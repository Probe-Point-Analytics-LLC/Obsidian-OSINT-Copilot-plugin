import { App, TFile, TFolder, normalizePath } from "obsidian";

function isAlreadyExistsError(e: unknown): boolean {
	return e instanceof Error && e.message.includes("already exists");
}

/**
 * After swallowing an "already exists" error, confirms the path really is the expected type on
 * the real filesystem adapter (not the in-memory cache, which can be unpopulated for the whole
 * bootstrap phase right after a reload) and warns if a positive stat proves it is the wrong type.
 * A null stat is inconclusive rather than proof that the path is absent. Older Obsidian adapters
 * may not expose `stat()` at all, so this remains a best-effort diagnostic. A thrown stat failure
 * is logged but never allowed to abort the bootstrap chain that's awaiting this call.
 */
async function warnIfNotReallyThere(
	app: App,
	normalized: string,
	expectedType: "file" | "folder",
	originalError: unknown,
): Promise<void> {
	const statPath = app.vault.adapter.stat;
	if (typeof statPath !== "function") return;
	try {
		const stat = await statPath.call(app.vault.adapter, normalized);
		if (stat !== null && stat.type !== expectedType) {
			console.warn(`[vault-bootstrap-fs] "${normalized}" reported as already existing but isn't a ${expectedType}:`, originalError);
		}
	} catch (statError) {
		console.warn(`[vault-bootstrap-fs] "${normalized}" reported as already existing; could not verify it's a ${expectedType}:`, statError);
	}
}

/**
 * Creates a folder if missing. `getAbstractFileByPath` reads Obsidian's in-memory vault index,
 * which can be momentarily stale right after a plugin reload — it may report a folder as
 * missing even though it genuinely exists on disk. Treating "already exists" from the actual
 * `createFolder` call as success (rather than only pre-checking the cache) makes this idempotent
 * regardless of cache staleness, so bootstrap doesn't log spurious failures on every reload.
 */
export async function ensureFolderExists(app: App, path: string): Promise<void> {
	const normalized = normalizePath(path);
	const existing = app.vault.getAbstractFileByPath(normalized);
	if (existing instanceof TFolder) return;
	if (existing) {
		// A file (not a folder) already occupies this exact path -- createFolder can't
		// succeed here no matter how many times we retry, and Obsidian's error text for a
		// file/folder name collision isn't guaranteed to match isAlreadyExistsError below.
		// Surface a clear, specific error instead of gambling on that substring match.
		throw new Error(`Cannot create folder "${normalized}": a file already exists at that path.`);
	}
	try {
		await app.vault.createFolder(normalized);
	} catch (e) {
		if (!isAlreadyExistsError(e)) throw e;
		await warnIfNotReallyThere(app, normalized, "folder", e);
	}
}

/** Creates each missing segment of a nested folder path (Obsidian's createFolder isn't recursive). */
export async function ensureFolderChain(app: App, path: string): Promise<void> {
	const parts = normalizePath(path).split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		await ensureFolderExists(app, acc);
	}
}

/** Creates the parent folder chain for a *file* path (i.e. every segment except the filename). */
export async function ensureFolderChainForFile(app: App, filePath: string): Promise<void> {
	const normalized = normalizePath(filePath);
	const parent = normalized.includes("/") ? normalized.substring(0, normalized.lastIndexOf("/")) : "";
	if (parent) await ensureFolderChain(app, parent);
}

/** Creates a file with the given content only if it doesn't already exist. Never overwrites. */
export async function createFileIfMissing(app: App, path: string, content: string): Promise<void> {
	const normalized = normalizePath(path);
	const existing = app.vault.getAbstractFileByPath(normalized);
	if (existing instanceof TFile) return;
	if (existing) {
		throw new Error(`Cannot create file "${normalized}": a folder already exists at that path.`);
	}

	await ensureFolderChainForFile(app, normalized);

	try {
		await app.vault.create(normalized, content);
	} catch (e) {
		if (!isAlreadyExistsError(e)) throw e;
		await warnIfNotReallyThere(app, normalized, "file", e);
	}
}
