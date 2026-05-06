import { describe, it, expect } from 'vitest';
import {
	normalizeCredentialsRelativePath,
	normalizeCustomVaultOperations,
	parseSkillIdForVault,
	summarizeCustomVaultOperation,
} from '../src/services/custom-vault-operations';
import { parseAgentTurnResult } from '../src/services/agent-runtime/parse-agent-turn-json';
import { AGENT_TURN_SCHEMA_VERSION } from '../src/services/agent-runtime/provider-types';

describe('custom vault operations', () => {
	it('normalizes upsert_skill and drops invalid ids', () => {
		const ops = normalizeCustomVaultOperations([
			{ action: 'upsert_skill', id: 'My Skill!', name: 'N', description: 'D', body: 'B' },
			{ action: 'upsert_skill', id: 'readme', name: 'x', description: '', body: '' },
			{ action: 'delete_skill', id: 'remove_me' },
		]);
		expect(ops).toHaveLength(2);
		expect(ops[0]).toMatchObject({ action: 'upsert_skill', id: 'my-skill' });
		expect(ops[1]).toMatchObject({ action: 'delete_skill', id: 'remove_me' });
	});

	it('rejects credential paths with traversal', () => {
		expect(normalizeCredentialsRelativePath('a/../b')).toBeNull();
		expect(normalizeCredentialsRelativePath('/abs')).toBeNull();
		expect(normalizeCredentialsRelativePath('vendor/key.txt')).toBe('vendor/key.txt');
	});

	it('summarize does not include secret body', () => {
		const s = summarizeCustomVaultOperation({
			action: 'put_credentials',
			relativePath: 'k.txt',
			content: 'SECRET',
		});
		expect(s).toContain('k.txt');
		expect(s).toContain('6 chars');
		expect(s).not.toContain('SECRET');
	});

	it('parseAgentTurnResult includes custom_vault_operations', () => {
		const raw = JSON.stringify({
			version: AGENT_TURN_SCHEMA_VERSION,
			answer_markdown: 'ok',
			retrieval_hits: [],
			graph_operations: [],
			custom_vault_operations: [{ action: 'delete_skill', id: 'old-one' }],
		});
		const r = parseAgentTurnResult(raw, 'claude-code');
		expect(r.custom_vault_operations).toHaveLength(1);
		expect(r.custom_vault_operations[0]).toMatchObject({ action: 'delete_skill', id: 'old-one' });
		expect(r.enricher_invocations).toEqual([]);
	});

	it('parseSkillIdForVault normalizes', () => {
		expect(parseSkillIdForVault('  Hello World  ')).toBe('hello-world');
	});
});
