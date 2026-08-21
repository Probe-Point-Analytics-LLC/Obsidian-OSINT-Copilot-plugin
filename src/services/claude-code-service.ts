import { Entity, ProcessTextResponse, AIOperation, type OsintSourceInput } from '../entities/types';
import { splitCliArgsLine } from './agent-runtime/cli-args';

export interface ClaudeCodeConfig {
    cliPath: string;
    model: string;
    maxTokens: number;
    timeoutMs: number;
    /**
     * When set (e.g. Obsidian vault root from `adapter.getBasePath()`), passed as `cwd` to the CLI process
     * so the CLI resolves relative paths and sandbox allowlists consistently with the open vault.
     */
    cliWorkingDirectory?: string;
    /**
     * Extra argv appended after `--max-turns` (whitespace-separated), e.g. `--permission-mode bypassPermissions`.
     * Dangerous: allows unattended Bash if the model requests it.
     */
    extraCliArgs?: string;
}

/** Common surface implemented by local AI CLIs used by extraction, task agents, and chat. */
export interface LocalCliService {
    readonly providerId: string;
    readonly displayName: string;
    setVaultSkillResolver(resolver: (() => Promise<string | null>) | null): void;
    updateConfig(config: Partial<ClaudeCodeConfig>): void;
    extractEntities(
        text: string,
        existingEntities?: Entity[],
        onProgress?: (message: string, percent: number) => void,
        signal?: AbortSignal,
        logOptions?: ExtractionLogOptions,
    ): Promise<ProcessTextResponse>;
    chat(
        systemPrompt: string,
        userMessage: string,
        signal?: AbortSignal,
        logOptions?: ExtractionLogOptions,
        maxTurns?: number,
    ): Promise<string>;
    extractTextFromImage(
        absolutePath: string,
        signal?: AbortSignal,
        logOptions?: ExtractionLogOptions,
    ): Promise<string>;
    isAvailable(): Promise<boolean>;
}

export type ExtractionLogLevel = 'info' | 'warn' | 'error' | 'debug';
export type ExtractionLogPhase =
    | 'invoke_start'
    | 'stdin_sent'
    | 'invoke_exit'
    | 'parse_start'
    | 'parse_success'
    | 'parse_failed'
    | 'invoke_error'
    | 'invoke_aborted';

export interface ExtractionLogEvent {
    phase: ExtractionLogPhase;
    level: ExtractionLogLevel;
    message: string;
    file?: string;
    details?: string;
    timestamp: number;
}

export interface ExtractionLogOptions {
    emit?: (event: ExtractionLogEvent) => void;
    rawCli?: boolean;
}

const DEFAULT_CONFIG: ClaudeCodeConfig = {
    cliPath: 'claude',
    model: 'sonnet',
    maxTokens: 16000,
    timeoutMs: 300_000,
};

/** `--max-turns` for chat-style CLI calls; entity extraction uses a separate invoke with turns=1. */
const DEFAULT_CHAT_MAX_TURNS = 16;

const SKILL_FILE = '.claude/GRAPH_EXTRACTION.md';

