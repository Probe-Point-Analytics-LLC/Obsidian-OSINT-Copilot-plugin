# Multi-schema catalog (FTM, STIX2, MITRE, user YAML)

Last updated: 2026-04-13

## Summary

- `SchemaCatalogService` merges **bundled FTM** (plus `CustomTypesService` registrations) with vault YAML under `OSINTCopilot/schemas/{stix2,mitre,user}/`.
- Plugin settings persist `enabledSchemaFamilies` (FTM, STIX2, MITRE, user); entity and connection pickers filter the union.
- New entities use paths `OSINTCopilot/<schemaFamily>/<type>/`; legacy flat `OSINTCopilot/<type>/` loads as FTM when `schemaFamily` is absent in frontmatter.
- `VaultAIPlugin.getGraphEntityVisual` resolves node color from the catalog for the graph view.

## Code

- `src/services/schema-catalog-service.ts` — catalog rebuild, `listEntityTypes` / `listRelationshipTypes`
- `src/services/schema-definition-loader.ts` — YAML parsing
- `src/services/schema-bootstrap-service.ts` — default files under `schemas/`
- `src/services/entity-manager.ts` — `createCatalogEntity`, family-scoped folders, `schemaFamily` frontmatter
- `main.ts` — settings, vault watchers on `schemas/` for debounced rebuild

## See also

- `OSINTCopilot/schemas/README.md` (vault, after bootstrap)
- [[vault-graph-lock]]
