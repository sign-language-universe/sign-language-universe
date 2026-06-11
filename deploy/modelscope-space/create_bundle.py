#!/usr/bin/env python3
"""Create a minimal ModelScope Docker Space repository bundle."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]


IGNORE_PATTERNS = shutil.ignore_patterns(
    "__pycache__",
    "*.pyc",
    "*.pyo",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
    "work",
    "logs",
    "generated",
    "tmp",
    "temp",
)


def copy_path(src: Path, dst: Path) -> None:
    if src.is_dir():
        shutil.copytree(src, dst, ignore=IGNORE_PATTERNS)
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def create_bundle(target: Path, force: bool) -> None:
    if target.exists():
        if not force:
            raise SystemExit(f"Target already exists: {target}. Use --force to overwrite.")
        shutil.rmtree(target)
    target.mkdir(parents=True)

    copy_path(SCRIPT_DIR / "Dockerfile", target / "Dockerfile")
    copy_path(SCRIPT_DIR / ".dockerignore", target / ".dockerignore")
    copy_path(SCRIPT_DIR / "README.md", target / "README.md")

    for rel in (
        "packages/scoring-core",
        "packages/shared-contracts",
        "services/scoring-api",
    ):
        copy_path(REPO_ROOT / rel, target / rel)

    for rel in ("LICENSE", "NOTICE"):
        path = REPO_ROOT / rel
        if path.exists():
            copy_path(path, target / rel)

    print(f"ModelScope Space bundle created: {target}")
    print()
    print("Next steps:")
    print(f"  cd {target}")
    print("  git init")
    print("  git add .")
    print('  git commit -m "deploy scoring api to modelscope space"')
    print("  git remote add origin <your-modelscope-space-git-url>")
    print("  git push -u origin main")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "target",
        nargs="?",
        default=str(REPO_ROOT / "work" / "generated" / "modelscope-space-bundle"),
        help="Output directory for the generated Space repository bundle.",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite target directory if it already exists.")
    args = parser.parse_args()

    create_bundle(Path(args.target).expanduser().resolve(), args.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
