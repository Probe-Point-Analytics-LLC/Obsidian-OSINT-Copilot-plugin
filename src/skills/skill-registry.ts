import { App, normalizePath, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import { parseSkillMarkdown } from "./parse-skill-markdown";
import type { VaultSkillManifest } from "./skill-types";
import { DEFAULT_SKILLS_FOLDER } from "../constants/vault-layout";

/**
 * Discovers vault-defined skills from skillsFolder (*.md except README).
 */
export class SkillRegistry {
	private cache: VaultSkillManifest[] | null = null;
	private registered = false;

	constructor(
		private app: App,
		private getFolder: () => string,
	) {}

	registerVaultEvents(plugin: Plugin): void {
		if (this.registered) return;
		this.registered = true;

		const maybeInvalidate = (file: TAbstractFile | null) => {
			if (!file) return;
			const p = file.path;
			const root = normalizePath(this.getFolder().trim() || DEFAULT_SKILLS_FOLDER);
			if (!root) return;
			const norm = normalizePath(p);
			if (norm === root || norm.startsWith(root + "/")) {
				this.cache = null;
			}
		};

		plugin.registerEvent(this.app.vault.on("modify", maybeInvalidate));
		plugin.registerEvent(this.app.vault.on("create", maybeInvalidate));
		plugin.registerEvent(this.app.vault.on("delete", maybeInvalidate));
		plugin.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				maybeInvalidate(file);
				if (oldPath) {
					const root = normalizePath(this.getFolder().trim() || DEFAULT_SKILLS_FOLDER);
					if (!root) return;
					const op = normalizePath(oldPath);
					if (op === root || op.startsWith(root + "/")) {
						this.cache = null;
					}
				}
			}),
		);
	}

	invalidate(): void {
		this.cache = null;
	}

	async listVaultSkills(): Promise<VaultSkillManifest[]> {
		if (this.cache) return this.cache;

		const root = normalizePath(this.getFolder().trim() || DEFAULT_SKILLS_FOLDER);
		const folder = this.app.vault.getAbstractFileByPath(root);
		if (!(folder instanceof TFolder)) {
			this.cache = [];
			return this.cache;
		}

		const out: VaultSkillManifest[] = [];
		for (const child of folder.children) {
			if (!(child instanceof TFile) || child.extension !== "md") continue;
			if (child.basename === "README") continue;
			try {
				const raw = await this.app.vault.read(child);
				const parsed = parseSkillMarkdown(raw, child.path);
				if (parsed) out.push(parsed);
			} catch (e) {
				console.warn("[SkillRegistry] failed to read", child.path, e);
			}
		}
		out.sort((a, b) => a.name.localeCompare(b.name));
		this.cache = out;
		return this.cache;
	}

	async getVaultSkillById(id: string): Promise<VaultSkillManifest | null> {
		const list = await this.listVaultSkills();
		return list.find((s) => s.id === id) ?? null;
	}
}
