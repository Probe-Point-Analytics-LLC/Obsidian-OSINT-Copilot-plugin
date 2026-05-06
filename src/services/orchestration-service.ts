import VaultAIPlugin from "../../main";
import { App, Notice, TFile } from 'obsidian';
import { GraphApiService } from './api-service';
import {
    AIOperation,
    EntityType,
    getEntityLabel,
    isFTMSchema,
    ProcessTextResponse,
    type GraphWriteContext,
    type OsintSourceInput,
} from '../entities/types';
import { buildInferredOsintSources } from './osint-confidence-engine';
import { ConfirmModal } from '../modals/confirm-modal';
import { parseVaultSkillPlannerTool } from '../skills/skill-runtime';
import { executeEnricherTool, executeVaultSkillTool } from '../skills/skill-executor';
import { enrichToolId, parseEnrichToolId } from './enrichers/enricher-schema';
import { createAgentProvider } from './agent-runtime/create-agent-provider';
import type { AgentTurnContext } from './agent-runtime/provider-types';
import { aiOperationsToGraphCommands } from './graph-commands-from-operations';
import type { CustomVaultOperation } from './custom-vault-operations';

export interface OrchestrationPlan {
    reasoning: string;
    planSummary?: string; // Summary of what will be done for user review
    isProposal?: boolean; // If true, the agent is asking for approval
    toolsToCall: string[]; // e.g., ['LOCAL_VAULT', 'EXTRACT_TO_GRAPH', 'VAULT_GRAPH_INGEST']
    graphCommands: string[]; // e.g., ['@@CREATE: {...}', '@@DELETE: {...}']
    directResponse?: string; // If no tools needed or as a final response
}

export interface OrchestrationResult {
    finalResponse: string;
    proposedCommands?: string[];
    /** Unified agent: proposed skill/credential file ops (applied only after user confirms in chat). */
    proposedCustomVaultOps?: CustomVaultOperation[];
    toolResults?: Record<string, any>;
    plan?: OrchestrationPlan;
    phase?: "TOOLS_COMPLETE" | "SYNTHESIS_COMPLETE";
}

/** Display names for orchestration tool ids (UI + progress rows). */
export const ORCHESTRATION_TOOL_DISPLAY_NAMES: Record<string, string> = {
    LOCAL_VAULT: "Local Search",
    EXTRACT_TO_GRAPH: "Extract to graph",
};

/** Optional metadata for orchestration progress callbacks (multi-tool UI). */
export interface OrchestrationProgressMeta {
    orchestrationTool?: string;
}

export interface ExecuteToolsParallelOptions {
    /** Per-tool cancellation (tool id → signal). */
    abortSignals?: Record<string, AbortSignal>;
    /** Cancels all tools (e.g. main chat Cancel). */
    globalAbort?: AbortSignal;
}

export interface ProcessRequestOptions {
    abortSignal?: AbortSignal;
    /** Called when multiple tools run; return per-tool signals for cooperative cancel. */
    onToolsStarting?: (tools: string[]) => Record<string, AbortSignal> | void;
}

/** Options for applying @@ graph commands (provenance context when sources are omitted). */
export interface ExecuteGraphCommandsOptions {
    showErrorNotices: boolean;
    graphWriteContext?: GraphWriteContext;
}

export class OrchestrationService {
    private plugin: VaultAIPlugin;

    constructor(plugin: VaultAIPlugin) {
        this.plugin = plugin;
    }


    private async verifyProviderAndCredits(): Promise<void> {
        // All AI calls are routed through Claude Code CLI locally — no remote credits needed.
    }

    private mergeAbortSignals(global?: AbortSignal, perTool?: AbortSignal): AbortSignal | undefined {
        if (!global && !perTool) return undefined;
        if (!global) return perTool;
        if (!perTool) return global;
        const c = new AbortController();
        const onAbort = () => {
            if (!c.signal.aborted) c.abort();
        };
        global.addEventListener("abort", onAbort);
        perTool.addEventListener("abort", onAbort);
        if (global.aborted || perTool.aborted) onAbort();
        return c.signal;
    }

    public async processRequest(
        query: string,
        attachmentsContext: string,
        currentGraphState: any,
        conversationMemory: { role: string, content: string }[],
        currentConversation: any,
        onProgress: (msg: string, percent: number, meta?: OrchestrationProgressMeta) => void,
        options?: ProcessRequestOptions
    ): Promise<OrchestrationResult> {
        try {
            return await this.processRequestUnified(
                query,
                attachmentsContext,
                currentGraphState,
                conversationMemory,
                onProgress,
                options,
            );
        } catch (error) {
            console.error("[OrchestrationService] Error:", error);
            this.handleError(error);
            throw error;
        }
    }

