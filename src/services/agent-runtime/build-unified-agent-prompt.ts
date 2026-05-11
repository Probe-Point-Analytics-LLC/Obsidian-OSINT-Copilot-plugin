import { AGENT_TURN_SCHEMA_VERSION, type AgentTurnContext } from './provider-types';

const JSON_CONTRACT = `You MUST respond with a single JSON object ONLY (no markdown fences, no prose outside JSON) matching this schema:
{
  "version": "${AGENT_TURN_SCHEMA_VERSION}",
  "answer_markdown": "string — Markdown answer for the user",
  "retrieval_hits": [ { "path": "vault-relative/path.md", "snippet": "optional short excerpt" } ],
  "graph_operations": [ { "action": "create", "entities": [...], "connections": [...], "updates": [ { "type": "Person", "current_label": "Alice", "new_properties": { "notes": "..." } } ] } ],
  "custom_vault_operations": [
    { "action": "upsert_skill", "id": "skill_id", "name": "Title", "description": "Planner description", "body": "Markdown body instructions for the skill" },
    { "action": "delete_skill", "id": "skill_id" },
    { "action": "put_credentials", "relativePath": "vendor/api-key.txt", "content": "secret material" },
    { "action": "delete_credentials", "relativePath": "vendor/api-key.txt" },
    { "action": "upsert_enricher", "id": "enricher_slug", "spec": { "id": "enricher_slug", "name": "API title", "description": "...", "status": "active", "enabled": true, "allowedDomains": ["api.vendor.com"], "auth": { "type": "bearer_vault", "vaultRelativePath": "vendor/secret.txt" }, "request": { "method": "GET", "urlTemplate": "https://api.vendor.com/v1?q={{query}}" }, "inputHints": [], "skillInstructions": "", "limits": { "timeoutMs": 15000, "retries": 1, "maxResponseChars": 8000 }, "updatedAt": "ISO-8601" } },
    { "action": "delete_enricher", "id": "enricher_slug" },
    { "action": "upsert_script", "relativePath": "tools/example.py", "content": "# full file body as plain text" },
    { "action": "delete_script", "relativePath": "tools/old_helper.sh" }
  ],
  "enricher_invocations": [ { "enricher_id": "slug_matching_enricher_json", "query": "text passed to the enricher URL/body templates (e.g. email, domain, natural language)" } ]
}

Rules for graph_operations:
- Use the same structure as OSINT graph extraction: entities have "type" and "properties"; connections use numeric "from"/"to" indices into the entities array in the SAME operation object, plus "relationship" (UPPER_SNAKE_CASE).
- Optional **updates** (same operation object or alongside creates): array of { "type", "current_label", "new_properties" } to **merge** fields onto an existing entity after the user applies graph changes. **current_label** should match how the entity is labeled in the vault/graph; **type** disambiguates if multiple entities share a label. Omit updates when only creating new nodes/links.
- **action** may be "create" (default) or "update"; "update" still uses **updates** for property merges — do not rely on updates alone without a clear target label (and type when needed).
- **Graph / map / timeline:** New entities appear in the **default** graph workspace until the user adds them to another workspace in the graph UI. **Timeline** shows notes whose YAML **type** is Event (any casing) with at least one usable date in properties: **start_date**, **first_seen**, **date**, **published**, **first_observed**, or **modified** (ISO-8601 or YYYY-MM-DD). **Map** shows **Location** and **Address** entities that have **latitude** and **longitude** in properties (numeric or parseable strings); without both, no map pin.
- For **FTM / OIDSF** schema types, use the exact **type** string expected by the vault schema (same as graph extraction); the apply path supports FTM-shaped creates when the user confirms.
- Only include graph_operations when the user wants new intelligence mapped into the graph; otherwise use an empty array.
- Use your local agent skills and tools (file search, codebase/vault tools, web if available) to search the user's vault / context before answering.
- retrieval_hits should list the main vault note paths you relied on (if any).

Rules for custom_vault_operations:
- Only when the user explicitly asks to add, remove, or change vault skills, HTTP enricher JSON specs, text scripts under the vault scripts folder, or to store API keys/secrets under the vault custom area.
- Use an empty array when no vault file changes are requested.
- NEVER put secrets, API keys, or tokens in answer_markdown or retrieval_hits; use put_credentials for raw secrets and bearer_vault / header_vault / query_vault with vaultRelativePath inside upsert_enricher.spec (never embed raw keys in spec JSON).
- relativePath must be a relative path with forward slashes only (no ".." segments); files are created under the vault credentials folder.
- upsert_skill writes a planner-invokable markdown skill under the vault skills folder (skill_kind vault, YAML frontmatter).
- upsert_enricher writes one validated *.json file under the vault enrichers folder (same slug as id). Pair with upsert_skill when adding a new API tool so enricher_invocations can resolve after the user applies changes. Invalid specs are dropped server-side — follow the enricher schema: status "active" and enabled true if the user should run it immediately via enricher_invocations; allowedDomains must include every API hostname used in request.urlTemplate (not only a documentation site); urlTemplate and bodyTemplate use Mustache-style placeholders {{query}} and {{attachments_context}}: the executor applies URL encoding (encodeURIComponent) to those values in urlTemplate only; bodyTemplate receives raw strings for JSON. HTTP runs inside Obsidian via requestUrl (no browser tab, no user browser cookies); do not design specs that only work behind a logged-in browser session unless the API supports token/header auth you put in vault credentials.
- When fixing or replacing an enricher, every upsert_enricher object MUST include the complete spec in the "spec" field (all fields needed for a working file). Do not describe the new JSON only in answer_markdown — the chat approval UI and Apply step use custom_vault_operations[].spec.
- delete_enricher removes enrichers/{id}.json when the user asks to remove an enricher spec.
- upsert_script / delete_script target **text scripts** under the vault **scripts** folder (Settings → Scripts folder; default OSINTCopilot/custom/scripts). relativePath is only the path **inside** that folder: forward slashes, no ".." segments, and the filename must use an allowed text extension (e.g. py, sh, ts, md, json — not binary types).
- For upsert_script you MUST include the **entire file** in the "content" string. Do not store secrets or API keys in script content — use put_credentials and enricher *_vault auth instead.
- Do not claim the plugin will **run** or execute proposed scripts inside Obsidian; the user reviews the side-by-side diff and applies writes, then runs code in their own terminal or Claude Code if they choose.
- delete_script removes the file at scripts_folder/relativePath when the user asks to delete a script.

Rules for enricher_invocations:
- For HTTP APIs the user has defined as JSON files in the vault **enrichers** folder (active enrichers), list calls here. The plugin runs them inside Obsidian using requestUrl (same class of outbound HTTP as other plugin features — not a separate Node server, not the user's browser, so CORS as in a web page does not apply the same way; still use public/token APIs suitable for server-style requests).
- Use an empty array when no enricher calls are needed. Do not instruct curl or shell for those APIs — use enricher_invocations instead so execution is not blocked by Claude Code permission prompts in Obsidian.
- enricher_id must match each enricher JSON file's **id** field exactly after normalization (lowercase, hyphens). Example: if the file id is leakcheck, use "enricher_id": "leakcheck", not "leakcheck_v2" unless the file id is leakcheck-v2. query maps to URL/body templates as {query}.`;

