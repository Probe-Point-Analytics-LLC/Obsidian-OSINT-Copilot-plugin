# Graph workspace membership

Last updated: 2026-04-13

## Behavior

- **`default` workspace**: The graph shows **all** vault entities (and legacy unknown-node handling for broken edges).
- **Any other workspace**: Only entities whose id appears in **`graph-positions.json` v2 `byGraph[workspaceId]`** are drawn. Membership equals saved position keys for that slice — a **new** workspace starts with an **empty** slice, so the canvas is empty until entities are added (which records a position in the cache and persists it).

## Implementation

- `GraphView.getEntitiesForActiveWorkspace()` filters `EntityManager.getGraphData().entities` using `nodePositionsCache` keys when not on `default`.
- Connections are included only when **both** endpoints are in the visible entity set.

## Related

- [[multi-schema-catalog]] — entity/connection type pickers (per schema family)
