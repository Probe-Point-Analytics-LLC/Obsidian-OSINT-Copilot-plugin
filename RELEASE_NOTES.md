# Release notes

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
