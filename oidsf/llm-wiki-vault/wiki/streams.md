# Streams

- Entry: `package.json` with `kind: oidsf.investigation_package` and `streams` map.
- JSONL files: one JSON object per line; stream type implied by manifest key (`entities`, `artifacts`, `statements`, `evidence_links`, `source_assessments`).
- Reference validator enforces schema + ID cross-references.

See [[../raw/SOURCES.md]] for `SERIALIZATION.md`.
