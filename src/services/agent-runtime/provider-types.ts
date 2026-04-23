import type { AIOperation } from '../../entities/types';

export const AGENT_TURN_SCHEMA_VERSION = 'osint_copilot_agent_turn_v1' as const;

export type AgentRuntimeId = 'claude-code' | 'hermes-agent';

export interface AgentRetrievalHit {
    path: string;
    snippet?: string;
}

export interface AgentTurnDiagnostics {
    provider: AgentRuntimeId;
    /** Short excerpt of raw model stdout for debugging (never full vault). */
    raw_excerpt?: string;
    notes?: string;
}

/**
 * Strict JSON contract returned by both Claude Code and Hermes agent CLIs for one chat turn.
 */
export interface AgentTurnResult {
    version: typeof AGENT_TURN_SCHEMA_VERSION;
    answer_markdown: string;
    retrieval_hits: AgentRetrievalHit[];
    /** Same shape as graph extraction `operations[]` entries (create entities + connections). */
    graph_operations: AIOperation[];
    diagnostics?: AgentTurnDiagnostics;
}

export interface AgentTurnContext {
    query: string;
    attachmentsContext: string;
    graphEntitiesSummary: string;
    conversationMemory: { role: string; content: string }[];
    vaultAugmentation?: string;
}

export interface AgentProvider {
    readonly id: AgentRuntimeId;
    runTurn(
        ctx: AgentTurnContext,
        signal: AbortSignal | undefined,
        onProgress?: (message: string, percent: number) => void,
    ): Promise<AgentTurnResult>;
    healthCheck(): Promise<boolean>;
}
