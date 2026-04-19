# OIDSF Charter

**OSINT Investigation Data Share Format (OIDSF)** — version **1.0.0** (graph-provenance profile)

## Problem statement

Public-interest investigations increasingly rely on open sources, collaborative tooling, and reproducible evidence chains. Practitioners need a **vendor-neutral interchange format** that:

- Represents **investigations as typed graphs** (entities and rich relationships) similar in spirit to FollowTheMoney, but **not** tied to financial-crime or sanctions-first ontologies.
- Carries **provenance**: which artifact supports which fact, with extraction metadata and confidence **without** conflating “we observed this in a source” with “this is true.”
- Supports optional **source trustworthiness** assessments (e.g. Amsterdam Matrix–style structured criteria).
- Allows **optional** hooks to existing standards (STIX for cyber objects, DISARM IDs for influence techniques) without making those the default core.

## Goals

1. **Interoperability**: Exchange investigation data between tools with predictable structure and validation.
2. **Streaming**: Support large graphs via **JSON Lines** streams, not only monolithic JSON.
3. **Provenance-first**: Normative `Statement` / assertion objects bind graph facts to **artifacts** and contributors.
4. **Safety and ethics**: Explicit **sensitivity**, **distribution**, and **redaction** labels at package and object level.
5. **Extensibility**: Namespaced extension properties without breaking the core.

## Non-goals (v1)

1. **Not** a legal chain-of-custody or forensic evidence standard for court admission (unless a future profile explicitly scopes that).
2. **Not** a replacement for STIX/TAXII for pure cyber-threat feeds; OIDSF may **embed or reference** STIX where useful.
3. **Not** a full BPM/workflow engine for the intelligence cycle (lightweight phase tags only, optional later profile).
4. **Not** mandating the full Amsterdam Matrix 23 parameters; assessments may be **partial** and profiled.

## Threat model (design considerations)

| Risk | Mitigation in OIDSF |
|------|---------------------|
| **Misinformation / misinterpretation** | Separate **observed** (artifact, statement) from **analytic** confidence; optional hypotheses/claims profile. |
| **Privacy / harm** | `sensitivity`, `distribution`, PII minimization guidance; redaction labels. |
| **Tampering** | Content hashes on `Artifact`; optional signatures (out of band or future extension). |
| **Ambiguous sharing** | Package-level `policy` block: intended use, license, attribution requirements. |

## Profiles

| Profile ID | Description | Required object types |
|------------|-------------|------------------------|
| **graph-provenance** (v1 default) | Entity graph + artifacts + statements + evidence links + optional source assessments | `InvestigationPackage`, `Entity`, `Artifact`, `Statement`, `EvidenceLink`; optional `SourceAssessment` |
| **epistemic** (future) | Claims, hypotheses, ACH-style matrices | Adds `Claim`, `Hypothesis`, `ACHMatrix` (specified in a later minor version) |
| **influence** (optional) | DISARM and related TTP references | `ExternalRef` on analytic objects; no taxonomy copy in OIDSF |
| **cyber** (optional) | STIX objects | `stix_bundle` attachment or external STIX IDs |

## Versioning rules

- **OIDSF version** uses **SemVer** (`MAJOR.MINOR.PATCH`).
- **Major**: Breaking changes to normative JSON Schema or required fields.
- **Minor**: Additive types, optional fields, new profiles.
- **Patch**: Clarifications, examples, non-breaking schema fixes.
- Every stream record and the package document **must** include `oidsf_version` matching the spec version they conform to (or a stated compatible range in the package `compat` field).

## Governance (lightweight)

- **Normative** artifacts: JSON Schemas under `spec/json-schema/` and this charter.
- **Informative**: Markdown narrative (`MODEL.md`, `SERIALIZATION.md`), examples under `examples/`.
- **Reference validator**: `tools/validator/` validates conforming packages; it is **not** the sole definition of the standard.

## Relationship to other work

- **FollowTheMoney**: Similar streaming and entity shapes; OIDSF uses its **patterns**, not its default schemata. Optional export to FtM remains a tool concern.
- **STIX 2.x**: Optional bundle for cyber-native content; OIDSF package shell remains primary.
- **DISARM**: Reference by stable technique IDs; do not embed full framework text in OIDSF payloads.
