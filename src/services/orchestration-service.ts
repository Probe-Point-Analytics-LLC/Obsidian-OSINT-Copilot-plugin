import VaultAIPlugin from "../../main";
import { App, Notice, requestUrl } from 'obsidian';
import { GraphApiService } from './api-service';
import { EntityType } from '../entities/types';
import { ConfirmModal } from '../modals/confirm-modal';

export interface OrchestrationPlan {
    reasoning: string;
    toolsToCall: string[]; // e.g., ['DARK_WEB', 'LOCAL_VAULT', 'OSINT_SEARCH', 'CORPORATE_REPORTS']
    graphCommands: string[]; // e.g., ['@@CREATE: {...}', '@@DELETE: {...}']
    directResponse?: string; // If no tools needed or as a final response
}

export class OrchestrationService {
    private plugin: VaultAIPlugin;

    constructor(plugin: VaultAIPlugin) {
        this.plugin = plugin;
    }

    /**
     * Main entry point triggered by ChatView.handleSend()
     */
    public async processRequest(
        query: string,
        attachmentsContext: string,
        currentGraphState: any,
        conversationMemory: { role: string, content: string }[],
        onProgress: (msg: string, percent: number) => void
    ): Promise<string> {
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

            let toolResults: Record<string, any> = {};
            if (plan.toolsToCall.length > 0) {
                onProgress(`Executing tools: ${plan.toolsToCall.join(', ')}...`, 50);
                toolResults = await this.executeToolsInParallel(plan.toolsToCall, query, attachmentsContext, onProgress);
            }

            if (this.shouldExtractEntities(toolResults)) {
                onProgress("Generating graph entities from tool results...", 70);
                await this.feedResultsToGraphExtraction(toolResults);
            }

            if (plan.graphCommands.length > 0) {
                onProgress(`Applying ${plan.graphCommands.length} graph modifications...`, 80);
                await this.executeGraphModifications(plan.graphCommands);
            }

            onProgress("Synthesizing final response...", 90);
            const finalResponse = await this.generateFinalResponse(plan, toolResults, query, currentGraphState, conversationMemory); // Updated call signature

            onProgress("Complete", 100);
            return finalResponse; // Return the final response
        } catch (error) {
            console.error("[OrchestrationService] Error:", error);
            this.handleError(error);
            throw error;
        }
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

    private async classifyIntent(query: string, attachmentsContext: string, graphState: any, conversationMemory: { role: string, content: string }[]): Promise<OrchestrationPlan> {
        const systemPrompt = this.plugin.settings.orchestrationPrompt
            || "You are the Orchestration Agent. Based on the user query, determine tools and graph commands to run.";

        // Format memory for context
        const memoryContext = conversationMemory && conversationMemory.length > 0
            ? conversationMemory.map(msg => `${msg.role.toUpperCase()}:\n${msg.content}`).join("\n\n")
            : "No previous conversation.";

        const prompt = `
${systemPrompt}

=== CURRENT GRAPH STATE ===
(Note: 'entities' lists all nodes. 'connections' lists all edges. Orphaned nodes are entities whose IDs do not appear in any connection's 'fromEntityId' or 'toEntityId' fields - these can be removed via @@delete_entity if requested.)
${JSON.stringify(graphState, null, 2)}

=== CONVERSATION HISTORY ===
${memoryContext}

=== ATTACHMENTS CONTEXT ===
${attachmentsContext ? attachmentsContext : "No attachments provided."}

=== USER REQUEST ===
${query}

Respond ONLY with a valid JSON object matching this structure. Do not use markdown backticks around the JSON.
{
  "reasoning": "Explain your thought process here",
  "toolsToCall": ["DARK_WEB", "OSINT_SEARCH", "CORPORATE_REPORTS", "LOCAL_VAULT", "EXTRACT_TO_GRAPH"], // Array of strings (0 to many)
  "graphCommands": [
    "@@create_entity {\"type\":\"Person\", \"label\":\"John Doe\", \"properties\":{}}",
    "@@delete_entity {\"id\":\"...\"}",
    "@@create_link {\"from\":\"John Doe\", \"to\":\"Jane Smith\", \"relationship\":\"KNOWS\"}",
    "@@delete_link {\"id\":\"...\"}"
  ], // Array of valid graph command strings. Do NOT ask for permission or state that you lack internal IDs, you can use exact entity labels instead of IDs.
  "directResponse": "A direct answer if no tools are needed, or conversational response"
}`;

        try {
            // Use the remote model for classification natively with JSON mode enforced
            const responseText = await this.plugin.graphApiService.callRemoteModel(
                [{ role: "user", content: prompt }],
                true, // Enforce JSON object mode
                this.plugin.settings.orchestrationModel, // Pass the chosen orchestration model (e.g., gpt-4o)
                undefined, // signal
                {
                    provider: this.plugin.settings.orchestrationProvider,
                    url: this.plugin.settings.orchestrationLocalUrl,
                    apiKey: this.plugin.settings.orchestrationApiKey
                }
            );

            // Try to extract JSON from the response text
            const match = responseText.match(/\{[\s\S]*\}/);
            if (match) {
                const plan = JSON.parse(match[0]) as OrchestrationPlan;

                // Set defaults if missing
                return {
                    reasoning: plan.reasoning || "No reasoning provided.",
                    toolsToCall: plan.toolsToCall || [],
                    graphCommands: plan.graphCommands || [],
                    directResponse: plan.directResponse
                };
            } else {
                throw new Error("Could not parse JSON from LLM response.");
            }
        } catch (error) {
            console.error("[OrchestrationService] Failed to classify intent:", error);
            // Fallback plan
            return {
                reasoning: "Fallback due to error.",
                toolsToCall: [],
                graphCommands: [],
                directResponse: "I encountered an error while trying to process your request."
            };
        }
    }