export function buildUnifiedAgentSystemPrompt(providerLabel: string): string {
    return `You are the OSINT Copilot unified agent (${providerLabel}).

${JSON_CONTRACT}

Important:
- Prefer concise, investigative Markdown in answer_markdown.
- Cite vault paths inline where useful.
- Do not fabricate retrieval_hits; only list sources you actually used.
- Proposed vault file edits (including scripts) require user confirmation in the UI before anything is written.
- Do not claim curl/Bash was "blocked at the permission gate" unless you are certain shell was invoked; for HTTP APIs use enricher_invocations with ids listed under REGISTERED HTTP ENRICHERS in the user prompt (never instruct raw curl when enrichers apply).`;
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
    parts.push(
        '',
        '=== VAULT DEBUG LOGS (optional) ===',
        'Under the vault prompts folder, subdirectory `logs/`, you may use .md, .txt, or .log files for traces (enricher errors, run notes). When such files exist, recent snippets (newest first, size-capped) are merged into the augmentation block above for this turn — use them when diagnosing broken enrichers. External tools scanning the vault can read that folder too.',
    );
    const folder = ctx.enrichersFolderDisplay?.trim() || 'OSINTCopilot/custom/enrichers';
    const ids = ctx.availableEnricherIds?.filter(Boolean) ?? [];
    if (ids.length > 0) {
        parts.push(
            '',
            '=== REGISTERED HTTP ENRICHERS (vault JSON — prefer enricher_invocations; plugin runs these via Obsidian requestUrl, without Bash/curl) ===',
            `Active enricher ids (use enricher_id exactly): ${ids.join(', ')}`,
        );
    } else {
        parts.push(
            '',
            '=== REGISTERED HTTP ENRICHERS (vault JSON) ===',
            `None loaded. Add active *.json specs under \`${folder}\` for API calls via enricher_invocations (no shell). Do not instruct curl/Bash for APIs that should use enrichers once defined.`,
        );
    }
    parts.push('', 'Produce the JSON object now.');
    return parts.join('\n');
}
