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
