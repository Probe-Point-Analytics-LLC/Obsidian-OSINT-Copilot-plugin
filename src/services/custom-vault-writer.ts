import { normalizePath, TFile } from 'obsidian';
import type VaultAIPlugin from '../plugin/vault-ai-plugin';
import {
	DEFAULT_CREDENTIALS_FOLDER,
	DEFAULT_ENRICHERS_FOLDER,
	DEFAULT_SCRIPTS_FOLDER,
	DEFAULT_SKILLS_FOLDER,
	OSINT_COPILOT_CUSTOM_ROOT,
} from '../constants/vault-layout';
import type { CustomVaultOperation } from './custom-vault-operations';
import {
	normalizeCredentialsRelativePath,
	parseSkillIdForVault,
	relativePathHasAllowedScriptExtension,
} from './custom-vault-operations';
import { ensureFolderExists, ensureFolderChainForFile } from '../utils/vault-bootstrap-fs';

function pathIsUnderPrefix(path: string, prefix: string): boolean {
	const p = normalizePath(path);
	const pre = normalizePath(prefix);
	return p === pre || p.startsWith(pre + '/');
}

export function assertPathUnderCustomRoot(resolvedPath: string, purpose: string): void {
	const p = normalizePath(resolvedPath);
	const root = normalizePath(OSINT_COPILOT_CUSTOM_ROOT);
	if (!pathIsUnderPrefix(p, root)) {
		throw new Error(`${purpose}: path must stay under ${root}`);
	}
}

function skillsRoot(plugin: VaultAIPlugin): string {
	return normalizePath(plugin.settings.skillsFolder.trim() || DEFAULT_SKILLS_FOLDER);
}

function credentialsRoot(plugin: VaultAIPlugin): string {
	return normalizePath(plugin.settings.credentialsFolder.trim() || DEFAULT_CREDENTIALS_FOLDER);
}

function enrichersRoot(plugin: VaultAIPlugin): string {
	return normalizePath(plugin.settings.enrichersFolder.trim() || DEFAULT_ENRICHERS_FOLDER);
}

function scriptsRoot(plugin: VaultAIPlugin): string {
	return normalizePath(plugin.settings.scriptsFolder.trim() || DEFAULT_SCRIPTS_FOLDER);
}

/** Re-validate op paths against current settings (defense in depth). */
export function resolveSkillMarkdownPath(plugin: VaultAIPlugin, skillId: string): string {
	const id = parseSkillIdForVault(skillId);
	if (!id || id === 'readme') throw new Error('Invalid skill id');
	const file = normalizePath(`${skillsRoot(plugin)}/${id}.md`);
	assertPathUnderCustomRoot(file, 'Skill file');
	return file;
}

export function resolveCredentialFilePath(plugin: VaultAIPlugin, relativePath: string): string {
	const rel = normalizeCredentialsRelativePath(relativePath);
	if (!rel) throw new Error('Invalid credentials relative path');
	const root = credentialsRoot(plugin);
	const file = normalizePath(`${root}/${rel}`);
	assertPathUnderCustomRoot(file, 'Credentials file');
	if (!pathIsUnderPrefix(file, root)) {
		throw new Error('Credential path escapes credentials folder');
	}
	return file;
}

/** `{enrichersRoot}/{id}.json` — id already normalized slug. */
export function resolveEnricherJsonPath(plugin: VaultAIPlugin, enricherId: string): string {
	const id = parseSkillIdForVault(enricherId);
	if (!id) throw new Error('Invalid enricher id');
	const root = enrichersRoot(plugin);
	assertPathUnderCustomRoot(root, 'Enrichers root');
	const file = normalizePath(`${root}/${id}.json`);
	assertPathUnderCustomRoot(file, 'Enricher file');
	if (!pathIsUnderPrefix(file, root)) {
		throw new Error('Enricher path escapes enrichers folder');
	}
	return file;
}

/** Resolved vault path for a script op `relativePath` (under configured scripts folder). */
export function resolveScriptFilePath(plugin: VaultAIPlugin, relativePath: string): string {
	const rel = normalizeCredentialsRelativePath(relativePath);
	if (!rel || !relativePathHasAllowedScriptExtension(rel)) {
		throw new Error('Invalid script relative path');
	}
	const root = scriptsRoot(plugin);
	assertPathUnderCustomRoot(root, 'Scripts root');
	const file = normalizePath(`${root}/${rel}`);
	assertPathUnderCustomRoot(file, 'Script file');
	if (!pathIsUnderPrefix(file, root)) {
		throw new Error('Script path escapes scripts folder');
	}
	return file;
}

const DEFAULT_SCRIPTS_README = `# Vault scripts (coding assets)

The unified agent can propose **create / update / delete** for text files in this folder. Review changes in chat and use **Apply selected** — the plugin does **not** run these scripts. Run them in your own terminal or Claude Code when you trust the code.

Do **not** store API keys or secrets in script bodies; use \`put_credentials\` and enricher \`*_vault\` auth instead.
`;

function yamlScalar(s: string): string {
	// JSON double-quoted strings are valid YAML scalars
	return JSON.stringify(s);
}

function buildSkillMarkdown(op: Extract<CustomVaultOperation, { action: 'upsert_skill' }>): string {
	return [
		'---',
		'skill_kind: vault',
		`id: ${op.id}`,
		`name: ${yamlScalar(op.name)}`,
		`description: ${yamlScalar(op.description)}`,
		'---',
		'',
		op.body.trim(),
		'',
	].join('\n');
}

