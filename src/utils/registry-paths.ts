import { normalizePath } from "obsidian";
import { DEFAULT_ENRICHERS_FOLDER, DEFAULT_SKILLS_FOLDER } from "../constants/vault-layout";
import { parseSkillIdForVault } from "../services/custom-vault-operations";

/** Vault path for `{skillsFolder}/{id}.md` (null if id invalid). */
export function skillMarkdownPathFromId(skillsFolder: string, rawId: string): string | null {
	const id = parseSkillIdForVault(rawId);
	if (!id || id === "readme") return null;
	const root = normalizePath(skillsFolder.trim() || DEFAULT_SKILLS_FOLDER);
	return normalizePath(`${root}/${id}.md`);
}

/** Vault path for `{enrichersFolder}/{id}.json` (null if id invalid). Matches custom-vault-writer slug rules. */
export function enricherJsonPathFromId(enrichersFolder: string, rawId: string): string | null {
	const id = parseSkillIdForVault(rawId);
	if (!id) return null;
	const root = normalizePath(enrichersFolder.trim() || DEFAULT_ENRICHERS_FOLDER);
	return normalizePath(`${root}/${id}.json`);
}
