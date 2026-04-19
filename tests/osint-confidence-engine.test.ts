import { describe, it, expect } from 'vitest';
import {
	buildInferredOsintSources,
	computeOsintConfidence,
	countIndependentVerifiedSources,
	finalizeOsintSources,
	normalizeSourceUrl,
} from '../src/services/osint-confidence-engine';
import type { Entity, OsintSource } from '../src/entities/types';

function src(
	partial: Partial<OsintSource> & Pick<OsintSource, 'id' | 'source_url' | 'inferred' | 'rationale' | 'captured_at'>,
): OsintSource {
	return {
		archive_status: partial.archive_status,
		archive_url: partial.archive_url,
		conversation_id: partial.conversation_id,
		claims: partial.claims,
		...partial,
	};
}

describe('osint-confidence-engine', () => {
	it('normalizeSourceUrl strips hash from http URLs', () => {
		expect(normalizeSourceUrl('https://ex.com/a#frag')).toBe('https://ex.com/a');
	});

	it('buildInferredOsintSources uses first http URL from context', () => {
		const rows = buildInferredOsintSources({
			query: 'see https://a.com/x',
			extracted_urls: ['https://a.com/x'],
			captured_at: '2026-01-01T00:00:00.000Z',
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].inferred).toBe(true);
		expect(rows[0].source_url).toBe('https://a.com/x');
	});

	it('finalizeOsintSources fills id and default source_url', () => {
		const out = finalizeOsintSources(
			[{ inferred: true, rationale: 'x' }],
			{ captured_at: '2026-01-01T00:00:00.000Z' },
		);
		expect(out).toHaveLength(1);
		expect(out[0].id).toMatch(/^src_/);
		expect(out[0].source_url).toBe('inferred:orchestration');
	});

	it('countIndependentVerifiedSources skips inferred and dedupes URLs', () => {
		const sources: OsintSource[] = [
			src({
				id: 'a',
				source_url: 'https://x.com/1',
				inferred: false,
				rationale: 'r',
				captured_at: 't',
			}),
			src({
				id: 'b',
				source_url: 'https://x.com/1',
				inferred: false,
				rationale: 'r2',
				captured_at: 't',
			}),
			src({
				id: 'c',
				source_url: 'https://y.com/',
				inferred: true,
				rationale: 'r3',
				captured_at: 't',
			}),
		];
		expect(countIndependentVerifiedSources(sources)).toBe(1);
	});

	it('computeOsintConfidence returns conflicted when claims disagree', () => {
		const entity: Entity = {
			id: 'e1',
			type: 'Person',
			label: 'A',
			properties: { country: 'US' },
		};
		const sources: OsintSource[] = [
			src({
				id: 's1',
				source_url: 'https://a.com',
				inferred: false,
				rationale: 'r',
				captured_at: 't',
				claims: [{ path: 'properties.country', value: 'US' }],
			}),
			src({
				id: 's2',
				source_url: 'https://b.com',
				inferred: false,
				rationale: 'r',
				captured_at: 't',
				claims: [{ path: 'properties.country', value: 'UK' }],
			}),
		];
		const o = computeOsintConfidence(entity, sources, ['properties.country']);
		expect(o.osint_confidence).toBe('conflicted');
		expect(o.osint_contradictions.length).toBeGreaterThan(0);
	});

	it('computeOsintConfidence caps inferred-only at unverified', () => {
		const entity: Entity = {
			id: 'e1',
			type: 'Person',
			label: 'A',
			properties: { name: 'Bob' },
		};
		const sources: OsintSource[] = [
			src({
				id: 's1',
				source_url: 'inferred:orchestration',
				inferred: true,
				rationale: 'r',
				captured_at: 't',
			}),
		];
		expect(computeOsintConfidence(entity, sources).osint_confidence).toBe('unverified');
	});

	it('computeOsintConfidence ladders verified independent sources', () => {
		const entity: Entity = {
			id: 'e1',
			type: 'Person',
			label: 'A',
			properties: {},
		};
		const one: OsintSource[] = [
			src({
				id: 'a',
				source_url: 'https://u1.com',
				inferred: false,
				rationale: 'r',
				captured_at: 't',
			}),
		];
		const two: OsintSource[] = [
			...one,
			src({
				id: 'b',
				source_url: 'https://u2.com',
				inferred: false,
				rationale: 'r',
				captured_at: 't',
			}),
		];
		const three: OsintSource[] = [
			...two,
			src({
				id: 'c',
				source_url: 'https://u3.com',
				inferred: false,
				rationale: 'r',
				captured_at: 't',
			}),
		];
		expect(computeOsintConfidence(entity, one).osint_confidence).toBe('low');
		expect(computeOsintConfidence(entity, two).osint_confidence).toBe('medium');
		expect(computeOsintConfidence(entity, three).osint_confidence).toBe('high');
	});
});
