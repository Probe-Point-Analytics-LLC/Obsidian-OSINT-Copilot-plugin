import type VaultAIPlugin from "../plugin/vault-ai-plugin";
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
	if (!spec) {
		const runnable = await plugin.enricherRegistry.listRunnable();
		const ids = runnable.map((e) => e.id).join(", ");
		const folder = plugin.settings.enrichersFolder?.trim() || "OSINTCopilot/custom/enrichers";
		const hint = ids
			? `\n\n**Available enricher ids** (use \`enricher_id\` exactly as in JSON — lowercase, hyphens): ${ids}`
			: `\n\nNo **active** enricher specs found under \`${folder}\`. Add or enable a JSON file; \`id\` must match \`enricher_id\`.`;
		return `Unknown enricher \`${id}\`.${hint}`;
	}
	return executeEnricherHttp(
		spec,
		query,
		attachmentsContext,
		signal,
		plugin.app.vault,
		plugin.settings.credentialsFolder,
	);
}
