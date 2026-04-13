export type TaskAgentOutputSchema = "vault_files_v1";

export interface TaskAgentManifest {
	agentKind: "task";
	id: string;
	name: string;
	description: string;
	outputSchema: TaskAgentOutputSchema;
	/** Vault-relative directory prefixes where writes are allowed (agent-side). */
	outputRoots: string[];
	/** Optional folders to scan for markdown context. */
	contextRoots: string[];
	maxNotes: number;
	maxContextChars: number;
	enabledDefault: boolean;
	/** Optional model override (future); empty = plugin default. */
	model: string;
	/** Instruction body (markdown) after frontmatter. */
	body: string;
	/** Vault path to the defining file. */
	sourcePath: string;
}

export interface VaultFileEntryV1 {
	path: string;
	body: string;
	/** Optional YAML frontmatter as a single string block. */
	frontmatter?: string;
}

export interface VaultFilesV1 {
	version: "vault_files_v1";
	files: VaultFileEntryV1[];
}
