# OIDSF unified ontology (single tree)

**Date:** 2026-04-19  

All entity schemata live in **one** directory: [`schemata/*.yaml`](schemata/) (141 files). Previous splits (`followthemoney/`, `stix2/`, `arkham/`, `oidsf/`) were merged; a read-only snapshot remains under [`_archive_pre_unify_schemata/`](../_archive_pre_unify_schemata/) for diffing.

## Layers (OSINT practice)

| Layer | Purpose | Typical schemata |
|-------|---------|------------------|
| **World** | Actors, assets, places, content | `Thing` → `Person`, `Organization`, `Company`, `Address`, `Event`, `Document`, `SocialPost`, `OnlineAccount`, … |
| **Links** | Interstitial relationships | `Interest` → `Ownership`, `Membership`, `EmploymentPost`, `Authorship`, `Affiliation`, `Citation`, … |
| **Cyber / CTI** | STIX-aligned intel objects | `IntelObject` → `Indicator`, `Malware`, `ThreatActor`, `ObservableArtifact`, `Ipv4Addr`, … |
| **Analysis** | Epistemic and workflow objects | `AnalyticObject` → `Claim`, `Hypothesis`, `ACHMatrix`, `EvidenceChain`, `ProvenanceLink`, … |

**Provenance** at the package level remains [`Artifact` / `Statement` / `EvidenceLink`](MODEL.md)—not duplicated as competing “evidence” entity types; Arkham-style **ClaimEvidence** links claims to references.

## Canonical renames (high level)

| Before | After | Notes |
|--------|-------|--------|
| FtM `Post` | `EmploymentPost` | Employment/position held; use `SocialPost` for social media. |
| FtM `UserAccount` + STIX SCO user-account | `OnlineAccount` | Single merged YAML; optional `account_profile` property. |
| `StixObject` | `IntelObject` | Extends `Thing`; all former STIX types extend `IntelObject`. |
| `StixNote` | `AnalysisNote` | Vs FtM `Note` (general). |
| `StixIdentity` | `IntelIdentity` | Vs FtM `Identification`. |
| `StixReport` | `IntelligenceReport` | |
| `StixLocation` | `GeoLocation` | Vs `Address` (postal/geo string model). |
| `StixBundle` | `CtiBundle` | Transport bundle. |
| `StixArtifactObservable` | `ObservableArtifact` | |
| `StixFileObservable` | `ObservableFile` | |
| `StixProcessObservable` | `ObservableProcess` | |
| `ArkhamClaim` | `Claim` | |
| `Arkham*` (others) | See [`tools/unify_schemata_tree.py`](../tools/unify_schemata_tree.py) `RENAME_SCHEMA` | e.g. `ACHMatrix`, `MirrorProject` (vs FtM `Project`). |

## Inheritance highlights

- **`IntelObject`** extends **`Thing`** — CTI objects participate in the same graph as investigations.
- **`AnalyticObject`** (abstract) — claims/ACH/provenance analysis types.
- **FtM roots** `Thing`, `Interval`, `Interest` retained for Aleph-style interoperability.

## OSINT Copilot mapping (informative)

The Obsidian **OSINT Copilot** plugin bundles FtM-like `BASE_SCHEMAS` and extensions such as `Evidence`, `Credentials`, `PhoneNumber`. Suggested alignment:

| OIDSF unified `schema` | Copilot / UI idea |
|------------------------|-------------------|
| `Person`, `Organization`, `Company` | Same as FtM picker |
| `OnlineAccount` | Maps `Username` + `UserAccount`-style rows |
| `SocialPost` | Social content (not `EmploymentPost`) |
| `Claim`, `ACHMatrix`, `EvidenceChain` | Analytic workspace / future picker entries |
| `Artifact` (JSON stream) | Copilot `Evidence` vault items → export as OIDSF `Artifact` + links |
| `IntelObject` subtree | STIX bundle or cyber workspace |

Colors and picker filters can use YAML `family` comments in tooling (not required in spec).

## Upstream FollowTheMoney

Do **not** copy `followthemoney/schema/` wholesale over `spec/schemata/*.yaml`. Merge release diffs selectively; keep [`VENDOR.md`](schemata/VENDOR.md) checkpoint (tag + date).

## Regenerating from scratch

Historical generators are superseded. To rebuild the unified tree from the archived quad-tree:

1. Restore `spec/schemata/{followthemoney,stix2,arkham,oidsf}/` from [`_archive_pre_unify_schemata/`](../_archive_pre_unify_schemata/).
2. Run `python tools/unify_schemata_tree.py` (moves sources to a new timestamped archive under `oidsf/_archive_pre_unify_schemata/`).
