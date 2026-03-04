import VaultAIPlugin from "../../main";
import { App, Notice, requestUrl } from 'obsidian';
import { GraphApiService } from './api-service';
import { EntityType } from '../entities/types';

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

            onProgress("Classifying intent and formulating plan...", 20);
            const plan = await this.classifyIntent(query, attachmentsContext, currentGraphState, conversationMemory);

            let toolResults: Record<string, any> = {};
            if (plan.toolsToCall.length > 0) {
                onProgress(`Executing ${plan.toolsToCall.length} tools...`, 40);
                toolResults = await this.executeToolsInParallel(plan.toolsToCall, query);
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
${JSON.stringify(graphState, null, 2)}

=== CONVERSATION HISTORY ===
${memoryContext}

=== ATTACHMENTS CONTEXT ===
${attachmentsContext ? attachmentsContext : "No attachments provided."}

=== USER REQUEST ===
${query}

Respond ONLY with a JSON object in the following format. Ensure all reasoning and properties are properly escaped.
{
  "reasoning": "Explain your thought process here",
  "toolsToCall": ["DARK_WEB", "OSINT_SEARCH", "CORPORATE_REPORTS", "LOCAL_VAULT"], // Array of strings (0 to many)
  "graphCommands": ["@@CREATE: {...}", "@@DELETE: {...}"], // Array of valid graph command strings
  "directResponse": "A direct answer if no tools are needed, or conversational response"
}`;

        try {
            // Use the remote model for classification natively
            const responseText = await this.plugin.graphApiService.callRemoteModel(
                [{ role: "user", content: prompt }],
                false, // not JSON mode in the API call itself if not supported, but we ask for JSON in prompt
                this.plugin.settings.customCheckpoints.length > 0 ? this.plugin.settings.customCheckpoints[0].model : undefined
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

    private async executeToolsInParallel(tools: string[], query: string): Promise<Record<string, any>> {
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
                                'X-API-Key': this.plugin.settings.reportApiKey
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

        for (const command of commands) {
            try {
                if (command.startsWith("@@CREATE:")) {
                    const jsonStr = command.replace("@@CREATE:", "").trim();
                    const data = JSON.parse(jsonStr);
                    // Scaffold: Assuming entity schema is standard
                    if (data.type && data.properties) {
                        await this.plugin.entityManager.createEntity(data.type, data.properties);
                    }
                } else if (command.startsWith("@@DELETE:")) {
                    const idStr = command.replace("@@DELETE:", "").trim();
                    const data = JSON.parse(idStr);
                    if (data.id) {
                        // Wait, EntityManager doesn't have an explicit root level delete that's easy to mock here.
                        // But if we could: await this.plugin.entityManager.deleteEntity(data.id);
                        console.warn(`[OrchestrationService] Delete command requested for ${data.id} but not fully implemented.`);
                    }
                } else {
                    console.warn(`[OrchestrationService] Unrecognized graph command: ${command}`);
                }
            } catch (e) {
                console.error(`[OrchestrationService] Failed to execute graph command '${command}':`, e);
            }
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
                this.plugin.settings.customCheckpoints.length > 0 ? this.plugin.settings.customCheckpoints[0].model : undefined
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