export interface ApplyCustomVaultOperationsResult {
	applied: number;
	errors: string[];
	skillsTouched: boolean;
	enrichersTouched: boolean;
}

/**
 * Perform confirmed vault writes/deletes. Caller must have obtained user consent.
 */
export async function applyCustomVaultOperations(
	plugin: VaultAIPlugin,
	ops: CustomVaultOperation[],
): Promise<ApplyCustomVaultOperationsResult> {
	const errors: string[] = [];
	let applied = 0;
	let skillsTouched = false;
	let enrichersTouched = false;

	for (const op of ops) {
		try {
			switch (op.action) {
				case 'upsert_skill': {
					const path = resolveSkillMarkdownPath(plugin, op.id);
					skillsTouched = true;
					await ensureFolderChainForFile(plugin.app, path);
					const existing = plugin.app.vault.getAbstractFileByPath(path);
					const body = buildSkillMarkdown(op);
					if (existing instanceof TFile) {
						await plugin.app.vault.modify(existing, body);
					} else {
						await plugin.app.vault.create(path, body);
					}
					applied++;
					break;
				}
				case 'delete_skill': {
					const path = resolveSkillMarkdownPath(plugin, op.id);
					skillsTouched = true;
					const existing = plugin.app.vault.getAbstractFileByPath(path);
					if (existing instanceof TFile) {
						await plugin.app.vault.delete(existing);
						applied++;
					}
					break;
				}
				case 'put_credentials': {
					const path = resolveCredentialFilePath(plugin, op.relativePath);
					await ensureFolderChainForFile(plugin.app, path);
					const existing = plugin.app.vault.getAbstractFileByPath(path);
					if (existing instanceof TFile) {
						await plugin.app.vault.modify(existing, op.content);
					} else {
						await plugin.app.vault.create(path, op.content);
					}
					applied++;
					break;
				}
				case 'delete_credentials': {
					const path = resolveCredentialFilePath(plugin, op.relativePath);
					const existing = plugin.app.vault.getAbstractFileByPath(path);
					if (existing instanceof TFile) {
						await plugin.app.vault.delete(existing);
						applied++;
					}
					break;
				}
				case 'upsert_enricher': {
					const path = resolveEnricherJsonPath(plugin, op.id);
					enrichersTouched = true;
					await ensureFolderChainForFile(plugin.app, path);
					const existing = plugin.app.vault.getAbstractFileByPath(path);
					const body = JSON.stringify(op.spec, null, 2);
					if (existing instanceof TFile) {
						await plugin.app.vault.modify(existing, body);
					} else {
						await plugin.app.vault.create(path, body);
					}
					applied++;
					break;
				}
				case 'delete_enricher': {
					const path = resolveEnricherJsonPath(plugin, op.id);
					enrichersTouched = true;
					const existing = plugin.app.vault.getAbstractFileByPath(path);
					if (existing instanceof TFile) {
						await plugin.app.vault.delete(existing);
						applied++;
					}
					break;
				}
				case 'upsert_script': {
					const path = resolveScriptFilePath(plugin, op.relativePath);
					await ensureFolderChainForFile(plugin.app, path);
					const existing = plugin.app.vault.getAbstractFileByPath(path);
					if (existing instanceof TFile) {
						await plugin.app.vault.modify(existing, op.content);
					} else {
						await plugin.app.vault.create(path, op.content);
					}
					applied++;
					break;
				}
				case 'delete_script': {
					const path = resolveScriptFilePath(plugin, op.relativePath);
					const existing = plugin.app.vault.getAbstractFileByPath(path);
					if (existing instanceof TFile) {
						await plugin.app.vault.delete(existing);
						applied++;
					}
					break;
				}
				default:
					break;
			}
		} catch (e) {
			errors.push(e instanceof Error ? e.message : String(e));
		}
	}

	if (skillsTouched) {
		plugin.skillRegistry.invalidate();
	}
	if (enrichersTouched) {
		plugin.enricherRegistry.invalidate();
	}

	return { applied, errors, skillsTouched, enrichersTouched };
}

/** Ensure credentials root folder exists. */
export async function ensureCredentialsFolder(plugin: VaultAIPlugin): Promise<void> {
	const root = credentialsRoot(plugin);
	assertPathUnderCustomRoot(root, 'Credentials root');
	await ensureFolderExists(plugin.app, root);
}

/** Ensure scripts root exists (under OSINTCopilot/custom/). */
export async function ensureScriptsFolder(plugin: VaultAIPlugin): Promise<void> {
	const root = scriptsRoot(plugin);
	assertPathUnderCustomRoot(root, 'Scripts root');
	await ensureFolderExists(plugin.app, root);
}

/** Create scripts folder and a short README when missing (never overwrites README). */
export async function ensureScriptsDefaultsInstalled(plugin: VaultAIPlugin): Promise<void> {
	await ensureScriptsFolder(plugin);
	const readme = normalizePath(`${scriptsRoot(plugin)}/README.md`);
	if (!plugin.app.vault.getAbstractFileByPath(readme)) {
		await plugin.app.vault.create(readme, DEFAULT_SCRIPTS_README);
	}
}
