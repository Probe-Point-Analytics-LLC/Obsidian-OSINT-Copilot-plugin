import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import type VaultAIPlugin from '../../main';
import {
	DEFAULT_CREDENTIALS_FOLDER,
	DEFAULT_SKILLS_FOLDER,
	OSINT_COPILOT_CUSTOM_ROOT,
} from '../constants/vault-layout';
import type { CustomVaultOperation } from './custom-vault-operations';
import { normalizeCredentialsRelativePath, parseSkillIdForVault } from './custom-vault-operations';

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

async function ensureFolderChain(app: App, filePath: string): Promise<void> {
	const parts = normalizePath(filePath).split('/').slice(0, -1);
	let current = '';
	for (const p of parts) {
		current = current ? `${current}/${p}` : p;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current);
		}
	}
}

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

	for (const op of ops) {
		try {
			switch (op.action) {
				case 'upsert_skill': {
					const path = resolveSkillMarkdownPath(plugin, op.id);
					skillsTouched = true;
					await ensureFolderChain(plugin.app, path);
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
					await ensureFolderChain(plugin.app, path);
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

	return { applied, errors, skillsTouched };
}

/** Ensure credentials root folder exists. */
export async function ensureCredentialsFolder(plugin: VaultAIPlugin): Promise<void> {
	const root = credentialsRoot(plugin);
	assertPathUnderCustomRoot(root, 'Credentials root');
	const f = plugin.app.vault.getAbstractFileByPath(root);
	if (!f) {
		await plugin.app.vault.createFolder(root);
	} else if (!(f instanceof TFolder)) {
		console.warn('[custom-vault-writer] credentials path is not a folder:', root);
	}
}
