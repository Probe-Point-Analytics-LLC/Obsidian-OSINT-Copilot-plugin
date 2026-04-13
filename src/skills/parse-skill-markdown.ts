import { parseMarkdownWithFrontmatter } from "../services/vault-prompt-loader";
import type { VaultSkillManifest } from "./skill-types";

/**
 * Parse a vault skill markdown file (skill_kind: vault or omitted).
 */
export function parseSkillMarkdown(raw: string, sourcePath: string): VaultSkillManifest | null {
	const { data, body } = parseMarkdownWithFrontmatter(raw);
	const kind = (data.skill_kind || "vault").trim().toLowerCase();
	if (kind !== "vault") return null;

	const id = (data.id || "").trim();
	if (!id) return null;

	const name = (data.name || id).trim();
	const description = (data.description || "").trim();

	return {
		id,
		name,
		description,
		body: body.trim(),
		sourcePath,
	};
}
