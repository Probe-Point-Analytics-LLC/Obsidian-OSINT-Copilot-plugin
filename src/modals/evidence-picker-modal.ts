import { App, Modal, TFile, Setting } from "obsidian";

export interface EvidencePickerResult {
  files: TFile[];
}

const EVIDENCE_EXTENSIONS = new Set([
  "md", "markdown", "txt",
  "pdf",
  "png", "jpg", "jpeg", "webp", "gif",
  "doc", "docx",
]);

const TYPE_ICONS: Record<string, string> = {
  pdf: "📄",
  png: "🖼️", jpg: "🖼️", jpeg: "🖼️", webp: "🖼️", gif: "🖼️",
  doc: "📝", docx: "📝",
  md: "📋", markdown: "📋", txt: "📋",
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Modal that lets the user pick vault files for evidence analysis.
 * Shows a checkbox list grouped by folder with select-all controls.
 */
export class EvidencePickerModal extends Modal {
  private resolve!: (result: EvidencePickerResult | null) => void;
  private selected = new Set<string>();
  private allFiles: TFile[] = [];

  constructor(app: App) {
    super(app);
  }

  /** Open the modal and return the user's selection (or null on cancel). */
  pick(): Promise<EvidencePickerResult | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("osint-evidence-picker");

    this.allFiles = this.app.vault
      .getFiles()
      .filter((f): f is TFile => f instanceof TFile)
      .filter((f) => EVIDENCE_EXTENSIONS.has((f.extension || "").toLowerCase()))
      .filter((f) => {
        const p = f.path.replace(/\\/g, "/").toLowerCase();
        return !p.startsWith(".obsidian/") && !p.includes("/.obsidian/") && !p.startsWith(".git/") && !p.includes("/.git/");
      })
      .sort((a, b) => a.path.localeCompare(b.path));

    // Header
    contentEl.createEl("h2", { text: "Analyze vault evidence" });
    const desc = contentEl.createEl("p", { cls: "setting-item-description" });
    desc.setText(`${this.allFiles.length} evidence files found. Select files to classify and extract structured data.`);

    // Select-all controls
    const controls = contentEl.createDiv({ cls: "osint-evidence-controls" });
    controls.setCssProps({ display: "flex", gap: "8px", "margin-bottom": "12px" });

    const btnAll = controls.createEl("button", { text: "Select all", cls: "mod-muted" });
    btnAll.addEventListener("click", () => this.toggleAll(true));
    const btnNone = controls.createEl("button", { text: "Deselect all", cls: "mod-muted" });
    btnNone.addEventListener("click", () => this.toggleAll(false));

    const countEl = controls.createSpan({ cls: "osint-evidence-count" });
    countEl.setCssProps({ "margin-left": "auto", "align-self": "center", "font-size": "0.85em", color: "var(--text-muted)" });
    this.updateCount(countEl);

    // File list (grouped by folder)
    const listContainer = contentEl.createDiv({ cls: "osint-evidence-list" });
    listContainer.setCssProps({
      "max-height": "400px", "overflow-y": "auto",
      border: "1px solid var(--background-modifier-border)", "border-radius": "6px", padding: "8px",
    });

    const grouped = this.groupByFolder(this.allFiles);
    for (const [folder, files] of grouped) {
      const folderEl = listContainer.createDiv({ cls: "osint-evidence-folder" });
      folderEl.setCssProps({ "margin-bottom": "6px" });

      const folderHeader = folderEl.createDiv();
      folderHeader.setCssProps({
        display: "flex", "align-items": "center", gap: "6px",
        "font-weight": "600", "font-size": "0.85em", color: "var(--text-muted)",
        cursor: "pointer", "margin-bottom": "2px",
      });
      folderHeader.createSpan({ text: "📁" });
      folderHeader.createSpan({ text: folder || "(root)" });
      const folderCountSpan = folderHeader.createSpan({ text: ` (${files.length})` });
      folderCountSpan.setCssProps({ "font-weight": "400" });

      folderHeader.addEventListener("click", () => {
        const allChecked = files.every((f) => this.selected.has(f.path));
        for (const f of files) {
          if (allChecked) this.selected.delete(f.path); else this.selected.add(f.path);
        }
        this.refreshCheckboxes(listContainer);
        this.updateCount(countEl);
      });

      for (const file of files) {
        const row = folderEl.createEl("label", { cls: "osint-evidence-row" });
        row.setCssProps({
          display: "flex", "align-items": "center", gap: "6px",
          padding: "3px 4px", cursor: "pointer", "border-radius": "4px",
        });

        const cb = row.createEl("input");
        cb.type = "checkbox";
        cb.checked = this.selected.has(file.path);
        cb.dataset.path = file.path;
        cb.addEventListener("change", () => {
          if (cb.checked) this.selected.add(file.path); else this.selected.delete(file.path);
          this.updateCount(countEl);
        });

        const ext = (file.extension || "").toLowerCase();
        row.createSpan({ text: TYPE_ICONS[ext] || "📎" });
        const nameSpan = row.createSpan({ text: file.name });
        nameSpan.setCssProps({ flex: "1" });
        const sizeSpan = row.createSpan({ text: humanSize(file.stat.size) });
        sizeSpan.setCssProps({ "font-size": "0.8em", color: "var(--text-faint)" });
      }
    }

    // Action buttons
    const actions = contentEl.createDiv({ cls: "osint-evidence-actions" });
    actions.setCssProps({ display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "16px" });

    const cancelBtn = actions.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => { this.resolve(null); this.close(); });

    const analyzeBtn = actions.createEl("button", { text: "Analyze selected", cls: "mod-cta" });
    analyzeBtn.addEventListener("click", () => {
      const picked = this.allFiles.filter((f) => this.selected.has(f.path));
      this.resolve({ files: picked });
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }

  private toggleAll(checked: boolean) {
    if (checked) {
      for (const f of this.allFiles) this.selected.add(f.path);
    } else {
      this.selected.clear();
    }
    const cbs = this.contentEl.querySelectorAll<HTMLInputElement>("input[type=checkbox][data-path]");
    cbs.forEach((cb) => { cb.checked = checked; });
    const countEl = this.contentEl.querySelector<HTMLElement>(".osint-evidence-count");
    if (countEl) this.updateCount(countEl);
  }

  private refreshCheckboxes(container: HTMLElement) {
    const cbs = container.querySelectorAll<HTMLInputElement>("input[type=checkbox][data-path]");
    cbs.forEach((cb) => { cb.checked = this.selected.has(cb.dataset.path || ""); });
  }

  private updateCount(el: HTMLElement) {
    el.setText(`${this.selected.size} / ${this.allFiles.length} selected`);
  }

  private groupByFolder(files: TFile[]): Map<string, TFile[]> {
    const map = new Map<string, TFile[]>();
    for (const f of files) {
      const parts = f.path.split("/");
      const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
      if (!map.has(folder)) map.set(folder, []);
      map.get(folder)!.push(f);
    }
    return map;
  }
}
