# HTTP enrichers — setup and constraints

Vault path (default): `OSINTCopilot/custom/enrichers/*.json` (see **Settings → OSINT Copilot → Enrichers folder**).

Companion skills (optional): `OSINTCopilot/custom/skills/<id>.md` — document when to call the enricher; the unified agent prefers **`enricher_invocations`** over Bash/`curl`.

Credentials (default): `OSINTCopilot/custom/credentials/` — see **Credentials folder** in Settings. Never store API keys in enricher JSON, chat, or `answer_markdown`.

---

## How the plugin runs HTTP

Enricher requests use **Obsidian `requestUrl`**, the same outbound HTTP path as other plugin features. They do **not** run in your browser tab, so they do **not** send site login cookies. APIs that only work behind a logged-in browser session will fail (same limitation as “fetch this webmail URL” in chat).

| Concern | Behavior |
|--------|----------|
| Host allowlist | Every hostname in `request.urlTemplate` must appear in `allowedDomains` |
| Path/query templates | `{{query}}`, `{{attachments_context}}` in **`urlTemplate`** are **URL-encoded** |
| JSON body templates | `bodyTemplate` uses **raw** substitution (valid JSON preserved) |
| Secrets | `bearer_vault`, `header_vault`, `query_vault` read files at execution time |
| Unified chat | Agent may return `enricher_invocations: [{ "enricher_id": "...", "query": "..." }]` |
| Drafting | Command **Draft HTTP enricher skill from API documentation** or agent `upsert_enricher` (confirm in chat) |

Full chat behavior (previews, Bash vs enrichers, truthfulness): **USER_GUIDE.md** → HTTP enrichers.

---

## Folder layout

```
OSINTCopilot/custom/
  enrichers/
    leakcheck.json          # spec (id must match enricher_id in chat)
  skills/
    leakcheck.md            # optional companion skill
  credentials/
    leakcheck/
      api-key.txt           # single secret line; path = vaultRelativePath in JSON
```

After **Apply selected** on an agent-proposed `upsert_enricher`, the registry reloads. Use **OSINT Copilot: Open tools & skills registry** to open, add a disabled draft, or trash enricher JSON files.

---

## Auth types

| `auth.type` | Required fields | Use when |
|-------------|-----------------|----------|
| `none` | — | Public endpoints only |
| `bearer_vault` | `vaultRelativePath` (under credentials folder) | `Authorization: Bearer <file contents>` |
| `header_vault` | `vaultRelativePath`, `headerName` | Custom header (e.g. `X-Api-Key`) |
| `query_vault` | `vaultRelativePath`, `queryParam` | API key as query param (LeakCheck-style `key`) |
| `bearer_env` / `header_env` / `query_env` | `envVar` | Key only in process environment (no vault file) |

**Credentials folder must match Settings.** The path in JSON is relative to that folder (e.g. `leakcheck/api-key.txt` → `<credentialsFolder>/leakcheck/api-key.txt`).

Console warnings like `[EnricherSchema] … auth downgraded to none` mean `vaultRelativePath` was missing or invalid — the request went out **without** a key.

---

## Example skeleton (path-style API, query_vault)

LeakCheck-style lookup (illustrative — adjust URL and fields to your API docs):

```json
{
  "id": "leakcheck",
  "name": "LeakCheck lookup",
  "description": "Query breach API for an email or username",
  "enabled": true,
  "allowedDomains": ["leakcheck.io"],
  "request": {
    "method": "GET",
    "urlTemplate": "https://leakcheck.io/api/v2/query/{{query}}"
  },
  "auth": {
    "type": "query_vault",
    "vaultRelativePath": "leakcheck/api-key.txt",
    "queryParam": "key"
  }
}
```

1. Create `OSINTCopilot/custom/credentials/leakcheck/api-key.txt` with your API key (one line).
2. Ensure **Credentials folder** in Settings points at `OSINTCopilot/custom/credentials`.
3. In chat, ask the unified agent to check `user@example.com` using enricher **`leakcheck`** (or rely on `enricher_invocations` in the agent JSON).
4. Read **Enricher results** and **Plugin status** at the bottom of the message — the Markdown answer is generated **before** enrichers run.

---

## Drafting vs editing

| Method | Approval |
|--------|----------|
| **Draft HTTP enricher skill from API documentation** | **Install** / **Cancel** modal before any vault write |
| Agent `upsert_enricher` in `custom_vault_operations` | **Apply selected** / **Dismiss** in chat; expand **Preview enricher JSON** first |
| Hand-edit `enrichers/*.json` | Immediate on save (vault watcher reloads registry) |

When drafting, put the **API hostname** in `allowedDomains`, not only the documentation site. Prefer `*_vault` auth over pasting keys into the spec.

---

## `enricher_id` must match the file

`enricher_id` in unified JSON is normalized (lowercase, hyphenated) and must match the `"id"` field in the JSON file. A model guess like `leakcheck_v2` will not resolve if the file says `"id": "leakcheck"`. On failure, the plugin lists **Available enricher ids**.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| **Unknown enricher** | Id mismatch | Copy `id` from `enrichers/*.json` exactly |
| **Missing credential env var: (unset)** on `query_vault` | Old plugin build | Update to ≥ 2.5.6 and reload Obsidian |
| Credential file not found | Wrong **Credentials folder** or path | Align Settings with where you stored the key |
| 401/403 from API | Bad key, wrong auth type, or browser-only API | Vault path + auth type; avoid session-cookie APIs |
| 400 on path query | Spaces/`@` in query | Ensure latest plugin (URL-encodes `urlTemplate` placeholders) |
| **Shell execution blocked** | Skill tells Claude to run `curl` | Use enricher JSON + `enricher_invocations` instead |
| Answer says “checked API” but no data | Enrichers run after prose | Read **Enricher results** / **Plugin status** |

Optional (trusted environments only): **Claude Code extra CLI args** e.g. `--permission-mode bypassPermissions` if you intentionally allow shell from skills — see USER_GUIDE.

---

## Related docs

- [USER_GUIDE.md](../USER_GUIDE.md) — configuration, registry view, workflows
- [CUSTOM_TYPES_SETUP.md](CUSTOM_TYPES_SETUP.md) — vault YAML entity types
- [README.md](../README.md) — documentation map
