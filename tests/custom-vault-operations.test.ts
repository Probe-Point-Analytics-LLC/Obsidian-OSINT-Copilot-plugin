import { describe, it, expect } from 'vitest';
import {
	MAX_ENRICHER_SPEC_JSON_CHARS,
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

	const minimalEnricherSpec = (id: string) => ({
		id,
		name: 'Test API',
		description: 'unit test',
		status: 'active',
		enabled: true,
		allowedDomains: ['api.example.test'],
		auth: { type: 'none' },
		request: { method: 'GET', urlTemplate: `https://api.example.test/v1?q={{query}}&ctx={{attachments_context}}` },
		inputHints: ['email'],
		skillInstructions: '',
		limits: { timeoutMs: 15000, retries: 1, maxResponseChars: 8000 },
		updatedAt: '2026-01-01T00:00:00.000Z',
	});

	it('normalizes upsert_enricher and uses normalized id from spec', () => {
		const ops = normalizeCustomVaultOperations([
			{
				action: 'upsert_enricher',
				spec: minimalEnricherSpec('Leak Check API'),
			},
		]);
		expect(ops).toHaveLength(1);
		expect(ops[0]).toMatchObject({ action: 'upsert_enricher', id: 'leak-check-api' });
		if (ops[0].action === 'upsert_enricher') {
			expect(ops[0].spec.id).toBe('leak-check-api');
			expect(ops[0].spec.request.urlTemplate).toContain('{{query}}');
		}
	});

	it('drops upsert_enricher when spec is invalid or oversize', () => {
		expect(
			normalizeCustomVaultOperations([
				{ action: 'upsert_enricher', id: 'x', spec: null },
				{ action: 'upsert_enricher', id: '', spec: { name: 'no id' } },
			]),
		).toHaveLength(0);

		const pad = 'x'.repeat(MAX_ENRICHER_SPEC_JSON_CHARS + 50);
		const big = normalizeCustomVaultOperations([
			{
				action: 'upsert_enricher',
				spec: { ...minimalEnricherSpec('big'), description: pad },
			},
		]);
		expect(big).toHaveLength(0);
	});

	it('normalizes delete_enricher id and summarizes enricher ops', () => {
		const ops = normalizeCustomVaultOperations([{ action: 'delete_enricher', id: 'Remove Me!' }]);
		expect(ops).toEqual([{ action: 'delete_enricher', id: 'remove-me' }]);
		const u = summarizeCustomVaultOperation({
			action: 'upsert_enricher',
			id: 'a',
			spec: {
				id: 'a',
				name: 'N',
				description: '',
				status: 'active',
				enabled: true,
				allowedDomains: ['x.com'],
				auth: { type: 'none' },
				request: { method: 'GET', urlTemplate: 'https://x.com/{{query}}' },
				inputHints: [],
				skillInstructions: '',
				limits: { timeoutMs: 15000, retries: 1, maxResponseChars: 8000 },
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
		});
		expect(u).toContain('Upsert enricher');
		expect(u).toContain('N');
	});
});
