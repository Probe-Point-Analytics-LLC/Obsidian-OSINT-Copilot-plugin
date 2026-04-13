import { App, normalizePath } from "obsidian";

export interface IndexedNoteLike {
	path: string;
	content: string;
	tags: string[];
	updated: number;
}

/**
 * Build wiki context from vault folders, optionally ranked by simple keyword overlap with query.
 */
export async function assembleTaskAgentContext(
	app: App,
	contextRoots: string[],
	pluginIndex: Map<string, IndexedNoteLike>,
	maxNotes: number,
	maxChars: number,
	query: string,
): Promise<string> {
	if (contextRoots.length === 0) return "";

	const roots = contextRoots.map((r) => normalizePath(r.trim())).filter(Boolean);
	const queryTerms = query
		.toLowerCase()
		.split(/\W+/)
		.filter((w) => w.length > 2);

	const candidates: { path: string; content: string; score: number }[] = [];

	for (const [, note] of pluginIndex) {
		const p = note.path;
		if (!p.toLowerCase().endsWith(".md")) continue;
		const under = roots.some((root) => p === root || p.startsWith(root + "/"));
		if (!under) continue;

		let score = 0;
		const lower = (note.content || "").toLowerCase();
		for (const t of queryTerms) {
			if (lower.includes(t)) score += 2;
		}
		score += Math.min(note.content.length / 5000, 1);
		candidates.push({ path: p, content: note.content, score });
	}

	candidates.sort((a, b) => b.score - a.score);
	const picked = candidates.slice(0, maxNotes);

	let out = "";
	let total = 0;
	for (const c of picked) {
		const block = `\n\n=== SOURCE: ${c.path} ===\n${c.content}\n`;
		if (total + block.length > maxChars) {
			const remain = maxChars - total - 100;
			if (remain < 200) break;
			out += `\n\n=== SOURCE: ${c.path} ===\n${c.content.slice(0, remain)}\n…[truncated]\n`;
			break;
		}
		out += block;
		total += block.length;
	}

	// If index missed files (e.g. not indexed yet), optionally read from disk for roots — keep light
	if (picked.length === 0 && roots.length > 0) {
		for (const root of roots.slice(0, 3)) {
			const folder = app.vault.getAbstractFileByPath(root);
			if (!folder) continue;
			const files = app.vault.getMarkdownFiles().filter(
				(f) => f.path === root || f.path.startsWith(root + "/"),
			);
			for (const f of files.slice(0, maxNotes)) {
				try {
					const content = await app.vault.read(f);
					const block = `\n\n=== SOURCE: ${f.path} ===\n${content}\n`;
					if (total + block.length > maxChars) break;
					out += block;
					total += block.length;
				} catch {
					/* skip */
				}
			}
		}
	}

	return out.trim();
}
