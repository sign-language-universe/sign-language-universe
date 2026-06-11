#!/usr/bin/env python3
"""Fail CI when generated data, local logs, or secrets are staged in Git."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


FORBIDDEN_PARTS = (
    "/work/generated/",
    "/work/logs/",
    "/.codex/tmux-workers/",
    "__pycache__",
)
FORBIDDEN_SUFFIXES = (
    ".pyc",
    ".pyo",
    ".pem",
    ".key",
    ".env",
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
    ".npy",
    ".npz",
    ".pkl",
    ".pt",
    ".pth",
    ".onnx",
)
MAX_FILE_BYTES = 95 * 1024 * 1024


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def main() -> int:
    root = Path.cwd()
    bad: list[str] = []
    for rel in tracked_files():
        normalized = f"/{rel}"
        path = root / rel
        if any(part in normalized for part in FORBIDDEN_PARTS):
            bad.append(rel)
            continue
        if any(rel.endswith(suffix) for suffix in FORBIDDEN_SUFFIXES):
            bad.append(rel)
            continue
        if path.exists() and path.is_file() and path.stat().st_size > MAX_FILE_BYTES:
            bad.append(f"{rel} (>95MB)")
    if bad:
        print("Forbidden files are tracked:", file=sys.stderr)
        for item in bad:
            print(f"- {item}", file=sys.stderr)
        return 1
    print("Forbidden file check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
