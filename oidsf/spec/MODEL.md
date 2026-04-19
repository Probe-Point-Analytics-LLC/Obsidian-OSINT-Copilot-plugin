# OIDSF Core Model (normative narrative)

OIDSF **1.0.0** defines the **graph-provenance** profile. Objects are JSON-serializable; the authoritative **record shapes** are the JSON Schemas in [`json-schema/`](json-schema/). **Entity types, properties, inheritance, and labels** follow FollowTheMoney-style YAML schemata in [`schemata/*.yaml`](schemata/) (single unified tree; see [`UNIFIED_ONTOLOGY.md`](UNIFIED_ONTOLOGY.md)).

## 1. InvestigationPackage

Top-level document describing one shareable investigation (or a slice of it).

- **Identity**: `id` (URI or URN), `title`, `summary`, `created`, `modified`.
- **Scope**: `topics`, `time_range`, `jurisdiction` (optional strings).
- **Contributors**: `contributors[]` with `name`, `role`, `organization_id` (optional).
- **Policy**: `data_policy` — `license`, `attribution`, `intended_use`, `distribution` (enum).
- **Streams**: paths (relative to package root) for JSONL files listed in `streams` (see SERIALIZATION.md).
- **Attachments**: optional `stix_bundle` (STIX 2 JSON object) for cyber profile; `external_refs` for opaque pointers.

## 2. Entity

FtM-inspired: `id`, `schema` (string, from the OIDSF YAML registry), `properties` (object: keys → array of strings, multi-valued). Allowed `schema` names and their property definitions are in [`schemata/*.yaml`](schemata/) (see [`schemata/README.md`](schemata/README.md)).

- **References**: property values that point to other entities use the same string ID as FtM (`entity` logical type in YAML: `type: entity`, optional `range:`).
- **Interstitial entities**: relationships with their own attributes (e.g. `Affiliation`, `Membership`) are **entities** whose schema extends **`Interest`** / **`Interval`** in YAML (FtM pattern), not a separate edge table.

## 3. Artifact

Represents a retrievable or stored source unit.

- **Identity**: `id`, optional `url`, `retrieved_at`, `title`, `mime_type`.
- **Integrity**: `hashes` — map of algorithm → hex string (e.g. `sha256`).
- **Capture**: `capture_method` (e.g. `http_get`, `archive_org`, `manual_upload`, `api`).
- **Storage**: `storage_hint` (opaque URI or path token for implementers).
- **sensitivity** / **distribution**: enums aligned with package policy.

## 4. Statement

Binds a **subject** to a **value** with provenance. This is the primary “fact line” object.

- **id**, **subject**: one of:
  - `entity_property`: `{ "entity_id", "property" }`
  - `entity_edge` (optional in 1.0): `{ "link_entity_id" }` for interstitial link entities
- **value**: string (atomic assertion at OIDSF 1.0).
- **artifact_ids[]**: supporting artifacts.
- **asserted_by**: contributor id or free-text agent id.
- **confidence**: `0.0`–`1.0` (analytic confidence in the assertion, not source truth).
- **extracted_at**, **extraction_method** (e.g. `manual`, `ocr`, `llm`, `import`).

Statements are **not** automatically “true”; they record what the investigation asserts and why.

## 5. EvidenceLink

Connects provenance to the graph or to future epistemic objects.

- **id**
- **from_ref**: `artifact_id` or `statement_id`
- **to_ref**: `entity_id` or (future) `claim_id`
- **relationship**: `supports` | `refutes` | `related`
- **strength**: `strong` | `moderate` | `weak`
- **notes** (optional)

## 6. SourceAssessment

Structured trustworthiness evaluation of an **artifact** or **entity** (e.g. social account).

- **id**, **subject_ref** (`artifact_id` or `entity_id`)
- **assessed_at**, **assessor** (contributor id)
- **pillars** (optional keys): `data_information_sources`, `argumentation`, `communication_style`, `community` — each may contain:
  - **parameters**: map of string code → `{ "score": number|null, "rationale": string }`
- **overall_trust** (optional): `reliable` | `neutral` | `unreliable` | `unknown`

OIDSF does **not** mandate Amsterdam Matrix codes; implementers may use `parameters` keys that align with that framework.

## Interoperability hooks

### FollowTheMoney (FtM)

- **Entity** shapes are intentionally similar. Mapping: OIDSF `schema` + `properties` → FtM `schema` + `properties` where schemas exist in both systems.
- **Statement** ↔ FtM **statements** model: map OIDSF `Statement` to FtM statement records where tooling supports it; OIDSF allows fewer mandatory fields.

### STIX 2.x

- Use **cyber profile**: include STIX objects in `InvestigationPackage.attachments.stix_bundle` or sidecar file referenced in package.
- Cross-link: `ExternalRef` pattern — `{ "system": "stix", "id": "indicator--..." }` on entities or statements (optional extension field `external_refs[]` on selected types — use `extensions` namespace in 1.0: `x_stix_refs` array on package or entity).

**Normative minimal hook in 1.0**: Package MAY include `attachments: { "stix_bundle": { ... } }` as arbitrary JSON; validator only checks it is JSON object if present.

### DISARM

- Store **technique IDs** as strings in `extensions` or in `Entity.properties` with schema `InfluenceTechniqueRef` (registry) e.g. property `disarmTechniqueIds`: `["T001", ...]`.
- Prefer **references** over copying definitions.

## Intelligence cycle (informative)

Optional property on package or entities: `intel_phase` = `planning` | `collection` | `processing` | `analysis` | `dissemination` for lightweight tagging (not normative in 1.0).
