import { App, normalizePath } from "obsidian";
import { VAULT_PROMPT_DEFAULT_FILES } from "../data/vault-prompt-defaults";
import { DEFAULT_PROMPTS_FOLDER } from "../constants/vault-layout";
import { createFileIfMissing } from "../utils/vault-bootstrap-fs";

/**
 * Creates default prompt files under the vault prompts root when missing (never overwrites).
 */
export class VaultPromptBootstrapService {
	constructor(
		private app: App,
		private getPromptsRoot: () => string,
	) {}

	async ensureDefaultsInstalled(): Promise<void> {
		const root = normalizePath(this.getPromptsRoot().trim() || DEFAULT_PROMPTS_FOLDER);
		for (const def of VAULT_PROMPT_DEFAULT_FILES) {
			const path = normalizePath(`${root}/${def.path}`);
			await createFileIfMissing(this.app, path, def.content);
		}
	}
}
