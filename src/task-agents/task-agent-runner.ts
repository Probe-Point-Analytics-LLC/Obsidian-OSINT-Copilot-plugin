import { App } from "obsidian";
import type { ClaudeCodeService } from "../services/claude-code-service";
import type { VaultPromptLoader } from "../services/vault-prompt-loader";
import { assembleTaskAgentContext } from "./context-assembler";
import type { IndexedNoteLike } from "./context-assembler";
import { normalizeRootList } from "./path-allowlist";
import type { TaskAgentManifest } from "./types";
import { parseVaultFilesJson } from "./json-response";
import { applyVaultFilesV1, formatApplyNotice } from "./write-applier";

export interface TaskAgentRunnerOptions {
	globalOutputAllowlist: string;
}

export class TaskAgentRunner {
	constructor(
		private app: App,
		private getClaude: () => ClaudeCodeService | null,
		private vaultPromptLoader: VaultPromptLoader,
		private getPluginIndex: () => Map<string, IndexedNoteLike>,
		private getDefaultModel: () => string,
		private options: TaskAgentRunnerOptions,
	) {}

	updateOptions(partial: Partial<TaskAgentRunnerOptions>): void {
		this.options = { ...this.options, ...partial };
	}

	async run(
		manifest: TaskAgentManifest,
		userMessage: string,
		signal?: AbortSignal,
	): Promise<{ assistantText: string; appliedPaths: string[] }> {
		const claude = this.getClaude();
		if (!claude) {
			return {
				assistantText: "Claude Code CLI is not initialized. Check plugin settings.",
				appliedPaths: [],
			};
		}

		const globalRoots = normalizeRootList(this.options.globalOutputAllowlist);
		if (globalRoots.length === 0) {
			return {
				assistantText:
					"Task agents are disabled: add at least one **global output allowlist** folder in Settings (Task agents).",
				appliedPaths: [],
			};
		}

		const wiki = await assembleTaskAgentContext(
			this.app,
			manifest.contextRoots,
			this.getPluginIndex(),
			manifest.maxNotes,
			manifest.maxContextChars,
			userMessage,
		);

		const globalRules = await this.vaultPromptLoader.getGlobalRules();
		const jsonContract = `You MUST respond with ONLY valid JSON (no markdown fences, no commentary) matching this shape:
{
  "version": "vault_files_v1",
  "files": [
    { "path": "relative/path/from/vault/root.md", "body": "markdown content", "frontmatter": "optional yaml lines" }
  ]
}

Paths must be vault-relative, use forward slashes, and stay within the agent output_roots AND the user's global allowlist.`;

		const parts: string[] = [];
		if (globalRules) parts.push("=== GLOBAL RULES (vault) ===\n" + globalRules);
		parts.push("=== TASK AGENT INSTRUCTIONS ===\n" + manifest.body);
		if (wiki) parts.push("=== WIKI / CONTEXT ===\n" + wiki);
		parts.push(jsonContract);

		const systemPrompt = parts.join("\n\n");
		const userBlock =
			"=== USER REQUEST ===\n" + userMessage.trim() + "\n\nProduce the JSON now.";

		const defaultModel = this.getDefaultModel();
		if (manifest.model) {
			claude.updateConfig({ model: manifest.model });
		}

		let raw: string;
		try {
			raw = await claude.chat(systemPrompt, userBlock, signal);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return { assistantText: `Task agent error (CLI): ${msg}`, appliedPaths: [] };
		} finally {
			if (manifest.model) {
				claude.updateConfig({ model: defaultModel });
			}
		}

		const data = parseVaultFilesJson(raw);
		if (!data || data.files.length === 0) {
			return {
				assistantText:
					`Could not parse vault_files_v1 JSON from the model.\n\n--- raw (truncated) ---\n${raw.slice(0, 4000)}${raw.length > 4000 ? "\n…" : ""}`,
				appliedPaths: [],
			};
		}

		const apply = await applyVaultFilesV1(
			this.app,
			data,
			manifest.outputRoots,
			globalRoots,
		);
		formatApplyNotice(apply);

		const paths = [...apply.created, ...apply.updated];
		let assistantText = `Applied **${paths.length}** file(s).`;
		if (apply.errors.length) {
			assistantText += `\n\n**Issues:**\n${apply.errors.map((e) => `- ${e}`).join("\n")}`;
		}
		if (paths.length) {
			assistantText += `\n\n**Paths:**\n${paths.map((p) => `- \`${p}\``).join("\n")}`;
		}

		return { assistantText, appliedPaths: paths };
	}
}