    /**
     * Phase 2: Called AFTER user reviews tool results.
     * Synthesizes the final response and generates graph modifications from all combined tool data.
     */
    public async continueAfterToolReview(
        toolResults: Record<string, any>,
        plan: OrchestrationPlan,
        query: string,
        currentGraphState: any,
        conversationMemory: { role: string, content: string }[],
        onProgress: (msg: string, percent: number) => void
    ): Promise<OrchestrationResult> {
        try {
            let proposedCommands: string[] | undefined;

            const vaultIngestAutoApplied =
                toolResults["VAULT_GRAPH_INGEST"] &&
                typeof toolResults["VAULT_GRAPH_INGEST"] === "object" &&
                (toolResults["VAULT_GRAPH_INGEST"] as { __vaultIngestAutoApplied?: boolean }).__vaultIngestAutoApplied === true;

            // Generate graph entities from ALL combined tool results
            if (this.plugin.settings.enableGraphFeatures && Object.keys(toolResults).length > 0) {
                onProgress("Generating graph entities from all tool results...", 30);
                const extraCommands = await this.feedResultsToGraphExtraction(toolResults);
                if (extraCommands.length > 0) {
                    if (!plan.graphCommands) plan.graphCommands = [];
                    plan.graphCommands = [...plan.graphCommands, ...extraCommands];
                }
            }

            if (!vaultIngestAutoApplied && plan.graphCommands && plan.graphCommands.length > 0) {
                onProgress(`Preparing ${plan.graphCommands.length} graph modifications...`, 50);
                proposedCommands = plan.graphCommands;
            }

            // Synthesize final analytical response
            onProgress("Synthesizing final analysis from all tool results...", 70);
            const finalResponse = await this.generateFinalResponse(plan, toolResults, query, currentGraphState, conversationMemory);

            onProgress("Complete", 100);
            return { finalResponse, proposedCommands, phase: "SYNTHESIS_COMPLETE" };
        } catch (error) {
            console.error("[OrchestrationService] Error in continueAfterToolReview:", error);
            this.handleError(error);
            throw error;
        }
    }

    private buildGraphEntitiesSummary(graphState: any): string {
        const entities = graphState?.entities;
        if (!Array.isArray(entities) || entities.length === 0) {
            return "Empty graph.";
        }
        const lines = entities
            .slice(0, 50)
            .map((e: { type?: string; label?: string; id?: string }) => `- ${e.type ?? "?"}: ${e.label ?? e.id ?? "?"}`);
        if (entities.length > 50) {
            lines.push(`... and ${entities.length - 50} more entities`);
        }
        return lines.join("\n");
    }

