/** Parsed vault skill (markdown under skills folder). */
export interface VaultSkillManifest {
	id: string;
	name: string;
	description: string;
	/** Markdown body (instructions for SkillExecutor). */
	body: string;
	sourcePath: string;
}
