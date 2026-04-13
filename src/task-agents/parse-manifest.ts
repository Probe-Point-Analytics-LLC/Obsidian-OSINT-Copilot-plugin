import { parseMarkdownWithFrontmatter } from "../services/vault-prompt-loader";
import { normalizeVaultPath } from "./normalize-vault-path";
import type { TaskAgentManifest, TaskAgentOutputSchema } from "./types";

function splitList(raw: string | undefined): string[] {
	if (!raw || !raw.trim()) return [];
	return raw
		.split(/[,\n]/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map((p) => normalizeVaultPath(p.replace(/^["']|["']$/g, "")));
}

function parseBool(raw: string | undefined, defaultVal: boolean): boolean {
	if (raw === undefined || raw === "") return defaultVal;
	const v = raw.trim().toLowerCase();
	if (v === "true" || v === "yes" || v === "1") return true;
	if (v === "false" || v === "no" || v === "0") return false;
	return defaultVal;
}

function parseIntSafe(raw: string | undefined, defaultVal: number): number {
	if (raw === undefined || raw === "") return defaultVal;
	const n = parseInt(raw.trim(), 10);
	return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

/**
 * Parse a task-agent markdown file. Returns null if not a valid task agent.
 */
export function parseTaskAgentMarkdown(
	raw: string,
	sourcePath: string,
): TaskAgentManifest | null {
	const { data, body } = parseMarkdownWithFrontmatter(raw);
	const kind = (data.agent_kind || "").trim().toLowerCase();
	if (kind !== "task") return null;

	const id = (data.id || "").trim();
	if (!id) return null;

	const outputSchema = (data.output_schema || "").trim() as TaskAgentOutputSchema;
	if (outputSchema !== "vault_files_v1") return null;

	const outputRoots = splitList(data.output_roots);
	if (outputRoots.length === 0) return null;

	const name = (data.name || id).trim();
	const description = (data.description || "").trim();

	return {
		agentKind: "task",
		id,
		name,
		description,
		outputSchema,
		outputRoots,
		contextRoots: splitList(data.context_roots),
		maxNotes: parseIntSafe(data.max_notes, 20),
		maxContextChars: parseIntSafe(data.max_context_chars, 120_000),
		enabledDefault: parseBool(data.enabled_default, true),
		model: (data.model || "").trim(),
		body: body.trim(),
		sourcePath,
	};
}
