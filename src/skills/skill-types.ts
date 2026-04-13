/** Built-in skill ids (settings / toggles). */
export type BuiltInSkillId = "local_vault" | "graph_generation";

export type SkillKind = "builtin" | "vault";

/** Unified entry for UI and planner (built-ins + vault markdown). */
export interface SkillListEntry {
	kind: SkillKind;
	/** Toggle key in settings.skillToggles (built-in id or vault manifest id). */
	id: string;
	name: string;
	description: string;
	/** Tool string used in planner JSON and execution (LOCAL_VAULT, EXTRACT_TO_GRAPH, SKILL_*). */
	plannerToolId: string;
	sourcePath?: string;
}

/** Parsed vault skill (markdown under skills folder). */
export interface VaultSkillManifest {
	id: string;
	name: string;
	description: string;
	/** Markdown body (instructions for SkillExecutor / planner blurb). */
	body: string;
	sourcePath: string;
}

export interface PlannerTooling {
	/** Bullet lines for === AVAILABLE TOOLS === */
	availableToolsLines: string[];
	/** Planner may only output tools in this set (plus post-filter for attachments). */
	enabledPlannerToolIds: Set<string>;
	/** Shown in JSON template example */
	defaultToolsExample: string[];
	/** Extra lines for CRITICAL RULES (tool-specific). */
	criticalRulesLines: string[];
	/** Routed intent block (conditional on enabled tools). */
	buildRoutedIntentBlock: (intentLabel: string, hasAttachments: boolean) => string;
}
