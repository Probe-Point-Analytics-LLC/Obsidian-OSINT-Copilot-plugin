import { AGENT_TURN_SCHEMA_VERSION, type AgentTurnContext } from './provider-types';

const JSON_CONTRACT = `You MUST respond with a single JSON object ONLY (no markdown fences, no prose outside JSON) matching this schema:
{
  "version": "${AGENT_TURN_SCHEMA_VERSION}",
  "answer_markdown": "string — Markdown answer for the user",
  "retrieval_hits": [ { "path": "vault-relative/path.md", "snippet": "optional short excerpt" } ],
  "graph_operations": [ { "action": "create", "entities": [...], "connections": [...] } ]
}

Rules for graph_operations:
- Use the same structure as OSINT graph extraction: entities have "type" and "properties"; connections use numeric "from"/"to" indices into the entities array in the SAME operation object, plus "relationship" (UPPER_SNAKE_CASE).
- Only include graph_operations when the user wants new intelligence mapped into the graph; otherwise use an empty array.
- Use your local agent skills and tools (file search, codebase/vault tools, web if available) to search the user's vault / context before answering.
- retrieval_hits should list the main vault note paths you relied on (if any).`;

export function buildUnifiedAgentSystemPrompt(providerLabel: string): string {
    return `You are the OSINT Copilot unified agent (${providerLabel}).

${JSON_CONTRACT}

Important:
- Prefer concise, investigative Markdown in answer_markdown.
- Cite vault paths inline where useful.
- Do not fabricate retrieval_hits; only list sources you actually used.`;
}

export function buildUnifiedAgentUserPrompt(ctx: AgentTurnContext): string {
    const memory =
        ctx.conversationMemory && ctx.conversationMemory.length > 0
            ? ctx.conversationMemory.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n---\n\n')
            : '(no prior messages)';

    const parts = [
        '=== USER REQUEST ===',
        ctx.query,
        '',
        '=== ATTACHMENT / URL / EXTRACTED CONTEXT (may be empty) ===',
        ctx.attachmentsContext?.trim() || '(none)',
        '',
        '=== EXISTING GRAPH (summary) ===',
        ctx.graphEntitiesSummary,
        '',
        '=== CONVERSATION MEMORY ===',
        memory,
    ];
    if (ctx.vaultAugmentation?.trim()) {
        parts.push('', '=== VAULT RULES / AGENT AUGMENTATION (user-editable) ===', ctx.vaultAugmentation.trim());
    }
    parts.push('', 'Produce the JSON object now.');
    return parts.join('\n');
}
