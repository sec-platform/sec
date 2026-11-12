#!/usr/bin/env python3
"""Replay the isolated 2026-11-05 reference using the repository's retained research bytes.
No product API or source is modified. Original compiler files remain unedited.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BASE = Path(__file__).resolve().parent
MODEL_SHA = "c64d0bc4452a24e36f83fbfd27d22fe64dec4259666be7cbdac7b44a806b157e"
MAP_SHA = "735fed9f13fdd7f865103567bb9555d81676ba8e69792fde234471074cc0fdfd"


def find_root() -> Path:
    for parent in BASE.parents:
        if (parent / "docs" / "信息" / "研究数据" / "README.md").is_file():
            return parent
    raise RuntimeError("Complete Git checkout with docs/信息/研究数据 is required")


def replay() -> dict:
    research = find_root() / "docs" / "信息" / "研究数据"
    model = gzip.decompress((research / "research_model.original-c64d0bc4452a.json.gz").read_bytes())
    mapping = (research / "568项模型责任追溯-735fed9f13fd.json").read_bytes()
    assert hashlib.sha256(model).hexdigest() == MODEL_SHA, "Original model bytes changed"
    assert hashlib.sha256(mapping).hexdigest() == MAP_SHA, "Question mapping bytes changed"
    with tempfile.TemporaryDirectory(prefix="gift-20261105-reference-") as td:
        stage = Path(td)
        shutil.copytree(BASE / "src", stage / "src")
        shutil.copytree(BASE / "examples", stage / "examples")
        shutil.copytree(BASE / "tests", stage / "tests")
        shutil.copyfile(BASE / "compile.py", stage / "compile.py")
        (stage / "data").mkdir()
        (stage / "data" / "research_model.original.json").write_bytes(model)
        (stage / "data" / "多维到Gift模型_568项逐项追溯.json").write_bytes(mapping)
        test = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests",
                               "-p", "test_branch_v2.py", "-v"], cwd=stage,
                               capture_output=True, text=True)
        if test.returncode:
            raise RuntimeError("Original /2 bridge tests failed:\n" + test.stdout + test.stderr)
        results = []
        for source in ("shared_views", "two_predicates", "repo_v2_query"):
            args = [sys.executable, "compile.py", "examples/" + source + ".author.json",
                    "--out", str(stage / "out" / source)]
            run = subprocess.run(args, cwd=stage, capture_output=True, text=True)
            if run.returncode:
                raise RuntimeError("Original reference compilation failed: " + source + "\n" + run.stderr)
            rec = json.loads((stage / "out" / source / "verification.json").read_text(encoding="utf8"))
            results.append({"input": source, "rows": rec["result_counts"],
                            "typescript": rec["typescript"], "rust": rec["rust"]})
        return {"model_sha256": MODEL_SHA, "mapping_sha256": MAP_SHA,
                "bridge_tests": "passed", "examples": results,
                "scope": "frozen 2026-11-05 reference, not Gift compiler production tests"}


if __name__ == "__main__":
    print(json.dumps(replay(), ensure_ascii=False, indent=2))
