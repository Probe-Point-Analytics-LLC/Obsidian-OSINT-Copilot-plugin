/**
 * Unified-agent JSON: proposed writes under OSINTCopilot/custom/ (skills, credentials, enrichers).
 * Applied only after user confirmation in chat.
 */

import type { EnricherSpec } from './enrichers/enricher-schema';
import { normalizeEnricherSpec } from './enrichers/enricher-schema';

export const MAX_CREDENTIAL_FILE_CHARS = 256_000;
/** Max serialized size for raw enricher spec payload before normalize (bytes of JSON string). */
export const MAX_ENRICHER_SPEC_JSON_CHARS = 200_000;

export type CustomVaultOperation =
	| CustomVaultUpsertSkill
	| CustomVaultDeleteSkill
	| CustomVaultPutCredentials
	| CustomVaultDeleteCredentials
	| CustomVaultUpsertEnricher
	| CustomVaultDeleteEnricher;

export interface CustomVaultUpsertSkill {
	action: 'upsert_skill';
	id: string;
	name: string;
	description: string;
	body: string;
}

export interface CustomVaultDeleteSkill {
	action: 'delete_skill';
	id: string;
}

export interface CustomVaultPutCredentials {
	action: 'put_credentials';
	relativePath: string;
	content: string;
}

export interface CustomVaultDeleteCredentials {
	action: 'delete_credentials';
	relativePath: string;
}

/** Validated enricher spec; written as `{id}.json` under the vault enrichers folder on apply. */
export interface CustomVaultUpsertEnricher {
	action: 'upsert_enricher';
	id: string;
	spec: EnricherSpec;
}

export interface CustomVaultDeleteEnricher {
	action: 'delete_enricher';
	id: string;
}

/** Normalize vault skill id for filenames (alphanumeric, underscore, hyphen). */
export function parseSkillIdForVault(raw: unknown): string {
	return String(raw ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * Normalize relative path under credentials root: no .., no absolute, forward slashes only.
 * Returns null if invalid.
 */
export function normalizeCredentialsRelativePath(raw: unknown): string | null {
	const s = String(raw ?? '').trim().replace(/\\/g, '/');
	if (!s || s.startsWith('/') || s.includes('..')) return null;
	const parts = s.split('/').filter((p) => p.length > 0);
	if (parts.length === 0) return null;
	for (const p of parts) {
		if (p === '.' || p === '..') return null;
	}
	return parts.join('/');
}

function pushUpsertSkill(out: CustomVaultOperation[], o: Record<string, unknown>): void {
	const id = parseSkillIdForVault(o.id);
	if (!id || id === 'readme') return;
	const name = String(o.name ?? id).trim() || id;
	const description = String(o.description ?? '').trim();
	const body = typeof o.body === 'string' ? o.body : '';
	if (body.length > 500_000) return;
	out.push({ action: 'upsert_skill', id, name, description, body });
}

function pushDeleteSkill(out: CustomVaultOperation[], o: Record<string, unknown>): void {
	const id = parseSkillIdForVault(o.id);
	if (!id || id === 'readme') return;
	out.push({ action: 'delete_skill', id });
}

function pushPutCreds(out: CustomVaultOperation[], o: Record<string, unknown>): void {
	const relativePath = normalizeCredentialsRelativePath(o.relativePath ?? o.path);
	if (!relativePath) return;
	const content = typeof o.content === 'string' ? o.content : '';
	if (content.length > MAX_CREDENTIAL_FILE_CHARS) return;
	out.push({ action: 'put_credentials', relativePath, content });
}

function pushDeleteCreds(out: CustomVaultOperation[], o: Record<string, unknown>): void {
	const relativePath = normalizeCredentialsRelativePath(o.relativePath ?? o.path);
	if (!relativePath) return;
	out.push({ action: 'delete_credentials', relativePath });
}

function parseSpecObject(o: Record<string, unknown>): Record<string, unknown> | null {
	const raw = o.spec;
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		return { ...(raw as Record<string, unknown>) };
	}
	if (typeof raw === 'string') {
		try {
			const p = JSON.parse(raw) as unknown;
			if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>;
		} catch {
			return null;
		}
	}
	return null;
}

function pushUpsertEnricher(out: CustomVaultOperation[], o: Record<string, unknown>): void {
	const specObj = parseSpecObject(o);
	if (!specObj) return;
	const idFromOp = parseSkillIdForVault(o.id);
	const idFromSpec = specObj.id != null ? parseSkillIdForVault(specObj.id) : '';
	const idCombined = idFromOp || idFromSpec;
	if (!idCombined) return;
	const merged: Record<string, unknown> = { ...specObj, id: idCombined };
	try {
		const rawJson = JSON.stringify(merged);
		if (rawJson.length > MAX_ENRICHER_SPEC_JSON_CHARS) return;
	} catch {
		return;
	}
	const normalized = normalizeEnricherSpec(merged);
	if (!normalized) return;
	out.push({ action: 'upsert_enricher', id: normalized.id, spec: normalized });
}

function pushDeleteEnricher(out: CustomVaultOperation[], o: Record<string, unknown>): void {
	const id = parseSkillIdForVault(o.id);
	if (!id) return;
	out.push({ action: 'delete_enricher', id });
}

/** Parse and validate custom_vault_operations from agent JSON; drops invalid entries. */
export function normalizeCustomVaultOperations(raw: unknown): CustomVaultOperation[] {
	if (!Array.isArray(raw)) return [];
	const out: CustomVaultOperation[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const o = item as Record<string, unknown>;
		const action = String(o.action ?? '').trim().toLowerCase().replace(/-/g, '_');
		switch (action) {
			case 'upsert_skill':
				pushUpsertSkill(out, o);
				break;
			case 'delete_skill':
				pushDeleteSkill(out, o);
				break;
			case 'put_credentials':
				pushPutCreds(out, o);
				break;
			case 'delete_credentials':
				pushDeleteCreds(out, o);
				break;
			case 'upsert_enricher':
				pushUpsertEnricher(out, o);
				break;
			case 'delete_enricher':
				pushDeleteEnricher(out, o);
				break;
			default:
				break;
		}
	}
	return out;
}

/** Human-readable one-line summary for chat UI (no secret contents). */
export function summarizeCustomVaultOperation(op: CustomVaultOperation): string {
	switch (op.action) {
		case 'upsert_skill':
			return `Upsert skill "${op.id}" (${op.name})`;
		case 'delete_skill':
			return `Delete skill "${op.id}"`;
		case 'put_credentials':
			return `Write credentials file "${op.relativePath}" (${op.content.length} chars)`;
		case 'delete_credentials':
			return `Delete credentials "${op.relativePath}"`;
		case 'upsert_enricher':
			return `Upsert enricher "${op.id}" (${op.spec.name})`;
		case 'delete_enricher':
			return `Delete enricher "${op.id}"`;
	}
}
