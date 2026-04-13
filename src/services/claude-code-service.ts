import { Entity, ProcessTextResponse, AIOperation } from '../entities/types';

export interface ClaudeCodeConfig {
    cliPath: string;
    model: string;
    maxTokens: number;
    timeoutMs: number;
}

const DEFAULT_CONFIG: ClaudeCodeConfig = {
    cliPath: 'claude',
    model: 'sonnet',
    maxTokens: 16000,
    timeoutMs: 120_000,
};

const SKILL_FILE = '.claude/GRAPH_EXTRACTION.md';

export class ClaudeCodeService {
    private config: ClaudeCodeConfig;
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

    private async resolveSkillContent(): Promise<string> {
        if (this.vaultSkillResolver) {
            try {
                const v = await this.vaultSkillResolver();
                if (v && v.trim().length > 0) return v.trim();
            } catch (e) {
                console.warn('[ClaudeCodeService] vault skill resolver failed:', e);
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
Output ONLY valid JSON: {"operations":[{"action":"create","entities":[{"type":"Person","properties":{"full_name":"...","notes":"..."}}],"connections":[{"from":0,"to":1,"relationship":"WORKS_AT"}]}]}
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
    ): Promise<ProcessTextResponse> {
        const prompt = await this.buildPrompt(text, existingEntities);

        onProgress?.('Invoking Claude Code CLI...', 30);

        try {
            const raw = await this.invokeCLI(prompt, signal);
            onProgress?.('Parsing response...', 80);

            const parsed = this.parseResponse(raw);
            if (!parsed) {
                return { success: false, error: 'Could not parse JSON from Claude response' };
            }

            const operations = this.normalizeOperations(parsed);
            onProgress?.('Extraction complete', 100);

            return { success: true, operations };
        } catch (err: any) {
            if (err.name === 'AbortError') throw err;
            console.error('[ClaudeCodeService] extraction failed:', err);
            return { success: false, error: err.message || String(err) };
        }
    }

    private invokeCLI(prompt: string, signal?: AbortSignal, maxTurns: number = 1): Promise<string> {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }

            const { execFile } = require('child_process') as typeof import('child_process');

            const args = [
                '--print',
                '--output-format', 'text',
                '--model', this.config.model,
                '--max-turns', String(maxTurns),
            ];

            const child = execFile(
                this.config.cliPath,
                args,
                {
                    timeout: this.config.timeoutMs,
                    maxBuffer: 10 * 1024 * 1024,
                    env: { ...process.env, NO_COLOR: '1' },
                },
                (error: any, stdout: string, stderr: string) => {
                    if (error) {
                        if (error.killed || error.signal === 'SIGTERM') {
                            reject(new DOMException('Aborted', 'AbortError'));
                        } else {
                            reject(new Error(`Claude CLI error (code ${error.code}): ${stderr || error.message}`));
                        }
                        return;
                    }
                    resolve(stdout);
                },
            );

            child.stdin?.write(prompt);
            child.stdin?.end();

            if (signal) {
                const onAbort = () => {
                    child.kill('SIGTERM');
                };
                signal.addEventListener('abort', onAbort, { once: true });
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
            entities: Array.isArray(op.entities) ? op.entities : undefined,
            connections: Array.isArray(op.connections) ? op.connections : undefined,
            updates: Array.isArray(op.updates) ? op.updates : undefined,
        }));
    }

    /**
     * General-purpose chat: send system + user messages to Claude CLI, return text.
     * Used for local search answer synthesis, entity extraction from queries, etc.
     */
    async chat(
        systemPrompt: string,
        userMessage: string,
        signal?: AbortSignal,
    ): Promise<string> {
        const prompt = systemPrompt
            ? `${systemPrompt}\n\n---\n\n${userMessage}`
            : userMessage;
        return this.invokeCLI(prompt, signal);
    }

    /**
     * Extract text and information from an image using Claude's vision capabilities.
     * Uses --max-turns 5 to allow Claude to read the file with its built-in tools.
     */
    async extractTextFromImage(absolutePath: string, signal?: AbortSignal): Promise<string> {
        const prompt = `Read the image file at "${absolutePath}" and extract ALL information from it.

Extract and return:
- All visible text (OCR), preserving structure
- Names of people, organizations, places
- Dates, phone numbers, email addresses, URLs, account numbers
- Any other identifiable data (IDs, addresses, license plates, etc.)
- A brief description of what the image shows

Return ONLY the extracted information as plain text. No markdown formatting, no commentary about the extraction process.`;

        return this.invokeCLI(prompt, signal, 5);
    }

    async isAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const { execFile } = require('child_process') as typeof import('child_process');
                execFile(this.config.cliPath, ['--version'], { timeout: 5000 }, (error: any) => {
                    resolve(!error);
                });
            } catch {
                resolve(false);
            }
        });
    }
}
