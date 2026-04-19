# OIDSF Serialization

## Document encoding

- **UTF-8** without BOM for all JSON and JSONL files.
- **MIME** suggestion for packages: `application/x-oidsf+json` for the manifest (not registered; informative).

## Investigation package manifest

Single JSON file, conventionally named **`package.json`** at the root of an OIDSF bundle (directory) or referenced as the entry when exchanging a ZIP.

### Required fields

| Field | Type | Description |
|-------|------|-------------|
| `oidsf_version` | string | SemVer, e.g. `1.0.0` |
| `kind` | string | Constant `"oidsf.investigation_package"` |
| `id` | string | Unique investigation id (URI recommended) |
| `title` | string | Human title |
| `streams` | object | Map of logical stream name → relative file path |

### Streams (graph-provenance profile)

| Stream key | File convention | Record type |
|------------|-----------------|-------------|
| `entities` | `entities.jsonl` | Entity |
| `artifacts` | `artifacts.jsonl` | Artifact |
| `statements` | `statements.jsonl` | Statement |
| `evidence_links` | `evidence_links.jsonl` | EvidenceLink |
| `source_assessments` | `source_assessments.jsonl` | SourceAssessment (optional) |

Each line in a `.jsonl` file is one JSON object **without** a wrapper; the file name determines the expected schema (validator loads path from manifest).

### Optional attachments

| Field | Description |
|-------|-------------|
| `attachments.stix_bundle` | JSON object: STIX 2 bundle (`type: bundle` + `objects` array) when cyber profile is used |
| `attachments.notes` | Free-form implementer notes (string) |

### Compatibility

| Field | Description |
|-------|-------------|
| `compat` | Optional `{ "min_version": "1.0.0", "max_version": "1.x.x" }` |

## JSON Lines rules

1. One record per line; no pretty-printing inside lines.
2. Line order is not semantically required; IDs are authoritative.
3. For deterministic tooling, sort by `id` ascending (recommended, FtM-style).

## ID conventions

- Prefer **opaque** ids: `urn:oidsf:...`, `https://...`, or prefixed random ids (`ent_`, `art_`, `stmt_`, `ev_`, `sa_`).
- **Reference integrity**: every `entity_id`, `artifact_id`, etc. must resolve to a record in the corresponding stream when that stream is present in the package.

## Validation levels

1. **Schema**: each file validates against JSON Schema.
2. **Cross-reference**: no dangling ids between streams.
3. **Policy** (optional): package `distribution` vs object-level rules (warning-only in reference validator).
