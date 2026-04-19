# OIDSF maintainer notes (LLM wiki)

## Ingest

- Canonical spec: [`../spec/CHARTER.md`](../spec/CHARTER.md), [`../spec/MODEL.md`](../spec/MODEL.md), [`../spec/SERIALIZATION.md`](../spec/SERIALIZATION.md).
- Machine validation: JSON Schemas in [`../spec/json-schema/`](../spec/json-schema/), reference CLI [`../tools/validator/validate.py`](../tools/validator/validate.py).

## Query

- Start at [`wiki/index.md`](wiki/index.md).
- Examples: [`../examples/`](../examples/).

## Lint / consistency

- Entity schemata: flat `spec/schemata/*.yaml` (unified ontology); run [`../tools/unify_schemata_tree.py`](../tools/unify_schemata_tree.py) only when rebuilding from the four legacy trees.
- After changing schemas, run the validator against both example packages.
- Bump `oidsf_version` in charter and schemas when making breaking changes.

## Last updated

- 2026-04-18: Unified schemata tree (`UNIFIED_ONTOLOGY.md`); validator loads `spec/schemata/*.yaml` only.
- 2026-04-18: Initial OIDSF 1.0.0 graph-provenance profile.
