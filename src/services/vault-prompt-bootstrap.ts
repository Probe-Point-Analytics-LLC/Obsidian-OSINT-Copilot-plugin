import { App, normalizePath, TFile } from "obsidian";
import { VAULT_PROMPT_DEFAULT_FILES } from "../data/vault-prompt-defaults";

/**
 * Creates default prompt files under the vault prompts root when missing (never overwrites).
 */
export class VaultPromptBootstrapService {
	constructor(
		private app: App,
		private getPromptsRoot: () => string,
	) {}

	async ensureDefaultsInstalled(): Promise<void> {
		const root = normalizePath(this.getPromptsRoot().trim() || ".osint-copilot/prompts");
		for (const def of VAULT_PROMPT_DEFAULT_FILES) {
			const path = normalizePath(`${root}/${def.path}`);
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) continue;

			const parent = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
			if (parent) await this.ensureFolderChain(parent);

			await this.app.vault.create(path, def.content);
		}
	}

	private async ensureFolderChain(path: string): Promise<void> {
		const norm = normalizePath(path);
		const parts = norm.split("/").filter(Boolean);
		let acc = "";
		for (const p of parts) {
			acc = acc ? `${acc}/${p}` : p;
			const f = this.app.vault.getAbstractFileByPath(acc);
			if (!f) {
				try {
					await this.app.vault.createFolder(acc);
				} catch (e) {
					if (
						e instanceof Error &&
						!e.message.includes("Folder already exists")
					) {
						throw e;
					}
				}
			}
		}
	}
}
