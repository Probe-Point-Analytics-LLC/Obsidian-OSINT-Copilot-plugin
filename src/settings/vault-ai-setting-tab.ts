import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type { EnabledSchemaFamilies } from "../services/schema-catalog-types";
import { VaultPromptBootstrapService } from "../services/vault-prompt-bootstrap";
import { TaskAgentBootstrapService } from "../task-agents/task-agent-bootstrap";
import { SkillBootstrapService } from "../skills/skill-bootstrap";
import {
	ensureCredentialsFolder,
	ensureScriptsDefaultsInstalled,
} from "../services/custom-vault-writer";
import { runtimeSettingsVisibility } from "../chat/runtime-settings-visibility";
import { CLAUDE_RUNTIME_ID, CODEX_RUNTIME_ID, getConfiguredRuntimeOptions, normalizeCustomRuntimeId, type CustomAgentRuntime } from "../services/agent-runtime/runtime-registry";
import { createAgentProvider } from "../services/agent-runtime/create-agent-provider";
import { isTaskAgentRunnable } from "../task-agents/task-agent-settings";
import { ClaudeCodeService } from "../services/claude-code-service";
import { CodexCliService } from "../services/codex-cli-service";
import { DEFAULT_SETTINGS } from "./vault-ai-settings";
import { ensureFolderExists } from "../utils/vault-bootstrap-fs";
import {
	DEFAULT_CONVERSATION_FOLDER,
	DEFAULT_CREDENTIALS_FOLDER,
	DEFAULT_ENRICHERS_FOLDER,
	DEFAULT_PROMPTS_FOLDER,
	DEFAULT_SCRIPTS_FOLDER,
	DEFAULT_SKILLS_FOLDER,
	DEFAULT_TASK_AGENTS_FOLDER,
	DEFAULT_TASK_AGENT_OUTPUT_ALLOWLIST,
} from "../constants/vault-layout";
import type VaultAIPlugin from "../plugin/vault-ai-plugin";

export class VaultAISettingTab extends PluginSettingTab {
	plugin: VaultAIPlugin;
	private _settingsDisplayDepth = 0;
	private _settingsDisplayQueued = false;

