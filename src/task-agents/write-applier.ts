import { App, normalizePath, Notice, TFile } from "obsidian";
import type { VaultFileEntryV1, VaultFilesV1 } from "./types";
import { isPathAllowedForWrite } from "./path-allowlist";

function buildNoteContent(entry: VaultFileEntryV1): string {
	const fm = (entry.frontmatter || "").trim();
	if (fm) {
		return `---\n${fm}\n---\n\n${entry.body || ""}`;
	}
	return entry.body || "";
}

export interface ApplyVaultFilesResult {
	created: string[];
	updated: string[];
	errors: string[];
}

/**
 * Create or update markdown notes from vault_files_v1 payload.
 */
export async function applyVaultFilesV1(
	app: App,
	data: VaultFilesV1,
	agentOutputRoots: string[],
	globalAllowlistRoots: string[],
	isPathLocked?: (path: string) => boolean,
): Promise<ApplyVaultFilesResult> {
	const result: ApplyVaultFilesResult = { created: [], updated: [], errors: [] };

	if (!data.files || !Array.isArray(data.files)) {
		result.errors.push("Invalid payload: missing files array");
		return result;
	}

	for (const file of data.files) {
		if (!file.path || typeof file.path !== "string") {
			result.errors.push("Skipping entry: missing path");
			continue;
		}
		const rel = normalizePath(file.path.replace(/\\/g, "/"));
		if (!isPathAllowedForWrite(rel, agentOutputRoots, globalAllowlistRoots)) {
			result.errors.push(`Not allowed: ${rel}`);
			continue;
		}

		if (isPathLocked?.(rel)) {
			result.errors.push(`Locked (unlock in editor or settings): ${rel}`);
			continue;
		}

		const content = buildNoteContent(file);
		try {
			const existing = app.vault.getAbstractFileByPath(rel);
			if (existing instanceof TFile) {
				await app.vault.modify(existing, content);
				result.updated.push(rel);
			} else if (existing) {
				result.errors.push(`Path exists and is not a file: ${rel}`);
			} else {
				const parent = rel.includes("/") ? rel.substring(0, rel.lastIndexOf("/")) : "";
				if (parent) {
					const folder = app.vault.getAbstractFileByPath(parent);
					if (!folder) {
						await app.vault.createFolder(parent);
					}
				}
				await app.vault.create(rel, content);
				result.created.push(rel);
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			result.errors.push(`${rel}: ${msg}`);
		}
	}

	return result;
}

export function formatApplyNotice(res: ApplyVaultFilesResult): void {
	const parts: string[] = [];
	if (res.created.length) parts.push(`Created: ${res.created.length}`);
	if (res.updated.length) parts.push(`Updated: ${res.updated.length}`);
	if (res.errors.length) parts.push(`Errors: ${res.errors.length}`);
	if (parts.length === 0) {
		new Notice("Task agent: no files applied.");
		return;
	}
	new Notice(`Task agent: ${parts.join(", ")}`, 6000);
	if (res.errors.length) {
		console.warn("[TaskAgent] apply errors:", res.errors);
	}
}
