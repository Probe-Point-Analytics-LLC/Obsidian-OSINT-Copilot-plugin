/**
 * Derives persisted OsintConfidence from sources and detected contradictions.
 * Pure logic — no vault I/O.
 */

import type {
	Connection,
	Entity,
	GraphWriteContext,
	OsintConfidence,
	OsintContradiction,
	OsintSource,
	OsintSourceInput,
} from '../entities/types';
import { OSINT_CONFIDENCE_LEVELS } from '../entities/types';

/** Material fields compared for entities (dot paths under properties + label). */
const DEFAULT_ENTITY_FIELD_PATHS = ['label', 'name', 'properties.country', 'properties.email'];

/** For connections: relationship line + key interval props. */
const DEFAULT_CONNECTION_FIELD_PATHS = ['relationship', 'label', 'properties.role', 'properties.startDate'];

export function isOsintConfidence(v: unknown): v is OsintConfidence {
	return typeof v === 'string' && (OSINT_CONFIDENCE_LEVELS as readonly string[]).includes(v);
}

/** When the pipeline has no explicit sources, attach one inferred row tied to query/context. */
export function buildInferredOsintSources(ctx: GraphWriteContext | undefined): OsintSourceInput[] {
	const q = (ctx?.query ?? '').trim() || 'Graph write (no query context)';
	const firstUrl = ctx?.extracted_urls?.find(
		(u) => u.startsWith('http://') || u.startsWith('https://'),
	);
	return [
		{
			inferred: true,
			source_url: firstUrl ?? 'inferred:orchestration',
			rationale: `Assistant graph pipeline. Context: ${q.slice(0, 600)}`,
			conversation_id: ctx?.conversation_id,
		},
	];
}

export function normalizeSourceUrl(url: string): string {
	const t = url.trim();
	try {
		if (t.startsWith('http://') || t.startsWith('https://')) {
			const u = new URL(t);
			u.hash = '';
			return u.toString();
		}
	} catch {
		/* vault path */
	}
	return t;
}

function getFieldValue(
	target: Entity | Connection,
	path: string,
): string | undefined {
	if (path === 'label') return target.label ?? undefined;
	if (path === 'relationship' && 'relationship' in target) {
		return target.relationship;
	}
	if (path.startsWith('properties.')) {
		const k = path.slice('properties.'.length);
		const props = target.properties ?? {};
		const v = props[k];
		if (v === undefined || v === null) return undefined;
		return String(v).trim();
	}
	return undefined;
}

function detectContradictions(
	target: Entity | Connection,
	fieldPaths: string[],
	sources: OsintSource[],
): OsintContradiction[] {
	const out: OsintContradiction[] = [];
	for (const field_path of fieldPaths) {
		const bySource: Record<string, string> = {};
		for (const src of sources) {
			const fromClaim = src.claims?.find((c) => c.path === field_path);
			if (fromClaim && fromClaim.value.trim() !== '') {
				bySource[src.id] = fromClaim.value.trim();
				continue;
			}
			const snap = getFieldValue(target, field_path);
			if (snap !== undefined && snap !== '') {
				bySource[src.id] = snap;
			}
		}
		const vals = Object.entries(bySource);
		if (vals.length < 2) continue;
		const unique = new Set(vals.map(([, v]) => v.toLowerCase()));
		if (unique.size > 1) {
			out.push({
				field_path,
				entries: vals.map(([source_id, value]) => ({ source_id, value })),
			});
		}
	}
	return out;
}

export interface ComputeOsintOutcome {
	osint_confidence: OsintConfidence;
	osint_contradictions: OsintContradiction[];
}

/**
 * Count independent non-inferred sources (deduped by normalized URL).
 */
export function countIndependentVerifiedSources(sources: OsintSource[]): number {
	const seen = new Set<string>();
	let n = 0;
	for (const s of sources) {
		if (s.inferred) continue;
		const key = normalizeSourceUrl(s.source_url);
		if (seen.has(key)) continue;
		seen.add(key);
		n++;
	}
	return n;
}

export function computeOsintConfidence(
	target: Entity | Connection,
	sources: OsintSource[],
	fieldPaths?: string[],
): ComputeOsintOutcome {
	const paths =
		'relationship' in target && target.relationship !== undefined
			? fieldPaths ?? DEFAULT_CONNECTION_FIELD_PATHS
			: fieldPaths ?? DEFAULT_ENTITY_FIELD_PATHS;

	const contradictions = detectContradictions(target, paths, sources);
	if (contradictions.length > 0) {
		return { osint_confidence: 'conflicted', osint_contradictions: contradictions };
	}

	const verified = countIndependentVerifiedSources(sources);
	const onlyInferred = sources.length > 0 && sources.every((s) => s.inferred);

	if (sources.length === 0) {
		return { osint_confidence: 'unverified', osint_contradictions: [] };
	}
	if (onlyInferred) {
		return { osint_confidence: 'unverified', osint_contradictions: [] };
	}
	if (verified <= 0) {
		return { osint_confidence: 'unverified', osint_contradictions: [] };
	}
	if (verified === 1) {
		return { osint_confidence: 'low', osint_contradictions: [] };
	}
	if (verified === 2) {
		return { osint_confidence: 'medium', osint_contradictions: [] };
	}
	return { osint_confidence: 'high', osint_contradictions: [] };
}

let sourceIdSeq = 0;
export function generateOsintSourceId(): string {
	sourceIdSeq += 1;
	return `src_${Date.now().toString(36)}_${sourceIdSeq}`;
}

/** Normalize LLM / pipeline input into full OsintSource records. */
export function finalizeOsintSources(
	inputs: OsintSourceInput[] | undefined,
	defaults: { captured_at: string; conversation_id?: string },
): OsintSource[] {
	if (!inputs?.length) return [];
	return inputs.map((raw) => {
		const id = raw.id?.trim() || generateOsintSourceId();
		const source_url = (raw.source_url ?? '').trim() || 'inferred:orchestration';
		return {
			id,
			source_url,
			archive_url: raw.archive_url,
			archive_status: raw.archive_status,
			inferred: raw.inferred === true,
			rationale: (raw.rationale ?? '').trim() || 'No rationale provided.',
			captured_at: raw.captured_at ?? defaults.captured_at,
			conversation_id: raw.conversation_id ?? defaults.conversation_id,
			claims: raw.claims,
		};
	});
}
