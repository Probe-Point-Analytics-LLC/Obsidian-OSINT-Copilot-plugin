import {
	App,
	ItemView,
	Modal,
	Notice,
	Setting,
	TFile,
	WorkspaceLeaf,
	normalizePath,
} from "obsidian";
import { BUILT_IN_ORCHESTRATION_TOOLS, DYNAMIC_PLANNER_TOOLS_NOTE } from "../data/built-in-orchestration-tools";
import type { EnricherRegistry } from "../services/enrichers/enricher-registry";
import { isEnricherRunnable, type EnricherSpec } from "../services/enrichers/enricher-schema";
import { parseSkillIdForVault } from "../services/custom-vault-operations";
import type { SkillRegistry } from "../skills/skill-registry";
import type { VaultSkillManifest } from "../skills/skill-types";
import { DEFAULT_ENRICHERS_FOLDER, DEFAULT_SKILLS_FOLDER } from "../constants/vault-layout";
import { ConfirmModal } from "../modals/confirm-modal";
import { enricherJsonPathFromId, skillMarkdownPathFromId } from "../utils/registry-paths";

export const TOOLS_SKILLS_REGISTRY_VIEW_TYPE = "osint-copilot-tools-skills-registry";

export interface ToolsSkillsRegistryHost {
	app: App;
	skillRegistry: SkillRegistry;
	enricherRegistry: EnricherRegistry;
	settings: { skillsFolder: string; enrichersFolder: string };
}

function buildDraftEnricherJson(id: string, name: string): string {
	const now = new Date().toISOString();
	const spec = {
		id,
		name: name || id,
		description: "Draft — edit URL, domains, and auth before setting status to active.",
		status: "draft",
		enabled: false,
		allowedDomains: [],
		auth: { type: "none" },
		request: {
			method: "GET",
			urlTemplate: "https://example.com/?q={{query}}",
			headers: {},
		},
		inputHints: ["query"],
		skillInstructions: "",
		limits: { timeoutMs: 15000, retries: 1, maxResponseChars: 8000 },
		updatedAt: now,
	};
	return JSON.stringify(spec, null, 2);
}

