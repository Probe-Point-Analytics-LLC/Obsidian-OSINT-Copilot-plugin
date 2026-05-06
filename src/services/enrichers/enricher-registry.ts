import { App, normalizePath, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";
import { DEFAULT_ENRICHERS_FOLDER } from "../../constants/vault-layout";
import { isEnricherRunnable, normalizeEnricherSpec, type EnricherSpec } from "./enricher-schema";

export class EnricherRegistry {
  private cache: EnricherSpec[] | null = null;
  private registered = false;

  constructor(
    private app: App,
    private getFolder: () => string,
  ) {}

  private root(): string {
    return normalizePath(this.getFolder().trim() || DEFAULT_ENRICHERS_FOLDER);
  }

  registerVaultEvents(plugin: Plugin): void {
    if (this.registered) return;
    this.registered = true;
    const maybeInvalidate = (file: TAbstractFile | null) => {
      if (!file) return;
      const root = this.root();
      const p = normalizePath(file.path);
      if (p === root || p.startsWith(`${root}/`)) this.cache = null;
    };
    plugin.registerEvent(this.app.vault.on("modify", maybeInvalidate));
    plugin.registerEvent(this.app.vault.on("create", maybeInvalidate));
    plugin.registerEvent(this.app.vault.on("delete", maybeInvalidate));
    plugin.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      maybeInvalidate(file);
      if (!oldPath) return;
      const root = this.root();
      const p = normalizePath(oldPath);
      if (p === root || p.startsWith(`${root}/`)) this.cache = null;
    }));
  }

  invalidate(): void {
    this.cache = null;
  }

  async listAll(): Promise<EnricherSpec[]> {
    if (this.cache) return this.cache;
    const folder = this.app.vault.getAbstractFileByPath(this.root());
    if (!(folder instanceof TFolder)) {
      this.cache = [];
      return this.cache;
    }
    const out: EnricherSpec[] = [];
    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== "json") continue;
      try {
        const raw = await this.app.vault.read(child);
        const parsed = normalizeEnricherSpec(JSON.parse(raw));
        if (parsed) out.push(parsed);
      } catch (e) {
        console.warn("[EnricherRegistry] failed to parse", child.path, e);
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    this.cache = out;
    return out;
  }

  async listRunnable(): Promise<EnricherSpec[]> {
    const all = await this.listAll();
    return all.filter(isEnricherRunnable);
  }

  async getById(id: string): Promise<EnricherSpec | null> {
    const all = await this.listAll();
    return all.find((e) => e.id === id) || null;
  }
}
