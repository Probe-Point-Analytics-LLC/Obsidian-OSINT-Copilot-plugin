import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestUrl } from 'obsidian';
import { GraphApiService, isLikelyExpectedUrlFetchFailure } from '../src/services/api-service';

describe('GraphApiService tryExtractTextFromUrl', () => {
	let service: GraphApiService;

	beforeEach(() => {
		service = new GraphApiService();
		vi.mocked(requestUrl).mockReset();
	});

	it('returns ok:false with shortMessage on HTTP 403', async () => {
		vi.mocked(requestUrl).mockResolvedValue({
			status: 403,
			text: '<html><title>x</title></html>',
			headers: { 'content-type': 'text/html; charset=UTF-8', 'cf-ray': 'abc' },
		} as any);

		const r = await service.tryExtractTextFromUrl('https://mail.example/?_task=mail&x=1');
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.status).toBe(403);
			expect(r.shortMessage).toContain('HTTP 403');
			expect(r.longDetail).toBeDefined();
			expect(r.longDetail).toContain('Obsidian cannot fetch');
		}
	});

	it('returns ok:true with stripped text on 200 HTML', async () => {
		vi.mocked(requestUrl).mockResolvedValue({
			status: 200,
			text: '<html><body><p>Hello world</p></body></html>',
			headers: { 'content-type': 'text/html' },
		} as any);

		const r = await service.tryExtractTextFromUrl('https://public.example/page');
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.text).toContain('Hello world');
		}
	});

	it('extractTextFromUrl throws longDetail for 403', async () => {
		vi.mocked(requestUrl).mockResolvedValue({
			status: 403,
			text: '',
			headers: {},
		} as any);

		await expect(service.extractTextFromUrl('https://x/')).rejects.toThrow(/Obsidian cannot fetch/);
	});
});

describe('isLikelyExpectedUrlFetchFailure', () => {
	it('matches common denied patterns', () => {
		expect(isLikelyExpectedUrlFetchFailure('HTTP 403 (page not loaded')).toBe(true);
		expect(isLikelyExpectedUrlFetchFailure('HTTP 401: x')).toBe(true);
		expect(isLikelyExpectedUrlFetchFailure('Failed to fetch URL (HTTP 500)')).toBe(false);
		expect(isLikelyExpectedUrlFetchFailure('Failed to fetch URL (HTTP 429)')).toBe(true);
		expect(isLikelyExpectedUrlFetchFailure('Obsidian cannot fetch this URL')).toBe(true);
		expect(isLikelyExpectedUrlFetchFailure('Network down')).toBe(false);
	});
});
