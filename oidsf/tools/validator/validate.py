#!/usr/bin/env python3
"""
OIDSF reference validator: JSON Schema + cross-reference checks for an investigation package directory.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry
from referencing.jsonschema import DRAFT202012, Resource

REQUIRED_STREAM_KEYS = ("entities", "artifacts", "statements", "evidence_links")

STREAM_SCHEMA = {
    "entities": "entity.json",
    "artifacts": "artifact.json",
    "statements": "statement.json",
    "evidence_links": "evidence-link.json",
    "source_assessments": "source-assessment.json",
}


def _schema_dir() -> Path:
    return Path(__file__).resolve().parent.parent.parent / "spec" / "json-schema"


def _schemata_dir() -> Path:
    return Path(__file__).resolve().parent.parent.parent / "spec" / "schemata"


def _load_yaml_entity_schema_names() -> set[str]:
    """Top-level keys from spec/schemata/*.yaml (single unified tree; no subfolders)."""
    names: set[str] = set()
    for path in sorted(_schemata_dir().glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            continue
        for key in data.keys():
            names.add(key)
    return names


def _load_abstract_schema_names() -> set[str]:
    out: set[str] = set()
    for path in sorted(_schemata_dir().glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            continue
        for name, body in data.items():
            if isinstance(body, dict) and body.get("abstract") is True:
                out.add(name)
    return out


def _yaml_extends_warnings() -> list[str]:
    """Ensure every extends parent exists as a schema name."""
    w: list[str] = []
    names = _load_yaml_entity_schema_names()
    for path in sorted(_schemata_dir().glob("*.yaml")):
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception as e:
            w.append(f"{path.name}: invalid YAML: {e}")
            continue
        if not isinstance(data, dict):
            continue
        for sname, body in data.items():
            if not isinstance(body, dict):
                continue
            ext = body.get("extends")
            if isinstance(ext, list):
                for parent in ext:
                    if isinstance(parent, str) and parent not in names:
                        w.append(f"schema {sname}: extends unknown parent {parent!r} ({path.name})")
            elif isinstance(ext, str) and ext not in names:
                w.append(f"schema {sname}: extends unknown parent {ext!r} ({path.name})")
    return w


def _load_registry() -> Registry:
    base = _schema_dir()
    registry: Registry = Registry()
    for path in sorted(base.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        uri = raw.get("$id")
        if not uri:
            raise ValueError(f"Schema missing $id: {path}")
        resource = Resource.from_contents(raw, default_specification=DRAFT202012)
        registry = registry.with_resource(uri, resource)
    return registry


def _validator_for_schema(schema_name: str, registry: Registry) -> Draft202012Validator:
    uri = f"https://oidsf.dev/schema/{schema_name}"
    return Draft202012Validator({"$ref": uri}, registry=registry)


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.is_file():
        return rows
    with path.open(encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                raise ValueError(f"{path}:{line_no}: invalid JSON: {e}") from e
            if not isinstance(obj, dict):
                raise ValueError(f"{path}:{line_no}: line must be a JSON object")
            rows.append(obj)
    return rows


def _collect_ids(stream_key: str, rows: list[dict[str, Any]]) -> set[str]:
    ids: set[str] = set()
    for r in rows:
        i = r.get("id")
        if not isinstance(i, str):
            raise ValueError(f"Stream {stream_key}: record missing string id")
        if i in ids:
            raise ValueError(f"Stream {stream_key}: duplicate id {i!r}")
        ids.add(i)
    return ids


def validate_package(root: Path) -> list[str]:
    """
    Validate package at `root` (directory containing package.json).
    Returns a list of warning strings (empty if none).
    """
    warnings: list[str] = []
    manifest_path = root / "package.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Missing package manifest: {manifest_path}")

    registry = _load_registry()
    pkg_raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    pkg_validator = _validator_for_schema("investigation-package.json", registry)
    pkg_validator.validate(pkg_raw)

    if pkg_raw.get("oidsf_version") != "1.0.0":
        warnings.append(
            f"oidsf_version is {pkg_raw.get('oidsf_version')!r}; reference examples use 1.0.0"
        )

    warnings.extend(_yaml_extends_warnings())

    streams = pkg_raw.get("streams") or {}
    for key in REQUIRED_STREAM_KEYS:
        if key not in streams:
            raise ValueError(f"Missing required stream key in package.streams: {key!r}")

    # Load all rows
    loaded: dict[str, list[dict[str, Any]]] = {}
    ids_by_stream: dict[str, set[str]] = {}
    for key, relpath in streams.items():
        path = (root / relpath).resolve()
        if not str(path).startswith(str(root.resolve())):
            raise ValueError(f"Stream path escapes root: {relpath}")
        rows = _read_jsonl(path)
        loaded[key] = rows
        ids_by_stream[key] = _collect_ids(key, rows) if rows else set()

    # Schema-validate each stream
    for key, rows in loaded.items():
        schema_file = STREAM_SCHEMA.get(key)
        if not schema_file:
            warnings.append(f"Unknown stream key (skipped): {key!r}")
            continue
        val = _validator_for_schema(schema_file, registry)
        for i, row in enumerate(rows):
            try:
                val.validate(row)
            except Exception as e:
                raise ValueError(f"{streams[key]} line {i+1}: {e}") from e

    # Entity schema names vs YAML registry (optional warnings)
    yaml_schemas = _load_yaml_entity_schema_names()
    abstract_schemas = _load_abstract_schema_names()
    for row in loaded.get("entities", []):
        sch = row.get("schema")
        if not isinstance(sch, str):
            continue
        if sch.startswith("x_"):
            continue
        if sch not in yaml_schemas:
            warnings.append(
                f"entity {row.get('id')}: schema {sch!r} not found under spec/schemata/*.yaml"
            )
        elif sch in abstract_schemas:
            warnings.append(
                f"entity {row.get('id')}: schema {sch!r} is abstract in YAML; prefer a concrete subtype"
            )

    # Cross-references
    ent_ids = ids_by_stream.get("entities", set())
    art_ids = ids_by_stream.get("artifacts", set())
    stmt_ids = ids_by_stream.get("statements", set())

    for row in loaded.get("statements", []):
        subj = row.get("subject") or {}
        if subj.get("type") == "entity_property":
            eid = subj.get("entity_id")
            if eid not in ent_ids:
                warnings.append(f"statement {row.get('id')}: entity_id {eid!r} not found in entities")
        elif subj.get("type") == "entity_edge":
            lid = subj.get("link_entity_id")
            if lid not in ent_ids:
                warnings.append(
                    f"statement {row.get('id')}: link_entity_id {lid!r} not found in entities"
                )
        for aid in row.get("artifact_ids") or []:
            if aid not in art_ids:
                warnings.append(f"statement {row.get('id')}: artifact_id {aid!r} not in artifacts")

    for row in loaded.get("evidence_links", []):
        fr = row.get("from_ref") or {}
        to = row.get("to_ref") or {}
        if fr.get("kind") == "artifact" and fr.get("id") not in art_ids:
            warnings.append(f"evidence_link {row.get('id')}: from artifact {fr.get('id')!r} missing")
        if fr.get("kind") == "statement" and fr.get("id") not in stmt_ids:
            warnings.append(f"evidence_link {row.get('id')}: from statement {fr.get('id')!r} missing")
        if to.get("kind") == "entity" and to.get("id") not in ent_ids:
            warnings.append(f"evidence_link {row.get('id')}: to entity {to.get('id')!r} missing")

    for row in loaded.get("source_assessments", []):
        sr = row.get("subject_ref") or {}
        if sr.get("kind") == "artifact" and sr.get("id") not in art_ids:
            warnings.append(f"source_assessment {row.get('id')}: artifact {sr.get('id')!r} missing")
        if sr.get("kind") == "entity" and sr.get("id") not in ent_ids:
            warnings.append(f"source_assessment {row.get('id')}: entity {sr.get('id')!r} missing")

    return warnings


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate OIDSF investigation package directory")
    ap.add_argument("root", type=Path, help="Directory containing package.json")
    args = ap.parse_args()
    root = args.root.resolve()
    try:
        warnings = validate_package(root)
    except Exception as e:
        print(f"VALIDATION FAILED: {e}", file=sys.stderr)
        return 1
    print(f"OK: {root}")
    for w in warnings:
        print(f"WARNING: {w}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