    /**
     * Single local agent turn (Claude Code or Hermes): vault search + graph extraction via the external agent's skills.
     */
    private async processRequestUnified(
        query: string,
        attachmentsContext: string,
        currentGraphState: any,
        conversationMemory: { role: string, content: string }[],
        onProgress: (msg: string, percent: number, meta?: OrchestrationProgressMeta) => void,
        options?: ProcessRequestOptions,
    ): Promise<OrchestrationResult> {
        const checkAborted = () => {
            if (options?.abortSignal?.aborted) {
                throw new DOMException("Aborted", "AbortError");
            }
        };

        await this.verifyProviderAndCredits();
        checkAborted();
        onProgress("Preparing unified local agent...", 10);

        let ctx = attachmentsContext;
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const urls = query.match(urlRegex);
        if (urls && urls.length > 0) {
            onProgress(`Extracting content from ${urls.length} link(s)...`, 15);
            for (const url of urls) {
                checkAborted();
                try {
                    const extractedText = await this.plugin.graphApiService.extractTextFromUrl(url);
                    ctx += `\n\n=== Content from ${url} ===\n${extractedText}`;
                } catch (e) {
                    console.error(`[OrchestrationService] Failed to extract from URL ${url}:`, e);
                    ctx += `\n\n=== Content from ${url} ===\n[Failed to extract content: ${
                        e instanceof Error ? e.message : String(e)
                    }]`;
                }
            }
        }

        onProgress("Running unified agent...", 35);
        checkAborted();

        let vaultAug = "";
        try {
            vaultAug = (await this.plugin.vaultPromptLoader?.getOrchestrationAugmentation()) ?? "";
        } catch (e) {
            console.warn("[OrchestrationService] vault prompts:", e);
        }

        let availableEnricherIds: string[] = [];
        try {
            const runnable = await this.plugin.enricherRegistry.listRunnable();
            availableEnricherIds = runnable.map((e) => e.id);
            // #region agent log
            fetch('http://127.0.0.1:7289/ingest/198dc7b8-9272-4918-abeb-9aa01fcb3925',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9b4ad8'},body:JSON.stringify({sessionId:'9b4ad8',location:'orchestration-service.ts:processRequestUnified',message:'listRunnable for agent ctx',data:{hypothesisId:'H1',count:availableEnricherIds.length,idsSample:availableEnricherIds.slice(0,15)},timestamp:Date.now(),runId:'enricher-prompt-v1'})}).catch(()=>{});
            // #endregion
        } catch (e) {
            console.warn("[OrchestrationService] enricher registry:", e);
        }

        const agentCtx: AgentTurnContext = {
            query,
            attachmentsContext: ctx,
            graphEntitiesSummary: this.buildGraphEntitiesSummary(currentGraphState),
            conversationMemory,
            vaultAugmentation: vaultAug,
            availableEnricherIds,
            enrichersFolderDisplay: this.plugin.settings.enrichersFolder,
        };

        const provider = createAgentProvider(this.plugin);
        try {
            const turn = await provider.runTurn(agentCtx, options?.abortSignal, (msg, pct) => onProgress(msg, pct));
            checkAborted();

            let answer = turn.answer_markdown || "";
            if (turn.retrieval_hits?.length) {
                const srcLines = turn.retrieval_hits
                    .map((h) => {
                        const sn = h.snippet ? ` — _${h.snippet.slice(0, 200)}${h.snippet.length > 200 ? "…" : ""}_` : "";
                        return `- \`${h.path}\`${sn}`;
                    })
                    .join("\n");
                answer += `\n\n### Retrieval\n${srcLines}`;
            }

            if (turn.enricher_invocations?.length) {
                const n = turn.enricher_invocations.length;
                const blocks: string[] = [];
                let enricherOk = 0;
                let enricherFail = 0;
                for (let i = 0; i < n; i++) {
                    const inv = turn.enricher_invocations[i];
                    const pct = 55 + Math.round(((i + 0.5) / n) * 38);
                    onProgress(`Enricher ${i + 1}/${n} (${inv.enricher_id})…`, Math.min(93, pct));
                    checkAborted();
                    const toolId = enrichToolId(inv.enricher_id);
                    const querySnippet =
                        inv.query.length > 120 ? `${inv.query.slice(0, 117)}…` : inv.query;
                    const heading = `### Enricher \`${inv.enricher_id}\` — \`${querySnippet.replace(/`/g, "'")}\``;
                    try {
                        const out = await executeEnricherTool(
                            this.plugin,
                            toolId,
                            inv.query,
                            ctx,
                            options?.abortSignal,
                        );
                        if (out.includes("Unknown enricher")) enricherFail++;
                        else enricherOk++;
                        blocks.push(`${heading}\n\n${out}`);
                    } catch (err) {
                        enricherFail++;
                        const msg = err instanceof Error ? err.message : String(err);
                        blocks.push(`${heading}\n\n**Error:** ${msg}`);
                    }
                }
                if (blocks.length) {
                    let statusLine = "";
                    if (enricherOk > 0 && enricherFail === 0) {
                        statusLine = `\n\n**Plugin status:** ${enricherOk} enricher call(s) completed.\n\n`;
                    } else if (enricherFail > 0 && enricherOk === 0) {
                        statusLine = `\n\n**Plugin status:** No enricher HTTP requests succeeded (${enricherFail} failed). The assistant text above may still describe success — rely on this section.\n\n`;
                    } else if (enricherOk > 0 && enricherFail > 0) {
                        statusLine = `\n\n**Plugin status:** ${enricherOk} succeeded, ${enricherFail} failed — verify \`enricher_id\` matches each JSON \`id\`.\n\n`;
                    }
                    answer += `\n\n---\n\n## Enricher results${statusLine}${blocks.join("\n\n---\n\n")}`;
                }
            }

            let proposedCommands: string[] | undefined;
            if (this.plugin.settings.enableGraphFeatures && turn.graph_operations?.length) {
                proposedCommands = aiOperationsToGraphCommands(turn.graph_operations);
            }

            const proposedCustomVaultOps =
                turn.custom_vault_operations?.length ? turn.custom_vault_operations : undefined;

            onProgress("Complete", 100);
            return {
                finalResponse: answer,
                proposedCommands,
                proposedCustomVaultOps,
                phase: "SYNTHESIS_COMPLETE",
            };
        } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") {
                throw e;
            }
            const msg = e instanceof Error ? e.message : String(e);
            console.error("[OrchestrationService] Unified agent failed:", e);
            onProgress("Complete", 100);
            return {
                finalResponse: `**Unified agent error (${provider.id})**\n\n${msg}`,
                phase: "SYNTHESIS_COMPLETE",
            };
        }
    }

    private async getVaultPromptAugmentation(): Promise<string> {
        try {
            return (await this.plugin.vaultPromptLoader?.getOrchestrationAugmentation()) ?? "";
        } catch (e) {
            console.warn("[OrchestrationService] vault prompts:", e);
            return "";
        }
    }

    private static readonly VAULT_INGEST_MAX_FILES = 200;
    private static readonly VAULT_INGEST_BATCH_SIZE = 5;
    /** Extensions processed during vault graph ingest (text read locally; binary sent to /api/extract-text). */
    private static readonly VAULT_INGEST_EXTENSIONS = new Set([
        'md',
        'markdown',
        'txt',
        'pdf',
        'png',
        'jpg',
        'jpeg',
        'webp',
        'gif',
        'doc',
        'docx',
    ]);

    private mimeTypeForIngestExtension(ext: string): string {
        const e = ext.toLowerCase();
        const map: Record<string, string> = {
            pdf: 'application/pdf',
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            webp: 'image/webp',
            gif: 'image/gif',
            doc: 'application/msword',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            md: 'text/markdown',
            markdown: 'text/markdown',
            txt: 'text/plain',
        };
        return map[e] || 'application/octet-stream';
    }

    private shouldSkipVaultPath(path: string): boolean {
        const p = path.replace(/\\/g, "/").toLowerCase();
        if (p.startsWith(".obsidian/") || p.includes("/.obsidian/")) return true;
        if (p.startsWith(".git/") || p.includes("/.git/")) return true;
        if (p.includes("node_modules/")) return true;
        return false;
    }

    /**
     * Walk ingestible vault files, extract entities per batch with local Claude CLI,
     * and auto-apply graph commands as each batch completes.
     */
    private async runVaultGraphIngest(
        onFileProgress: (
            message: string,
            percent: number,
            detail?: { vaultIngestAppliedLine?: string; vaultIngestAccumulatedCommands?: string[] }
        ) => void,
        abortSignal?: AbortSignal
    ): Promise<{
        summary: string;
        graphCommands: string[];
        filesProcessed: number;
        filesTotal: number;
        truncatedFiles: number;
        extractFailures: number;
    }> {
        const vaultFiles = this.plugin.app.vault.getFiles();
        const files = vaultFiles
            .filter((f): f is TFile => f instanceof TFile)
            .filter((f) => !this.shouldSkipVaultPath(f.path))
            .filter((f) => OrchestrationService.VAULT_INGEST_EXTENSIONS.has((f.extension || '').toLowerCase()))
            .sort((a, b) => a.path.localeCompare(b.path));

        const maxFiles = Math.min(files.length, OrchestrationService.VAULT_INGEST_MAX_FILES);
        const filesToProcess = files.slice(0, maxFiles);
        const BATCH = OrchestrationService.VAULT_INGEST_BATCH_SIZE;
        const totalBatches = Math.ceil(filesToProcess.length / BATCH) || 1;

        const graphCommands: string[] = [];
        let filesProcessed = 0;
        let extractFailures = 0;
        const refTime = new Date().toISOString();

        for (let b = 0; b < totalBatches; b++) {
            if (abortSignal?.aborted) break;

            const batchFiles = filesToProcess.slice(b * BATCH, (b + 1) * BATCH);
            const batchLabel = `Batch ${b + 1}/${totalBatches}`;
            const basePct = Math.floor((b / totalBatches) * 90) + 5;

            onFileProgress(
                `${batchLabel}: reading ${batchFiles.length} file(s) for local extraction…`,
                basePct,
            );

            const parts: string[] = [];
            for (const f of batchFiles) {
                try {
                    const text = await this.plugin.app.vault.cachedRead(f);
                    parts.push(`=== ${f.path} ===\n${text}`);
                } catch (e) {
                    console.error(`[OrchestrationService] Failed to read ${f.path}:`, e);
                    extractFailures += 1;
                }
            }

            const combined = parts.join("\n\n");
            if (!combined.trim()) {
                extractFailures += batchFiles.length;
                continue;
            }

            let extraction: ProcessTextResponse;
            try {
                onFileProgress(`${batchLabel}: extracting entities (local Claude)…`, basePct + 2);
                extraction = await this.plugin.graphApiService.processTextInChunks(
                    combined,
                    this.plugin.entityManager.getAllEntities(),
                    refTime,
                    (chunkIndex, totalChunks, message) => {
                        if (abortSignal?.aborted) return;
                        const scaled =
                            basePct + 2 + Math.floor((chunkIndex / Math.max(totalChunks, 1)) * (80 / totalBatches));
                        onFileProgress(`${batchLabel}: ${message}`, Math.min(scaled, 94));
                    },
                    undefined,
                    abortSignal,
                    true,
                );
            } catch (e) {
                if (e instanceof DOMException && e.name === "AbortError") break;
                console.error(`[OrchestrationService] Local ingest batch ${b + 1} failed:`, e);
                extractFailures += batchFiles.length;
                continue;
            }

            const batchCmds =
                extraction.success && extraction.operations?.length
                    ? aiOperationsToGraphCommands(extraction.operations)
                    : [];

            if (!extraction.success) {
                extractFailures += batchFiles.length;
            }

            const ingestCtx: GraphWriteContext = {
                query: `Vault graph ingest (${batchLabel})`,
                captured_at: refTime,
            };
            for (const cmd of batchCmds) {
                const lines = await this.executeGraphCommandsImmediate([cmd], {
                    showErrorNotices: false,
                    graphWriteContext: ingestCtx,
                });
                graphCommands.push(cmd);
                for (const line of lines) {
                    onFileProgress(
                        `${batchLabel}: ${line}`,
                        basePct,
                        { vaultIngestAppliedLine: line },
                    );
                }
            }

            filesProcessed += batchFiles.length;
        }

        const summary =
            (abortSignal?.aborted ? "**Cancelled by user.** " : "") +
            `Processed **${filesProcessed}** file(s) out of **${files.length}** eligible (cap ${OrchestrationService.VAULT_INGEST_MAX_FILES}), ` +
            `in **${totalBatches}** batch(es) of up to ${BATCH} files (**local Claude** extraction). ` +
            (extractFailures > 0 ? `**${extractFailures}** file(s) or batch(es) had issues. ` : "") +
            `**${graphCommands.length}** graph operation(s) were **applied automatically** to your vault graph.`;

        return {
            summary,
            graphCommands,
            filesProcessed,
            filesTotal: files.length,
            truncatedFiles: 0,
            extractFailures,
        };
    }

    public async executeToolsInParallel(
        tools: string[],
        query: string,
        attachmentsContext: string,
        currentConversation: any,
        onProgress: (
            tool: string,
            message: string,
            percent: number,
            detail?: { vaultIngestAccumulatedCommands?: string[]; vaultIngestAppliedLine?: string }
        ) => void,
        options?: ExecuteToolsParallelOptions
    ): Promise<Record<string, any>> {
        const results: Record<string, any> = {};

        const toolToDisplayName = ORCHESTRATION_TOOL_DISPLAY_NAMES;

        const isCancelled = (toolId: string) =>
            options?.globalAbort?.aborted === true ||
            options?.abortSignals?.[toolId]?.aborted === true;

        const vaultSkillList = await this.plugin.skillRegistry.listVaultSkills();
        const enricherList = await this.plugin.enricherRegistry.listRunnable();
        const vaultSkillTitle = (toolId: string): string => {
            const id = parseVaultSkillPlannerTool(toolId);
            if (!id) return toolId;
            const m = vaultSkillList.find((s) => s.id === id);
            return m?.name || toolId;
        };
        const enricherTitle = (toolId: string): string => {
            const id = parseEnrichToolId(toolId);
            if (!id) return toolId;
            const m = enricherList.find((e) => e.id === id);
            return m?.name || toolId;
        };

        const promises = tools.map(async (tool) => {
            const displayName =
                toolToDisplayName[tool] ||
                (tool.startsWith("SKILL_") ? vaultSkillTitle(tool) : tool.startsWith("ENRICH_") ? enricherTitle(tool) : tool);
            try {
                switch (tool) {
                    case "LOCAL_VAULT": {
                        if (isCancelled("LOCAL_VAULT")) {
                            results["LOCAL_VAULT"] = "Cancelled by user.";
                            onProgress(displayName, "Cancelled", 100);
                            break;
                        }
                        onProgress(displayName, "Searching Obsidian vault...", 20);
                        const searchTerms = query.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
                        const files = this.plugin.app.vault.getMarkdownFiles();
                        const matching: string[] = [];
                        for (const file of files) {
                            if (isCancelled("LOCAL_VAULT")) break;
                            if (matching.length >= 10) break;
                            const content = await this.plugin.app.vault.cachedRead(file);
                            if (searchTerms.some(t => content.toLowerCase().includes(t.toLowerCase()))) {
                                matching.push(`File: ${file.path}\nContent Preview: ${content.substring(0, 500)}...`);
                            }
                        }
                        results["LOCAL_VAULT"] = isCancelled("LOCAL_VAULT")
                            ? "Cancelled by user."
                            : matching.length > 0
                              ? matching.join("\n\n---\n\n")
                              : "No relevant local notes found.";
                        if (isCancelled("LOCAL_VAULT")) {
                            onProgress(displayName, "Cancelled", 100);
                        } else {
                            onProgress(displayName, "Complete", 100);
                        }
                        break;
                    }

                    case "EXTRACT_TO_GRAPH": {
                        if (isCancelled("EXTRACT_TO_GRAPH")) {
                            results["EXTRACT_TO_GRAPH"] = "Cancelled by user.";
                            onProgress(displayName, "Cancelled", 100);
                            break;
                        }
                        onProgress(displayName, "Extracting entities to graph (local Claude)...", 40);
                        if (!attachmentsContext || attachmentsContext.trim() === '') {
                            results["EXTRACT_TO_GRAPH"] = "No attachments provided.";
                            onProgress(displayName, "No context", 100);
                            break;
                        }
                        const extractSignal =
                            options?.abortSignals?.["EXTRACT_TO_GRAPH"] ?? options?.globalAbort;
                        const onChunkProgress = (chunkIndex: number, totalChunks: number, message: string) => {
                            const pct = 40 + Math.round((chunkIndex / Math.max(totalChunks, 1)) * 50);
                            onProgress(displayName, message, Math.min(95, pct));
                        };
                        const onRetry = (
                            attempt: number,
                            maxAttempts: number,
                            _reason: string,
                            _nextDelayMs: number
                        ) => {
                            onProgress(
                                displayName,
                                `Retrying extraction… (${attempt}/${maxAttempts})`,
                                50
                            );
                        };
                        const refTime = new Date().toISOString();
                        const existing = this.plugin.entityManager.getAllEntities();
                        const extraction = await this.plugin.graphApiService.processTextInChunks(
                            attachmentsContext,
                            existing,
                            refTime,
                            onChunkProgress,
                            onRetry,
                            extractSignal,
                            true
                        );
                        const graphCommands = extraction.success && extraction.operations?.length
                            ? aiOperationsToGraphCommands(extraction.operations)
                            : [];
                        results["EXTRACT_TO_GRAPH"] = {
                            __extractToGraph: true,
                            graphCommands,
                            summary: extraction.success
                                ? graphCommands.length > 0
                                    ? `Claude extracted **${graphCommands.length}** graph command(s) from attachment text. Confirm with **📊 Generate Analysis & Graph**.`
                                    : "No entities or relationships were extracted from the attachment text."
                                : `Extraction failed: ${extraction.error || "unknown error"}`,
                        };
                        onProgress(displayName, "Complete", 100);
                        break;
                    }

                    default: {
                        if (tool.startsWith("SKILL_")) {
                            if (isCancelled(tool)) {
                                results[tool] = "Cancelled by user.";
                                onProgress(displayName, "Cancelled", 100);
                                break;
                            }
                            onProgress(displayName, "Running vault skill (local Claude)...", 35);
                            const sig =
                                options?.abortSignals?.[tool] ?? options?.globalAbort;
                            try {
                                const out = await executeVaultSkillTool(
                                    this.plugin,
                                    tool,
                                    query,
                                    attachmentsContext,
                                    sig,
                                );
                                results[tool] = out;
                                onProgress(displayName, "Complete", 100);
                            } catch (e) {
                                const msg = e instanceof Error ? e.message : String(e);
                                results[tool] = `Skill error: ${msg}`;
                                onProgress(displayName, "Failed", 100);
                            }
                            break;
                        }
                        if (tool.startsWith("ENRICH_")) {
                            if (isCancelled(tool)) {
                                results[tool] = "Cancelled by user.";
                                onProgress(displayName, "Cancelled", 100);
                                break;
                            }
                            onProgress(displayName, "Running enricher API tool...", 35);
                            const sig = options?.abortSignals?.[tool] ?? options?.globalAbort;
                            try {
                                const out = await executeEnricherTool(
                                    this.plugin,
                                    tool,
                                    query,
                                    attachmentsContext,
                                    sig,
                                );
                                results[tool] = out;
                                onProgress(displayName, "Complete", 100);
                            } catch (e) {
                                const msg = e instanceof Error ? e.message : String(e);
                                results[tool] = `Enricher error: ${msg}`;
                                onProgress(displayName, "Failed", 100);
                            }
                            break;
                        }
                        console.warn(`[OrchestrationService] Unknown tool: ${tool}`);
                    }
                }
            } catch (error) {
                console.error(`[OrchestrationService] Tool ${tool} failed:`, error);
                results[tool] = `Error: ${error instanceof Error ? error.message : String(error)}`;
                onProgress(displayName, "Failed", 100);
            }
        });

        await Promise.all(promises);
        return results;
    }

    private async feedResultsToGraphExtraction(results: Record<string, any>): Promise<string[]> {
        const commands: string[] = [];
        let textToProcess = "=== AUTOMATED INVESTIGATION RESULTS ===\n";
        let hasNonVaultTool = false;

        for (const [tool, result] of Object.entries(results)) {
            if (
                tool === "VAULT_GRAPH_INGEST" &&
                result &&
                typeof result === "object" &&
                result.__vaultIngest === true &&
                Array.isArray(result.graphCommands)
            ) {
                if (!result.__vaultIngestAutoApplied) {
                    commands.push(...result.graphCommands);
                }
                textToProcess += `\n\n--- TOOL: ${tool} (summary) ---\n${result.summary || ""}\n`;
                continue;
            }
            if (
                tool === "EXTRACT_TO_GRAPH" &&
                result &&
                typeof result === "object" &&
                (result as { __extractToGraph?: boolean }).__extractToGraph === true &&
                Array.isArray((result as { graphCommands?: string[] }).graphCommands)
            ) {
                const r = result as { graphCommands: string[]; summary?: string };
                commands.push(...r.graphCommands);
                textToProcess += `\n\n--- TOOL: ${tool} (summary) ---\n${r.summary || ""}\n`;
                continue;
            }
            hasNonVaultTool = true;
            textToProcess += `\n\n--- TOOL: ${tool} ---\n`;
            if (typeof result === "string") {
                textToProcess += result;
            } else {
                textToProcess += JSON.stringify(result, null, 2);
            }
        }

        if (!hasNonVaultTool) {
            return commands;
        }

        try {
            const extraction = await this.plugin.graphApiService.processTextInChunks(
                textToProcess,
                this.plugin.entityManager.getAllEntities(),
                new Date().toISOString()
            );

            if (extraction.success && extraction.operations) {
                commands.push(...aiOperationsToGraphCommands(extraction.operations));
            }
        } catch (error) {
            console.error("[OrchestrationService] Post-search extraction failed:", error);
        }

        return commands;
    }

    /**
     * Apply @@ graph commands without modal (vault ingest / evidence analysis).
     * Returns one human-readable line per command.
     */
    public async executeGraphCommandsImmediate(
        commands: string[],
        options: ExecuteGraphCommandsOptions,
    ): Promise<string[]> {
        const lines: string[] = [];
        const ctx = options.graphWriteContext;

        for (const command of commands) {
            try {
                if (command.startsWith("@@create_entity")) {
                    const jsonStr = command.replace("@@create_entity", "").trim();
                    const data = JSON.parse(jsonStr);
                    if (data.type && data.properties) {
                        let rawSources = data.sources as OsintSourceInput[] | undefined;
                        if (!Array.isArray(rawSources) || rawSources.length === 0) {
                            rawSources = buildInferredOsintSources(ctx);
                        }
                        const osintOpts = {
                            osint_sources: rawSources,
                            osint_captured_at: ctx?.captured_at ?? new Date().toISOString(),
                            conversation_id: ctx?.conversation_id,
                        };
                        if (isFTMSchema(String(data.type))) {
                            await this.plugin.entityManager.createFTMEntity(data.type, data.properties, osintOpts);
                        } else {
                            await this.plugin.entityManager.createEntity(data.type, data.properties, osintOpts);
                        }
                        const name = data.label || getEntityLabel(data.type as EntityType, data.properties || {});
                        lines.push(`✓ Created ${data.type}: **${name}**`);
                    }
                } else if (command.startsWith("@@delete_entity")) {
                    const jsonStr = command.replace("@@delete_entity", "").trim();
                    const data = JSON.parse(jsonStr);
                    if (data.id) {
                        const entity = this.plugin.entityManager.getEntity(data.id);
                        const name = entity ? entity.label : `ID: ${data.id}`;
                        if (entity?.filePath && this.plugin.vaultLockService?.isPathLocked(entity.filePath)) {
                            lines.push(`⚠ Skipped delete (locked): **${name}**`);
                        } else {
                            await this.plugin.entityManager.deleteEntities([data.id]);
                            lines.push(`✓ Removed entity: **${name}**`);
                        }
                    }
                } else if (command.startsWith("@@create_link")) {
                    const jsonStr = command.replace("@@create_link", "").trim();
                    const data = JSON.parse(jsonStr);
                    if (data.from && data.to && data.relationship) {
                        let fromId = data.from;
                        let toId = data.to;

                        if (!this.plugin.entityManager.getEntity(fromId)) {
                            const fromEnt = this.plugin.entityManager.findEntityByLabel(data.from);
                            if (fromEnt) fromId = fromEnt.id;
                        }

                        if (!this.plugin.entityManager.getEntity(toId)) {
                            const toEnt = this.plugin.entityManager.findEntityByLabel(data.to);
                            if (toEnt) toId = toEnt.id;
                        }

                        let rawSources = data.sources as OsintSourceInput[] | undefined;
                        if (!Array.isArray(rawSources) || rawSources.length === 0) {
                            rawSources = buildInferredOsintSources(ctx);
                        }
                        const osintOpts = {
                            osint_sources: rawSources,
                            osint_captured_at: ctx?.captured_at ?? new Date().toISOString(),
                            conversation_id: ctx?.conversation_id,
                        };
                        await this.plugin.entityManager.createConnection(
                            fromId,
                            toId,
                            data.relationship,
                            data.properties as Record<string, unknown> | undefined,
                            osintOpts,
                        );
                        const fromEnt = this.plugin.entityManager.getEntity(fromId);
                        const toEnt = this.plugin.entityManager.getEntity(toId);
                        const fromName = fromEnt ? fromEnt.label : String(data.from);
                        const toName = toEnt ? toEnt.label : String(data.to);
                        lines.push(`✓ Link: **${fromName}** → (${data.relationship}) → **${toName}**`);
                    }
                } else if (command.startsWith("@@delete_link")) {
                    const jsonStr = command.replace("@@delete_link", "").trim();
                    const data = JSON.parse(jsonStr);
                    if (data.id) {
                        const conn = this.plugin.entityManager.getConnection(data.id);
                        const locked =
                            (conn?.filePath && this.plugin.vaultLockService?.isPathLocked(conn.filePath)) ||
                            false;
                        if (locked) {
                            lines.push(`⚠ Skipped delete link (locked): id ${data.id}`);
                        } else {
                            await this.plugin.entityManager.deleteConnectionWithNote(data.id);
                            lines.push(`✓ Removed link (id ${data.id})`);
                        }
                    }
                } else {
                    console.warn(`[OrchestrationService] Unrecognized graph command: ${command}`);
                    lines.push(`⚠ Skipped unrecognized command`);
                }
            } catch (e) {
                console.error(`[OrchestrationService] Failed to execute graph command '${command}':`, e);
                const msg = e instanceof Error ? e.message : String(e);
                lines.push(`⚠ Failed: ${msg.substring(0, 120)}${msg.length > 120 ? "…" : ""}`);
                if (options.showErrorNotices) {
                    new Notice(`Error executing command: ${command.substring(0, 30)}...`);
                }
            }
        }

        return lines;
    }

    public async executeGraphModifications(
        commands: string[],
        execOptions?: { graphWriteContext?: GraphWriteContext },
    ): Promise<void> {
        if (!commands || commands.length === 0) return;

        const checkboxItems: { label: string, value: string, checked: boolean }[] = [];
        commands.forEach((cmd, idx) => {
            let labelText = `❓ Unknown: ${cmd}`;
            try {
                if (cmd.startsWith("@@create_entity")) {
                    const data = JSON.parse(cmd.replace("@@create_entity", "").trim());
                    const name = data.label || getEntityLabel(data.type as EntityType, data.properties || {});
                    labelText = `➕ Create ${data.type || 'Entity'}: **${name}**`;
                } else if (cmd.startsWith("@@delete_entity")) {
                    const data = JSON.parse(cmd.replace("@@delete_entity", "").trim());
                    const entity = this.plugin.entityManager.getEntity(data.id);
                    const name = entity ? entity.label : `ID: ${data.id}`;
                    labelText = `🗑️ Delete Entity: **${name}**`;
                } else if (cmd.startsWith("@@create_link")) {
                    const data = JSON.parse(cmd.replace("@@create_link", "").trim());
                    const fromEnt = this.plugin.entityManager.getEntity(data.from);
                    const toEnt = this.plugin.entityManager.getEntity(data.to);
                    const fromName = fromEnt ? fromEnt.label : data.from;
                    const toName = toEnt ? toEnt.label : data.to;
                    labelText = `🔗 Connect: [**${fromName}**] ──(${data.relationship})──> [**${toName}**]`;
                } else if (cmd.startsWith("@@delete_link")) {
                    const data = JSON.parse(cmd.replace("@@delete_link", "").trim());
                    labelText = `✂️ Delete Link (ID: ${data.id})`;
                }
            } catch (e) {
                labelText = `⚠️ Raw Data: ${cmd}`;
            }
            checkboxItems.push({ label: labelText, value: idx.toString(), checked: true });
        });

        // 1. Dry Run / User Confirmation using ConfirmModal
        const confirmedValues = await new Promise<string[] | undefined>((resolve) => {
            new ConfirmModal(
                this.plugin.app,
                "Confirm Graph Modifications",
                `The agent wants to make the following changes. Uncheck those you wish to ignore:`,
                (selectedValues) => resolve(selectedValues),
                () => resolve(undefined),
                false,
                checkboxItems
            ).open();
        });

        if (!confirmedValues) {
            new Notice("Graph modifications cancelled by user.");
            return;
        }

        const cmdsToExecute = commands.filter((cmd, idx) => confirmedValues.includes(idx.toString()));
        if (cmdsToExecute.length === 0) {
            new Notice("No graph modifications selected.");
            return;
        }

        const lines = await this.executeGraphCommandsImmediate(cmdsToExecute, {
            showErrorNotices: true,
            graphWriteContext: execOptions?.graphWriteContext,
        });
        const successCount = lines.filter((l) => l.startsWith("✓")).length;

        if (successCount > 0) {
            new Notice(`Successfully executed ${successCount} graph modification(s).`);
        }
    }

    private async generateFinalResponse(plan: OrchestrationPlan, toolResults: Record<string, any>, query: string, graphState: any, conversationMemory: { role: string, content: string }[]): Promise<string> {
        // If there are no tool results and there is a direct response, just return it.
        if (Object.keys(toolResults).length === 0 && plan.directResponse) {
            return plan.directResponse;
        }

        const systemPrompt = "You are the Orchestration Agent. Based on the user query, determine tools and graph commands to run.";

        // Format memory for context
        const memoryContext = conversationMemory && conversationMemory.length > 0
            ? conversationMemory.map(msg => `${msg.role.toUpperCase()}:\n${msg.content}`).join("\n\n")
            : "No previous conversation.";

        // --- SMART TRUNCATION FOR CONTEXT SIZE CONTROL ---
        // Large tool results can trigger 524 Gateway Timeouts. We truncate if total char count exceeds ~50k.
        const MAX_TOTAL_CHARS = 50000;
        const resultEntries = Object.entries(toolResults);
        let currentTotal = 0;
        const truncatedResults: Record<string, string> = {};

        // Calculate total length first
        for (const [key, value] of resultEntries) {
            const strVal = typeof value === 'string' ? value : JSON.stringify(value);
            currentTotal += strVal.length;
        }

        if (currentTotal > MAX_TOTAL_CHARS) {
            console.warn(`[OrchestrationService] Total tool result size (${currentTotal} chars) exceeds limit. Truncating for synthesis...`);
            const perResultLimit = Math.floor(MAX_TOTAL_CHARS / resultEntries.length);
            for (const [key, value] of resultEntries) {
                let strVal = typeof value === 'string' ? value : JSON.stringify(value);
                if (strVal.length > perResultLimit) {
                    const keep = Math.floor(perResultLimit / 2) - 100;
                    strVal = strVal.substring(0, keep) + "\n\n[... TRUNCATED DUE TO SIZE ...] \n\n" + strVal.substring(strVal.length - keep);
                }
                truncatedResults[key] = strVal;
            }
        } else {
            for (const [key, value] of resultEntries) {
                truncatedResults[key] = typeof value === 'string' ? value : JSON.stringify(value);
            }
        }

        const vaultAug = await this.getVaultPromptAugmentation();

        const prompt = `
${systemPrompt}
${vaultAug ? `\n=== VAULT-DEFINED RULES AND AGENT ===\n${vaultAug}\n` : ""}

=== CURRENT GRAPH STATE ===
${JSON.stringify(graphState, null, 2)}

=== CONVERSATION HISTORY ===
${memoryContext}

=== USER REQUEST ===
${query}

=== PREVIOUS ORCHESTRATION REASONING ===
${plan.reasoning}

=== TOOL EXECUTION RESULTS ===
${JSON.stringify(truncatedResults, null, 2)}

Synthesize the tool results, graph state, and the user's request into a conversational, well-formatted response to the user. Do not output raw JSON, write in Markdown.
`;

        try {
            return await this.plugin.graphApiService.callRemoteModel(
                [{ role: "user", content: prompt }],
                false
            );
        } catch (error) {
            console.error("[OrchestrationService] Failed to generate final response:", error);
            return "I completed the tools, but encountered an error formatting the final response.";
        }
    }

    private handleError(error: unknown): void {
        const errorMsg = error instanceof Error ? error.message : String(error);
        new Notice(`Orchestrator Error: ${errorMsg}`);
    }
}
