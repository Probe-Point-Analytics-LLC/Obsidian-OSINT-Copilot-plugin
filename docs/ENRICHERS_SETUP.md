# HTTP enrichers — setup and constraints

Vault path (default): `OSINTCopilot/custom/enrichers/*.json` (see plugin **Enrichers folder** setting).

## How the plugin runs HTTP

Enricher requests use **Obsidian `requestUrl`**, the same unrestricted outbound HTTP path as other plugin features. They do **not** run in your normal browser tab, so they do **not** send your site login cookies and are not a place for “open this webmail print URL” style flows.

When **drafting** specs (command **Draft HTTP enricher skill from API documentation**, or unified-agent **`upsert_enricher`**), assume:

- **`allowedDomains`** lists every hostname used in `request.urlTemplate` (the API origin, not only the documentation host).
- **Auth**: use `bearer_vault` / `header_vault` / `query_vault` with `vaultRelativePath` under the vault credentials folder for secrets; never put API keys in JSON or chat.
- **Templates**: `{{query}}` and `{{attachments_context}}` in `urlTemplate` / `bodyTemplate`. The plugin **URL-encodes** those values when building `urlTemplate` (needed for path segments like `.../query/{{query}}` when the query contains spaces or `@`). **`bodyTemplate`** uses **raw** substitution so JSON bodies stay valid.
- **Avoid** APIs that only work behind a **browser session** the plugin cannot reproduce.

## Operator checklist

1. Confirm `id` matches what you pass as `enricher_id` in unified chat.
2. After edits, reload or wait for vault events; use **Apply selected** if the agent proposed `upsert_enricher`.
3. If calls fail, verify domain allowlist, auth file path, and that the API supports token/header style access.

See **USER_GUIDE.md** → HTTP enrichers for unified chat behavior (`enricher_invocations`, Bash vs enrichers).