function yamlDoubleQuoted(s: string): string {
	const oneLine = s.replace(/\r?\n/g, " ").trim();
	return `"${oneLine.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function ensureFolderChain(app: App, path: string): Promise<void> {
	const norm = normalizePath(path);
	const parts = norm.split("/").filter(Boolean);
	let acc = "";
	for (const p of parts) {
		acc = acc ? `${acc}/${p}` : p;
		const f = app.vault.getAbstractFileByPath(acc);
		if (!f) {
			try {
				await app.vault.createFolder(acc);
			} catch (e) {
				if (e instanceof Error && !e.message.includes("Folder already exists")) {
					throw e;
				}
			}
		}
	}
}

class AddSkillModal extends Modal {
	private idInput = "";
	private nameInput = "";
	private descInput = "";

	constructor(
		app: App,
		private onSubmit: (id: string, name: string, description: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "New vault skill" });
		contentEl.createDiv({
			text: "Id becomes the filename (slug). README is reserved.",
			cls: "setting-item-description",
		});

		new Setting(contentEl).setName("Skill id").addText((t) => {
			t.setPlaceholder("my_skill");
			t.onChange((v) => {
				this.idInput = v;
			});
		});
		new Setting(contentEl).setName("Display name").addText((t) => {
			t.setPlaceholder("My skill");
			t.onChange((v) => {
				this.nameInput = v;
			});
		});
		new Setting(contentEl).setName("Description").addTextArea((t) => {
			t.setPlaceholder("Short line for the planner tool list");
			t.inputEl.rows = 3;
			t.onChange((v) => {
				this.descInput = v;
			});
		});

		new Setting(contentEl).addButton((b) => {
			b.setButtonText("Create").setCta();
			b.onClick(() => {
				void (async () => {
					const id = parseSkillIdForVault(this.idInput);
					if (!id || id === "readme") {
						new Notice("Enter a valid skill id (letters, numbers, _ and -).");
						return;
					}
					const name = this.nameInput.trim() || id;
					const description = this.descInput.trim() || "New vault skill";
					await this.onSubmit(id, name, description);
					this.close();
				})();
			});
		});
		new Setting(contentEl).addButton((b) => {
			b.setButtonText("Cancel");
			b.onClick(() => this.close());
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class AddEnricherDraftModal extends Modal {
	private idInput = "";
	private nameInput = "";

	constructor(
		app: App,
		private onSubmit: (id: string, name: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "New enricher draft" });
		contentEl.createDiv({
			text: "Creates a disabled draft JSON. Edit domains and URL before enabling.",
			cls: "setting-item-description",
		});
		new Setting(contentEl).setName("Enricher id").addText((t) => {
			t.setPlaceholder("my_enricher");
			t.onChange((v) => {
				this.idInput = v;
			});
		});
		new Setting(contentEl).setName("Display name").addText((t) => {
			t.setPlaceholder("My enricher");
			t.onChange((v) => {
				this.nameInput = v;
			});
		});
		new Setting(contentEl).addButton((b) => {
			b.setButtonText("Create draft").setCta();
			b.onClick(() => {
				void (async () => {
					const id = parseSkillIdForVault(this.idInput);
					if (!id) {
						new Notice("Enter a valid enricher id.");
						return;
					}
					const name = this.nameInput.trim() || id;
					await this.onSubmit(id, name);
					this.close();
				})();
			});
		});
		new Setting(contentEl).addButton((b) => {
			b.setButtonText("Cancel");
			b.onClick(() => this.close());
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ToolsSkillsRegistryView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private host: ToolsSkillsRegistryHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return TOOLS_SKILLS_REGISTRY_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "OSINT Copilot tools & skills";
	}

	getIcon(): string {
		return "layout-list";
	}

	async onOpen(): Promise<void> {
		const root = this.containerEl.children[1];
		root.empty();
		root.addClass("osint-copilot-registry-root");

		const toolbar = root.createDiv({ cls: "osint-copilot-registry-toolbar" });
		const refreshBtn = toolbar.createEl("button", { text: "Refresh", cls: "mod-cta" });
		refreshBtn.addEventListener("click", () => {
			void this.reload();
		});
		const addSkillBtn = toolbar.createEl("button", { text: "Add skill" });
		addSkillBtn.addEventListener("click", () => {
			new AddSkillModal(this.app, (id, name, description) => this.createSkillFile(id, name, description)).open();
		});
		const addEnrichBtn = toolbar.createEl("button", { text: "Add enricher draft" });
		addEnrichBtn.addEventListener("click", () => {
			new AddEnricherDraftModal(this.app, (id, name) => this.createEnricherDraft(id, name)).open();
		});

		const grid = root.createDiv({ cls: "osint-copilot-registry-grid" });
		this.toolsCol = grid.createDiv({ cls: "osint-copilot-registry-column" });
		this.skillsCol = grid.createDiv({ cls: "osint-copilot-registry-column" });
		this.enrichCol = grid.createDiv({ cls: "osint-copilot-registry-column" });

		await this.reload();
	}

	private toolsCol!: HTMLElement;
	private skillsCol!: HTMLElement;
	private enrichCol!: HTMLElement;

	private async reload(): Promise<void> {
		this.host.skillRegistry.invalidate();
		this.host.enricherRegistry.invalidate();
		const skills = await this.host.skillRegistry.listVaultSkills();
		const enrichers = await this.host.enricherRegistry.listAll();
		this.renderTools();
		this.renderSkills(skills);
		this.renderEnrichers(enrichers);
	}

	private renderTools(): void {
		this.toolsCol.empty();
		this.toolsCol.createEl("h3", { text: "Built-in tools" });
		this.toolsCol.createDiv({
			text: "These run inside the plugin or local agent flows. They are not vault files.",
			cls: "osint-copilot-registry-hint",
		});
		for (const t of BUILT_IN_ORCHESTRATION_TOOLS) {
			const card = this.toolsCol.createDiv({ cls: "osint-copilot-registry-card" });
			card.createEl("div", { text: t.title, cls: "osint-copilot-registry-card-title" });
			card.createEl("code", { text: t.id, cls: "osint-copilot-registry-card-id" });
			card.createDiv({ text: t.description, cls: "osint-copilot-registry-card-desc" });
		}
		this.toolsCol.createDiv({
			text: DYNAMIC_PLANNER_TOOLS_NOTE,
			cls: "osint-copilot-registry-dynamic-note",
		});
	}

	private renderSkills(skills: VaultSkillManifest[]): void {
		this.skillsCol.empty();
		this.skillsCol.createEl("h3", { text: "Vault skills" });
		this.skillsCol.createDiv({
			text: `Folder: ${normalizePath(this.host.settings.skillsFolder.trim() || DEFAULT_SKILLS_FOLDER)}`,
			cls: "osint-copilot-registry-hint",
		});
		if (skills.length === 0) {
			this.skillsCol.createDiv({ text: "No skills found.", cls: "osint-copilot-registry-empty" });
			return;
		}
		for (const s of skills) {
			const row = this.skillsCol.createDiv({ cls: "osint-copilot-registry-row" });
			row.createEl("div", { text: s.name, cls: "osint-copilot-registry-row-title" });
			row.createEl("code", { text: s.id, cls: "osint-copilot-registry-row-id" });
			const actions = row.createDiv({ cls: "osint-copilot-registry-row-actions" });
			const openBtn = actions.createEl("button", { text: "Open note" });
			openBtn.addEventListener("click", () => void this.openPath(s.sourcePath));
			const delBtn = actions.createEl("button", { text: "Delete", cls: "mod-warning" });
			delBtn.addEventListener("click", () => this.confirmTrashSkill(s));
		}
	}

	private renderEnrichers(list: EnricherSpec[]): void {
		this.enrichCol.empty();
		this.enrichCol.createEl("h3", { text: "HTTP enrichers" });
		this.enrichCol.createDiv({
			text: `Folder: ${normalizePath(this.host.settings.enrichersFolder.trim() || DEFAULT_ENRICHERS_FOLDER)}`,
			cls: "osint-copilot-registry-hint",
		});
		if (list.length === 0) {
			this.enrichCol.createDiv({ text: "No enricher JSON files found.", cls: "osint-copilot-registry-empty" });
			return;
		}
		for (const e of list) {
			const row = this.enrichCol.createDiv({ cls: "osint-copilot-registry-row" });
			const title = row.createEl("div", { cls: "osint-copilot-registry-row-title" });
			title.setText(e.name);
			const runnable = isEnricherRunnable(e);
			row.createEl("code", {
				text: `${e.id} · ${e.status} · ${e.enabled ? "enabled" : "disabled"} · ${runnable ? "runnable" : "not runnable"}`,
				cls: "osint-copilot-registry-row-id",
			});
			const path =
				enricherJsonPathFromId(this.host.settings.enrichersFolder, e.id) ??
				normalizePath(`${normalizePath(this.host.settings.enrichersFolder.trim() || DEFAULT_ENRICHERS_FOLDER)}/${e.id}.json`);
			const actions = row.createDiv({ cls: "osint-copilot-registry-row-actions" });
			const openBtn = actions.createEl("button", { text: "Open file" });
			openBtn.addEventListener("click", () => void this.openPath(path));
			const delBtn = actions.createEl("button", { text: "Delete", cls: "mod-warning" });
			delBtn.addEventListener("click", () => this.confirmTrashEnricher(e, path));
		}
	}

	private async openPath(vaultPath: string): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(normalizePath(vaultPath));
		if (!(f instanceof TFile)) {
			new Notice("File not found: " + vaultPath);
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(f);
	}

	private confirmTrashSkill(s: VaultSkillManifest): void {
		new ConfirmModal(
			this.app,
			"Move skill to trash?",
			`Move "${s.name}" (${s.sourcePath}) to trash?`,
			() => {
				void this.trashByPath(s.sourcePath, "skill");
			},
			undefined,
			true,
			undefined,
			"Move to trash",
		).open();
	}

	private confirmTrashEnricher(e: EnricherSpec, path: string): void {
		new ConfirmModal(
			this.app,
			"Move enricher to trash?",
			`Move enricher "${e.name}" (${path}) to trash?`,
			() => {
				void this.trashByPath(path, "enricher");
			},
			undefined,
			true,
			undefined,
			"Move to trash",
		).open();
	}

	private async trashByPath(vaultPath: string, kind: "skill" | "enricher"): Promise<void> {
		const norm = normalizePath(vaultPath);
		const f = this.app.vault.getAbstractFileByPath(norm);
		if (!(f instanceof TFile)) {
			new Notice("File not found.");
			return;
		}
		try {
			await this.app.fileManager.trashFile(f);
		} catch (err) {
			console.error(err);
			new Notice("Could not move file to trash.");
			return;
		}
		if (kind === "skill") this.host.skillRegistry.invalidate();
		else this.host.enricherRegistry.invalidate();
		new Notice("Moved to trash.");
		await this.reload();
	}

	private async createSkillFile(id: string, name: string, description: string): Promise<void> {
		const rel = skillMarkdownPathFromId(this.host.settings.skillsFolder, id);
		if (!rel) {
			new Notice("Invalid skill id.");
			return;
		}
		const existing = this.app.vault.getAbstractFileByPath(rel);
		if (existing) {
			new Notice("A file already exists at " + rel);
			return;
		}
		const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
		if (parent) await ensureFolderChain(this.app, parent);
		const body = `---
skill_kind: vault
id: ${id}
name: ${yamlDoubleQuoted(name)}
description: ${yamlDoubleQuoted(description)}
---

Edit the body with instructions used when this skill runs (local agent).
`;
		try {
			await this.app.vault.create(rel, body);
		} catch (e) {
			console.error(e);
			new Notice("Could not create skill file.");
			return;
		}
		this.host.skillRegistry.invalidate();
		new Notice("Skill created.");
		await this.reload();
	}

	private async createEnricherDraft(id: string, name: string): Promise<void> {
		const rel = enricherJsonPathFromId(this.host.settings.enrichersFolder, id);
		if (!rel) {
			new Notice("Invalid enricher id.");
			return;
		}
		const existing = this.app.vault.getAbstractFileByPath(rel);
		if (existing) {
			new Notice("A file already exists at " + rel);
			return;
		}
		const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
		if (parent) await ensureFolderChain(this.app, parent);
		const json = buildDraftEnricherJson(id, name);
		try {
			await this.app.vault.create(rel, json);
		} catch (e) {
			console.error(e);
			new Notice("Could not create enricher file.");
			return;
		}
		this.host.enricherRegistry.invalidate();
		new Notice("Enricher draft created.");
		await this.reload();
	}

	async onClose(): Promise<void> {
		this.containerEl.children[1].empty();
	}
}
