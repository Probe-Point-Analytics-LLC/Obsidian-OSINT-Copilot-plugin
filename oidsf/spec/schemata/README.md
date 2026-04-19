# OIDSF entity schemata (unified)

All definitions are **flat** YAML files in this directory: **`*.yaml`** (one top-level schema key per file).

- **No subfolders** — one coherent namespace (see [`../UNIFIED_ONTOLOGY.md`](../UNIFIED_ONTOLOGY.md)).
- **FollowTheMoney** upstream was merged here; **STIX 2.1** types extend `IntelObject` (which extends `Thing`). **Arkham**-inspired types use names like `Claim`, `ACHMatrix` (no `Arkham*` prefix).
- **Merge highlight:** `OnlineAccount` unifies former FtM `UserAccount` and STIX `user-account` SCO fields. **`EmploymentPost`** replaces FtM `Post` (employment); **`SocialPost`** is OSINT social content.

## Archives

Prior quad-tree snapshots for diffing: [`../../_archive_pre_unify_schemata/`](../../_archive_pre_unify_schemata/).

## Maintenance

- **Rebuild unified tree** (after restoring the four source dirs under `spec/schemata/`): run [`../../tools/unify_schemata_tree.py`](../../tools/unify_schemata_tree.py).
- **FtM upstream:** see [`VENDOR.md`](VENDOR.md).

## Type vocabulary

Property `type` values follow FtM conventions (`name`, `text`, `url`, `entity`, `country`, `identifier`, …).
