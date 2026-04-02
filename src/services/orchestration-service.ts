import VaultAIPlugin from "../../main";
import { App, Notice, requestUrl, TFile } from 'obsidian';
import { GraphApiService } from './api-service';
import { AIOperation } from '../entities/types';
import { ConfirmModal } from '../modals/confirm-modal';
import { detectOrchestrationIntent, type OrchestrationIntent } from './intent-router';

export interface OrchestrationPlan {
    reasoning: string;
    planSummary?: string; // Summary of what will be done for user review
    isProposal?: boolean; // If true, the agent is asking for approval
    toolsToCall: string[]; // e.g., ['DARK_WEB', 'LOCAL_VAULT', 'OSINT_SEARCH', 'CORPORATE_REPORTS']
    graphCommands: string[]; // e.g., ['@@CREATE: {...}', '@@DELETE: {...}']
    directResponse?: string; // If no tools needed or as a final response
}

export interface OrchestrationResult {
    finalResponse: string;
    proposedCommands?: string[];
    proposedPlan?: OrchestrationPlan;
    toolResults?: Record<string, any>;
    plan?: OrchestrationPlan;
    phase?: "PLAN_PROPOSED" | "TOOLS_COMPLETE" | "SYNTHESIS_COMPLETE";
}

/** Display names for orchestration tool ids (UI + progress rows). */
export const ORCHESTRATION_TOOL_DISPLAY_NAMES: Record<string, string> = {
    DARK_WEB: "DarkWeb Search",
    OSINT_SEARCH: "Digital Footprint",
    CORPORATE_REPORTS: "Companies & People",
    LOCAL_VAULT: "Local Search",
    VAULT_GRAPH_INGEST: "Vault graph (notes)",
    EXTRACT_TO_GRAPH: "Extract to graph",
    ANALYZE_EVIDENCE: "Evidence analysis",
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

export class OrchestrationService {
    private plugin: VaultAIPlugin;

    constructor(plugin: VaultAIPlugin) {
        this.plugin = plugin;
    }


    private async verifyProviderAndCredits(): Promise<void> {
        if (this.plugin.settings.orchestrationProvider === 'osint-copilot') {
            try {
                const base = (this.plugin.settings.graphApiUrl || "https://api.osint-copilot.com").replace(/\/+$/, "");
                const response = await requestUrl({
                    url: `${base}/api/key/info`,
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${this.plugin.settings.reportApiKey}`,
                        "Content-Type": "application/json",
                    },
                    throw: false,
                });

                if (response.status >= 200 && response.status < 300) {
                    const apiInfo = response.json;
                    const quota = apiInfo?.remaining_credits ?? apiInfo?.remaining_quota ?? 0;
                    if (quota <= 0) {
                        throw new Error("Insufficient credits. Please upgrade your plan or check your quota to use the official OSINT Copilot Orchestration API.");
                    }
                } else {
                    console.warn("[OrchestrationService] Failed to fetch quota info, but continuing...");
                }
            } catch (e) {
                console.error("[OrchestrationService] Error verifying credits:", e);
                // Non-blocking if the verification server itself is down
            }
        }
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
        const checkAborted = () => {
            if (options?.abortSignal?.aborted) {
                throw new DOMException("Aborted", "AbortError");
            }
        };

        try {
            onProgress("Verifying provider and credits...", 10);
            await this.verifyProviderAndCredits();
            checkAborted();

            // Implicit URL Extraction (Phase 3)
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const urls = query.match(urlRegex);
            if (urls && urls.length > 0) {
                onProgress(`Extracting content from ${urls.length} link(s)...`, 15);
                for (const url of urls) {
                    checkAborted();
                    try {
                        const extractedText = await this.plugin.graphApiService.extractTextFromUrl(url);
                        attachmentsContext += `\n\n=== Content from ${url} ===\n${extractedText}`;
                    } catch (e) {
                        console.error(`[OrchestrationService] Failed to extract from URL ${url}:`, e);
                        attachmentsContext += `\n\n=== Content from ${url} ===\n[Failed to extract content: ${e instanceof Error ? e.message : String(e)}]`;
                    }
                }
            }

            onProgress("Classifying intent and formulating plan...", 20);
            checkAborted();
            const routedIntent = detectOrchestrationIntent(query);
            console.log("[OrchestrationService] Routed intent:", routedIntent);
            const plan = await this.classifyIntent(
                query,
                attachmentsContext,
                currentGraphState,
                conversationMemory,
                routedIntent
            );
            checkAborted();

            // HITL: If the plan is a proposal, return immediately for user review
            if (plan.isProposal && plan.toolsToCall.length > 0) {
                onProgress("Investigation plan proposed for review.", 100);
                return {
                    finalResponse: plan.directResponse || `I have formulated an investigation plan. ${plan.planSummary}`,
                    proposedPlan: plan,
                    phase: "PLAN_PROPOSED"
                };
            }

            // If no tools needed, generate direct response
            if (plan.toolsToCall.length === 0) {
                onProgress("Generating response...", 90);
                checkAborted();
                const finalResponse = await this.generateFinalResponse(plan, {}, query, currentGraphState, conversationMemory);
                onProgress("Complete", 100);
                return { finalResponse, phase: "SYNTHESIS_COMPLETE" };
            }

            let toolAbortSignals: Record<string, AbortSignal> | undefined;
            if (plan.toolsToCall.length > 1 && options?.onToolsStarting) {
                const sigs = options.onToolsStarting(plan.toolsToCall);
                toolAbortSignals = sigs || undefined;
            }

            onProgress(
                plan.toolsToCall.length > 1
                    ? `Running ${plan.toolsToCall.length} tools in parallel...`
                    : `Executing tools: ${plan.toolsToCall.join(", ")}...`,
                40
            );
            checkAborted();

            const toolResults = await this.executeToolsInParallel(
                plan.toolsToCall,
                query,
                attachmentsContext,
                currentConversation,
                (toolDisplay, msg, percent, _detail) => {
                    onProgress(msg, percent, { orchestrationTool: toolDisplay });
                },
                {
                    abortSignals: toolAbortSignals,
                    globalAbort: options?.abortSignal,
                }
            );

            // Return tool results for user review BEFORE synthesis
            onProgress("Tools complete. Awaiting review...", 60);
            return {
                finalResponse: "Investigation tools have completed. Review the results below, then click **📊 Generate Analysis & Graph** to proceed.",
                toolResults: toolResults,
                plan: plan,
                phase: "TOOLS_COMPLETE"
            };

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

    /** Example default tools shown in the planner JSON template; aligns with routed intent. */
    private defaultToolsForIntent(intent: OrchestrationIntent): string[] {
        switch (intent) {
            case "VAULT_GRAPH_BUILD":
                return ["VAULT_GRAPH_INGEST"];
            case "VAULT_QA":
                return ["LOCAL_VAULT"];
            case "MIXED":
                return ["LOCAL_VAULT", "OSINT_SEARCH"];
            case "OSINT_TOOL_RUN":
            default:
                return ["OSINT_SEARCH"];
        }
    }

    private buildRoutedIntentInstructions(intent: OrchestrationIntent, hasAttachments: boolean): string {
        const att = hasAttachments
            ? " Attachments are present; EXTRACT_TO_GRAPH may be included if it helps ingest files into the graph."
            : " No attachment payload in this turn; do not select EXTRACT_TO_GRAPH.";
        switch (intent) {
            case "VAULT_GRAPH_BUILD":
                return `VAULT_GRAPH_BUILD — User wants to build or enrich the knowledge graph from Obsidian notes (often many or all files).${att} You MUST include "VAULT_GRAPH_INGEST" in toolsToCall (full vault / note ingestion for entity extraction). Do NOT include OSINT_SEARCH, DARK_WEB, or CORPORATE_REPORTS unless the user explicitly asks for external/open-web or dark-web intelligence in the same message.`;
            case "VAULT_QA":
                return `VAULT_QA — User wants answers grounded in their vault.${att} Prioritize "LOCAL_VAULT". Add OSINT or other tools only if they clearly ask for outside sources.`;
            case "OSINT_TOOL_RUN":
                return `OSINT_TOOL_RUN — Primary need is external investigation.${att} Prefer OSINT_SEARCH and/or DARK_WEB/CORPORATE_REPORTS as appropriate. Include LOCAL_VAULT only if they also ask about their notes.`;
            case "MIXED":
                return `MIXED — Both vault-local and external investigation appear relevant.${att} Include LOCAL_VAULT plus at least one external tool when appropriate.`;
            default:
                return `UNKNOWN — No strong heuristic match.${att} Choose tools from the user request; prefer LOCAL_VAULT when the question is only about their notes or building the graph from local documents.`;
        }
    }

    /** When the LLM returns no tools, align defaults with routed intent (avoid forcing OSINT for vault work). */
    private fallbackProposalForEmptyTools(routedIntent: OrchestrationIntent, query: string): {
        toolsToCall: string[];
        planSummary: string;
        directResponse: string;
    } {
        if (routedIntent === "VAULT_GRAPH_BUILD") {
            return {
                toolsToCall: ["VAULT_GRAPH_INGEST"],
                planSummary: `### Investigation Plan\n1. **Vault graph ingest** — Process your markdown notes and extract entities/relationships for the graph (up to a safe file limit).\n\n*Adjust modules before running.*`,
                directResponse: `I'll run vault graph ingestion to extract entities from your notes into graph proposals. Add external modules only if you also need OSINT or dark web.`,
            };
        }
        if (routedIntent === "VAULT_QA") {
            return {
                toolsToCall: ["LOCAL_VAULT"],
                planSummary: `### Investigation Plan\n1. **Local vault** — Search your Obsidian notes for: "${query}"\n\n*Adjust modules before running.*`,
                directResponse: `I'll search your vault for relevant material. You can add other modules only if you also need external intelligence.`,
            };
        }
        if (routedIntent === "MIXED") {
            return {
                toolsToCall: ["LOCAL_VAULT", "OSINT_SEARCH"],
                planSummary: `### Investigation Plan\n1. **Local vault** — Review your notes\n2. **OSINT** — Check external sources\n\n*Click Run to proceed.*`,
                directResponse: `I'll combine local vault search with OSINT. Adjust modules if needed.`,
            };
        }
        return {
            toolsToCall: ["OSINT_SEARCH"],
            planSummary: `### Investigation Plan\n1. **OSINT Search** — Search public intelligence sources for: "${query}"\n\n*Reply to add more modules (DARK_WEB, CORPORATE_REPORTS, etc.) or click Run to proceed.*`,
            directResponse: `I'll investigate this using OSINT Search. You can add more modules like DARK_WEB or CORPORATE_REPORTS before I start.`,
        };
    }

    private async classifyIntent(
        query: string,
        attachmentsContext: string,
        graphState: any,
        conversationMemory: { role: string; content: string }[],
        routedIntent: OrchestrationIntent
    ): Promise<OrchestrationPlan> {
        const systemPrompt = this.plugin.settings.orchestrationPrompt
            || "You are the Orchestration Agent. Based on the user query, determine tools and graph commands to run.";

        // Format memory for context
        const memoryContext =
            conversationMemory && conversationMemory.length > 0
                ? conversationMemory.map((msg) => `${msg.role.toUpperCase()}:\n${msg.content}`).join("\n\n")
                : "No previous conversation.";

        // Check if the user is approving a previously proposed plan
        const isApproval = /^\s*(proceed|go|approved|yes|ok|run|execute|do it|start|launch|confirm)/i.test(query);

        // Only include EXTRACT_TO_GRAPH when attachments are present
        const hasAttachments = !!(attachmentsContext && attachmentsContext.trim().length > 0);
        const extractToGraphTool = hasAttachments
            ? '\n- "EXTRACT_TO_GRAPH" - Extract entities from attached files/links into the knowledge graph.'
            : "";

        const defaultToolsExample = this.defaultToolsForIntent(routedIntent);
        const routedIntentBlock = this.buildRoutedIntentInstructions(routedIntent, hasAttachments);

        const prompt = `You are an OSINT investigation planner. You MUST respond with a JSON object ONLY. No other text.

=== ROUTED INTENT (heuristic, trust this for tool choice) ===
${routedIntentBlock}

=== CRITICAL RULES ===
1. You are a PLANNER, not a responder. You NEVER answer the user's question directly.
2. For ANY investigative question (who, what, where, when about people, organizations, events, crimes, threats), you MUST propose tools — EXCEPT when ROUTED INTENT is VAULT_GRAPH_BUILD: then use VAULT_GRAPH_INGEST only (unless they also ask for external sources). For VAULT_QA, prioritize LOCAL_VAULT. Do not add OSINT_SEARCH for vault-only graph builds.
3. Set "isProposal" to true and list the tools you recommend.
4. The ONLY time you set "isProposal" to false with empty "toolsToCall" is when the user says "Proceed", "Go", "Approved", or similar confirmation words.
5. Your "directResponse" should describe your PLAN, never the answer to the question.
6. NEVER put factual answers in "directResponse". That field is for describing what tools you will use and why.

=== AVAILABLE TOOLS ===
- "OSINT_SEARCH" - Search digital footprints: emails, phones, breaches, public records, web search.
- "DARK_WEB" - Dark web intelligence: hidden services, underground leaks, threat actor forums.
- "CORPORATE_REPORTS" - Corporate/legal data: ownership registries, financial filings, sanctions lists.
- "LOCAL_VAULT" - Quick keyword search across a few matching Obsidian notes (legacy Q&A style).
- "VAULT_GRAPH_INGEST" - Read many/all markdown notes in the vault (subject to limits), call the graph API to extract entities and relationships, and propose graph commands.${extractToGraphTool}

=== USER'S ORCHESTRATION CONTEXT ===
${systemPrompt}

=== CURRENT GRAPH STATE (existing entities) ===
Entities: ${Array.isArray(graphState?.entities) ? graphState.entities.length : 0} nodes
${Array.isArray(graphState?.entities) ? graphState.entities.slice(0, 20).map((e: any) => `- ${e.type}: ${e.label}`).join("\n") : "Empty graph"}

=== CONVERSATION HISTORY ===
${memoryContext}

=== USER REQUEST ===
${query}

${isApproval ? '>>> THE USER IS APPROVING A PREVIOUS PLAN. Set "isProposal": false and list the final tools from the previous plan.' : '>>> THIS IS A NEW REQUEST. You MUST set "isProposal": true and propose tools.'}

Respond with this exact JSON structure:
{
  "reasoning": "Your analysis of the query and why you chose these tools",
  "planSummary": "### Investigation Plan\\n1. Step 1...\\n2. Step 2...",
  "isProposal": ${isApproval ? "false" : "true"},
  "toolsToCall": ${JSON.stringify(defaultToolsExample)},
  "graphCommands": [],
  "directResponse": "Describe your investigation plan here (NOT the answer to the question)"
}`;

        try {
            // Use the remote model for classification natively with JSON mode enforced
            const responseText = await this.plugin.graphApiService.callRemoteModel(
                [{ role: "user", content: prompt }],
                true, // Enforce JSON object mode
                this.plugin.settings.orchestrationModel,
                undefined, // signal
                {
                    provider: this.plugin.settings.orchestrationProvider,
                    url: this.plugin.settings.orchestrationLocalUrl,
                    apiKey: this.plugin.settings.orchestrationApiKey
                }
            );

            console.log("[OrchestrationService] Raw LLM classification response:", responseText.substring(0, 2000));

            // Try to extract JSON from the response text
            const match = responseText.match(/\{[\s\S]*\}/);
            if (match) {
                const rawPlan = JSON.parse(match[0]);
                console.log("[OrchestrationService] Parsed plan:", JSON.stringify(rawPlan, null, 2).substring(0, 1000));

                // Handle both camelCase and snake_case keys from LLM
                let toolsToCall = rawPlan.toolsToCall || rawPlan.tools_to_call || [];
                // Filter out EXTRACT_TO_GRAPH when no attachments present
                if (!hasAttachments) {
                    toolsToCall = toolsToCall.filter((t: string) => t !== "EXTRACT_TO_GRAPH");
                }

                const plan: OrchestrationPlan = {
                    reasoning: rawPlan.reasoning || "No reasoning provided.",
                    toolsToCall,
                    graphCommands: rawPlan.graphCommands || rawPlan.graph_commands || [],
                    directResponse: rawPlan.directResponse || rawPlan.direct_response,
                    isProposal: rawPlan.isProposal ?? rawPlan.is_proposal ?? false,
                    planSummary: rawPlan.planSummary || rawPlan.plan_summary
                };

                // GUARD: If this is NOT an approval and the LLM still returned no tools, use intent-aligned defaults
                if (!isApproval && plan.toolsToCall.length === 0) {
                    const fb = this.fallbackProposalForEmptyTools(routedIntent, query);
                    console.warn(
                        "[OrchestrationService] LLM returned no tools for a non-approval query. Forcing fallback proposal:",
                        routedIntent,
                        fb.toolsToCall
                    );
                    plan.isProposal = true;
                    plan.toolsToCall = fb.toolsToCall;
                    plan.planSummary = plan.planSummary || fb.planSummary;
                    plan.directResponse = plan.directResponse || fb.directResponse;
                }

                console.log("[OrchestrationService] Final plan - isProposal:", plan.isProposal, "tools:", plan.toolsToCall);
                return plan;
            } else {
                throw new Error("Could not parse JSON from LLM response.");
            }
        } catch (error) {
            console.error("[OrchestrationService] Failed to classify intent:", error);
            const fb = this.fallbackProposalForEmptyTools(routedIntent, query);
            return {
                reasoning: "Fallback due to classification error.",
                toolsToCall: fb.toolsToCall,
                graphCommands: [],
                isProposal: true,
                planSummary: `### Investigation Plan\n1. Fallback — ${fb.toolsToCall.join(", ")}\n\n*The planner request failed; adjust modules and click Run.*`,
                directResponse: fb.directResponse,
            };
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

    /** Convert graph API operations into @@ graph command strings (same shape as feedResultsToGraphExtraction). */
    private operationsToGraphCommands(operations: AIOperation[]): string[] {
        const commands: string[] = [];
        for (const op of operations) {
            if (op.entities) {
                op.entities.forEach((entity) => {
                    commands.push(
                        `@@create_entity ${JSON.stringify({
                            type: entity.type,
                            label:
                                entity.properties.name ||
                                entity.properties.title ||
                                entity.properties.label ||
                                entity.type,
                            properties: entity.properties,
                        })}`
                    );
                });
            }
            if (op.connections) {
                op.connections.forEach((conn) => {
                    commands.push(
                        `@@create_link ${JSON.stringify({
                            from: conn.from_label || conn.from.toString(),
                            to: conn.to_label || conn.to.toString(),
                            relationship: conn.relationship,
                        })}`
                    );
                });
            }
        }
        return commands;
    }

    /**
     * Walk ingestible vault files, send them in batches to the evidence
     * analysis endpoint (server-side parallel classification + extraction),
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
        const { EvidenceService } = await import("./evidence-service");
        const svc = new EvidenceService(this.plugin);

        const vaultFiles = this.plugin.app.vault.getFiles();
        const files = vaultFiles
            .filter((f): f is TFile => f instanceof TFile)
            .filter((f) => !this.shouldSkipVaultPath(f.path))
            .filter((f) => OrchestrationService.VAULT_INGEST_EXTENSIONS.has((f.extension || '').toLowerCase()))
            .sort((a, b) => a.path.localeCompare(b.path));

        const maxFiles = Math.min(files.length, OrchestrationService.VAULT_INGEST_MAX_FILES);
        const filesToProcess = files.slice(0, maxFiles);
        const BATCH = OrchestrationService.VAULT_INGEST_BATCH_SIZE;
        const totalBatches = Math.ceil(filesToProcess.length / BATCH);

        const graphCommands: string[] = [];
        let filesProcessed = 0;
        let extractFailures = 0;

        for (let b = 0; b < totalBatches; b++) {
            if (abortSignal?.aborted) break;

            const batchFiles = filesToProcess.slice(b * BATCH, (b + 1) * BATCH);
            const batchLabel = `Batch ${b + 1}/${totalBatches}`;
            const basePct = Math.floor((b / totalBatches) * 90) + 5;

            onFileProgress(
                `${batchLabel}: sending ${batchFiles.length} files to server…`,
                basePct,
            );

            let batchCommands: string[];
            try {
                batchCommands = await svc.analyze(
                    batchFiles,
                    (msg, pct) => {
                        if (abortSignal?.aborted) return;
                        const scaled = basePct + Math.floor((pct / 100) * (90 / totalBatches));
                        onFileProgress(`${batchLabel}: ${msg}`, Math.min(scaled, 94));
                    },
                );
            } catch (e) {
                if (e instanceof DOMException && e.name === "AbortError") break;
                console.error(`[OrchestrationService] Evidence batch ${b + 1} failed:`, e);
                extractFailures += batchFiles.length;
                continue;
            }

            for (const cmd of batchCommands) {
                const lines = await this.executeGraphCommandsImmediate([cmd], { showErrorNotices: false });
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
            `sent in **${totalBatches}** batch(es) of up to ${BATCH} files (server-side parallel analysis). ` +
            (extractFailures > 0 ? `**${extractFailures}** file(s) failed. ` : "") +
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

        const promises = tools.map(async (tool) => {
            const displayName = toolToDisplayName[tool] || tool;
            try {
                switch (tool) {
                    case "DARK_WEB": {
                        if (isCancelled("DARK_WEB")) {
                            results["DARK_WEB"] = "Cancelled by user.";
                            onProgress(displayName, "Cancelled", 100);
                            break;
                        }
                        const darkWebModel = "gpt-5-mini"; // Align with main.ts DARKWEB_MODEL
                        onProgress(displayName, "Initializing job...", 10);
                        const darkWebRes = await requestUrl({
                            url: `${this.plugin.settings.graphApiUrl}/api/darkweb/investigate`,
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.plugin.settings.reportApiKey}`
                            },
                            body: JSON.stringify({ query, model: darkWebModel, threads: 8 }),
                            throw: false
                        });
                        if (darkWebRes.status < 200 || darkWebRes.status >= 300) {
                            results["DARK_WEB"] = `API error: ${darkWebRes.status}`;
                            onProgress(displayName, "Failed", 100);
                            break;
                        }
                        const jobId = darkWebRes.json?.job_id;
                        if (!jobId) {
                            results["DARK_WEB"] = "No job ID returned.";
                            onProgress(displayName, "Failed", 100);
                            break;
                        }

                        const maxPollMs = 5 * 60 * 1000;
                        const startTime = Date.now();
                        let completed = false;
                        while (Date.now() - startTime < maxPollMs) {
                            if (isCancelled("DARK_WEB")) {
                                results["DARK_WEB"] = "Cancelled by user.";
                                onProgress(displayName, "Cancelled", 100);
                                break;
                            }
                            await new Promise(resolve => setTimeout(resolve, 5000));
                            const elapsed = Math.round((Date.now() - startTime) / 1000);
                            onProgress(displayName, `Searching... (${elapsed}s)`, 30 + Math.min(60, Math.floor(elapsed / 2)));

                            const statusRes = await requestUrl({
                                url: `${this.plugin.settings.graphApiUrl}/api/darkweb/status/${jobId}`,
                                method: 'GET',
                                headers: { 'Authorization': `Bearer ${this.plugin.settings.reportApiKey}` },
                                throw: false
                            });
                            if (statusRes.status >= 200 && statusRes.status < 300) {
                                if (statusRes.json?.status === 'completed' || statusRes.json?.status === 'done') {
                                    completed = true;
                                    break;
                                } else if (statusRes.json?.status === 'failed') {
                                    results["DARK_WEB"] = "Investigation failed.";
                                    break;
                                }
                            }
                        }

                        if (completed && !isCancelled("DARK_WEB")) {
                            onProgress(displayName, "Downloading results...", 90);
                            const downloadRes = await requestUrl({
                                url: `${this.plugin.settings.graphApiUrl}/api/darkweb/summary/${jobId}`,
                                method: 'GET',
                                headers: { 'Authorization': `Bearer ${this.plugin.settings.reportApiKey}` },
                                throw: false
                            });

                            if (downloadRes.status < 300 && downloadRes.json?.summary) {
                                const summary = downloadRes.json.summary;
                                let savedFileName = "";
                                try {
                                    if (typeof (this.plugin as any).saveDarkWebReportToVault === "function") {
                                        savedFileName = await (this.plugin as any).saveDarkWebReportToVault(summary, query, jobId);
                                    }
                                } catch (e) {
                                    console.error("Could not save dark web report to vault", e);
                                }
                                results["DARK_WEB"] = savedFileName ? `**Saved to Vault: [[${savedFileName}]]**\n\n${summary}` : summary;
                            } else {
                                results["DARK_WEB"] = "Download failed.";
                            }
                        } else if (!results["DARK_WEB"] && isCancelled("DARK_WEB")) {
                            results["DARK_WEB"] = "Cancelled by user.";
                            onProgress(displayName, "Cancelled", 100);
                        }
                        const dw = results["DARK_WEB"];
                        if (typeof dw === "string" && dw.includes("Cancelled")) {
                            // already at 100%
                        } else {
                            onProgress(displayName, "Complete", 100);
                        }
                        break;
                    }

                    case "OSINT_SEARCH": {
                        if (isCancelled("OSINT_SEARCH")) {
                            results["OSINT_SEARCH"] = "Cancelled by user.";
                            onProgress(displayName, "Cancelled", 100);
                            break;
                        }
                        onProgress(displayName, "Searching digital footprints...", 30);
                        try {
                            const osintRes = await this.plugin.graphApiService.aiSearch({
                                query,
                                max_providers: 5,
                                parallel: true
                            });
                            results["OSINT_SEARCH"] = osintRes;
                        } catch (e: any) {
                            results["OSINT_SEARCH"] = `Search failed: ${e.message}`;
                        }
                        if (isCancelled("OSINT_SEARCH")) {
                            results["OSINT_SEARCH"] = "Cancelled by user.";
                            onProgress(displayName, "Cancelled", 100);
                        } else {
                            onProgress(displayName, "Complete", 100);
                        }
                        break;
                    }

                    case "CORPORATE_REPORTS": {
                        if (isCancelled("CORPORATE_REPORTS")) {
                            results["CORPORATE_REPORTS"] = "Cancelled by user.";
                            onProgress(displayName, "Cancelled", 100);
                            break;
                        }
                        onProgress(displayName, "Generating corporate intelligence report...", 10);
                        try {
                            const reportData = await this.plugin.generateReport(
                                query,
                                currentConversation || null,
                                (status, progress) => {
                                    if (isCancelled("CORPORATE_REPORTS")) return;
                                    if (progress) {
                                        onProgress(displayName, progress.message, progress.percent);
                                    } else {
                                        onProgress(displayName, status, 30);
                                    }
                                }
                            );

                            let savedFileName = "";
                            try {
                                savedFileName = await this.plugin.saveReportToVault(
                                    reportData.content,
                                    query,
                                    reportData.filename
                                );
                            } catch (e) {
                                console.error("Could not save corporate report to vault", e);
                            }

                            results["CORPORATE_REPORTS"] = savedFileName ? `**Saved to Vault: [[${savedFileName}]]**\n\n${reportData.content}` : reportData.content;
                        } catch (e: any) {
                            results["CORPORATE_REPORTS"] = `Report generation failed: ${e.message}`;
                        }
                        if (isCancelled("CORPORATE_REPORTS")) {
                            results["CORPORATE_REPORTS"] = "Cancelled by user.";
                            onProgress(displayName, "Cancelled", 100);
                        } else {
                            onProgress(displayName, "Complete", 100);
                        }
                        break;
                    }

                    case "VAULT_GRAPH_INGEST": {
                        if (isCancelled("VAULT_GRAPH_INGEST")) {
                            results["VAULT_GRAPH_INGEST"] = "Cancelled by user.";
                            onProgress(displayName, "Cancelled", 100);
                            break;
                        }
                        onProgress(displayName, "Starting vault graph ingest...", 5);
                        try {
                            const vaultSig = this.mergeAbortSignals(
                                options?.globalAbort,
                                options?.abortSignals?.["VAULT_GRAPH_INGEST"]
                            );
                            const out = await this.runVaultGraphIngest((msg, pct, detail) => {
                                if (isCancelled("VAULT_GRAPH_INGEST")) return;
                                onProgress(displayName, msg, pct, detail);
                            }, vaultSig);
                            results["VAULT_GRAPH_INGEST"] = {
                                __vaultIngest: true,
                                __vaultIngestAutoApplied: true,
                                summary: out.summary,
                                graphCommands: [],
                                appliedOperationsCount: out.graphCommands.length,
                                filesProcessed: out.filesProcessed,
                                filesTotal: out.filesTotal,
                                truncatedFiles: out.truncatedFiles,
                                extractFailures: out.extractFailures,
                            };
                        } catch (e: unknown) {
                            results["VAULT_GRAPH_INGEST"] = `Vault graph ingest failed: ${
                                e instanceof Error ? e.message : String(e)
                            }`;
                        }
                        if (isCancelled("VAULT_GRAPH_INGEST")) {
                            results["VAULT_GRAPH_INGEST"] = "Cancelled by user.";
                            onProgress(displayName, "Cancelled", 100);
                        } else {
                            onProgress(displayName, "Complete", 100);
                        }
                        break;
                    }

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
                        onProgress(displayName, "Extracting entities to graph...", 40);
                        if (!attachmentsContext || attachmentsContext.trim() === '') {
                            results["EXTRACT_TO_GRAPH"] = "No attachments provided.";
                            onProgress(displayName, "No context", 100);
                            break;
                        }
                        const graphGenRes = await requestUrl({
                            url: `${this.plugin.settings.graphApiUrl}/api/process-text`,
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.plugin.settings.reportApiKey}`
                            },
                            body: JSON.stringify({
                                text: attachmentsContext,
                                existing_entities: [],
                                reference_time: new Date().toISOString()
                            }),
                            throw: false
                        });
                        results["EXTRACT_TO_GRAPH"] = graphGenRes.status < 300 ? "Successfully extracted to graph." : "Extraction failed.";
                        onProgress(displayName, "Complete", 100);
                        break;
                    }

                    case "ANALYZE_EVIDENCE": {
                        if (isCancelled("ANALYZE_EVIDENCE")) {
                            results["ANALYZE_EVIDENCE"] = "Cancelled by user.";
                            onProgress(displayName, "Cancelled", 100);
                            break;
                        }
                        onProgress(displayName, "Opening evidence picker…", 5);
                        try {
                            const { EvidencePickerModal } = await import("../modals/evidence-picker-modal");
                            const picker = new EvidencePickerModal(this.plugin.app);
                            const selection = await picker.pick();
                            if (!selection || selection.files.length === 0) {
                                results["ANALYZE_EVIDENCE"] = "No files selected.";
                                onProgress(displayName, "Skipped", 100);
                                break;
                            }
                            const { EvidenceService } = await import("./evidence-service");
                            const svc = new EvidenceService(this.plugin);
                            const commands = await svc.analyze(
                                selection.files,
                                (msg, pct) => {
                                    if (isCancelled("ANALYZE_EVIDENCE")) return;
                                    onProgress(displayName, msg, pct);
                                },
                            );
                            if (commands.length > 0) {
                                const lines = await this.executeGraphCommandsImmediate(commands, { showErrorNotices: false });
                                results["ANALYZE_EVIDENCE"] = {
                                    __evidenceAnalysis: true,
                                    summary: lines.join("\n"),
                                    graphCommands: [],
                                    appliedOperationsCount: commands.length,
                                    filesProcessed: selection.files.length,
                                };
                            } else {
                                results["ANALYZE_EVIDENCE"] = "No entities extracted from evidence files.";
                            }
                        } catch (e: unknown) {
                            results["ANALYZE_EVIDENCE"] = `Evidence analysis failed: ${
                                e instanceof Error ? e.message : String(e)
                            }`;
                        }
                        if (isCancelled("ANALYZE_EVIDENCE")) {
                            results["ANALYZE_EVIDENCE"] = "Cancelled by user.";
                            onProgress(displayName, "Cancelled", 100);
                        } else {
                            onProgress(displayName, "Complete", 100);
                        }
                        break;
                    }

                    default:
                        console.warn(`[OrchestrationService] Unknown tool: ${tool}`);
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
                commands.push(...this.operationsToGraphCommands(extraction.operations));
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
        options: { showErrorNotices: boolean }
    ): Promise<string[]> {
        const lines: string[] = [];

        for (const command of commands) {
            try {
                if (command.startsWith("@@create_entity")) {
                    const jsonStr = command.replace("@@create_entity", "").trim();
                    const data = JSON.parse(jsonStr);
                    if (data.type && data.properties) {
                        await this.plugin.entityManager.createEntity(data.type, data.properties);
                        const name =
                            data.label ||
                            (data.properties && (data.properties.name as string)) ||
                            data.type;
                        lines.push(`✓ Created ${data.type}: **${name}**`);
                    }
                } else if (command.startsWith("@@delete_entity")) {
                    const jsonStr = command.replace("@@delete_entity", "").trim();
                    const data = JSON.parse(jsonStr);
                    if (data.id) {
                        const entity = this.plugin.entityManager.getEntity(data.id);
                        const name = entity ? entity.label : `ID: ${data.id}`;
                        await this.plugin.entityManager.deleteEntities([data.id]);
                        lines.push(`✓ Removed entity: **${name}**`);
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

                        await this.plugin.entityManager.createConnection(fromId, toId, data.relationship);
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
                        await this.plugin.entityManager.deleteConnectionWithNote(data.id);
                        lines.push(`✓ Removed link (id ${data.id})`);
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

    public async executeGraphModifications(commands: string[]): Promise<void> {
        if (!commands || commands.length === 0) return;

        const checkboxItems: { label: string, value: string, checked: boolean }[] = [];
        commands.forEach((cmd, idx) => {
            let labelText = `❓ Unknown: ${cmd}`;
            try {
                if (cmd.startsWith("@@create_entity")) {
                    const data = JSON.parse(cmd.replace("@@create_entity", "").trim());
                    const name = data.label || (data.properties && data.properties.name) || 'Unknown';
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

        const lines = await this.executeGraphCommandsImmediate(cmdsToExecute, { showErrorNotices: true });
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

        const systemPrompt = this.plugin.settings.orchestrationPrompt
            || "You are the Orchestration Agent. Based on the user query, determine tools and graph commands to run.";

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

        const prompt = `
${systemPrompt}

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
                false,
                this.plugin.settings.orchestrationModel,
                undefined,
                {
                    provider: this.plugin.settings.orchestrationProvider,
                    url: this.plugin.settings.orchestrationLocalUrl,
                    apiKey: this.plugin.settings.orchestrationApiKey
                }
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
