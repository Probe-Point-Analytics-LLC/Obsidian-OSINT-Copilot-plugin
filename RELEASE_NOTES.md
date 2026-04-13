# Release notes

## 2.4.0

- **Vault graph lock**: Box-select entities and relationships in the graph, then **Lock area** to mark those notes read-only until unlocked (editor unlock button or Settings).
- **Editor UX**: Locked notes open in preview; unlock via toolbar control or **Unlock all** in plugin settings.
- **Agents**: Orchestration and task agents skip writes to locked paths; graph delete commands respect locks.
- **Multi-graph workspaces**: Toolbar dropdown for separate saved layouts; positions stored in `graph-positions.json` as versioned `byGraph` (legacy flat file is migrated automatically).
