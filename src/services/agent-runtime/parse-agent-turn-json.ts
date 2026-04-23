import type { AIOperation, OsintSourceInput } from '../../entities/types';
import {
    AGENT_TURN_SCHEMA_VERSION,
    type AgentRetrievalHit,
    type AgentTurnDiagnostics,
    type AgentTurnResult,
    type AgentRuntimeId,
} from './provider-types';

function extractJsonObject(raw: string): string | null {
    const trimmed = raw.trim();
    try {
        const d = JSON.parse(trimmed);
        if (d && typeof d === 'object') return trimmed;
    } catch {
        /* fall through */
    }
    const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
        try {
            JSON.parse(fenceMatch[1].trim());
            return fenceMatch[1].trim();
        } catch {
            /* fall through */
        }
    }
    const match = trimmed.match(/\{[\s\S]*\}/);
    return match ? match[0] : null;
}

function normalizeSources(raw: unknown): OsintSourceInput[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const out: OsintSourceInput[] = [];
    for (const s of raw) {
        if (!s || typeof s !== 'object') continue;
        const o = s as Record<string, unknown>;
        out.push({
            inferred: Boolean(o.inferred),
            source_url: typeof o.source_url === 'string' ? o.source_url : undefined,
            rationale: typeof o.rationale === 'string' ? o.rationale : undefined,
            claims: Array.isArray(o.claims)
                ? (o.claims as unknown[])
                      .filter((c): c is { path: string; value: string } => {
                          if (!c || typeof c !== 'object') return false;
                          const cl = c as Record<string, unknown>;
                          return typeof cl.path === 'string' && typeof cl.value === 'string';
                      })
                      .map((c) => ({ path: c.path, value: c.value }))
                : undefined,
        });
    }
    return out.length ? out : undefined;
}

function normalizeGraphOperations(raw: unknown): AIOperation[] {
    if (!Array.isArray(raw)) return [];
    const ops: AIOperation[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const action = o.action === 'update' ? 'update' : 'create';
        const entities = Array.isArray(o.entities)
            ? (o.entities as unknown[]).map((e) => {
                  if (!e || typeof e !== 'object') return null;
                  const ent = e as Record<string, unknown>;
                  return {
                      type: String(ent.type ?? ''),
                      properties:
                          ent.properties && typeof ent.properties === 'object'
                              ? (ent.properties as Record<string, unknown>)
                              : {},
                      sources: normalizeSources(ent.sources),
                  };
              })
            : [];
        const connections = Array.isArray(o.connections)
            ? (o.connections as unknown[]).map((c) => {
                  if (!c || typeof c !== 'object') return null;
                  const conn = c as Record<string, unknown>;
                  return {
                      from: Number(conn.from),
                      to: Number(conn.to),
                      relationship: String(conn.relationship ?? ''),
                      from_label: conn.from_label as string | undefined,
                      to_label: conn.to_label as string | undefined,
                      from_type: conn.from_type as string | undefined,
                      to_type: conn.to_type as string | undefined,
                      sources: normalizeSources(conn.sources),
                  };
              })
            : [];
        const cleanEntities = entities.filter(Boolean) as NonNullable<AIOperation['entities']>;
        const cleanConnections = connections.filter(Boolean) as NonNullable<AIOperation['connections']>;
        ops.push({
            action,
            entities: cleanEntities.length ? cleanEntities : undefined,
            connections: cleanConnections.length ? cleanConnections : undefined,
            updates: Array.isArray(o.updates) ? (o.updates as AIOperation['updates']) : undefined,
        });
    }
    return ops;
}

function normalizeHits(raw: unknown): AgentRetrievalHit[] {
    if (!Array.isArray(raw)) return [];
    const hits: AgentRetrievalHit[] = [];
    for (const h of raw) {
        if (!h || typeof h !== 'object') continue;
        const o = h as Record<string, unknown>;
        const path = typeof o.path === 'string' ? o.path : '';
        if (!path) continue;
        hits.push({
            path,
            snippet: typeof o.snippet === 'string' ? o.snippet : undefined,
        });
    }
    return hits;
}

/**
 * Parse stdout from Claude/Hermes into AgentTurnResult; never throws — returns fallback object.
 */
export function parseAgentTurnResult(raw: string, provider: AgentRuntimeId): AgentTurnResult {
    const excerpt = raw.length > 2000 ? raw.slice(0, 2000) + '…' : raw;
    const jsonStr = extractJsonObject(raw);
    if (!jsonStr) {
        return {
            version: AGENT_TURN_SCHEMA_VERSION,
            answer_markdown:
                `**Agent response could not be parsed as JSON.**\n\nShow raw output (truncated):\n\n\`\`\`\n${excerpt}\n\`\`\``,
            retrieval_hits: [],
            graph_operations: [],
            diagnostics: { provider, raw_excerpt: excerpt, notes: 'no_json_object' },
        };
    }
    try {
        const data = JSON.parse(jsonStr) as Record<string, unknown>;
        const version =
            data.version === AGENT_TURN_SCHEMA_VERSION ? AGENT_TURN_SCHEMA_VERSION : AGENT_TURN_SCHEMA_VERSION;
        const answer =
            typeof data.answer_markdown === 'string'
                ? data.answer_markdown
                : typeof data.answer === 'string'
                  ? data.answer
                  : typeof data.response === 'string'
                    ? data.response
                    : '';
        const hits = normalizeHits(data.retrieval_hits ?? data.retrievalHits ?? data.hits);
        const graphOps = normalizeGraphOperations(data.graph_operations ?? data.graphOperations ?? data.operations);
        const diag: AgentTurnDiagnostics = {
            provider,
            raw_excerpt: excerpt,
            notes: typeof data.diagnostics === 'object' && data.diagnostics !== null
                ? JSON.stringify(data.diagnostics).slice(0, 500)
                : undefined,
        };
        return {
            version,
            answer_markdown: answer || '_Empty answer from model._',
            retrieval_hits: hits,
            graph_operations: graphOps,
            diagnostics: diag,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            version: AGENT_TURN_SCHEMA_VERSION,
            answer_markdown: `**Invalid agent JSON:** ${msg}\n\nRaw (truncated):\n\n\`\`\`\n${excerpt}\n\`\`\``,
            retrieval_hits: [],
            graph_operations: [],
            diagnostics: { provider, raw_excerpt: excerpt, notes: 'json_parse_error' },
        };
    }
}
