import type { BuiltInSkillId, PlannerTooling, SkillListEntry } from "./skill-types";
import type { SkillRegistry } from "./skill-registry";

export const SKILL_PLANNER_PREFIX = "SKILL_";

export function vaultSkillPlannerToolId(vaultSkillId: string): string {
	return `${SKILL_PLANNER_PREFIX}${vaultSkillId}`;
}

/** Returns vault skill id without prefix, or null. */
export function parseVaultSkillPlannerTool(tool: string): string | null {
	if (!tool.startsWith(SKILL_PLANNER_PREFIX)) return null;
	const id = tool.slice(SKILL_PLANNER_PREFIX.length).trim();
	return id || null;
}

export function builtinPlannerToolId(id: BuiltInSkillId): "LOCAL_VAULT" | "EXTRACT_TO_GRAPH" {
	if (id === "local_vault") return "LOCAL_VAULT";
	return "EXTRACT_TO_GRAPH";
}

export function isSkillToggleEnabled(
	skillToggles: Record<string, boolean>,
	key: string,
	defaultOn = true,
): boolean {
	const v = skillToggles[key];
	if (v === undefined) return defaultOn;
	return v;
}

function builtinEntries(): SkillListEntry[] {
	return [
		{
			kind: "builtin",
			id: "local_vault",
			name: "Local search",
			description: "Search across Obsidian notes in the vault (LOCAL_VAULT).",
			plannerToolId: "LOCAL_VAULT",
		},
		{
			kind: "builtin",
			id: "graph_generation",
			name: "Graph generation",
			description: "Extract entities from attached text into the knowledge graph (EXTRACT_TO_GRAPH).",
			plannerToolId: "EXTRACT_TO_GRAPH",
		},
	];
}

/**
 * Merge built-ins + vault skills, apply toggles, build planner sections.
 */
export async function buildPlannerTooling(
	registry: SkillRegistry,
	skillToggles: Record<string, boolean>,
	hasAttachments: boolean,
): Promise<PlannerTooling> {
	const vaultSkills = await registry.listVaultSkills();
	const merged: SkillListEntry[] = [...builtinEntries()];
	for (const v of vaultSkills) {
		merged.push({
			kind: "vault",
			id: v.id,
			name: v.name,
			description: v.description || `Custom skill \`${v.id}\`.`,
			plannerToolId: vaultSkillPlannerToolId(v.id),
			sourcePath: v.sourcePath,
		});
	}

	const enabledPlannerToolIds = new Set<string>();
	const availableToolsLines: string[] = [];

	for (const e of merged) {
		if (!isSkillToggleEnabled(skillToggles, e.id, true)) continue;
		if (e.plannerToolId === "EXTRACT_TO_GRAPH" && !hasAttachments) {
			// Still allow skill to be "enabled" in settings but not offer to planner without attachments
			continue;
		}
		enabledPlannerToolIds.add(e.plannerToolId);
		const desc = e.description || e.name;
		availableToolsLines.push(`- "${e.plannerToolId}" - ${desc}`);
	}

	const defaultToolsExample: string[] =
		enabledPlannerToolIds.size > 0
			? Array.from(enabledPlannerToolIds).slice(0, 3)
			: [];

	const criticalRulesLines: string[] = [];
	if (enabledPlannerToolIds.has("LOCAL_VAULT")) {
		criticalRulesLines.push(
			"For investigative questions about the user's vault, propose LOCAL_VAULT when relevant.",
		);
	}
	if (hasAttachments && enabledPlannerToolIds.has("EXTRACT_TO_GRAPH")) {
		criticalRulesLines.push(
			"When attachments or extracted URLs are present, you may propose EXTRACT_TO_GRAPH to ingest into the graph.",
		);
	}
	const vaultCustom = merged.filter(
		(e) =>
			e.kind === "vault" &&
			isSkillToggleEnabled(skillToggles, e.id, true) &&
			enabledPlannerToolIds.has(e.plannerToolId),
	);
	for (const e of vaultCustom) {
		criticalRulesLines.push(`You may propose "${e.plannerToolId}" when it matches the user's goal.`);
	}

	const buildRoutedIntentBlock = (intentLabel: string, att: boolean): string => {
		let attHint = "";
		if (att) {
			if (enabledPlannerToolIds.has("EXTRACT_TO_GRAPH")) {
				attHint =
					" Attachments are present; EXTRACT_TO_GRAPH may be included if it helps ingest into the graph.";
			}
		} else {
			attHint = " No attachment payload in this turn; do not select EXTRACT_TO_GRAPH.";
		}
		if (enabledPlannerToolIds.has("LOCAL_VAULT")) {
			return `${intentLabel} — Use LOCAL_VAULT to search the user's vault when appropriate.${attHint}`;
		}
		return `${intentLabel} — Choose only from AVAILABLE TOOLS below.${attHint}`;
	};

	return {
		availableToolsLines,
		enabledPlannerToolIds,
		defaultToolsExample: defaultToolsExample.length > 0 ? defaultToolsExample : ["LOCAL_VAULT"],
		criticalRulesLines,
		buildRoutedIntentBlock,
	};
}

/** Filter planner output to enabled tools and attachment rules. */
export function filterToolsToCall(
	tools: string[],
	enabled: Set<string>,
	hasAttachments: boolean,
): string[] {
	return tools.filter((t) => {
		if (!enabled.has(t)) return false;
		if (t === "EXTRACT_TO_GRAPH" && !hasAttachments) return false;
		return true;
	});
}

/** Built-in + vault skills for the Skills menu (toggle state from settings). */
export async function listSkillsForMenu(
	registry: SkillRegistry,
	skillToggles: Record<string, boolean>,
): Promise<{ entry: SkillListEntry; enabled: boolean }[]> {
	const vaultSkills = await registry.listVaultSkills();
	const merged: SkillListEntry[] = [...builtinEntries()];
	for (const v of vaultSkills) {
		merged.push({
			kind: "vault",
			id: v.id,
			name: v.name,
			description: v.description || `Custom skill \`${v.id}\`.`,
			plannerToolId: vaultSkillPlannerToolId(v.id),
			sourcePath: v.sourcePath,
		});
	}
	return merged.map((entry) => ({
		entry,
		enabled: isSkillToggleEnabled(skillToggles, entry.id, true),
	}));
}
