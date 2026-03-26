import VaultAIPlugin from "../../main";
import { App, Notice, requestUrl } from 'obsidian';
import { GraphApiService } from './api-service';
import { EntityType } from '../entities/types';
import { ConfirmModal } from '../modals/confirm-modal';

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

export class OrchestrationService {
    private plugin: VaultAIPlugin;

    constructor(plugin: VaultAIPlugin) {
        this.plugin = plugin;
    }


    private async verifyProviderAndCredits(): Promise<void> {
        if (this.plugin.settings.orchestrationProvider === 'osint-copilot') {
            try {
                const response = await requestUrl({
                    url: "https://api.osint-copilot.com/api/key/info",
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

    public async processRequest(
        query: string,
        attachmentsContext: string,
        currentGraphState: any,
        conversationMemory: { role: string, content: string }[],
        onProgress: (msg: string, percent: number) => void
    ): Promise<OrchestrationResult> {
        try {
            onProgress("Verifying provider and credits...", 10);
            await this.verifyProviderAndCredits();

            // Implicit URL Extraction (Phase 3)
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const urls = query.match(urlRegex);
            if (urls && urls.length > 0) {
                onProgress(`Extracting content from ${urls.length} link(s)...`, 15);
                for (const url of urls) {
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
            const plan = await this.classifyIntent(query, attachmentsContext, currentGraphState, conversationMemory);

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
                const finalResponse = await this.generateFinalResponse(plan, {}, query, currentGraphState, conversationMemory);
                onProgress("Complete", 100);
                return { finalResponse, phase: "SYNTHESIS_COMPLETE" };
            }

            // Execute tools in parallel
            onProgress(`Executing tools: ${plan.toolsToCall.join(', ')}...`, 40);
            const toolResults = await this.executeToolsInParallel(plan.toolsToCall, query, attachmentsContext, onProgress);

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

            // Generate graph entities from ALL combined tool results
            if (this.plugin.settings.enableGraphFeatures && Object.keys(toolResults).length > 0) {
                onProgress("Generating graph entities from all tool results...", 30);
                const extraCommands = await this.feedResultsToGraphExtraction(toolResults);
                if (extraCommands.length > 0) {
                    if (!plan.graphCommands) plan.graphCommands = [];
                    plan.graphCommands = [...plan.graphCommands, ...extraCommands];
                }
            }

            if (plan.graphCommands && plan.graphCommands.length > 0) {
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

    private async classifyIntent(query: string, attachmentsContext: string, graphState: any, conversationMemory: { role: string, content: string }[]): Promise<OrchestrationPlan> {
        const systemPrompt = this.plugin.settings.orchestrationPrompt
            || "You are the Orchestration Agent. Based on the user query, determine tools and graph commands to run.";

        // Format memory for context
        const memoryContext = conversationMemory && conversationMemory.length > 0
            ? conversationMemory.map(msg => `${msg.role.toUpperCase()}:\n${msg.content}`).join("\n\n")
            : "No previous conversation.";

        // Check if the user is approving a previously proposed plan
        const isApproval = /^\s*(proceed|go|approved|yes|ok|run|execute|do it|start|launch|confirm)/i.test(query);

        // Only include EXTRACT_TO_GRAPH when attachments are present
        const hasAttachments = attachmentsContext && attachmentsContext.trim().length > 0;
        const extractToGraphTool = hasAttachments
            ? '\n- "EXTRACT_TO_GRAPH" - Extract entities from attached files/links into the knowledge graph.'
            : '';

        const prompt = `You are an OSINT investigation planner. You MUST respond with a JSON object ONLY. No other text.

=== CRITICAL RULES ===
1. You are a PLANNER, not a responder. You NEVER answer the user's question directly.
2. For ANY investigative question (who, what, where, when about people, organizations, events, crimes, threats), you MUST propose tools.
3. Set "isProposal" to true and list the tools you recommend.
4. The ONLY time you set "isProposal" to false with empty "toolsToCall" is when the user says "Proceed", "Go", "Approved", or similar confirmation words.
5. Your "directResponse" should describe your PLAN, never the answer to the question.
6. NEVER put factual answers in "directResponse". That field is for describing what tools you will use and why.

=== AVAILABLE TOOLS ===
- "OSINT_SEARCH" - Search digital footprints: emails, phones, breaches, public records, web search.
- "DARK_WEB" - Dark web intelligence: hidden services, underground leaks, threat actor forums.
- "CORPORATE_REPORTS" - Corporate/legal data: ownership registries, financial filings, sanctions lists.
- "LOCAL_VAULT" - Search the user's local Obsidian notes for existing intelligence.${extractToGraphTool}

=== USER'S ORCHESTRATION CONTEXT ===
${systemPrompt}

=== CURRENT GRAPH STATE (existing entities) ===
Entities: ${Array.isArray(graphState?.entities) ? graphState.entities.length : 0} nodes
${Array.isArray(graphState?.entities) ? graphState.entities.slice(0, 20).map((e: any) => `- ${e.type}: ${e.label}`).join('\n') : 'Empty graph'}

=== CONVERSATION HISTORY ===
${memoryContext}

=== USER REQUEST ===
${query}

${isApproval ? '>>> THE USER IS APPROVING A PREVIOUS PLAN. Set "isProposal": false and list the final tools from the previous plan.' : '>>> THIS IS A NEW REQUEST. You MUST set "isProposal": true and propose tools.'}

Respond with this exact JSON structure:
{
  "reasoning": "Your analysis of the query and why you chose these tools",
  "planSummary": "### Investigation Plan\\n1. Step 1...\\n2. Step 2...",
  "isProposal": ${isApproval ? 'false' : 'true'},
  "toolsToCall": ["OSINT_SEARCH"],
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

                // GUARD: If this is NOT an approval and the LLM still returned no tools,
                // force a proposal with OSINT_SEARCH as default
                if (!isApproval && plan.toolsToCall.length === 0) {
                    console.warn("[OrchestrationService] LLM returned no tools for a non-approval query. Forcing OSINT_SEARCH proposal.");
                    plan.isProposal = true;
                    plan.toolsToCall = ["OSINT_SEARCH"];
                    plan.planSummary = plan.planSummary || `### Investigation Plan\n1. **OSINT Search** — Search public intelligence sources for: "${query}"\n\n*Reply to add more modules (DARK_WEB, CORPORATE_REPORTS, etc.) or click Run to proceed.*`;
                    plan.directResponse = plan.directResponse || `I'll investigate this using OSINT Search. You can add more modules like DARK_WEB or CORPORATE_REPORTS before I start.`;
                }

                console.log("[OrchestrationService] Final plan - isProposal:", plan.isProposal, "tools:", plan.toolsToCall);
                return plan;
            } else {
                throw new Error("Could not parse JSON from LLM response.");
            }
        } catch (error) {
            console.error("[OrchestrationService] Failed to classify intent:", error);
            // Fallback plan - still propose tools instead of giving up
            return {
                reasoning: "Fallback due to classification error.",
                toolsToCall: ["OSINT_SEARCH"],
                graphCommands: [],
                isProposal: true,
                planSummary: `### Investigation Plan\n1. **OSINT Search** — Search for: "${query}"\n\n*The classifier encountered an issue, but I've defaulted to an OSINT search. Add more tools or click Run.*`,
                directResponse: `I'll search for intelligence on this topic. You can add DARK_WEB, CORPORATE_REPORTS, or other modules before I begin.`
            };
        }
    }

    public async executeToolsInParallel(tools: string[], query: string, attachmentsContext: string, onProgress: (msg: string, percent: number) => void): Promise<Record<string, any>> {
        const results: Record<string, any> = {};

        const promises = tools.map(async (tool) => {
            try {
                switch (tool) {
                    case "DARK_WEB": {
                        onProgress("Starting dark web investigation...", 25);
                        // Step 1: Start the investigation job
                        const darkWebRes = await requestUrl({
                            url: `${this.plugin.settings.graphApiUrl}/api/darkweb/investigate`,
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.plugin.settings.reportApiKey}`
                            },
                            body: JSON.stringify({ query, model: 'gpt-5-mini', threads: 8 }),
                            throw: false
                        });
                        if (darkWebRes.status < 200 || darkWebRes.status >= 300) {
                            results["DARK_WEB"] = `Dark web API error: ${darkWebRes.status}`;
                            break;
                        }
                        const jobId = darkWebRes.json?.job_id;
                        if (!jobId) {
                            results["DARK_WEB"] = "Dark web API did not return a job ID.";
                            break;
                        }

                        // Step 2: Poll for completion (max 5 minutes)
                        const maxPollMs = 5 * 60 * 1000;
                        const startTime = Date.now();
                        let pollInterval = 5000;
                        let completed = false;

                        while (Date.now() - startTime < maxPollMs) {
                            await new Promise(resolve => setTimeout(resolve, pollInterval));
                            const elapsed = Math.round((Date.now() - startTime) / 1000);
                            onProgress(`Dark web: searching... (${elapsed}s)`, 30);

                            const statusRes = await requestUrl({
                                url: `${this.plugin.settings.graphApiUrl}/api/darkweb/status/${jobId}`,
                                method: 'GET',
                                headers: { 'Authorization': `Bearer ${this.plugin.settings.reportApiKey}` },
                                throw: false
                            });

                            if (statusRes.status >= 200 && statusRes.status < 300) {
                                const statusData = statusRes.json;
                                if (statusData?.status === 'completed' || statusData?.status === 'done') {
                                    completed = true;
                                    break;
                                } else if (statusData?.status === 'failed' || statusData?.status === 'error') {
                                    results["DARK_WEB"] = `Dark web investigation failed: ${statusData?.error || 'Unknown error'}`;
                                    return;
                                }
                            }
                            // Increase poll interval over time
                            if (Date.now() - startTime > 30000) pollInterval = 8000;
                        }

                        if (!completed) {
                            results["DARK_WEB"] = `Dark web investigation timed out after ${Math.round(maxPollMs / 60000)} minutes. Job ID: ${jobId}`;
                            break;
                        }

                        // Step 3: Download the results
                        onProgress("Dark web: downloading results...", 45);
                        const downloadRes = await requestUrl({
                            url: `${this.plugin.settings.graphApiUrl}/api/darkweb/summary/${jobId}`,
                            method: 'GET',
                            headers: { 'Authorization': `Bearer ${this.plugin.settings.reportApiKey}` },
                            throw: false
                        });

                        if (downloadRes.status >= 200 && downloadRes.status < 300) {
                            const summaryData = downloadRes.json;
                            results["DARK_WEB"] = summaryData?.summary || summaryData?.report || summaryData?.content || JSON.stringify(summaryData);
                        } else {
                            // Try download endpoint as fallback
                            const dlRes = await requestUrl({
                                url: `${this.plugin.settings.graphApiUrl}/api/darkweb/download/${jobId}`,
                                method: 'GET',
                                headers: { 'Authorization': `Bearer ${this.plugin.settings.reportApiKey}` },
                                throw: false
                            });
                            results["DARK_WEB"] = dlRes.status >= 200 && dlRes.status < 300
                                ? (dlRes.text || "No content returned")
                                : `Failed to download dark web results: ${downloadRes.status}`;
                        }
                        break;
                    }

                    case "OSINT_SEARCH": {
                        onProgress("Running OSINT search...", 30);
                        // Use the chat completion API with an OSINT research prompt
                        const osintResponse = await this.plugin.graphApiService.callRemoteModel([
                            {
                                role: "system",
                                content: `You are an OSINT intelligence analyst. Research the user's query thoroughly using your knowledge. Provide:
1. A comprehensive factual summary of the topic
2. All key individuals, organizations, and entities involved with their roles
3. Key dates, events, and timeline
4. Known connections between entities
5. Sources and investigations that have covered this topic

Be thorough, factual, and structured. Use markdown formatting with headers and bullet points.`
                            },
                            {
                                role: "user",
                                content: `Research this OSINT query:\n\n${query}`
                            }
                        ]);
                        results["OSINT_SEARCH"] = osintResponse;
                        break;
                    }

                    case "CORPORATE_REPORTS": {
                        onProgress("Searching corporate registries...", 35);
                        // Use the chat completion API with a corporate/financial focus
                        const corpResponse = await this.plugin.graphApiService.callRemoteModel([
                            {
                                role: "system",
                                content: `You are a corporate intelligence analyst specializing in company ownership structures, financial filings, and sanctions screening. For the given query:
1. Identify all companies, banks, and financial institutions involved
2. Map ownership structures and beneficial owners
3. Identify shell companies and offshore entities
4. Check for sanctions, legal proceedings, and regulatory actions
5. Trace financial flows and corporate relationships

Be thorough and structured. Use markdown formatting.`
                            },
                            {
                                role: "user",
                                content: `Analyze corporate and financial structures related to:\n\n${query}`
                            }
                        ]);
                        results["CORPORATE_REPORTS"] = corpResponse;
                        break;
                    }

                    case "LOCAL_VAULT": {
                        onProgress("Searching local vault...", 20);
                        // Search the user's Obsidian vault for relevant notes
                        const searchTerms = query.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
                        const files = this.plugin.app.vault.getMarkdownFiles();
                        const matchingNotes: string[] = [];

                        for (const file of files) {
                            if (matchingNotes.length >= 10) break;
                            try {
                                const content = await this.plugin.app.vault.cachedRead(file);
                                const lowerContent = content.toLowerCase();
                                const queryLower = query.toLowerCase();
                                // Check if file contains relevant keywords
                                const matches = searchTerms.filter(term => lowerContent.includes(term.toLowerCase()));
                                if (matches.length >= 2 || lowerContent.includes(queryLower.substring(0, 30).toLowerCase())) {
                                    matchingNotes.push(`### ${file.basename}\n${content.substring(0, 500)}${content.length > 500 ? '...' : ''}`);
                                }
                            } catch (e) {
                                // Skip unreadable files
                            }
                        }

                        results["LOCAL_VAULT"] = matchingNotes.length > 0
                            ? `Found ${matchingNotes.length} relevant note(s):\n\n${matchingNotes.join('\n\n---\n\n')}`
                            : `No relevant notes found in the vault for: "${query}"`;
                        break;
                    }

                    case "EXTRACT_TO_GRAPH":
                        if (!attachmentsContext || attachmentsContext.trim() === '') {
                            results["EXTRACT_TO_GRAPH"] = "No attachments or links provided to extract.";
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

                        if (graphGenRes.status >= 200 && graphGenRes.status < 300) {
                            const result = graphGenRes.json;
                            let entitiesCreated = 0;
                            let connectionsCreated = 0;

                            if (result && result.operations) {
                                for (const operation of result.operations) {
                                    if (operation.action === "create" && operation.entities) {
                                        for (const ent of operation.entities) {
                                            try {
                                                await this.plugin.entityManager.createEntity(ent.type, ent.properties);
                                                entitiesCreated++;
                                            } catch (e) {
                                                console.error(`[OrchestrationService] Failed to create entity:`, e);
                                            }
                                        }
                                    }
                                }
                            }
                            results["EXTRACT_TO_GRAPH"] = `Successfully extracted ${entitiesCreated} entities and ${connectionsCreated} connections into the graph.`;
                        } else {
                            results["EXTRACT_TO_GRAPH"] = `Extraction failed: ${graphGenRes.status}`;
                        }
                        break;

                    default:
                        console.warn(`[OrchestrationService] Unknown tool requested: ${tool}`);
                }
            } catch (e) {
                console.error(`[OrchestrationService] Tool execution failed for ${tool}:`, e);
                results[tool] = `Error: ${e instanceof Error ? e.message : String(e)}`;
            }
        });

        await Promise.all(promises);
        return results;
    }

    private async feedResultsToGraphExtraction(results: Record<string, any>): Promise<string[]> {
        const commands: string[] = [];

        // 1. Group results by tool
        let textToProcess = "=== AUTOMATED INVESTIGATION RESULTS ===\n";
        for (const [tool, result] of Object.entries(results)) {
            textToProcess += `\n\n--- TOOL: ${tool} ---\n`;
            if (typeof result === 'string') {
                textToProcess += result;
            } else {
                textToProcess += JSON.stringify(result, null, 2);
            }
        }

        // 2. Call GraphApiService for extraction
        try {
            const extraction = await this.plugin.graphApiService.processText(
                textToProcess,
                this.plugin.entityManager.getAllEntities(),
                new Date().toISOString()
            );

            if (extraction.success && extraction.operations) {
                // Convert extracted operations (entities/connections) into graph commands
                extraction.operations.forEach(op => {
                    if (op.entities) {
                        op.entities.forEach(entity => {
                            commands.push(`@@create_entity ${JSON.stringify({
                                type: entity.type,
                                label: entity.properties.name || entity.properties.title || entity.properties.label || entity.type,
                                properties: entity.properties
                            })}`);
                        });
                    }

                    if (op.connections) {
                        op.connections.forEach(conn => {
                            commands.push(`@@create_link ${JSON.stringify({
                                from: conn.from_label || conn.from.toString(),
                                to: conn.to_label || conn.to.toString(),
                                relationship: conn.relationship
                            })}`);
                        });
                    }
                });
            }
        } catch (error) {
            console.error("[OrchestrationService] Post-search extraction failed:", error);
        }

        return commands;
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

        let successCount = 0;

        for (const command of cmdsToExecute) {
            try {
                if (command.startsWith("@@create_entity")) {
                    const jsonStr = command.replace("@@create_entity", "").trim();
                    const data = JSON.parse(jsonStr);
                    if (data.type && data.properties) {
                        await this.plugin.entityManager.createEntity(data.type, data.properties);
                        successCount++;
                    }
                } else if (command.startsWith("@@delete_entity")) {
                    const jsonStr = command.replace("@@delete_entity", "").trim();
                    const data = JSON.parse(jsonStr);
                    if (data.id) {
                        await this.plugin.entityManager.deleteEntities([data.id]);
                        successCount++;
                    }
                } else if (command.startsWith("@@create_link")) {
                    const jsonStr = command.replace("@@create_link", "").trim();
                    const data = JSON.parse(jsonStr);
                    if (data.from && data.to && data.relationship) {
                        let fromId = data.from;
                        let toId = data.to;

                        // Try to find the entity by label if it's not a recognized ID
                        if (!this.plugin.entityManager.getEntity(fromId)) {
                            const fromEnt = this.plugin.entityManager.findEntityByLabel(data.from);
                            if (fromEnt) fromId = fromEnt.id;
                        }

                        if (!this.plugin.entityManager.getEntity(toId)) {
                            const toEnt = this.plugin.entityManager.findEntityByLabel(data.to);
                            if (toEnt) toId = toEnt.id;
                        }

                        await this.plugin.entityManager.createConnection(fromId, toId, data.relationship);
                        successCount++;
                    }
                } else if (command.startsWith("@@delete_link")) {
                    const jsonStr = command.replace("@@delete_link", "").trim();
                    const data = JSON.parse(jsonStr);
                    if (data.id) {
                        await this.plugin.entityManager.deleteConnectionWithNote(data.id);
                        successCount++;
                    }
                } else {
                    console.warn(`[OrchestrationService] Unrecognized graph command: ${command}`);
                }
            } catch (e) {
                console.error(`[OrchestrationService] Failed to execute graph command '${command}':`, e);
                new Notice(`Error executing command: ${command.substring(0, 30)}...`);
            }
        }

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
