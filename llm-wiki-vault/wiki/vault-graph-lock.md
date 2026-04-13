# Vault graph lock

Atomic note: **2026-04-13**

## Behavior

- Locked paths live in plugin settings `lockedVaultPaths` (sorted).
- `VaultLockService` — lock/unlock, rename migration.
- Graph: box select → **Lock area**; multi-graph positions in `graph-positions.json` v2 `byGraph`.
- Editor: preview + unlock modal (`VaultUnlockModal`).
- `EntityManager`, orchestration deletes, `applyVaultFilesV1` respect locks.

## Code

- `src/services/vault-lock-service.ts`
- `src/modals/vault-unlock-modal.ts`
- `main.ts` — hooks, settings
- `src/views/graph-view.ts` — toolbar
