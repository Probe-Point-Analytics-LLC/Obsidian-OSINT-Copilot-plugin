/** Vault-relative path normalization (no Obsidian import; safe in unit tests). */
export function normalizeVaultPath(p: string): string {
	return p
		.trim()
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/\/$/, "");
}
