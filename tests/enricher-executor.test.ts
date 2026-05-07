import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestUrl, TFile } from 'obsidian';
import { executeEnricherHttp } from '../src/services/enrichers/enricher-executor';
import type { EnricherSpec } from '../src/services/enrichers/enricher-schema';

function minimalSpec(overrides: Partial<EnricherSpec> = {}): EnricherSpec {
	return {
		id: 't1',
		name: 'Test',
		description: '',
		status: 'active',
		enabled: true,
		allowedDomains: ['api.example.com'],
		auth: { type: 'none' },
		request: {
			method: 'GET',
			urlTemplate: 'https://api.example.com/v?q={{query}}',
			headers: {},
		},
		inputHints: [],
		skillInstructions: '',
		limits: { timeoutMs: 8000, retries: 0, maxResponseChars: 8000 },
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

describe('executeEnricherHttp', () => {
	beforeEach(() => {
		vi.mocked(requestUrl).mockReset();
	});

	it('uses requestUrl for GET and returns formatted JSON body', async () => {
		vi.mocked(requestUrl).mockResolvedValue({
			status: 200,
			text: '{"hits":1}',
			headers: { 'content-type': 'application/json' },
			json: { hits: 1 },
			arrayBuffer: new ArrayBuffer(0),
		} as any);

		const out = await executeEnricherHttp(minimalSpec(), 'x@y.com', '', undefined, undefined, undefined);
		expect(out).toContain('Enricher Test succeeded');
		expect(out).toContain('"hits": 1');
		expect(requestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'https://api.example.com/v?q=x@y.com',
				method: 'GET',
				throw: false,
			}),
		);
	});

	it('throws on non-2xx from requestUrl', async () => {
		vi.mocked(requestUrl).mockResolvedValue({
			status: 403,
			text: 'denied',
			headers: {},
			json: null,
			arrayBuffer: new ArrayBuffer(0),
		} as any);

		await expect(executeEnricherHttp(minimalSpec(), 'q', '', undefined, undefined, undefined)).rejects.toThrow(
			/status=403/,
		);
	});

	it('sends POST body and contentType application/json', async () => {
		vi.mocked(requestUrl).mockResolvedValue({
			status: 200,
			text: '{}',
			headers: {},
			json: {},
			arrayBuffer: new ArrayBuffer(0),
		} as any);

		const spec = minimalSpec({
			request: {
				method: 'POST',
				urlTemplate: 'https://api.example.com/v',
				headers: {},
				bodyTemplate: '{"email":"{{query}}"}',
			},
		});

		await executeEnricherHttp(spec, 'u@d.com', '', undefined, undefined, undefined);

		expect(requestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				method: 'POST',
				body: '{"email":"u@d.com"}',
				contentType: 'application/json',
				throw: false,
			}),
		);
	});

	it('query_vault adds API key to URL and does not throw Missing credential env var', async () => {
		vi.mocked(requestUrl).mockResolvedValue({
			status: 200,
			text: '{"ok":true}',
			headers: {},
			json: { ok: true },
			arrayBuffer: new ArrayBuffer(0),
		} as any);

		const credFile = new TFile() as any;
		const vaultPath = 'OSINTCopilot/custom/credentials/leakcheck/api-key.txt';
		const mockVault = {
			getAbstractFileByPath: (p: string) => (p === vaultPath ? credFile : null),
			read: async () => 'mysecretkey',
		};

		const spec = minimalSpec({
			auth: {
				type: 'query_vault',
				queryParam: 'key',
				vaultRelativePath: 'leakcheck/api-key.txt',
			},
		});

		await executeEnricherHttp(
			spec,
			'test@example.com',
			'',
			undefined,
			mockVault as any,
			'OSINTCopilot/custom/credentials',
		);

		expect(requestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: expect.stringContaining('key=mysecretkey'),
			}),
		);
	});
});