	constructor(app: App, plugin: VaultAIPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private runtimeLabel(runtimeId: string): string {
		const option = getConfiguredRuntimeOptions(this.plugin).find((r) => r.id === runtimeId);
		return option?.displayName || "Claude Code";
	}

	private uniqueCustomRuntimeId(raw: string, currentId?: string): string {
		const candidate = normalizeCustomRuntimeId(raw);
		const ids = new Set((this.plugin.settings.customAgentRuntimes || []).map((r) => r.id));
		if (currentId) ids.delete(currentId);
		if (!ids.has(candidate)) return candidate;
		let i = 2;
		while (ids.has(`${candidate}-${i}`)) i++;
		return `${candidate}-${i}`;
	}

	private createDefaultCustomRuntime(index: number): CustomAgentRuntime {
		const id = this.uniqueCustomRuntimeId(`runtime-${index}`);
		return {
			id,
			displayName: `Custom ${index}`,
			cliPath: "hermes",
			extraArgs: "",
			timeoutMs: 120_000,
			healthCheckArgs: "--version",
			enabled: true,
		};
	}

	display(): void {
		if (this._settingsDisplayDepth > 0) {
			this._settingsDisplayQueued = true;
			return;
		}
		this._settingsDisplayDepth++;
		const { containerEl } = this;
		containerEl.empty();

		// Plugin Updates Section
		new Setting(containerEl).setName("Plugin updates").setHeading();

		new Setting(containerEl)
			.setName("Current version: " + this.plugin.manifest.version)
			.setDesc(
				"Force update plugin to the latest version from GitHub main branch. This will overwrite local files with the newest code.",
			)
			.addButton((btn) =>
				btn
					.setButtonText("Update plugin")
					.setCta()
					.setTooltip("Download and install the latest version from GitHub main branch")
					.onClick(async () => {
						const originalText = btn.buttonEl.innerText;
						btn.setButtonText("Updating...");
						btn.setDisabled(true);

						new Notice("Updating plugin from GitHub main branch...");
						try {
							const success = await this.plugin.updaterService.updateFromMain();

							if (success) {
								btn.setButtonText("Reloading...");
								new Notice("Update successful! Reloading plugin...");
								await this.plugin.updaterService.reloadPlugin();
							} else {
								btn.setButtonText("Update failed");
								btn.setDisabled(false);
								setTimeout(() => btn.setButtonText(originalText), 3000);
								new Notice("Failed to download update. Check console for details.");
							}
						} catch (error) {
							console.error("[OSINT Copilot] Update failed:", error);
							btn.setButtonText("Update failed");
							btn.setDisabled(false);
							setTimeout(() => btn.setButtonText(originalText), 3000);
							new Notice("An error occurred during update.");
						}
					}),
			);

		new Setting(containerEl).setName("Graph note lock").setHeading();
		new Setting(containerEl)
			.setName(`Locked notes (${this.plugin.vaultLockService.getLockedCount()})`)
			.setDesc(
				"Notes locked from the entity graph are read-only until you unlock them (editor toolbar or here). Task agents and orchestration skip writes to locked paths.",
			)
			.addButton((btn) =>
				btn.setButtonText("Unlock all").onClick(async () => {
					if (!confirm("Unlock all notes locked from the graph?")) return;
					this.plugin.vaultLockService.unlockAll();
					new Notice("All graph locks cleared.");
					this.display();
				}),
			);

		// Max Notes
		new Setting(containerEl)
			.setName("Max notes")
			.setDesc("Maximum number of notes to include in context")
			.addText((text) =>
				text
					.setPlaceholder("15")
					.setValue(String(this.plugin.settings.maxNotes))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.maxNotes = num;
							await this.plugin.saveSettings();
						}
					}),
			);

		// System Prompt
		new Setting(containerEl)
			.setName("System prompt")
			.setDesc("Default system prompt for q&a")
			.addTextArea((text) => {
				text
					.setPlaceholder("You are a vault assistant...")
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.systemPrompt = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 4;
				text.inputEl.setCssProps({ width: "100%" });
			});

		new Setting(containerEl).setName("Vault prompts").setHeading();
		new Setting(containerEl)
			.setName("Prompts folder")
			.setDesc("Editable rules, agents, and graph-extraction skill (Markdown). Default copies on first run if files are missing.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_PROMPTS_FOLDER)
					.setValue(this.plugin.settings.promptsFolder)
					.onChange(async (value) => {
						this.plugin.settings.promptsFolder = value.trim() || DEFAULT_PROMPTS_FOLDER;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Active agent id")
			.setDesc("Matches agents/<id>.md under the prompts folder (see frontmatter id).")
			.addText((text) =>
				text
					.setPlaceholder("default")
					.setValue(this.plugin.settings.activeAgentId)
					.onChange(async (value) => {
						this.plugin.settings.activeAgentId = value.trim() || "default";
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Install missing default prompt files")
			.setDesc("Creates any default files that are not present. Does not overwrite your edits.")
			.addButton((btn) =>
				btn.setButtonText("Install missing").onClick(async () => {
					try {
						await new VaultPromptBootstrapService(this.plugin.app, () => this.plugin.settings.promptsFolder).ensureDefaultsInstalled();
						await new TaskAgentBootstrapService(this.plugin.app, () => this.plugin.settings.taskAgentsFolder).ensureDefaultsInstalled();
						await new SkillBootstrapService(this.plugin.app, () => this.plugin.settings.skillsFolder).ensureDefaultsInstalled();
						const enricherRoot = this.plugin.settings.enrichersFolder.trim() || DEFAULT_ENRICHERS_FOLDER;
						await ensureFolderExists(this.plugin.app, enricherRoot);
						await ensureCredentialsFolder(this.plugin);
						await ensureScriptsDefaultsInstalled(this.plugin);
						this.plugin.vaultPromptLoader?.invalidateAll();
						this.plugin.taskAgentRegistry?.invalidate();
						this.plugin.skillRegistry?.invalidate();
						this.plugin.enricherRegistry?.invalidate();
						this.plugin.attachVaultSkillFromVault();
						new Notice("Done. Open the prompts, skills, and task-agents folders in the vault to edit.");
					} catch (e) {
						new Notice(`Failed: ${e instanceof Error ? e.message : String(e)}`, 5000);
					}
				}),
			);

		new Setting(containerEl).setName("Skills (vault)").setHeading();
		new Setting(containerEl)
			.setName("Skills folder")
			.setDesc(
				"Markdown skill files for vault-defined workflows; the unified agent can propose creating or updating them via custom_vault_operations (same flow can propose enricher *.json under the enrichers folder; enricher HTTP tools use companion skills here).",
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SKILLS_FOLDER)
					.setValue(this.plugin.settings.skillsFolder)
					.onChange(async (value) => {
						this.plugin.settings.skillsFolder = value.trim() || DEFAULT_SKILLS_FOLDER;
						this.plugin.skillRegistry?.invalidate();
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Enrichers folder")
			.setDesc("JSON enricher specs (HTTP tools) that can be proposed by the agent after explicit approval.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_ENRICHERS_FOLDER)
					.setValue(this.plugin.settings.enrichersFolder)
					.onChange(async (value) => {
						this.plugin.settings.enrichersFolder = value.trim() || DEFAULT_ENRICHERS_FOLDER;
						this.plugin.enricherRegistry?.invalidate();
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Credentials folder")
			.setDesc(
				"Plain-text secrets the unified agent may propose storing (e.g. API keys). Paths must stay under OSINTCopilot/custom/. Use bearer_vault / header_vault / query_vault in enricher JSON to read a file here.",
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_CREDENTIALS_FOLDER)
					.setValue(this.plugin.settings.credentialsFolder)
					.onChange(async (value) => {
						this.plugin.settings.credentialsFolder = value.trim() || DEFAULT_CREDENTIALS_FOLDER;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Scripts folder")
			.setDesc(
				"Text scripts (e.g. .py, .sh, .ts) the unified agent may propose via upsert_script / delete_script. Review the side-by-side diff in chat; the plugin does not execute scripts.",
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SCRIPTS_FOLDER)
					.setValue(this.plugin.settings.scriptsFolder)
					.onChange(async (value) => {
						this.plugin.settings.scriptsFolder = value.trim() || DEFAULT_SCRIPTS_FOLDER;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Task agents (vault)").setHeading();
		new Setting(containerEl)
			.setName("Enable task agents")
			.setDesc(
				"In General mode, pick a task agent to run local AI CLI workflows that create vault files (JSON contract), or None for full orchestration.",
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.taskAgentsEnabled).onChange(async (v) => {
					this.plugin.settings.taskAgentsEnabled = v;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("Task agents folder")
			.setDesc("Markdown manifests with agent_kind: task (separate from prompts/agents orchestration agents).")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_TASK_AGENTS_FOLDER)
					.setValue(this.plugin.settings.taskAgentsFolder)
					.onChange(async (value) => {
						this.plugin.settings.taskAgentsFolder = value.trim() || DEFAULT_TASK_AGENTS_FOLDER;
						this.plugin.taskAgentRegistry?.invalidate();
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Global output allowlist")
			.setDesc("Newlines or commas. Task agents may only write under these paths AND each agent's output_roots.")
			.addTextArea((text) => {
				text
					.setPlaceholder(DEFAULT_TASK_AGENT_OUTPUT_ALLOWLIST)
					.setValue(this.plugin.settings.taskAgentGlobalOutputAllowlist)
					.onChange(async (value) => {
						this.plugin.settings.taskAgentGlobalOutputAllowlist = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
				text.inputEl.setCssProps({ width: "100%" });
			});
		new Setting(containerEl)
			.setName("Install missing default task-agent files")
			.setDesc("Creates README + sample agents when missing. Does not overwrite edits.")
			.addButton((btn) =>
				btn.setButtonText("Install missing").onClick(async () => {
					try {
						await new TaskAgentBootstrapService(this.plugin.app, () => this.plugin.settings.taskAgentsFolder).ensureDefaultsInstalled();
						this.plugin.taskAgentRegistry?.invalidate();
						new Notice("Task-agent defaults installed where missing.");
						this.display();
					} catch (e) {
						new Notice(`Failed: ${e instanceof Error ? e.message : String(e)}`, 5000);
					}
				}),
			);
		const taskAgentToggleHost = containerEl.createDiv("osint-copilot-task-agent-toggles");
		void this.populateTaskAgentToggleSettings(taskAgentToggleHost);

		new Setting(containerEl)
			.setName("Conversation history folder")
			.setDesc("Directory where chat conversations will be saved")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_CONVERSATION_FOLDER)
					.setValue(this.plugin.settings.conversationFolder)
					.onChange(async (value) => {
						const folder = value.trim() || DEFAULT_CONVERSATION_FOLDER;
						this.plugin.settings.conversationFolder = folder;
						this.plugin.conversationService.setBasePath(folder);
						await this.plugin.saveSettings();
						await this.plugin.conversationService.initialize();
					}),
			);

		new Setting(containerEl).setName("Unified chat agent").setHeading();
		containerEl.createEl("p", {
			text: "Chat uses one local agent turn (JSON contract). Choose Claude Code, Codex CLI, Hermes, or a custom runtime here or in the chat header.",
			cls: "setting-item-description",
		});
		const selectedRuntimeId = this.plugin.settings.agentRuntimeProvider;
		const selectedCustomRuntime = (this.plugin.settings.customAgentRuntimes || []).find((rt) => rt.id === selectedRuntimeId);
		const visibility = runtimeSettingsVisibility(selectedRuntimeId);

		new Setting(containerEl)
			.setName("Agent runtime")
			.setDesc("Default runtime for unified chat turns.")
			.addDropdown((dd) => {
				const options = getConfiguredRuntimeOptions(this.plugin);
				for (const option of options) dd.addOption(option.id, option.displayName);
				const selected = options.some((o) => o.id === this.plugin.settings.agentRuntimeProvider)
					? this.plugin.settings.agentRuntimeProvider
					: CLAUDE_RUNTIME_ID;
				dd.setValue(selected);
				dd.onChange(async (v) => {
					this.plugin.settings.agentRuntimeProvider = v;
					if (v === CLAUDE_RUNTIME_ID || v === CODEX_RUNTIME_ID) {
						this.plugin.settings.apiProvider = v;
					}
					await this.plugin.saveSettings();
					this.display();
				});
			});

		if (visibility.showHermesSettings) {
			new Setting(containerEl)
				.setName("Hermes CLI path")
				.setDesc("Executable for Hermes Agent (built-in runtime).")
				.addText((text) =>
					text
						.setPlaceholder("hermes")
						.setValue(this.plugin.settings.hermesAgentCliPath)
						.onChange(async (value) => {
							this.plugin.settings.hermesAgentCliPath = value.trim() || "hermes";
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Hermes extra CLI args")
				.setDesc("Whitespace-separated argv after the executable (e.g. a subcommand your CLI requires). Prompt is sent on stdin.")
				.addText((text) =>
					text
						.setPlaceholder("")
						.setValue(this.plugin.settings.hermesAgentExtraArgs)
						.onChange(async (value) => {
							this.plugin.settings.hermesAgentExtraArgs = value;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Hermes request timeout (ms)")
				.addText((text) =>
					text
						.setPlaceholder(String(DEFAULT_SETTINGS.hermesAgentTimeoutMs))
						.setValue(String(this.plugin.settings.hermesAgentTimeoutMs))
						.onChange(async (value) => {
							const n = parseInt(value.trim(), 10);
							this.plugin.settings.hermesAgentTimeoutMs =
								Number.isFinite(n) && n >= 5000 ? n : DEFAULT_SETTINGS.hermesAgentTimeoutMs;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Hermes health-check args")
				.setDesc("Whitespace-separated argv used only by “Test agent runtime” (e.g. --version).")
				.addText((text) =>
					text
						.setPlaceholder("--version")
						.setValue(this.plugin.settings.hermesAgentHealthCheckArgs)
						.onChange(async (value) => {
							this.plugin.settings.hermesAgentHealthCheckArgs = value.trim() || "--version";
							await this.plugin.saveSettings();
						}),
				);
		}

		if (visibility.showClaudeRuntimeHint) {
			containerEl.createEl("p", {
				text: "Claude runtime selected. Its CLI, model, and extraction diagnostics are configured in the “Local AI CLI” section below.",
				cls: "setting-item-description",
			});
			new Setting(containerEl)
				.setName("Claude runtime quick view")
				.setDesc(
					`CLI: ${this.plugin.settings.claudeCodeCliPath || "claude"} | model: ${this.plugin.settings.claudeCodeModel || "sonnet"}`,
				);
		}

		if (visibility.showCodexRuntimeHint) {
			containerEl.createEl("p", {
				text: "Codex runtime selected. Its CLI, model override, and extraction diagnostics are configured in the “Local AI CLI” section below.",
				cls: "setting-item-description",
			});
			new Setting(containerEl)
				.setName("Codex runtime quick view")
				.setDesc(
					`CLI: ${this.plugin.settings.codexCliPath || "codex"} | model: ${this.plugin.settings.codexCliModel || "Codex config default"}`,
				);
		}

		new Setting(containerEl)
			.setName("Test agent runtime")
			.setDesc("Checks reachability for the currently selected runtime.")
			.addButton((btn) =>
				btn.setButtonText("Test connection").onClick(async () => {
					btn.setButtonText("Testing...");
					btn.setDisabled(true);
					try {
						const provider = createAgentProvider(this.plugin);
						const ok = await provider.healthCheck();
						new Notice(
							ok
								? `${this.runtimeLabel(provider.id)} is reachable.`
								: "Runtime is not ready. Check its executable path and, where applicable, login, provider, or health-check configuration.",
						);
					} catch (e: unknown) {
						new Notice("Error: " + (e instanceof Error ? e.message : String(e)));
					}
					btn.setButtonText("Test connection");
					btn.setDisabled(false);
				}),
			);

		new Setting(containerEl).setName("Custom runtimes").setHeading();
		containerEl.createEl("p", {
			text: "Manage Hermes-compatible local CLIs. Edit fields appear only when a custom runtime is selected as Agent runtime.",
			cls: "setting-item-description",
		});
		new Setting(containerEl)
			.setName("Configured custom runtimes")
			.setDesc(
				this.plugin.settings.customAgentRuntimes.length > 0
					? this.plugin.settings.customAgentRuntimes.map((rt) => `${rt.displayName} (${rt.id})`).join(", ")
					: "No custom runtime configured yet.",
			);
		new Setting(containerEl)
			.setName("Add custom runtime")
			.setDesc("Creates a new runtime profile (Hermes-compatible stdin/stdout contract).")
			.addButton((btn) =>
				btn.setButtonText("Add runtime").onClick(async () => {
					const next = this.createDefaultCustomRuntime(this.plugin.settings.customAgentRuntimes.length + 1);
					this.plugin.settings.customAgentRuntimes.push(next);
					await this.plugin.saveSettings();
					this.display();
				}),
			);
		if (visibility.showSelectedCustomSettings && selectedCustomRuntime) {
			const i = this.plugin.settings.customAgentRuntimes.findIndex((rt) => rt.id === selectedCustomRuntime.id);
			const rt = selectedCustomRuntime;
			new Setting(containerEl)
				.setName(`Selected custom runtime: ${rt.displayName}`)
				.setDesc(rt.id)
				.addButton((btn) =>
					btn.setButtonText("Remove selected").setWarning().onClick(async () => {
						if (i < 0) return;
						const removedId = rt.id;
						this.plugin.settings.customAgentRuntimes.splice(i, 1);
						if (this.plugin.settings.agentRuntimeProvider === removedId) {
							this.plugin.settings.agentRuntimeProvider = CLAUDE_RUNTIME_ID;
						}
						await this.plugin.saveSettings();
						this.display();
					}),
				);
			new Setting(containerEl)
				.setName("Display name")
				.addText((text) =>
					text.setValue(rt.displayName).onChange(async (value) => {
						rt.displayName = value.trim() || `Custom ${i + 1}`;
						await this.plugin.saveSettings();
					}),
				);
			new Setting(containerEl)
				.setName("Runtime id")
				.setDesc("Stored as custom:<id>. Lowercase letters, numbers, _ and -.")
				.addText((text) =>
					text.setValue(rt.id.replace(/^custom:/, "")).onChange(async (value) => {
						const nextId = this.uniqueCustomRuntimeId(value, rt.id);
						const prevId = rt.id;
						rt.id = nextId;
						if (this.plugin.settings.agentRuntimeProvider === prevId) {
							this.plugin.settings.agentRuntimeProvider = nextId;
						}
						await this.plugin.saveSettings();
						this.display();
					}),
				);
			new Setting(containerEl)
				.setName("Enabled")
				.addToggle((toggle) =>
					toggle.setValue(rt.enabled).onChange(async (value) => {
						rt.enabled = value;
						if (!value && this.plugin.settings.agentRuntimeProvider === rt.id) {
							this.plugin.settings.agentRuntimeProvider = CLAUDE_RUNTIME_ID;
						}
						await this.plugin.saveSettings();
						this.display();
					}),
				);
			new Setting(containerEl)
				.setName("CLI path")
				.addText((text) =>
					text.setValue(rt.cliPath).onChange(async (value) => {
						rt.cliPath = value.trim() || "hermes";
						await this.plugin.saveSettings();
					}),
				);
			new Setting(containerEl)
				.setName("Extra CLI args")
				.addText((text) =>
					text.setValue(rt.extraArgs).onChange(async (value) => {
						rt.extraArgs = value;
						await this.plugin.saveSettings();
					}),
				);
			new Setting(containerEl)
				.setName("Request timeout (ms)")
				.addText((text) =>
					text.setValue(String(rt.timeoutMs)).onChange(async (value) => {
						const n = parseInt(value.trim(), 10);
						rt.timeoutMs = Number.isFinite(n) && n >= 5000 ? n : 120000;
						await this.plugin.saveSettings();
					}),
				);
			new Setting(containerEl)
				.setName("Health-check args")
				.addText((text) =>
					text.setValue(rt.healthCheckArgs).onChange(async (value) => {
						rt.healthCheckArgs = value.trim() || "--version";
						await this.plugin.saveSettings();
					}),
				);
		}

		new Setting(containerEl).setName("Local AI CLI").setHeading();

		containerEl.createEl("p", {
			text: "Select the CLI used for bulk entity extraction, image analysis, vault skills, and task agents. Choosing Claude or Codex as the chat runtime also selects it here; Hermes/custom chat leaves this choice unchanged.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Extraction and task-agent CLI")
			.setDesc("Both integrations run locally as child processes and reuse their CLI's existing sign-in.")
			.addDropdown((dd) =>
				dd
					.addOption(CLAUDE_RUNTIME_ID, "Claude Code")
					.addOption(CODEX_RUNTIME_ID, "Codex CLI")
					.setValue(this.plugin.settings.apiProvider)
					.onChange(async (value) => {
						this.plugin.settings.apiProvider = value === CODEX_RUNTIME_ID ? CODEX_RUNTIME_ID : CLAUDE_RUNTIME_ID;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.apiProvider === CLAUDE_RUNTIME_ID) {
			new Setting(containerEl)
				.setName("Claude CLI path")
				.setDesc("Path to the claude executable. Use 'claude' if it's on your PATH.")
				.addText((text) =>
					text
						.setPlaceholder("claude")
						.setValue(this.plugin.settings.claudeCodeCliPath)
						.onChange(async (value) => {
							this.plugin.settings.claudeCodeCliPath = value || "claude";
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Claude model")
				.setDesc("Model to use (for example sonnet, opus, or haiku).")
				.addText((text) =>
					text
						.setPlaceholder("sonnet")
						.setValue(this.plugin.settings.claudeCodeModel)
						.onChange(async (value) => {
							this.plugin.settings.claudeCodeModel = value || "sonnet";
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Claude Code extra CLI args")
				.setDesc(
					"Whitespace-separated flags appended after --max-turns. Prefer vault enricher JSON for HTTP APIs instead of unattended shell access.",
				)
				.addText((text) =>
					text.setValue(this.plugin.settings.claudeCodeExtraArgs).onChange(async (value) => {
						this.plugin.settings.claudeCodeExtraArgs = value;
						await this.plugin.saveSettings();
					}),
				);

			new Setting(containerEl)
				.setName("Claude Code timeout (ms)")
				.addText((text) =>
					text.setValue(String(this.plugin.settings.claudeCodeTimeoutMs)).onChange(async (value) => {
						const n = parseInt(value.trim(), 10);
						this.plugin.settings.claudeCodeTimeoutMs = Number.isFinite(n) && n >= 5000 ? n : 300_000;
						await this.plugin.saveSettings();
					}),
				);
		} else {
			new Setting(containerEl)
				.setName("Codex CLI path")
				.setDesc("Path to the codex executable. Desktop launches may require an absolute path, such as /home/you/.local/bin/codex.")
				.addText((text) =>
					text
						.setPlaceholder("codex")
						.setValue(this.plugin.settings.codexCliPath)
						.onChange(async (value) => {
							this.plugin.settings.codexCliPath = value.trim() || "codex";
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Codex sign-in")
				.setDesc(
					`Run “${this.plugin.settings.codexCliPath || "codex"} login” in a terminal. The plugin reuses that saved login and never stores it in the vault.`,
				)
				.addButton((btn) =>
					btn.setButtonText("Check login").onClick(async () => {
						btn.setDisabled(true);
						btn.setButtonText("Checking...");
						const adapter = this.plugin.app.vault.adapter as { getBasePath?: () => string };
						const vaultRoot = typeof adapter.getBasePath === "function" ? String(adapter.getBasePath() || "") : "";
						const status = await new CodexCliService("", {
							cliPath: this.plugin.settings.codexCliPath || "codex",
							cliWorkingDirectory: vaultRoot || undefined,
						}).getLoginStatus();
						const detail = status.message.length > 1000 ? status.message.slice(0, 1000) + "…" : status.message;
						new Notice(status.authenticated ? detail : `Codex is not logged in: ${detail}`, 8000);
						btn.setButtonText("Check login");
						btn.setDisabled(false);
					}),
				);

			new Setting(containerEl)
				.setName("Codex model override")
				.setDesc("Leave blank to use the model configured by your local Codex CLI.")
				.addText((text) =>
					text
						.setPlaceholder("Use Codex config default")
						.setValue(this.plugin.settings.codexCliModel)
						.onChange(async (value) => {
							this.plugin.settings.codexCliModel = value.trim();
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Codex exec extra args")
				.setDesc(
					"Optional whitespace-separated codex exec flags (for example, --oss). Safety, output, model, image, working-directory, and session flags are managed by the plugin and rejected here.",
				)
				.addText((text) =>
					text.setValue(this.plugin.settings.codexCliExtraArgs).onChange(async (value) => {
						this.plugin.settings.codexCliExtraArgs = value;
						await this.plugin.saveSettings();
					}),
				);

			new Setting(containerEl)
				.setName("Codex timeout (ms)")
				.addText((text) =>
					text.setValue(String(this.plugin.settings.codexCliTimeoutMs)).onChange(async (value) => {
						const n = parseInt(value.trim(), 10);
						this.plugin.settings.codexCliTimeoutMs = Number.isFinite(n) && n >= 5000 ? n : 300_000;
						await this.plugin.saveSettings();
					}),
				);
		}

		new Setting(containerEl)
			.setName("Extraction log verbosity")
			.setDesc("How much local CLI extraction detail is shown in chat while processing attachments.")
			.addDropdown((dd) =>
				dd
					.addOption("minimal", "Minimal (milestones)")
					.addOption("detailed", "Detailed (stages + snippets)")
					.setValue(this.plugin.settings.extractionLogVerbosity)
					.onChange(async (value) => {
						this.plugin.settings.extractionLogVerbosity = value === "minimal" ? "minimal" : "detailed";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Extraction debug: raw CLI output")
			.setDesc("Include raw stdout/stderr in extraction logs. Warning: may expose sensitive content.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.extractionDebugRawCli)
					.onChange(async (value) => {
						this.plugin.settings.extractionDebugRawCli = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Test selected local AI CLI")
			.setDesc("Checks the executable, then runs a minimal request using the same invocation path as chat and extraction.")
			.addButton((btn) =>
				btn.setButtonText("Test CLI").onClick(async () => {
					btn.setButtonText("Testing...");
					btn.setDisabled(true);
					try {
						const adapter = this.plugin.app.vault.adapter as { getBasePath?: () => string };
						const vaultRoot = typeof adapter.getBasePath === "function" ? String(adapter.getBasePath() || "") : "";
						const svc = this.plugin.settings.apiProvider === CODEX_RUNTIME_ID
							? new CodexCliService("", {
								cliPath: this.plugin.settings.codexCliPath || "codex",
								model: this.plugin.settings.codexCliModel || "",
								timeoutMs: 45_000,
								cliWorkingDirectory: vaultRoot || undefined,
								extraCliArgs: this.plugin.settings.codexCliExtraArgs ?? "",
							})
							: new ClaudeCodeService("", {
								cliPath: this.plugin.settings.claudeCodeCliPath || "claude",
								model: this.plugin.settings.claudeCodeModel || "sonnet",
								timeoutMs: 45_000,
								cliWorkingDirectory: vaultRoot || undefined,
								extraCliArgs: this.plugin.settings.claudeCodeExtraArgs ?? "",
							});
						const ok = await svc.isAvailable();
						if (!ok) {
							new Notice(
								`${svc.displayName} is not ready. Check its executable path and, for Codex, its login or explicit provider configuration.`,
								8000,
							);
							btn.setButtonText("Test CLI");
							btn.setDisabled(false);
							return;
						}
						await svc.chat("", "Reply with exactly the single word: OK", undefined, undefined, 1);
						new Notice(`${svc.displayName} is available and responded to a test request.`, 6000);
					} catch (e: unknown) {
						const msg = e instanceof Error ? e.message : String(e);
						new Notice(msg.length > 2000 ? msg.slice(0, 2000) + "…" : msg, 12000);
					}
					btn.setButtonText("Test CLI");
					btn.setDisabled(false);
				}),
			);

		new Setting(containerEl).setName("Graph view").setHeading();

		new Setting(containerEl)
			.setName("Schema families in type pickers")
			.setDesc(
				"Filter which definitions appear when creating entities and connections: FTM (bundled), STIX 2 and MITRE vault YAML under your entity folder, and optional user YAML in schemas/user/.",
			);

		const fam = this.plugin.settings.enabledSchemaFamilies;
		const addFamToggle = (key: keyof EnabledSchemaFamilies, name: string) => {
			new Setting(containerEl)
				.setName(name)
				.addToggle((toggle) =>
					toggle.setValue(fam[key]).onChange(async (value) => {
						fam[key] = value;
						await this.plugin.saveSettings();
					}),
				);
		};
		addFamToggle("ftm", "FTM (FollowTheMoney)");
		addFamToggle("stix2", "STIX 2 (vault YAML)");
		addFamToggle("mitre", "MITRE ATT&CK (vault YAML)");
		addFamToggle("user", "User YAML (schemas/user)");

		new Setting(containerEl)
			.setName("OIDSF bundled schema layers (type pickers)")
			.setDesc(
				"Filter the bundled ontology (OIDSF) in FTM pickers: World (default entities), Links (relationship/interval types), Cyber (STIX-aligned), Analysis (claims/ACH/etc.). Graph still resolves any type already in the vault.",
			);
		const layers = this.plugin.settings.oidsfModalLayers;
		const addLayerToggle = (key: keyof typeof layers, caption: string) => {
			new Setting(containerEl)
				.setName(caption)
				.addToggle((toggle) =>
					toggle.setValue(layers[key]).onChange(async (value) => {
						layers[key] = value;
						await this.plugin.saveSettings();
					}),
				);
		};
		addLayerToggle("world", "World (people, orgs, documents, …)");
		addLayerToggle("links", "Links (relationship / interval types)");
		addLayerToggle("cyber", "Cyber (STIX / CTI-aligned entities)");
		addLayerToggle("analysis", "Analysis (claims, ACH, evidence chains, …)");

		new Setting(containerEl)
			.setName("Auto-refresh graph view")
			.setDesc("Automatically refresh the graph view when new entities are created through AI generation")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoRefreshGraph)
					.onChange(async (value) => {
						this.plugin.settings.autoRefreshGraph = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-open graph view")
			.setDesc("Automatically open the graph view when entities are created (if not already open)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoOpenGraphOnEntityCreation)
					.onChange(async (value) => {
						this.plugin.settings.autoOpenGraphOnEntityCreation = value;
						await this.plugin.saveSettings();
					}),
			);

		this._settingsDisplayDepth--;
		if (this._settingsDisplayQueued) {
			this._settingsDisplayQueued = false;
			queueMicrotask(() => this.display());
		}
	}

	private async populateTaskAgentToggleSettings(host: HTMLElement): Promise<void> {
		host.empty();
		try {
			const list = await this.plugin.taskAgentRegistry.listAgents();
			if (list.length === 0) {
				host.createEl("p", {
					text: "No task agents found. Add .md files with agent_kind: task to the task agents folder.",
					cls: "setting-item-description",
				});
				return;
			}
			for (const a of list) {
				const runnable = isTaskAgentRunnable(a, this.plugin.settings);
				new Setting(host)
					.setName(a.name)
					.setDesc(`${a.description || a.id} — output: ${a.outputRoots.join(", ")}`)
					.addToggle((t) => {
						t.setValue(runnable);
						t.onChange(async (v) => {
							if (v) {
								if (a.enabledDefault) {
									delete this.plugin.settings.taskAgentOverrides[a.id];
								} else {
									this.plugin.settings.taskAgentOverrides[a.id] = true;
								}
							} else {
								this.plugin.settings.taskAgentOverrides[a.id] = false;
							}
							await this.plugin.saveSettings();
						});
					});
			}
		} catch (e) {
			host.createEl("p", {
				text: `Could not list task agents: ${e instanceof Error ? e.message : String(e)}`,
				cls: "setting-item-description",
			});
		}
	}
}
