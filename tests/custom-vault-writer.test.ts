import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import { DEFAULT_ENRICHERS_FOLDER, DEFAULT_SCRIPTS_FOLDER } from '../src/constants/vault-layout';
import { applyCustomVaultOperations, resolveScriptFilePath } from '../src/services/custom-vault-writer';
import type { CustomVaultOperation } from '../src/services/custom-vault-operations';
import type { EnricherSpec } from '../src/services/enrichers/enricher-schema';

function minimalSpec(id: string): EnricherSpec {
	return {
		id,
		name: 'T',
		description: '',
		status: 'active',
		enabled: true,
		allowedDomains: ['x.test'],
		auth: { type: 'none' },
		request: { method: 'GET', urlTemplate: `https://x.test/{{query}}` },
		inputHints: [],
		skillInstructions: '',
		limits: { timeoutMs: 15000, retries: 1, maxResponseChars: 8000 },
		updatedAt: '2026-01-01T00:00:00.000Z',
	};
}

describe('applyCustomVaultOperations — enrichers', () => {
	let create: ReturnType<typeof vi.fn>;
	let modify: ReturnType<typeof vi.fn>;
	let del: ReturnType<typeof vi.fn>;
	let getAbstractFileByPath: ReturnType<typeof vi.fn>;
	let createFolder: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		create = vi.fn(async () => {});
		modify = vi.fn(async () => {});
		del = vi.fn(async () => {});
		createFolder = vi.fn(async () => {});
		getAbstractFileByPath = vi.fn(() => null);
	});

	function plugin() {
		return {
			settings: {
				skillsFolder: 'OSINTCopilot/custom/skills',
				credentialsFolder: 'OSINTCopilot/custom/credentials',
				enrichersFolder: DEFAULT_ENRICHERS_FOLDER,
				scriptsFolder: DEFAULT_SCRIPTS_FOLDER,
			},
			app: { vault: { getAbstractFileByPath, create, modify, delete: del, createFolder } },
			skillRegistry: { invalidate: vi.fn() },
			enricherRegistry: { invalidate: vi.fn() },
		} as any;
	}

	it('creates enricher JSON and invalidates enricherRegistry', async () => {
		const p = plugin();
		const ops: CustomVaultOperation[] = [{ action: 'upsert_enricher', id: 'my-api', spec: minimalSpec('my-api') }];
		const result = await applyCustomVaultOperations(p, ops);
		expect(result.applied).toBe(1);
		expect(result.enrichersTouched).toBe(true);
		expect(p.enricherRegistry.invalidate).toHaveBeenCalledTimes(1);
		expect(create).toHaveBeenCalled();
		const jsonPath = `${DEFAULT_ENRICHERS_FOLDER}/my-api.json`;
		expect(create.mock.calls[0][0]).toBe(jsonPath);
		const body = create.mock.calls[0][1] as string;
		expect(JSON.parse(body).id).toBe('my-api');
		expect(p.skillRegistry.invalidate).not.toHaveBeenCalled();
	});

	it('modifies existing enricher file', async () => {
		const jsonPath = `${DEFAULT_ENRICHERS_FOLDER}/ex.json`;
		const existing = new TFile() as any;
		existing.path = jsonPath;
		getAbstractFileByPath.mockImplementation((path: string) => (path === jsonPath ? existing : null));
		const p = plugin();
		await applyCustomVaultOperations(p, [{ action: 'upsert_enricher', id: 'ex', spec: minimalSpec('ex') }]);
		expect(modify).toHaveBeenCalledWith(existing, expect.stringContaining('"id": "ex"'));
		expect(create).not.toHaveBeenCalled();
	});

	it('delete_enricher removes file when present', async () => {
		const jsonPath = `${DEFAULT_ENRICHERS_FOLDER}/gone.json`;
		const existing = new TFile() as any;
		existing.path = jsonPath;
		getAbstractFileByPath.mockImplementation((path: string) => (path === jsonPath ? existing : null));
		const p = plugin();
		const result = await applyCustomVaultOperations(p, [{ action: 'delete_enricher', id: 'gone' }]);
		expect(result.applied).toBe(1);
		expect(del).toHaveBeenCalledWith(existing);
		expect(p.enricherRegistry.invalidate).toHaveBeenCalled();
	});
});

describe('applyCustomVaultOperations — scripts', () => {
	let create: ReturnType<typeof vi.fn>;
	let modify: ReturnType<typeof vi.fn>;
	let del: ReturnType<typeof vi.fn>;
	let getAbstractFileByPath: ReturnType<typeof vi.fn>;
	let createFolder: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		create = vi.fn(async () => {});
		modify = vi.fn(async () => {});
		del = vi.fn(async () => {});
		createFolder = vi.fn(async () => {});
		getAbstractFileByPath = vi.fn(() => null);
	});

	function plugin(scriptsFolder = DEFAULT_SCRIPTS_FOLDER) {
		return {
			settings: {
				skillsFolder: 'OSINTCopilot/custom/skills',
				credentialsFolder: 'OSINTCopilot/custom/credentials',
				enrichersFolder: DEFAULT_ENRICHERS_FOLDER,
				scriptsFolder,
			},
			app: { vault: { getAbstractFileByPath, create, modify, delete: del, createFolder } },
			skillRegistry: { invalidate: vi.fn() },
			enricherRegistry: { invalidate: vi.fn() },
		} as any;
	}

	it('creates script file under scripts folder', async () => {
		const p = plugin();
		const path = `${DEFAULT_SCRIPTS_FOLDER}/tools/x.py`;
		await applyCustomVaultOperations(p, [
			{ action: 'upsert_script', relativePath: 'tools/x.py', content: 'print(1)\n' },
		]);
		expect(create).toHaveBeenCalledWith(path, 'print(1)\n');
	});

	it('modifies existing script', async () => {
		const path = `${DEFAULT_SCRIPTS_FOLDER}/a.ts`;
		const existing = new TFile() as any;
		existing.path = path;
		getAbstractFileByPath.mockImplementation((fp: string) => (fp === path ? existing : null));
		const p = plugin();
		await applyCustomVaultOperations(p, [{ action: 'upsert_script', relativePath: 'a.ts', content: 'export {};\n' }]);
		expect(modify).toHaveBeenCalledWith(existing, 'export {};\n');
	});

	it('delete_script removes file when present', async () => {
		const path = `${DEFAULT_SCRIPTS_FOLDER}/old.sh`;
		const existing = new TFile() as any;
		existing.path = path;
		getAbstractFileByPath.mockImplementation((fp: string) => (fp === path ? existing : null));
		const p = plugin();
		const result = await applyCustomVaultOperations(p, [{ action: 'delete_script', relativePath: 'old.sh' }]);
		expect(result.applied).toBe(1);
		expect(del).toHaveBeenCalledWith(existing);
	});

	it('resolveScriptFilePath rejects traversal in relative path', () => {
		const p = plugin();
		expect(() => resolveScriptFilePath(p, '../credentials/leak.txt')).toThrow(/Invalid/);
	});

	it('resolveScriptFilePath rejects disallowed extension', () => {
		const p = plugin();
		expect(() => resolveScriptFilePath(p, 'x.exe')).toThrow();
	});
});
