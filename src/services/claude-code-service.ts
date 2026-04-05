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
    private skillContent: string | null = null;
    private pluginDir: string;

    constructor(pluginDir: string, config?: Partial<ClaudeCodeConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.pluginDir = pluginDir;
    }

    updateConfig(config: Partial<ClaudeCodeConfig>) {
        Object.assign(this.config, config);
    }

    private getSkillContent(): string {
        if (this.skillContent) return this.skillContent;
        try {
            const nodePath = require('path') as typeof import('path');
            const nodeFs = require('fs') as typeof import('fs');
            const skillPath = nodePath.join(this.pluginDir, SKILL_FILE);
            this.skillContent = nodeFs.readFileSync(skillPath, 'utf-8');
        } catch {
            this.skillContent = this.getFallbackSkill();
        }
        return this.skillContent;
    }

    private getFallbackSkill(): string {
        return `You are an OSINT investigator AI. Extract entities and relationships from text.
Output ONLY valid JSON with this structure: {"operations":[{"action":"create","entities":[{"type":"Person","properties":{"full_name":"...","notes":"..."}}],"connections":[{"from":0,"to":1,"relationship":"WORKS_AT"}]}]}
Entity types: Person (full_name), Event (name, start_date, description), Company (name), Location (address, city, country), Email (address), Phone (number), Username (username), Vehicle (model), Website (title).
Relationships MUST be UPPERCASE. Notes must be comprehensive. If no entities found: {"operations":[]}`;
    }

    private buildPrompt(text: string, existingEntities?: Entity[]): string {
        const skill = this.getSkillContent();
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

Respond with ONLY the JSON object. No markdown fences, no explanation.`;
    }

    async extractEntities(
        text: string,
        existingEntities?: Entity[],
        onProgress?: (message: string, percent: number) => void,
        signal?: AbortSignal,
    ): Promise<ProcessTextResponse> {
        const prompt = this.buildPrompt(text, existingEntities);

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

    private invokeCLI(prompt: string, signal?: AbortSignal): Promise<string> {
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
                '--max-turns', '1',
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
