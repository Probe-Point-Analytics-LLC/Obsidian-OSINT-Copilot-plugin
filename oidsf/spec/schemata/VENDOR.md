# FollowTheMoney upstream (post-unification)

OIDSF no longer keeps a live `followthemoney/` subfolder. The vendored snapshot that was merged into the flat tree is preserved under [`../../_archive_pre_unify_schemata/followthemoney/`](../../_archive_pre_unify_schemata/followthemoney/) for three-way diff.

## Updating from alephdata/followthemoney

1. Check out a **release tag** from [followthemoney](https://github.com/alephdata/followthemoney).
2. Diff `followthemoney/schema/*.yaml` against the archive copy.
3. Apply changes manually into the matching flat files in `spec/schemata/` (e.g. `Person.yaml`), preserving OIDSF renames:
   - `Post` → `EmploymentPost` (FtM `Post.yaml` content maps to `EmploymentPost.yaml`).
   - `UserAccount` merged into `OnlineAccount.yaml` (do not reintroduce a separate `UserAccount.yaml`).
4. Record the upstream tag and date in a git commit message or note in [`../UNIFIED_ONTOLOGY.md`](../UNIFIED_ONTOLOGY.md).

Do **not** overwrite the whole `spec/schemata/` directory with upstream without reconciling `RENAME_SCHEMA` in [`tools/unify_schemata_tree.py`](../../tools/unify_schemata_tree.py).
