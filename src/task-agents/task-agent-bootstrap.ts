import { App, normalizePath } from "obsidian";
import { TASK_AGENT_DEFAULT_FILES } from "../data/task-agent-defaults";
import { DEFAULT_TASK_AGENTS_FOLDER } from "../constants/vault-layout";
import { createFileIfMissing } from "../utils/vault-bootstrap-fs";

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
			await createFileIfMissing(this.app, path, def.content);
		}
	}
}
