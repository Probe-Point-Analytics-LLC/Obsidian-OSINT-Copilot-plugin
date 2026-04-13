import { App, normalizePath, TFile } from 'obsidian';
import { SCHEMA_VAULT_DEFAULT_FILES } from '../data/schema-vault-defaults';
import { OSINT_COPILOT_VAULT_ROOT } from '../constants/vault-layout';

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
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) continue;

			const parent = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
			if (parent) await this.ensureFolderChain(parent);

			await this.app.vault.create(path, def.content);
		}
	}

	private async ensureFolderChain(path: string): Promise<void> {
		const norm = normalizePath(path);
		const parts = norm.split('/').filter(Boolean);
		let acc = '';
		for (const p of parts) {
			acc = acc ? `${acc}/${p}` : p;
			const f = this.app.vault.getAbstractFileByPath(acc);
			if (!f) {
				try {
					await this.app.vault.createFolder(acc);
				} catch (e) {
					if (e instanceof Error && !e.message.includes('Folder already exists')) {
						throw e;
					}
				}
			}
		}
	}
}
