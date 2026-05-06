import type VaultAIPlugin from "../../main";
import { parseVaultSkillPlannerTool } from "./skill-runtime";
import { executeEnricherHttp } from "../services/enrichers/enricher-executor";
import { parseEnrichToolId } from "../services/enrichers/enricher-schema";

/**
 * Runs a vault skill via local Claude (v1: single call, skill body as system context).
 */
export async function executeVaultSkillTool(
	plugin: VaultAIPlugin,
	toolId: string,
	query: string,
	attachmentsContext: string,
	signal: AbortSignal | undefined,
): Promise<string> {
	const vid = parseVaultSkillPlannerTool(toolId);
	if (!vid) {
		return `Invalid skill tool id: ${toolId}`;
	}
	const manifest = await plugin.skillRegistry.getVaultSkillById(vid);
	if (!manifest) {
		return `Unknown skill \`${vid}\`. Check ${plugin.settings.skillsFolder} and Skills settings.`;
	}

	const system = `${manifest.body}\n\n---\nYou are invoked as a tool. Respond with clear, factual output for the orchestrator. Be concise.`;
	const user = `=== USER REQUEST ===\n${query}\n\n=== ATTACHMENT / URL CONTEXT (may be empty) ===\n${attachmentsContext || "(none)"}`;

	const text = await plugin.graphApiService.callRemoteModel(
		[
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		false,
		undefined,
		signal,
	);
	return text;
}

export async function executeEnricherTool(
	plugin: VaultAIPlugin,
	toolId: string,
	query: string,
	attachmentsContext: string,
	signal: AbortSignal | undefined,
): Promise<string> {
	const id = parseEnrichToolId(toolId);
	if (!id) return `Invalid enricher tool id: ${toolId}`;
	const spec = await plugin.enricherRegistry.getById(id);
	if (!spec) return `Unknown enricher \`${id}\`.`;
	return executeEnricherHttp(spec, query, attachmentsContext, signal);
}
