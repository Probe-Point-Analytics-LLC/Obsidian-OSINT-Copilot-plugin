import { App, normalizePath, TFile } from "obsidian";
import { TASK_AGENT_DEFAULT_FILES } from "../data/task-agent-defaults";
import { DEFAULT_TASK_AGENTS_FOLDER } from "../constants/vault-layout";

export class TaskAgentBootstrapService {
	constructor(
		private app: App,
		private getTaskAgentsRoot: () => string,
	) {}

	async ensureDefaultsInstalled(): Promise<void> {
		const root = normalizePath(
			this.getTaskAgentsRoot().trim() || DEFAULT_TASK_AGENTS_FOLDER,
		);
		for (const def of TASK_AGENT_DEFAULT_FILES) {
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