export function sanitizeCliOutput(text: string, maxLen = 500): string {
    const cleaned = (text || '')
        .replace(/\x1b\[[0-9;]*m/g, '')
        .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
        .trim();
    if (cleaned.length <= maxLen) return cleaned;
    return `${cleaned.slice(0, maxLen)}…`;
}

export class ClaudeCodeService implements LocalCliService {
    readonly providerId: string = 'claude-code';
    readonly displayName: string = 'Claude Code';
    protected config: ClaudeCodeConfig;
    private pluginDir: string;
    /** When set, tried first for graph extraction skill (vault-editable). */
    private vaultSkillResolver: (() => Promise<string | null>) | null = null;

    constructor(pluginDir: string, config?: Partial<ClaudeCodeConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.pluginDir = pluginDir;
    }

    setVaultSkillResolver(resolver: (() => Promise<string | null>) | null): void {
        this.vaultSkillResolver = resolver;
    }

    updateConfig(config: Partial<ClaudeCodeConfig>) {
        Object.assign(this.config, config);
    }

    /** Build argv for one prompt. Subclasses can adapt another CLI while reusing extraction/parsing. */
    protected buildCliArgs(maxTurns: number, extra: string[], _imagePaths: string[]): string[] {
        return [
            '--print',
            '--output-format', 'text',
            '--model', this.config.model,
            '--max-turns', String(maxTurns),
            ...extra,
        ];
    }

    private async resolveSkillContent(): Promise<string> {
        if (this.vaultSkillResolver) {
            try {
                const v = await this.vaultSkillResolver();
                if (v && v.trim().length > 0) return v.trim();
            } catch (e) {
                console.warn(`[${this.displayName}] vault skill resolver failed:`, e);
            }
        }
        try {
            const nodePath = require('path') as typeof import('path');
            const nodeFs = require('fs') as typeof import('fs');
            const skillPath = nodePath.join(this.pluginDir, SKILL_FILE);
            return nodeFs.readFileSync(skillPath, 'utf-8');
        } catch {
            return this.getFallbackSkill();
        }
    }

    private getFallbackSkill(): string {
        return `You are an entity extraction engine. Extract entities and relationships from the provided text. Do NOT answer questions, do NOT propose plans — just extract entities and return JSON.
Output ONLY valid JSON: {"operations":[{"action":"create","entities":[{"type":"Person","properties":{"full_name":"...","notes":"..."},"sources":[{"inferred":false,"source_url":"https://example.com/page","rationale":"Where this was stated"}]}],"connections":[{"from":0,"to":1,"relationship":"WORKS_AT","sources":[{"inferred":false,"source_url":"https://...","rationale":"..."}]}]}]}
Each entity and each connection may include "sources": an array of { "source_url" (http(s) URL or vault path), "inferred" (boolean), "rationale" (short string), optional "claims": [ { "path": "properties.country", "value": "US" } ] }. Use inferred:true only when the source is not explicit in the text.
Entity types: Person (full_name), Event (name, start_date "YYYY-MM-DD HH:mm" REQUIRED, add_to_timeline: true REQUIRED, description), Company (name), Location (address REQUIRED, city REQUIRED, country REQUIRED, latitude, longitude), Email (address), Phone (number), Username (username), Vehicle (model), Website (title).
Rules: Relationships UPPERCASE. Notes comprehensive. Every Event MUST have start_date (never "unknown") and add_to_timeline:true. Create Location for every place/city/country mentioned. If no entities: {"operations":[]}`;
    }

    private async buildPrompt(text: string, existingEntities?: Entity[]): Promise<string> {
        const skill = await this.resolveSkillContent();
        const now = new Date();
        const refTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        let existingContext = '';
        if (existingEntities && existingEntities.length > 0) {
            const lines = existingEntities.slice(0, 50).map(e => {
                const propsStr = Object.entries(e.properties || {})
                    .filter(([k, v]) => v && k !== 'source' && k !== 'image')
                    .map(([k, v]) => `${k}: ${String(v).substring(0, 200)}`)
                    .join(', ');
                return `- ${e.type}: ${e.label}${propsStr ? ` (${propsStr})` : ''}`;
            });
            existingContext = `\n\nEXISTING ENTITIES (do not duplicate, update instead):\n${lines.join('\n')}`;
        }

        return `${skill}

REFERENCE TIME: ${refTime}
${existingContext}

=== TEXT TO ANALYZE ===
${text}

CRITICAL: Output ONLY the raw JSON object. No markdown fences, no prose, no investigation plan, no explanation. Just the {"operations": [...]} JSON.`;
    }

    async extractEntities(
        text: string,
        existingEntities?: Entity[],
        onProgress?: (message: string, percent: number) => void,
        signal?: AbortSignal,
        logOptions?: ExtractionLogOptions,
    ): Promise<ProcessTextResponse> {
        const prompt = await this.buildPrompt(text, existingEntities);

        onProgress?.(`Invoking ${this.displayName}...`, 30);
        logOptions?.emit?.({
            phase: 'invoke_start',
            level: 'info',
            message: `Invoking ${this.displayName} for entity extraction`,
            timestamp: Date.now(),
        });

        try {
            const raw = await this.invokeCLI(prompt, signal, 1, logOptions);
            onProgress?.('Parsing response...', 80);
            logOptions?.emit?.({
                phase: 'parse_start',
                level: 'info',
                message: 'Parsing extraction response JSON',
                timestamp: Date.now(),
            });

            const parsed = this.parseResponse(raw);
            if (!parsed) {
                logOptions?.emit?.({
                    phase: 'parse_failed',
                    level: 'warn',
                    message: 'Could not parse extraction response JSON',
                    details: sanitizeCliOutput(raw, 900),
                    timestamp: Date.now(),
                });
                return { success: false, error: `Could not parse JSON from ${this.displayName} response` };
            }

            const operations = this.normalizeOperations(parsed);
            onProgress?.('Extraction complete', 100);
            logOptions?.emit?.({
                phase: 'parse_success',
                level: 'info',
                message: `Extraction complete (${operations.length} operation${operations.length === 1 ? '' : 's'})`,
                timestamp: Date.now(),
            });

            return { success: true, operations };
        } catch (err: any) {
            if (err.name === 'AbortError') throw err;
            console.error(`[${this.displayName}] extraction failed:`, err);
            return { success: false, error: err.message || String(err) };
        }
    }

    protected invokeCLI(
        prompt: string,
        signal?: AbortSignal,
        maxTurns: number = 1,
        logOptions?: ExtractionLogOptions,
        imagePaths: string[] = [],
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                logOptions?.emit?.({
                    phase: 'invoke_aborted',
                    level: 'warn',
                    message: 'CLI invocation skipped because request is already aborted',
                    timestamp: Date.now(),
                });
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }

            const { execFile } = require('child_process') as typeof import('child_process');

            // Tracks whether *our* AbortSignal triggered the kill, as opposed to execFile's own
            // `timeout` option killing a slow-running process — both present identically as
            // `error.killed`/`error.signal === 'SIGTERM'`, but only the former is a real cancel.
            let killedByAbortSignal = false;
            let onAbort: (() => void) | null = null;
            let settled = false;

            const rejectOnce = (error: Error): void => {
                if (settled) return;
                settled = true;
                reject(error);
            };

            const extra = splitCliArgsLine(this.config.extraCliArgs ?? '');
            const args = this.buildCliArgs(maxTurns, extra, imagePaths);

            const cwd = this.config.cliWorkingDirectory?.trim();
            logOptions?.emit?.({
                phase: 'invoke_start',
                level: 'info',
                message: `Running ${this.displayName}: ${this.config.cliPath}${extra.length ? ` (+${extra.length} extra arg(s))` : ''}`,
                details: cwd ? `cwd=${cwd}` : 'cwd=(default)',
                timestamp: Date.now(),
            });
            const child = execFile(
                this.config.cliPath,
                args,
                {
                    timeout: this.config.timeoutMs,
                    maxBuffer: 10 * 1024 * 1024,
                    env: { ...process.env, NO_COLOR: '1' },
                    ...(cwd ? { cwd } : {}),
                },
                (error: any, stdout: string, stderr: string) => {
                    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
                    if (settled) return;
                    settled = true;
                    const errOut = stderr?.trim() ?? '';
                    const stdOut = stdout?.trim() ?? '';
                    if (error) {
                        if (killedByAbortSignal) {
                            logOptions?.emit?.({
                                phase: 'invoke_aborted',
                                level: 'warn',
                                message: `${this.displayName} process aborted`,
                                timestamp: Date.now(),
                            });
                            reject(new DOMException('Aborted', 'AbortError'));
                        } else {
                            // Some CLIs print fatal messages on stdout; include both for Obsidian notices and logs.
                            const combined = [errOut, stdOut].filter(Boolean).join('\n');
                            const timedOut = error.killed || error.signal === 'SIGTERM';
                            // A timeout kill leaves no useful stderr/stdout, and Node's own error.message
                            // ("Command failed: ...") is just the invoked command line, not a real
                            // explanation — prefer the clear timeout message over that generic text.
                            const tail = combined ||
                                (timedOut ? `${this.displayName} timed out after ${this.config.timeoutMs}ms and was killed` : null) ||
                                error.message || 'unknown error';
                            logOptions?.emit?.({
                                phase: 'invoke_error',
                                level: 'error',
                                message: `${this.displayName} failed (code ${error.code})`,
                                details: logOptions?.rawCli ? tail : sanitizeCliOutput(tail, 1200),
                                timestamp: Date.now(),
                            });
                            console.error(`[${this.displayName}] CLI failed`, { code: error.code, stderr: errOut, stdout: stdOut });
                            reject(new Error(`${this.displayName} error (code ${error.code}): ${tail}`));
                        }
                        return;
                    }
                    logOptions?.emit?.({
                        phase: 'invoke_exit',
                        level: 'info',
                        message: `${this.displayName} completed successfully`,
                        details: logOptions?.rawCli ? stdOut : sanitizeCliOutput(stdOut, 400),
                        timestamp: Date.now(),
                    });
                    resolve(stdout);
                },
            );

            if (signal) {
                onAbort = () => {
                    killedByAbortSignal = true;
                    child.kill('SIGTERM');
                };
                signal.addEventListener('abort', onAbort, { once: true });
                if (signal.aborted) onAbort();
            }

            if (!killedByAbortSignal) {
                const stdin = child.stdin;
                if (stdin) {
                    // A CLI can reject argv and exit before a large prompt is written. Without
                    // an error listener Node treats the resulting EPIPE as an uncaught exception.
                    stdin.on('error', (stdinError: NodeJS.ErrnoException) => {
                        if (stdinError.code === 'EPIPE' || killedByAbortSignal || child.killed) return;
                        child.kill('SIGTERM');
                        rejectOnce(new Error(`${this.displayName} stdin error: ${stdinError.message}`));
                    });
                    try {
                        stdin.end(prompt, () => {
                            if (settled || killedByAbortSignal) return;
                            logOptions?.emit?.({
                                phase: 'stdin_sent',
                                level: 'debug',
                                message: `Prompt sent to ${this.displayName} stdin`,
                                timestamp: Date.now(),
                            });
                        });
                    } catch (stdinError) {
                        child.kill('SIGTERM');
                        const message = stdinError instanceof Error ? stdinError.message : String(stdinError);
                        rejectOnce(new Error(`${this.displayName} stdin error: ${message}`));
                    }
                }
            }
        });
    }

    private parseResponse(raw: string): any | null {
        const trimmed = raw.trim();

        // Try direct parse first
        try {
            const data = JSON.parse(trimmed);
            if (data.operations) return data;
        } catch { /* fall through */ }

        // Extract JSON from possible markdown fences or surrounding text
        const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (fenceMatch) {
            try {
                const data = JSON.parse(fenceMatch[1].trim());
                if (data.operations) return data;
            } catch { /* fall through */ }
        }

        // Find the largest balanced JSON object
        const stack: number[] = [];
        let start = -1;
        let bestStart = -1;
        let bestEnd = -1;

        for (let i = 0; i < trimmed.length; i++) {
            if (trimmed[i] === '{') {
                if (start === -1) start = i;
                stack.push(i);
            } else if (trimmed[i] === '}' && stack.length > 0) {
                stack.pop();
                if (stack.length === 0) {
                    const len = i - start + 1;
                    if (bestStart === -1 || len > (bestEnd - bestStart + 1)) {
                        bestStart = start;
                        bestEnd = i;
                    }
                    start = -1;
                }
            }
        }

        if (bestStart >= 0) {
            let candidate = trimmed.substring(bestStart, bestEnd + 1);
            candidate = candidate.replace(/,(\s*[}\]])/g, '$1');
            try {
                const data = JSON.parse(candidate);
                if (data.operations) return data;
                if (data.action) return { operations: [data] };
            } catch { /* fall through */ }
        }

        return null;
    }

    private normalizeOperations(data: any): AIOperation[] {
        if (!data?.operations || !Array.isArray(data.operations)) return [];
        return data.operations.map((op: any) => ({
            action: op.action || 'create',
            entities: Array.isArray(op.entities)
                ? op.entities.map((e: any) => ({
                      type: String(e.type ?? ''),
                      properties: (e.properties && typeof e.properties === 'object' ? e.properties : {}) as Record<
                          string,
                          unknown
                      >,
                      sources: Array.isArray(e.sources)
                          ? (e.sources as OsintSourceInput[])
                          : undefined,
                  }))
                : undefined,
            connections: Array.isArray(op.connections)
                ? op.connections.map((c: any) => ({
                      from: Number(c.from),
                      to: Number(c.to),
                      relationship: String(c.relationship ?? ''),
                      from_label: c.from_label,
                      to_label: c.to_label,
                      from_type: c.from_type,
                      to_type: c.to_type,
                      sources: Array.isArray(c.sources)
                          ? (c.sources as OsintSourceInput[])
                          : undefined,
                  }))
                : undefined,
            updates: Array.isArray(op.updates) ? op.updates : undefined,
        }));
    }

    /**
     * General-purpose chat: send system + user messages to this CLI and return text.
     * Used for local search answer synthesis, entity extraction from queries, etc.
     */
    async chat(
        systemPrompt: string,
        userMessage: string,
        signal?: AbortSignal,
        logOptions?: ExtractionLogOptions,
        maxTurns: number = DEFAULT_CHAT_MAX_TURNS,
    ): Promise<string> {
        const prompt = systemPrompt
            ? `${systemPrompt}\n\n---\n\n${userMessage}`
            : userMessage;
        return this.invokeCLI(prompt, signal, maxTurns, logOptions);
    }

    /**
     * Extract text and information from an image using Claude's vision capabilities.
     * Uses --max-turns 5 to allow Claude to read the file with its built-in tools.
     */
    async extractTextFromImage(absolutePath: string, signal?: AbortSignal, logOptions?: ExtractionLogOptions): Promise<string> {
        const prompt = `Read the image file at "${absolutePath}" and extract ALL information from it.

Extract and return:
- All visible text (OCR), preserving structure
- Names of people, organizations, places
- Dates, phone numbers, email addresses, URLs, account numbers
- Any other identifiable data (IDs, addresses, license plates, etc.)
- A brief description of what the image shows

Return ONLY the extracted information as plain text. No markdown formatting, no commentary about the extraction process.`;

        return this.invokeCLI(prompt, signal, 5, {
            ...logOptions,
            emit: (event) => {
                logOptions?.emit?.({
                    ...event,
                    file: absolutePath,
                });
            },
        }, [absolutePath]);
    }

    async isAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const { execFile } = require('child_process') as typeof import('child_process');
                const cwd = this.config.cliWorkingDirectory?.trim();
                execFile(this.config.cliPath, ['--version'], {
                    timeout: 5000,
                    ...(cwd ? { cwd } : {}),
                }, (error: any) => {
                    resolve(!error);
                });
            } catch {
                resolve(false);
            }
        });
    }
}
