# Release notes

## Unreleased (main branch, after v2.5.6)

- **Codex on Flatpak**: automatically use Codex's read-only Landlock backend so CLI tools work without nested-Bubblewrap namespace failures.
- **Runtime resilience**: ignore late unified-agent progress callbacks after switching conversations, and avoid false bootstrap warnings when filesystem status is temporarily inconclusive.
- **Plugin layout**: thin `main.ts` re-export; core logic in `src/plugin/vault-ai-plugin.ts` and modular views.
- **Tools & skills registry**: dedicated ItemView (ribbon **layout-list**); collapsible built-in tools reference; graph icons keyed by entity identity.
- **OSINT views**: chat, registry, graph, timeline, and map group as tabs in one strip where supported.
- **Vault scripts**: unified agent can propose `upsert_script` / `delete_script` with side-by-side diff in chat (scripts are not executed inside Obsidian).

## 2.5.6

- **HTTP enrichers (self-add)**: draft enrichers from API documentation; **Install** / **Cancel** before vault writes; agent `upsert_enricher` via `custom_vault_operations` with JSON preview in chat.
- **Enricher execution**: `enricher_invocations` in unified JSON; HTTP via Obsidian `requestUrl`; registered enricher ids injected into the agent prompt.
- **Enricher fixes**: `query_vault` auth; URL-encoded `{{query}}` in `urlTemplate`; clearer credential errors and auth-downgrade warnings; vault log augmentation under `prompts/logs/`.
- **URL extraction**: quieter failures, 401/403 guidance, deduplicated chat links.
- **Legacy orchestration removed**: chat always uses the unified agent path (except **Vault graph ingest**); planner UI and `unifiedAgentOrchestration` / skill-toggle settings removed.
- **Timeline**: case-insensitive **Event** type matching; additional date property aliases; auto-refresh after entity-path saves.

## 2.5.5

- **Agent runtime**: Claude remains default; register multiple **custom CLI runtimes** in Settings; chat header **runtime dropdown** lists all healthy runtimes (Claude, Hermes, custom).
- **Settings UX**: runtime-specific fields shown only for the selected runtime (Hermes args, custom path/timeout, Claude extraction block).

## 2.5.4

- **Custom types documentation**: `docs/CUSTOM_TYPES_SETUP.md` and README cross-links for vault YAML entity/relationship types.
- **Docs polish**: BRAT-first install checklist, unified-runtime vs local-views summary, extraction-log settings documented.

## 2.5.3

- **Duplicate-key YAML fix**: entity frontmatter serialization now protects reserved keys (`id`, `type`, `label`, schema/osint keys). If a property collides (for example `type`), it is written under `props.<key>` instead of duplicating top-level YAML keys.
- **Backward-compatible parsing**: `frontmatter.props` is merged back into `entity.properties` so existing and migrated notes both load.
- **Migration command**: added **Normalize entity frontmatter reserved keys (props namespace)** to rewrite existing entity notes safely.
- **Tests**: added regression coverage for serialization and parse behavior.

## 2.5.2

- **Visible extraction logs in chat**: attachment/image extraction now emits structured Claude CLI events and displays them in an expandable **Extraction logs** panel.
- **Configurable diagnostics**: added settings `Extraction log verbosity` (`minimal`/`detailed`) and `Extraction debug: raw CLI output`.
- **Safer default output**: CLI snippets shown in chat are sanitized/truncated unless raw debug mode is enabled.

## 2.4.1

- **Graph workspaces (Electron)**: Replace unsupported `window.prompt()` with an Obsidian modal for **+ new** graph workspace. Delete workspace uses `ConfirmModal` instead of `confirm()`.

## 2.4.0

- **Vault graph lock**: Box-select entities and relationships in the graph, then **Lock area** to mark those notes read-only until unlocked (editor unlock button or Settings).
- **Editor UX**: Locked notes open in preview; unlock via toolbar control or **Unlock all** in plugin settings.
- **Agents**: Orchestration and task agents skip writes to locked paths; graph delete commands respect locks.
- **Multi-graph workspaces**: Toolbar dropdown for separate saved layouts; positions stored in `graph-positions.json` as versioned `byGraph` (legacy flat file is migrated automatically).
