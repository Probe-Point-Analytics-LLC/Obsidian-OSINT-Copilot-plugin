import { App, normalizePath, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import { DEFAULT_PROMPTS_FOLDER } from "../constants/vault-layout";

export interface ParsedVaultMarkdown {
	data: Record<string, string>;
	body: string;
}

/** Split YAML frontmatter (simple key: value lines) from body. */
export function parseMarkdownWithFrontmatter(raw: string): ParsedVaultMarkdown {
	const trimmed = raw.replace(/^\uFEFF/, "").trim();
	if (!trimmed.startsWith("---")) {
		return { data: {}, body: trimmed };
	}
	const nl = trimmed.indexOf("\n");
	if (nl === -1) return { data: {}, body: trimmed };
	let end = trimmed.indexOf("\n---", 3);
	if (end === -1) {
		end = trimmed.indexOf("\r\n---", 3);
		if (end !== -1) {
			const fmBlock = trimmed.slice(3, end).trim();
			const body = trimmed.slice(end + 5).trim();
			return { data: parseYamlLike(fmBlock), body };
		}
		return { data: {}, body: trimmed };
	}
	const fmBlock = trimmed.slice(3, end).trim();
	const body = trimmed.slice(end + 4).trim();
	return { data: parseYamlLike(fmBlock), body };
}

function parseYamlLike(block: string): Record<string, string> {
	const data: Record<string, string> = {};
	for (const line of block.split(/\r?\n/)) {
		const m = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
		if (m) {
			let v = m[2].trim();
			if (
				(v.startsWith('"') && v.endsWith('"')) ||
				(v.startsWith("'") && v.endsWith("'"))
			) {
				v = v.slice(1, -1);
			}
			data[m[1]] = v;
		}
	}
	return data;
}

export interface VaultAgentMeta {
	id: string;
	name: string;
	description: string;
	path: string;
}

/**
 * Loads editable prompts from the vault with cache invalidation on file changes under the prompts root.
 */
export class VaultPromptLoader {
	private cache = new Map<string, string>();
	private registered = false;

	constructor(
		private app: App,
		private getPromptsRoot: () => string,
		private getActiveAgentId: () => string,
	) {}

	/** Subscribe to vault changes under the prompts folder. */
	registerVaultEvents(plugin: Plugin): void {
		if (this.registered) return;
		this.registered = true;

		const maybeInvalidate = (file: TAbstractFile | null) => {
			if (!file) return;
			const p = file.path;
			const root = normalizePath(this.getPromptsRoot().trim());
			if (!root) return;
			const norm = normalizePath(p);
			if (norm === root || norm.startsWith(root + "/")) {
				this.invalidateAll();
			}
		};

		plugin.registerEvent(this.app.vault.on("modify", maybeInvalidate));
		plugin.registerEvent(this.app.vault.on("create", maybeInvalidate));
		plugin.registerEvent(this.app.vault.on("delete", maybeInvalidate));
		plugin.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				maybeInvalidate(file);
				if (oldPath) {
					const root = normalizePath(this.getPromptsRoot().trim());
					if (!root) return;
					const op = normalizePath(oldPath);
					if (op === root || op.startsWith(root + "/")) {
						this.invalidateAll();
					}
				}
			}),
		);
	}

	invalidateAll(): void {
		this.cache.clear();
	}

	private root(): string {
		const r = this.getPromptsRoot().trim();
		return normalizePath(r || DEFAULT_PROMPTS_FOLDER);
	}

	private async readFileIfExists(relativePath: string): Promise<string | null> {
		const path = normalizePath(`${this.root()}/${relativePath}`);
		const hit = this.cache.get(path);
		if (hit !== undefined) return hit;

		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) {
			this.cache.set(path, "");
			return null;
		}
		const text = await this.app.vault.read(f);
		this.cache.set(path, text);
		return text;
	}

	/** Graph extraction skill text for ClaudeCodeService (body only); null → use plugin file / code fallback. */
	async getGraphExtractionSkill(): Promise<string | null> {
		const raw = await this.readFileIfExists("skills/graph-extraction.md");
		if (raw === null) return null;
		const { body } = parseMarkdownWithFrontmatter(raw);
		const t = body.trim();
		if (t.length < 30) return null;
		return t;
	}

	async getGlobalRules(): Promise<string> {
		const raw = await this.readFileIfExists("rules/global.md");
		if (raw === null) return "";
		const { body } = parseMarkdownWithFrontmatter(raw);
		return body.trim();
	}

	/** Active agent markdown body (frontmatter stripped). */
	async getActiveAgentBody(): Promise<string> {
		let id = (this.getActiveAgentId() || "default").trim();
		if (!id.endsWith(".md")) id = `${id}.md`;
		const raw = await this.readFileIfExists(`agents/${id}`);
		if (raw === null) return "";
		const { body } = parseMarkdownWithFrontmatter(raw);
		return body.trim();
	}

	/** Concatenated block for orchestration / planner prompts. */
	async getOrchestrationAugmentation(): Promise<string> {
		const global = await this.getGlobalRules();
		const agent = await this.getActiveAgentBody();
		const parts: string[] = [];
		if (global) parts.push("=== USER VAULT RULES (rules/global.md) ===\n" + global);
		if (agent)
			parts.push(
				`=== USER VAULT AGENT (${this.getActiveAgentId()}) ===\n` + agent,
			);
		return parts.join("\n\n");
	}

	/** List agent files under agents/ (for future UI). */
	async listAgents(): Promise<VaultAgentMeta[]> {
		const agentsPath = normalizePath(`${this.root()}/agents`);
		const folder = this.app.vault.getAbstractFileByPath(agentsPath);
		if (!(folder instanceof TFolder)) return [];

		const out: VaultAgentMeta[] = [];
		for (const child of folder.children) {
			if (!(child instanceof TFile) || child.extension !== "md") continue;
			if (child.basename === "README") continue;
			try {
				const raw = await this.app.vault.read(child);
				const { data, body } = parseMarkdownWithFrontmatter(raw);
				const id =
					data.id ||
					child.basename.replace(/\.md$/i, "") ||
					child.basename;
				out.push({
					id,
					name: data.name || id,
					description: data.description || "",
					path: child.path,
				});
			} catch {
				out.push({
					id: child.basename.replace(/\.md$/i, ""),
					name: child.basename,
					description: "",
					path: child.path,
				});
			}
		}
		out.sort((a, b) => a.name.localeCompare(b.name));
		return out;
	}
}
