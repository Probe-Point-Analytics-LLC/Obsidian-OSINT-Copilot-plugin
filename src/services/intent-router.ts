/**
 * Lightweight heuristic intent routing for Main Copilot (orchestration mode).
 * Used before the LLM planner so vault-local and graph-build requests are not
 * drowned out by OSINT defaults.
 */

export type OrchestrationIntent =
    | "VAULT_GRAPH_BUILD"
    | "VAULT_QA"
    | "OSINT_TOOL_RUN"
    | "MIXED"
    | "UNKNOWN";

/**
 * Classify the user message into a coarse intent. No network calls.
 */
export function detectOrchestrationIntent(query: string): OrchestrationIntent {
    const q = query.trim().toLowerCase();
    if (!q) return "UNKNOWN";

    const vaultWideScope =
        /\b(all|every|entire|whole|full)\s+(the\s+)?(local\s+)?(documents?|notes?|files?|markdowns?)\b/.test(q) ||
        /\b(all|every)\s+notes?\b/.test(q) ||
        /\b(all|every)\s+markdown\s+files?\b/.test(q) ||
        (/\b(this|my|the)\s+vault\b/.test(q) && /\b(all|every|entire)\b/.test(q)) ||
        /\bacross\s+(the\s+)?(vault|obsidian)\b/.test(q) ||
        /\bvault[- ]wide\b/.test(q) ||
        /\b(all|every)\s+local\s+documents?\b/.test(q);

    const graphFromVault =
        /\b(build|create|make|generate|populate|construct)\s+(a\s+)?(knowledge\s+|entity\s+)?graph\b/.test(q) ||
        /\b(populate|fill)\b.{0,40}\b(knowledge\s+|entity\s+)?graph\b/.test(q) ||
        /\b(knowledge\s+)?graph\s+(from|based\s+on|using)\b/.test(q) ||
        /\bentities?\s+(from|in)\s+(my\s+)?(vault|notes)\b/.test(q) ||
        /\bmap\s+((all|my)\s+)?(notes|documents)\b/.test(q) ||
        /\b(extract|ingest)\b.{0,50}\b(entities|graph)\b/.test(q);

    const explicitVaultGraph =
        /\bbuild\s+(a\s+)?(knowledge\s+)?graph\b/.test(q) &&
        /\b(vault|local\s+documents?|this\s+vault|all\s+.{0,30}\b(notes|documents))\b/.test(q);

    const hasVaultGraph =
        (vaultWideScope && graphFromVault) ||
        explicitVaultGraph ||
        (/\bpopulate\b/.test(q) && /\bgraph\b/.test(q) && /\b(vault|notes)\b/.test(q));

    const externalInvestigation =
        /\b(dark\s*web|\.onion|breach|data\s*breach|leak\s*site|sanctions?\b|company\s+registry|whois|linkedin\.com)\b/.test(
            q
        ) ||
        /\b(look\s*up|search)\s+(on\s+)?(the\s+)?(internet|web|google)\b/.test(q) ||
        /\b(run|do|perform)\s+osint\b|\bosint\s+(on|for|about)\b/i.test(q) ||
        (/\bopen\s*source\s*(intel|intelligence)\b/.test(q) && /\b(not|outside|beyond)\s+(my\s+)?vault\b/.test(q));

    const vaultQaSignals =
        /\b(what|which|where|who|how)\b.{0,80}\b(my\s+)?(vault|notes)\b|\b(my\s+)?(vault|notes)\b.{0,40}\b(say|contain|about|mention)\b/.test(
            q
        ) ||
        /\bsearch\s+(in\s+)?(my\s+)?(vault|notes)\b/.test(q) ||
        /\baccording\s+to\s+(my\s+)?notes\b/.test(q);

    if (hasVaultGraph && externalInvestigation) return "MIXED";
    if (hasVaultGraph) return "VAULT_GRAPH_BUILD";
    if (externalInvestigation) return "OSINT_TOOL_RUN";
    if (vaultQaSignals && !hasVaultGraph) return "VAULT_QA";
    return "UNKNOWN";
}

/** Manual regression strings — expected intent after detectOrchestrationIntent */
export const INTENT_ROUTER_SELF_CHECK: { query: string; expect: OrchestrationIntent }[] = [
    {
        query: "I want you to build a graph based on all local documents in this vault",
        expect: "VAULT_GRAPH_BUILD",
    },
    { query: "Create a knowledge graph from every note in my vault", expect: "VAULT_GRAPH_BUILD" },
    { query: "Populate the entity graph using all markdown files here", expect: "VAULT_GRAPH_BUILD" },
    { query: "What do my notes say about Project X?", expect: "VAULT_QA" },
    { query: "Search my vault for mentions of the supplier", expect: "VAULT_QA" },
    { query: "Dark web forum posts about this hash", expect: "OSINT_TOOL_RUN" },
    {
        query: "Build a graph from my vault and also run OSINT on the CEO",
        expect: "MIXED",
    },
];

/**
 * Returns mismatched cases for debugging (e.g. from devtools). Empty array means all passed.
 */
export function verifyIntentRouterSelfCheck(): { query: string; expect: OrchestrationIntent; got: OrchestrationIntent }[] {
    const out: { query: string; expect: OrchestrationIntent; got: OrchestrationIntent }[] = [];
    for (const row of INTENT_ROUTER_SELF_CHECK) {
        const got = detectOrchestrationIntent(row.query);
        if (got !== row.expect) {
            out.push({ query: row.query, expect: row.expect, got });
        }
    }
    return out;
}
