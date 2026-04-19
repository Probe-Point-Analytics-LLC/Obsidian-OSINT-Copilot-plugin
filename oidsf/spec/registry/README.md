# OIDSF Schema Registry (summary)

**Authoritative definitions** are the YAML files under [`../schemata/*.yaml`](../schemata/) — **one unified namespace** (no `followthemoney/`, `stix2/`, `arkham/`, `oidsf/` subfolders). See [`../UNIFIED_ONTOLOGY.md`](../UNIFIED_ONTOLOGY.md) for layers, renames, and merge rules.

This file is a **high-level index** only; the YAML files are source of truth.

## OIDSF-oriented highlights (merge notes)

| Schema | Role |
|--------|------|
| **SocialPost** | Public social content. **`EmploymentPost`** replaces FtM employment **`Post`** (avoid overloading “post”). |
| **OnlineAccount** | Union of former FtM `UserAccount` and STIX `user-account` SCO fields. |
| **Domain** | DNS / hostname node. |
| **Authorship** | `owner`/`asset` link for author → work. |
| **Citation** | Citing source → cited source. |
| **Affiliation** | Generic `owner`/`asset` dyadic link; use **Membership** when strictly member ↔ organization. |
| **IntelObject** | Abstract root for STIX-aligned types (extends **Thing**). |

## DISARM (optional)

On **SocialPost**, **Event**, or **Organization**, optional `disarmTechniqueIds` string arrays (see `SocialPost.yaml`, FtM entities extended via same property name where needed).

## FtM + CTI (informative)

Core FtM schemata remain in the flat tree with OIDSF renames where needed (**EmploymentPost**, **OnlineAccount**). STIX-aligned types share `IntelObject` → `Thing` with discriminating names (e.g. **AnalysisNote**, **ObservableFile**).
