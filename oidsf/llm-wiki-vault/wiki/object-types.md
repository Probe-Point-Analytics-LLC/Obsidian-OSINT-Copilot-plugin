# Object types (v1)

| Type | Role |
|------|------|
| InvestigationPackage | Manifest: metadata, policy, stream paths, optional `attachments.stix_bundle` |
| Entity | `schema` + multi-valued string `properties`; field definitions in [[../raw/SOURCES.md|YAML schemata]] (`spec/schemata/`), FtM-style |
| Artifact | Captures: URLs, hashes, retrieval metadata |
| Statement | Provenance-backed assertion: subject → value + `artifact_ids` |
| EvidenceLink | `artifact`/`statement` → `entity` with supports/refutes/related |
| SourceAssessment | Structured trust evaluation of artifact or entity |

Interstitial **link entities** (e.g. Affiliation, Authorship) remain **entities** with their own `schema`.
