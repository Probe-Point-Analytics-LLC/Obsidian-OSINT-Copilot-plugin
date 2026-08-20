import { App, normalizePath } from 'obsidian';
import { SCHEMA_VAULT_DEFAULT_FILES } from '../data/schema-vault-defaults';
import { OSINT_COPILOT_VAULT_ROOT } from '../constants/vault-layout';
import { createFileIfMissing } from '../utils/vault-bootstrap-fs';

/**
 * Creates default schema YAML files under OSINTCopilot/schemas when missing (never overwrites).
 */
export class SchemaBootstrapService {
	constructor(
		private app: App,
		private getEntityBasePath: () => string,
	) {}

	async ensureDefaultsInstalled(): Promise<void> {
		const root = normalizePath(this.getEntityBasePath().trim() || OSINT_COPILOT_VAULT_ROOT);
		for (const def of SCHEMA_VAULT_DEFAULT_FILES) {
			const path = normalizePath(`${root}/${def.path}`);
			await createFileIfMissing(this.app, path, def.content);
		}
	}
}
