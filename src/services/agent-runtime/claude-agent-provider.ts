import type { GraphApiService } from '../api-service';
import { buildUnifiedAgentSystemPrompt, buildUnifiedAgentUserPrompt } from './build-unified-agent-prompt';
import { parseAgentTurnResult } from './parse-agent-turn-json';
import type { AgentProvider, AgentTurnContext, AgentTurnResult } from './provider-types';
export class ClaudeAgentProvider implements AgentProvider {
    readonly id = 'claude-code' as const;

    constructor(private readonly graphApi: GraphApiService) {}

    async runTurn(
        ctx: AgentTurnContext,
        signal: AbortSignal | undefined,
        onProgress?: (message: string, percent: number) => void,
    ): Promise<AgentTurnResult> {
        onProgress?.('Running Claude Code agent (JSON turn)...', 25);
        const system = buildUnifiedAgentSystemPrompt('Claude Code');
        const user = buildUnifiedAgentUserPrompt(ctx);
        const raw = await this.graphApi.callRemoteModel(
            [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            true,
            undefined,
            signal,
        );
        onProgress?.('Parsing agent response...', 85);
        return parseAgentTurnResult(raw, 'claude-code');
    }

    async healthCheck(): Promise<boolean> {
        const health = await this.graphApi.checkHealth();
        return health !== null && health.status === 'ok';
    }
}
