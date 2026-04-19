# OSINT Investigation Data Share Format (OIDSF)

OIDSF **1.0.0** is a vendor-neutral interchange format for **public-interest investigations**, combining:

- A **FollowTheMoney-inspired** entity graph (typed `schema`, multi-valued `properties`, JSONL streams).
- **Provenance** via `Statement` objects and `EvidenceLink` records tied to `Artifact` captures.
- Optional **source trustworthiness** structures (`SourceAssessment`) compatible with frameworks such as the Amsterdam Matrix (partial parameters allowed).
- Optional **STIX 2** bundle attachment and **DISARM** technique id strings on entities (see [`spec/MODEL.md`](spec/MODEL.md)).

## Layout

| Path | Purpose |
|------|---------|
| [`spec/CHARTER.md`](spec/CHARTER.md) | Goals, non-goals, threat model, profiles, versioning |
| [`spec/MODEL.md`](spec/MODEL.md) | Normative object descriptions |
| [`spec/SERIALIZATION.md`](spec/SERIALIZATION.md) | `package.json` manifest + JSONL stream rules |
| [`spec/schemata/*.yaml`](spec/schemata/) | **YAML registry:** single unified tree (FtM + STIX + extensions); see [`spec/UNIFIED_ONTOLOGY.md`](spec/UNIFIED_ONTOLOGY.md) |
| [`spec/schemata/VENDOR.md`](spec/schemata/VENDOR.md) | How to refresh vendored FollowTheMoney YAML |
| [`spec/registry/README.md`](spec/registry/README.md) | Short summary + merge notes |
| [`spec/json-schema/`](spec/json-schema/) | JSON Schema (Draft 2020-12) |
| [`examples/`](examples/) | Two round-tripped example packages |
| [`tools/validator/`](tools/validator/) | Reference Python validator |

## Validate an example package

```bash
python3 -m venv .venv
.venv/bin/pip install -r tools/validator/requirements.txt
.venv/bin/python tools/validator/validate.py examples/influence-operation-slice
.venv/bin/python tools/validator/validate.py examples/geo-accountability
```

## Profiles (v1)

The default **graph-provenance** profile requires streams: `entities`, `artifacts`, `statements`, `evidence_links`. Optional: `source_assessments`.

## License

Specification text and schemas: dedicate to public domain or follow your project’s license; example data is illustrative and synthetic.
