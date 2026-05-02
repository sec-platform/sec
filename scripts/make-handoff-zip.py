#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import os
import subprocess
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path.cwd().resolve()
OUTPUT_DIR = REPO_ROOT / "_handoff"

EXCLUDE_DIRS = {
    ".git",
    ".tmp",
    ".shared-deps",
    "node_modules",
    ".next",
    "dist",
    "build",
    "coverage",
    "report",
    "test-results",
    ".turbo",
    ".cache",
}

EXCLUDE_FILES = {
    ".env",
    ".env.local",
    ".env.development.local",
    ".env.test.local",
    ".env.production.local",
}

EXCLUDE_SUFFIXES = {
    ".log",
    ".tsbuildinfo",
}


def run_git(args: list[str], allow_fail: bool = True) -> str:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except FileNotFoundError:
        if allow_fail:
            return ""
        raise

    if result.returncode != 0 and not allow_fail:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")

    return result.stdout.strip()


def safe_name(value: str) -> str:
    cleaned = []
    for char in value:
        if char.isalnum() or char in ("-", "_", "."):
            cleaned.append(char)
        else:
            cleaned.append("-")
    return "".join(cleaned).strip("-") or "unknown"


def should_exclude(path: Path) -> bool:
    rel_parts = path.relative_to(REPO_ROOT).parts

    if any(part in EXCLUDE_DIRS for part in rel_parts):
        return True

    if path.name in EXCLUDE_FILES:
        return True

    if path.name.startswith(".env."):
        return True

    if path.suffix in EXCLUDE_SUFFIXES:
        return True

    if path.is_file() and path.stat().st_size > 50 * 1024 * 1024:
        return True

    return False


def git_file_list() -> list[Path]:
    output = run_git(["ls-files", "--cached", "--modified", "--others", "--exclude-standard"])
    files: set[Path] = set()

    for line in output.splitlines():
        if not line.strip():
            continue
        path = (REPO_ROOT / line).resolve()
        if path.exists() and path.is_file() and REPO_ROOT in path.parents and not should_exclude(path):
            files.add(path)

    return sorted(files)


def walk_file_list() -> list[Path]:
    files: list[Path] = []

    for root, dirs, filenames in os.walk(REPO_ROOT):
        root_path = Path(root)

        dirs[:] = [
            directory
            for directory in dirs
            if directory not in EXCLUDE_DIRS
        ]

        for filename in filenames:
            path = root_path / filename
            if path.is_file() and not should_exclude(path):
                files.append(path.resolve())

    return sorted(files)


def collect_files() -> list[Path]:
    files = git_file_list()
    if files:
        return files
    return walk_file_list()


def main() -> int:
    branch = run_git(["branch", "--show-current"]) or "detached"
    short_sha = run_git(["rev-parse", "--short", "HEAD"]) or "no-git"
    full_sha = run_git(["rev-parse", "HEAD"]) or "no-git"
    status = run_git(["status", "--short"])
    diff_stat = run_git(["diff", "--stat"])
    recent_log = run_git(["log", "--oneline", "--decorate", "-20"])

    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    archive_name = f"pjc-{safe_name(branch)}-{short_sha}-{timestamp}.zip"

    OUTPUT_DIR.mkdir(exist_ok=True)
    archive_path = OUTPUT_DIR / archive_name

    files = collect_files()

    metadata = "\n".join([
        f"branch: {branch}",
        f"head: {full_sha}",
        f"created_at: {dt.datetime.now().isoformat(timespec='seconds')}",
        "",
        "git status --short:",
        status or "(clean)",
        "",
        "git diff --stat:",
        diff_stat or "(no unstaged diff)",
        "",
        "recent commits:",
        recent_log or "(no git log)",
        "",
        f"file_count: {len(files)}",
        "",
    ])

    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr(".chatgpt-handoff/metadata.txt", metadata)

        for path in files:
            rel_path = path.relative_to(REPO_ROOT).as_posix()
            archive.write(path, rel_path)

    size_mb = archive_path.stat().st_size / 1024 / 1024

    print(f"Created: {archive_path}")
    print(f"Size: {size_mb:.2f} MB")
    print(f"Branch: {branch}")
    print(f"HEAD: {short_sha}")
    print(f"Files: {len(files)}")
    print()
    print("Upload this zip to ChatGPT:")
    print(archive_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())