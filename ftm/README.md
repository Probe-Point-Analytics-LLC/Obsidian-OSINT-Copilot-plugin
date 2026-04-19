# Deprecated folder

FollowTheMoney-style YAML **reference copies** used to live here. The **canonical** bundled schemata for the plugin are now the **OIDSF unified ontology**:

- [`../oidsf/spec/schemata/`](../oidsf/spec/schemata/) — YAML sources
- [`../scripts/generate-oidsf-schemas.cjs`](../scripts/generate-oidsf-schemas.cjs) — codegen into `src/generated/oidsfBundledSchemas.ts`

Run `npm run generate:schemas` (or `npm run build`) after changing OIDSF YAML.

Do not add new `.yaml` files to this `ftm/` folder.
