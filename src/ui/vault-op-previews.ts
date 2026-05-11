import { TFile, type App } from "obsidian";
import type { Entity } from "../entities/types";
import type { CustomVaultOperation } from "../services/custom-vault-operations";
import { resolveScriptFilePath } from "../services/custom-vault-writer";
import {
	buildDeleteScriptSideBySideRows,
	buildScriptSideBySideRows,
	renderScriptSideBySideTable,
} from "./vault-script-side-diff";

/** Max chars for enricher/skill preview under proposed vault changes (DOM). */
export const VAULT_OP_PREVIEW_MAX_CHARS = 90_000;

export function truncateVaultOpPreviewText(raw: string): string {
	if (raw.length <= VAULT_OP_PREVIEW_MAX_CHARS) return raw;
	const overflow = raw.length - VAULT_OP_PREVIEW_MAX_CHARS;
	return `${raw.slice(0, VAULT_OP_PREVIEW_MAX_CHARS)}\n\n… [preview truncated: ${overflow} more character(s)]`;
}

export function entityHasMapCoordinates(entity: Entity): boolean {
	const lat = entity.properties?.latitude;
	const lng = entity.properties?.longitude;
	if (lat == null || lng == null) return false;
	if (typeof lat === "number" && typeof lng === "number" && !Number.isNaN(lat) && !Number.isNaN(lng)) {
		return true;
	}
	const ls = String(lat).trim();
	const cs = String(lng).trim();
	return ls.length > 0 && cs.length > 0;
}

/** Minimal plugin surface for vault op previews (matches custom-vault-writer expectations). */
export type VaultOpPreviewPlugin = {
	app: App;
} & Parameters<typeof resolveScriptFilePath>[0];

export async function appendVaultOpPreviewBlock(
	plugin: VaultOpPreviewPlugin,
	parent: HTMLDivElement,
	op: CustomVaultOperation,
): Promise<void> {
	if (op.action === "upsert_script" || op.action === "delete_script") {
		const details = parent.createEl("details");
		details.style.marginLeft = "24px";
		details.style.marginTop = "4px";
		details.createEl("summary", {
			text:
				op.action === "delete_script"
					? "Preview script delete (side-by-side)"
					: "Preview script change (side-by-side)",
		});
		let current = "";
		try {
			const path = resolveScriptFilePath(plugin, op.relativePath);
			const f = plugin.app.vault.getAbstractFileByPath(path);
			if (f instanceof TFile) {
				current = await plugin.app.vault.cachedRead(f);
			}
		} catch {
			/* new file or unreadable path */
		}
		const bodyHost = details.createDiv();
		const { rows, truncated } =
			op.action === "delete_script"
				? buildDeleteScriptSideBySideRows(current)
				: buildScriptSideBySideRows(current, op.content);
		const note = truncated
			? `Table truncated at ${rows.length} rows — open the vault file for the full view.`
			: undefined;
		renderScriptSideBySideTable(bodyHost, rows, { truncationNote: note });
		return;
	}
	if (op.action === "upsert_enricher") {
		const details = parent.createEl("details");
		details.style.marginLeft = "24px";
		details.style.marginTop = "4px";
		details.createEl("summary", { text: "Preview enricher JSON (click to expand)" });
		const pre = details.createEl("pre", {
			text: truncateVaultOpPreviewText(JSON.stringify(op.spec, null, 2)),
		});
		pre.style.whiteSpace = "pre-wrap";
		pre.style.fontSize = "11px";
		pre.style.maxHeight = "420px";
		pre.style.overflow = "auto";
		return;
	}
	if (op.action === "upsert_skill") {
		const details = parent.createEl("details");
		details.style.marginLeft = "24px";
		details.style.marginTop = "4px";
		details.createEl("summary", { text: "Preview skill (name, description, body)" });
		const combined = `name: ${op.name}\ndescription: ${op.description}\n\n--- body ---\n${op.body}`;
		const pre = details.createEl("pre", { text: truncateVaultOpPreviewText(combined) });
		pre.style.whiteSpace = "pre-wrap";
		pre.style.fontSize = "11px";
		pre.style.maxHeight = "420px";
		pre.style.overflow = "auto";
	}
}
