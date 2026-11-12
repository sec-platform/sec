#!/usr/bin/env python3
"""Replay 2026-11-08 *finite design models*; never calls Gift product.
Run from any directory: python replay_evidence.py
"""
from __future__ import annotations
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
BASE = Path(__file__).resolve().parent
EVIDENCE = BASE / "evidence"
sys.path.insert(0, str(EVIDENCE))
from design_counterexamples import run as design_run


def normalized(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def replay():
    old_checks = normalized(EVIDENCE / "design_counterexamples.json")
    actual_checks = design_run()
    if old_checks != actual_checks or actual_checks.get("passed_count") != 8:
        raise AssertionError("Design counterexample results differ from saved provenance")
    with tempfile.TemporaryDirectory(prefix="gift-20261108-model-") as td:
        result_path = Path(td) / "model.json"
        subprocess.run([sys.executable, str(EVIDENCE / "protocol_models.py"),
                        "--output", str(result_path)], check=True, capture_output=True, text=True)
        old_protocol = normalized(EVIDENCE / "protocol_model_results.json")
        actual_protocol = normalized(result_path)
        if old_protocol != actual_protocol or actual_protocol.get("study_count") != 12:
            raise AssertionError("Bounded protocol models differ from saved results")
    provenance = normalized(EVIDENCE / "research_connections.json")
    if provenance.get("question_count") != 6 or provenance.get("unique_unit_count") != 23:
        raise AssertionError("Preserved research excerpt cardinality changed")
    return {"design_checks": 8, "bounded_studies": 12, "research_D": 6, "research_U": 23,
            "design_results_sha256": hashlib.sha256((EVIDENCE / "design_counterexamples.json").read_bytes()).hexdigest(),
            "protocol_results_sha256": hashlib.sha256((EVIDENCE / "protocol_model_results.json").read_bytes()).hexdigest(),
            "product_tests": "NOT_RUN", "proof_scope": "the particular finite models only"}


if __name__ == "__main__":
    print(json.dumps(replay(), ensure_ascii=False, indent=2))
