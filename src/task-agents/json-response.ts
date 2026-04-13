import type { VaultFilesV1 } from "./types";

function tryParseVaultFiles(obj: unknown): VaultFilesV1 | null {
	if (!obj || typeof obj !== "object") return null;
	const o = obj as Record<string, unknown>;
	if (o.version !== "vault_files_v1") return null;
	if (!Array.isArray(o.files)) return null;
	const files: VaultFilesV1["files"] = [];
	for (const f of o.files) {
		if (!f || typeof f !== "object") continue;
		const e = f as Record<string, unknown>;
		if (typeof e.path !== "string") continue;
		files.push({
			path: e.path,
			body: typeof e.body === "string" ? e.body : "",
			frontmatter:
				typeof e.frontmatter === "string" ? e.frontmatter : undefined,
		});
	}
	return { version: "vault_files_v1", files };
}

/**
 * Extract vault_files_v1 JSON from Claude CLI stdout (may include fences or prose).
 */
export function parseVaultFilesJson(raw: string): VaultFilesV1 | null {
	const trimmed = raw.trim();

	try {
		const data = JSON.parse(trimmed);
		const v = tryParseVaultFiles(data);
		if (v) return v;
	} catch {
		/* continue */
	}

	const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (fenceMatch) {
		try {
			const data = JSON.parse(fenceMatch[1].trim());
			const v = tryParseVaultFiles(data);
			if (v) return v;
		} catch {
			/* continue */
		}
	}

	const stack: number[] = [];
	let start = -1;
	let bestStart = -1;
	let bestEnd = -1;

	for (let i = 0; i < trimmed.length; i++) {
		if (trimmed[i] === "{") {
			if (start === -1) start = i;
			stack.push(i);
		} else if (trimmed[i] === "}" && stack.length > 0) {
			stack.pop();
			if (stack.length === 0) {
				const len = i - start + 1;
				if (bestStart === -1 || len > bestEnd - bestStart + 1) {
					bestStart = start;
					bestEnd = i;
				}
				start = -1;
			}
		}
	}

	if (bestStart >= 0) {
		let candidate = trimmed.substring(bestStart, bestEnd + 1);
		candidate = candidate.replace(/,(\s*[}\]])/g, "$1");
		try {
			const data = JSON.parse(candidate);
			return tryParseVaultFiles(data);
		} catch {
			return null;
		}
	}

	return null;
}
