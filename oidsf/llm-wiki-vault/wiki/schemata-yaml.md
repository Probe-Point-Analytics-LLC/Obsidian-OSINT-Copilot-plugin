# YAML schemata (FtM-style, unified)

OIDSF entity types live under `spec/schemata/` as **one YAML file per schema** in a **single flat namespace** (`*.yaml`).

- **FollowTheMoney**-derived types are merged here (no separate `followthemoney/` folder).
- **STIX 2.1**–aligned types extend **`IntelObject`** → **`Thing`** (not a detached `stix2/` island).
- **Arkham**-inspired concepts use global names (**`Claim`**, **`ACHMatrix`**, …) without an `Arkham*` prefix.

**Notable renames:** FtM **`Post`** → **`EmploymentPost`**; FtM **`UserAccount`** + STIX user-account SCO → **`OnlineAccount`**.

Regenerate the unified tree from the four legacy source trees (if present) with `tools/unify_schemata_tree.py`. Refresh FtM from upstream per `spec/schemata/VENDOR.md` (diff against `_archive_pre_unify_schemata/followthemoney/`).

The old `tools/generate_stix_arkham_schemata.py` entry point is **deprecated** (exits with an error message).

See [[unified-ontology]] for the normative merge table and OSINT notes.

See [[../raw/SOURCES.md]] for paths.
