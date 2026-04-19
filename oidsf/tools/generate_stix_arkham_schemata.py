#!/usr/bin/env python3
"""DEPRECATED — do not use for new work.

Historically this script emitted YAML into `spec/schemata/stix2/`, `arkham/`, and `oidsf/`.
OIDSF now uses a **single flat tree**: `spec/schemata/*.yaml` (see `spec/UNIFIED_ONTOLOGY.md`).

To rebuild the unified tree from the four legacy source directories (e.g. after restoring
from git or `_archive_pre_unify_schemata/`), run:

    python tools/unify_schemata_tree.py

The previous implementation is preserved in git history (pre–unified ontology merge).
"""

from __future__ import annotations

import sys


def main() -> None:
    print(
        "error: generate_stix_arkham_schemata.py is deprecated.\n"
        "  Use: python tools/unify_schemata_tree.py\n"
        "  Doc: spec/UNIFIED_ONTOLOGY.md",
        file=sys.stderr,
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
