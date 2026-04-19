#!/usr/bin/env python3
"""
Flatten OIDSF schemata to a single tree under spec/schemata/*.yaml
See spec/UNIFIED_ONTOLOGY.md for rename/merge rationale.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
SCHEMATA = ROOT / "spec" / "schemata"
ARCHIVE = ROOT / "_archive_pre_unify_schemata"

RENAME_SCHEMA: dict[str, str] = {
    "Post": "EmploymentPost",
    "UserAccount": "OnlineAccount",
    "StixObject": "IntelObject",
    "StixNote": "AnalysisNote",
    "StixIdentity": "IntelIdentity",
    "StixReport": "IntelligenceReport",
    "StixLocation": "GeoLocation",
    "StixBundle": "CtiBundle",
    "StixArtifactObservable": "ObservableArtifact",
    "StixFileObservable": "ObservableFile",
    "StixProcessObservable": "ObservableProcess",
    "ArkhamObject": "AnalyticObject",
    "ArkhamClaim": "Claim",
    "ArkhamClaimEvidence": "ClaimEvidence",
    "ArkhamHypothesis": "Hypothesis",
    "ArkhamACHEvidence": "ACHEvidenceRow",
    "ArkhamACHRating": "ACHRating",
    "ArkhamACHMatrix": "ACHMatrix",
    "ArkhamEvidenceChain": "EvidenceChain",
    "ArkhamProvenanceLink": "ProvenanceLink",
    "ArkhamTrackedArtifact": "TrackedArtifact",
    "ArkhamMediaAnalysis": "MediaAnalysis",
    "ArkhamTimelineEvent": "TimelineEvent",
    "ArkhamGraphNode": "GraphNode",
    "ArkhamGraphEdge": "GraphEdge",
    "ArkhamSummary": "InvestigationSummary",
    "ArkhamContradiction": "ClaimContradiction",
    "ArkhamCredibilityAssessment": "CredibilityAssessment",
    "ArkhamProject": "MirrorProject",
    "ArkhamDocumentRecord": "CorpusDocument",
    "ArkhamEntityRecord": "ExtractedEntityRecord",
    "ArkhamSearchHit": "SearchHit",
    "ArkhamAnomaly": "AnomalyFinding",
    "ArkhamTemplate": "ReportTemplate",
    "ArkhamPremortemAnalysis": "PremortemAnalysis",
    "ArkhamScenarioTree": "ScenarioTree",
}


def _remap_extends_and_range(body: dict[str, Any]) -> None:
    ext = body.get("extends")
    if isinstance(ext, list):
        body["extends"] = [RENAME_SCHEMA.get(x, x) for x in ext]
    elif isinstance(ext, str):
        body["extends"] = RENAME_SCHEMA.get(ext, ext)

    for prop in (body.get("properties") or {}).values():
        if not isinstance(prop, dict):
            continue
        r = prop.get("range")
        if isinstance(r, str):
            prop["range"] = RENAME_SCHEMA.get(r, r)


def _load_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or len(data) != 1:
        raise ValueError(f"Expected single top-level key in {path}")
    return data


def _merge_online_account(ftm_path: Path, stix_path: Path) -> dict[str, Any]:
    ftm = _load_yaml(ftm_path)
    stix = _load_yaml(stix_path)
    old_ftm = next(iter(ftm))
    old_stix = next(iter(stix))
    base = ftm[old_ftm]
    stix_body = stix[old_stix]
    props = dict(base.get("properties") or {})
    for k, v in (stix_body.get("properties") or {}).items():
        if k not in props:
            props[k] = v
    merged_body: dict[str, Any] = {
        **{kk: vv for kk, vv in base.items() if kk != "properties"},
        "label": "Online account",
        "plural": "Online accounts",
        "description": (
            "Service or platform account (OSINT). Unifies former FtM UserAccount and "
            "STIX 2.1 user-account (SCO) fields."
        ),
        "properties": props,
    }
    merged_body["properties"]["account_profile"] = {
        "label": "Account profile",
        "description": "social_handle | service_credential | stix_sco",
        "type": "string",
    }
    _remap_extends_and_range(merged_body)
    return {"OnlineAccount": merged_body}


def run() -> None:
    subs = ("followthemoney", "stix2", "arkham", "oidsf")
    pre_move: list[Path] = []
    for sub in subs:
        d = SCHEMATA / sub
        if d.is_dir():
            pre_move.extend(sorted(d.glob("*.yaml")))

    if not pre_move:
        raise SystemExit("No source YAML found under spec/schemata/{followthemoney,stix2,arkham,oidsf}/")

    if ARCHIVE.exists():
        shutil.rmtree(ARCHIVE)
    ARCHIVE.mkdir(parents=True)

    for sub in subs:
        src = SCHEMATA / sub
        if src.is_dir():
            shutil.move(str(src), str(ARCHIVE / sub))

    out_dir = SCHEMATA
    written: set[str] = set()

    ftm_ua = ARCHIVE / "followthemoney" / "UserAccount.yaml"
    stix_ua = ARCHIVE / "stix2" / "StixUserAccountObservable.yaml"
    if ftm_ua.is_file() and stix_ua.is_file():
        merged = _merge_online_account(ftm_ua, stix_ua)
        (out_dir / "OnlineAccount.yaml").write_text(
            yaml.safe_dump(merged, default_flow_style=False, allow_unicode=True, sort_keys=False),
            encoding="utf-8",
        )
        written.add("OnlineAccount.yaml")

    skip_names = {"UserAccount.yaml", "StixUserAccountObservable.yaml"}

    for src in pre_move:
        if src.name in skip_names:
            continue
        arc = ARCHIVE / src.parent.name / src.name
        if not arc.is_file():
            continue
        data = _load_yaml(arc)
        old_key = next(iter(data))
        body = data[old_key]
        if not isinstance(body, dict):
            raise ValueError(f"Bad body for {arc}")
        new_key = RENAME_SCHEMA.get(old_key, old_key)
        _remap_extends_and_range(body)
        out = {new_key: body}
        out_name = f"{new_key}.yaml"
        out_path = out_dir / out_name
        if out_path.name in written:
            raise RuntimeError(f"Duplicate output {out_path} from {arc}")
        out_path.write_text(
            yaml.safe_dump(out, default_flow_style=False, allow_unicode=True, sort_keys=False),
            encoding="utf-8",
        )
        written.add(out_path.name)

    n = len(list(out_dir.glob("*.yaml")))
    print(f"Wrote {n} schema files to {out_dir}")


if __name__ == "__main__":
    run()
