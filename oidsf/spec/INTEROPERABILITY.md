# OIDSF Interoperability (informative)

## FollowTheMoney (FtM)

- **Entities**: Map OIDSF `Entity` lines to FtM entities when `schema` names and properties overlap (e.g. `Person`, `Organization`, `Document`).
- **Statements**: FtM’s statement model tracks per-value provenance; OIDSF `Statement` is a simplified assertion record—use ETL to convert when importing into Aleph/OpenSanctions-style pipelines.
- **Streams**: Both ecosystems can use JSONL; OIDSF stream types are **split by file** (`entities.jsonl`, …) whereas FtM often uses a single mixed stream—merge with care.

## STIX 2.x

- **When to use**: Cyber observables, indicators, malware objects, or sharing with TAXII-compatible tools.
- **How**: Set `InvestigationPackage.attachments.stix_bundle` to a STIX 2 `bundle` object. OIDSF does not duplicate STIX semantics; keep cyber-native detail in STIX.
- **YAML schemata**: Under `spec/schemata/*.yaml` — STIX-aligned types extend **`IntelObject`** (which extends **`Thing`**). Collisions with FtM were resolved with unified names (e.g. **AnalysisNote**, **CtiBundle**, **ObservableFile**); see [`UNIFIED_ONTOLOGY.md`](UNIFIED_ONTOLOGY.md).
- **Cross-links**: Optionally duplicate key ids in OIDSF `Artifact.hashes` or entity properties for search.

*(Note: the standard is **STIX**, not “STYX”.)*

## DISARM

- **When to use**: Influence operations, information operations analysis.
- **How**: Use string arrays on relevant entities (e.g. `disarmTechniqueIds` in `properties`) with stable DISARM IDs. Do not paste full technique descriptions in OIDSF payloads if they can be referenced.

## Amsterdam Matrix

- **How**: Represent evaluations as `SourceAssessment` with `pillars.*.parameters` keyed by short codes your team defines; include `rationale` strings for auditability.

## MITRE ATT&CK

- Not embedded in OIDSF 1.0. If needed, use similar pattern to DISARM: external ID strings in `properties` or a future `ExternalRef` extension.