    private async executeToolsInParallel(tools: string[], query: string, attachmentsContext: string, onProgress: (msg: string, percent: number) => void): Promise<Record<string, any>> {
        const results: Record<string, any> = {};

        const promises = tools.map(async (tool) => {
            try {
                switch (tool) {
                    case "DARK_WEB":
                        const darkWebRes = await requestUrl({
                            url: `${this.plugin.settings.graphApiUrl}/api/darkweb/investigate`,
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.plugin.settings.reportApiKey}`
                            },
                            body: JSON.stringify({ query }),
                            throw: false
                        });
                        if (darkWebRes.status >= 200 && darkWebRes.status < 300) {
                            results["DARK_WEB"] = darkWebRes.json || await darkWebRes.text;
                        } else {
                            results["DARK_WEB"] = `Dark web failed: ${darkWebRes.status}`;
                        }
                        break;
                    case "OSINT_SEARCH":
                        const osintRes = await this.plugin.graphApiService.aiSearch(
                            { query },
                            () => { },
                            new AbortController().signal
                        );
                        results["OSINT_SEARCH"] = osintRes;
                        break;
                    case "CORPORATE_REPORTS":
                        results["CORPORATE_REPORTS"] = "Corporate report stub for: " + query; // Pending dedicated endpoint
                        break;
                    case "LOCAL_VAULT":
                        const vaultResults = `Executing local search for: ${query}. Use search findings appropriately.`; // TODO: wire actual search
                        results["LOCAL_VAULT"] = vaultResults;
                        break;
                    case "EXTRACT_TO_GRAPH":
                        if (!attachmentsContext || attachmentsContext.trim() === '') {
                            results["EXTRACT_TO_GRAPH"] = "No attachments or links provided to extract.";
                            break;
                        }
                        // Use the correct API command for extracting text to graph
                        // Let's rely on ChatView's Graph Only Mode backend logic
                        const graphGenRes = await requestUrl({
                            url: `${this.plugin.settings.graphApiUrl}/api/process-text`,
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.plugin.settings.reportApiKey}`
                            },
                            body: JSON.stringify({
                                text: attachmentsContext,
                                existing_entities: [], // Or optionally map `this.plugin.entityManager.getAllEntities()` if context size permits
                                reference_time: new Date().toISOString()
                            }),
                            throw: false
                        });

                        if (graphGenRes.status >= 200 && graphGenRes.status < 300) {
                            // Automatically insert these entities into the local Obsidian graph!
                            const generatedGraph = graphGenRes.json;
                            if (generatedGraph && generatedGraph.entities) {
                                for (const ent of generatedGraph.entities) {
                                    await this.plugin.entityManager.createEntity(ent.type, ent.properties);
                                }
                            }
                            if (generatedGraph && generatedGraph.connections) {
                                for (const conn of generatedGraph.connections) {
                                    await this.plugin.entityManager.createConnection(conn.from, conn.to, conn.relationship);
                                }
                            }
                            results["EXTRACT_TO_GRAPH"] = `Successfully extracted ${generatedGraph?.entities?.length || 0} entities and ${generatedGraph?.connections?.length || 0} connections into the graph.`;
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

    private shouldExtractEntities(toolResults: Record<string, any>): boolean {
        // TODO: Determine if tool results contain extractable entities (e.g., non-empty object)
        return Object.keys(toolResults).length > 0;
    }

    private async feedResultsToGraphExtraction(results: Record<string, any>): Promise<void> {
        // TODO: Transform results to text and call GraphApiService for extraction
    }

    private async executeGraphModifications(commands: string[]): Promise<void> {
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
                        await this.plugin.entityManager.createConnection(data.from, data.to, data.relationship);
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
${JSON.stringify(toolResults, null, 2)}

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
