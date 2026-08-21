import type { AIOperation } from '../../entities/types';
import type { CustomVaultOperation } from '../custom-vault-operations';
import type { ExtractionLogOptions } from '../claude-code-service';

export const AGENT_TURN_SCHEMA_VERSION = 'osint_copilot_agent_turn_v1' as const;

export type AgentRuntimeId = string;

export interface AgentRetrievalHit {
    path: string;
    snippet?: string;
}

/** One HTTP enricher to run in-plugin (no Bash); id matches JSON under the vault enrichers folder. */
export interface AgentEnricherInvocation {
    enricher_id: string;
    query: string;
}

export interface AgentTurnDiagnostics {
    provider: AgentRuntimeId;
    /** Short excerpt of raw model stdout for debugging (never full vault). */
    raw_excerpt?: string;
    notes?: string;
}

/**
 * Strict JSON contract returned by supported local agent CLIs for one chat turn.
 */
export interface AgentTurnResult {
    version: typeof AGENT_TURN_SCHEMA_VERSION;
    answer_markdown: string;
    retrieval_hits: AgentRetrievalHit[];
    /** Same shape as graph extraction `operations[]` entries (create entities + connections). */
    graph_operations: AIOperation[];
    /**
     * Proposed skill/credential file changes under OSINTCopilot/custom/.
     * The UI applies these only after explicit user confirmation (never auto-written).
     */
    custom_vault_operations: CustomVaultOperation[];
    /** Run after parse: plugin executes via Node HTTP (see enricher specs). */
    enricher_invocations: AgentEnricherInvocation[];
    diagnostics?: AgentTurnDiagnostics;
}

export interface AgentTurnContext {
    query: string;
    attachmentsContext: string;
    graphEntitiesSummary: string;
    conversationMemory: { role: string; content: string }[];
    vaultAugmentation?: string;
    /** Active enricher spec ids from vault JSON at prompt build time. */
    availableEnricherIds?: string[];
    enrichersFolderDisplay?: string;
}

export interface AgentProvider {
    readonly id: AgentRuntimeId;
    runTurn(
        ctx: AgentTurnContext,
        signal: AbortSignal | undefined,
        onProgress?: (message: string, percent: number) => void,
        logOptions?: ExtractionLogOptions,
    ): Promise<AgentTurnResult>;
    healthCheck(): Promise<boolean>;
}
