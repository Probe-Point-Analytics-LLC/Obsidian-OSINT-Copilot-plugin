import { execFile } from 'child_process';
import { buildUnifiedAgentSystemPrompt, buildUnifiedAgentUserPrompt } from './build-unified-agent-prompt';
import { parseAgentTurnResult } from './parse-agent-turn-json';
import type { AgentProvider, AgentTurnContext, AgentTurnResult } from './provider-types';

export interface HermesAgentRuntimeConfig {
    cliPath: string;
    /** Extra argv tokens after the executable (e.g. "run --json"). Split on whitespace. */
    extraArgs: string;
    timeoutMs: number;
    /** argv tokens for health check (default asks for --version). */
    healthCheckArgs: string;
}

function splitArgv(line: string): string[] {
    const s = line.trim();
    if (!s) return [];
    return s.split(/\s+/).filter(Boolean);
}

export class HermesAgentProvider implements AgentProvider {
    readonly id = 'hermes-agent' as const;

    constructor(private readonly cfg: HermesAgentRuntimeConfig) {}

    async runTurn(
        ctx: AgentTurnContext,
        signal: AbortSignal | undefined,
        onProgress?: (message: string, percent: number) => void,
    ): Promise<AgentTurnResult> {
        onProgress?.('Running Hermes agent (JSON turn)...', 25);
        const system = buildUnifiedAgentSystemPrompt('Hermes Agent');
        const user = buildUnifiedAgentUserPrompt(ctx);
        const fullPrompt = `${system}\n\n---\n\n${user}`;

        const args = splitArgv(this.cfg.extraArgs);
        const stdout = await this.invokeHermes(fullPrompt, args, signal);
        onProgress?.('Parsing agent response...', 85);
        return parseAgentTurnResult(stdout, 'hermes-agent');
    }

    private invokeHermes(prompt: string, args: string[], signal: AbortSignal | undefined): Promise<string> {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }
            const child = execFile(
                this.cfg.cliPath || 'hermes',
                args,
                {
                    encoding: 'utf8',
                    timeout: this.cfg.timeoutMs || 120_000,
                    maxBuffer: 10 * 1024 * 1024,
                    env: { ...process.env, NO_COLOR: '1' },
                },
                (error: Error | null, stdout: string, stderr: string) => {
                    if (error) {
                        const anyErr = error as { killed?: boolean; signal?: string; code?: string | number | null };
                        if (anyErr.killed || anyErr.signal === 'SIGTERM') {
                            reject(new DOMException('Aborted', 'AbortError'));
                        } else {
                            reject(
                                new Error(
                                    `Hermes CLI error (code ${anyErr.code ?? '?'}): ${stderr || error.message}`,
                                ),
                            );
                        }
                        return;
                    }
                    resolve(stdout || '');
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

    async healthCheck(): Promise<boolean> {
        const args = splitArgv(this.cfg.healthCheckArgs);
        try {
            await new Promise<void>((resolve, reject) => {
                execFile(
                    this.cfg.cliPath || 'hermes',
                    args.length ? args : ['--version'],
                    {
                        encoding: 'utf8',
                        timeout: 8000,
                        maxBuffer: 1024 * 1024,
                        env: { ...process.env, NO_COLOR: '1' },
                    },
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    },
                );
            });
            return true;
        } catch {
            try {
                await new Promise<void>((resolve, reject) => {
                    execFile(
                        this.cfg.cliPath || 'hermes',
                        ['-h'],
                        {
                            encoding: 'utf8',
                            timeout: 8000,
                            maxBuffer: 1024 * 1024,
                            env: { ...process.env, NO_COLOR: '1' },
                        },
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        },
                    );
                });
                return true;
            } catch {
                return false;
            }
        }
    }
}
