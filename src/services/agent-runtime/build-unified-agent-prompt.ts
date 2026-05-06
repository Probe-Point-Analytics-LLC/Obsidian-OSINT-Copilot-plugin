import { AGENT_TURN_SCHEMA_VERSION, type AgentTurnContext } from './provider-types';

const JSON_CONTRACT = `You MUST respond with a single JSON object ONLY (no markdown fences, no prose outside JSON) matching this schema:
{
  "version": "${AGENT_TURN_SCHEMA_VERSION}",
  "answer_markdown": "string — Markdown answer for the user",
  "retrieval_hits": [ { "path": "vault-relative/path.md", "snippet": "optional short excerpt" } ],
  "graph_operations": [ { "action": "create", "entities": [...], "connections": [...] } ],
  "custom_vault_operations": [
    { "action": "upsert_skill", "id": "skill_id", "name": "Title", "description": "Planner description", "body": "Markdown body instructions for the skill" },
    { "action": "delete_skill", "id": "skill_id" },
    { "action": "put_credentials", "relativePath": "vendor/api-key.txt", "content": "secret material" },
    { "action": "delete_credentials", "relativePath": "vendor/api-key.txt" }
  ],
  "enricher_invocations": [ { "enricher_id": "slug_matching_enricher_json", "query": "text passed to the enricher URL/body templates (e.g. email, domain, natural language)" } ]
}

Rules for graph_operations:
- Use the same structure as OSINT graph extraction: entities have "type" and "properties"; connections use numeric "from"/"to" indices into the entities array in the SAME operation object, plus "relationship" (UPPER_SNAKE_CASE).
- Only include graph_operations when the user wants new intelligence mapped into the graph; otherwise use an empty array.
- Use your local agent skills and tools (file search, codebase/vault tools, web if available) to search the user's vault / context before answering.
- retrieval_hits should list the main vault note paths you relied on (if any).

Rules for custom_vault_operations:
- Only when the user explicitly asks to add, remove, or change vault skills or to store API keys/secrets under the vault custom area.
- Use an empty array when no vault file changes are requested.
- NEVER put secrets, API keys, or tokens in answer_markdown or retrieval_hits; use put_credentials only.
- relativePath must be a relative path with forward slashes only (no ".." segments); files are created under the vault credentials folder.
- upsert_skill writes a planner-invokable markdown skill under the vault skills folder (skill_kind vault, YAML frontmatter).

Rules for enricher_invocations:
- For HTTP APIs the user has defined as JSON files in the vault **enrichers** folder (active enrichers), list calls here. The plugin runs them via Node (no curl/Bash), using vault-stored credentials per enricher auth config.
- Use an empty array when no enricher calls are needed. Do not instruct curl or shell for those APIs — use enricher_invocations instead so execution is not blocked by Claude Code permission prompts in Obsidian.
- enricher_id must match the enricher spec id (slug). query is substituted into the enricher templates as {query} / attachments_context as documented in each spec.`;

export function buildUnifiedAgentSystemPrompt(providerLabel: string): string {
    return `You are the OSINT Copilot unified agent (${providerLabel}).

${JSON_CONTRACT}

Important:
- Prefer concise, investigative Markdown in answer_markdown.
- Cite vault paths inline where useful.
- Do not fabricate retrieval_hits; only list sources you actually used.
- Proposed vault file edits require user confirmation in the UI before anything is written.`;
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
