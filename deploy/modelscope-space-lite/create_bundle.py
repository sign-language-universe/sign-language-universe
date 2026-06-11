#!/usr/bin/env python3
"""Create a minimal ModelScope Docker Space repository bundle for web-landmark scoring."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_LEGACY_TEMPLATE_ROOT = Path(
    "/data/WYC/signLanguage/work/generated/scoring_mvp_run3/all_demo_step2_worker_cache_semantic_v1/results"
)
DEFAULT_LEGACY_SEMANTIC_PROFILE = Path(
    "/data/WYC/signLanguage/work/generated/scoring_semantic_profiles/sign_semantic_weights.json"
)


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


def create_bundle(
    target: Path,
    force: bool,
    template_root: Path | None = None,
    semantic_profile_json: Path | None = None,
) -> None:
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

    templates_dir = target / "templates"
    (templates_dir / "holistic").mkdir(parents=True, exist_ok=True)
    (templates_dir / "README.md").write_text(
        "Lite scoring templates for browser-side Holistic landmark requests.\n",
        encoding="utf-8",
    )
    if template_root and template_root.exists():
        shutil.rmtree(templates_dir / "holistic")
        copy_path(template_root, templates_dir / "holistic")
    if semantic_profile_json and semantic_profile_json.exists():
        copy_path(semantic_profile_json, templates_dir / "sign_semantic_weights.json")

    for rel in ("LICENSE", "NOTICE"):
        path = REPO_ROOT / rel
        if path.exists():
            copy_path(path, target / rel)

    print(f"ModelScope Lite Space bundle created: {target}")
    print()
    print("Next steps:")
    print(f"  cd {target}")
    print("  git init -b master")
    print("  git add .")
    print('  git commit -m "deploy lite scoring api to modelscope space"')
    print("  git remote add origin <your-lite-modelscope-space-git-url>")
    print("  git push -u origin master")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "target",
        nargs="?",
        default=str(REPO_ROOT / "work" / "generated" / "modelscope-space-lite-bundle"),
        help="Output directory for the generated lite Space repository bundle.",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite target directory if it already exists.")
    parser.add_argument(
        "--template-root",
        default=str(DEFAULT_LEGACY_TEMPLATE_ROOT if DEFAULT_LEGACY_TEMPLATE_ROOT.exists() else ""),
        help="Optional legacy Holistic template results directory to copy into templates/holistic.",
    )
    parser.add_argument(
        "--semantic-profile-json",
        default=str(DEFAULT_LEGACY_SEMANTIC_PROFILE if DEFAULT_LEGACY_SEMANTIC_PROFILE.exists() else ""),
        help="Optional semantic weight profile JSON to copy into templates/sign_semantic_weights.json.",
    )
    args = parser.parse_args()

    template_root = Path(args.template_root).expanduser().resolve() if args.template_root else None
    semantic_profile_json = (
        Path(args.semantic_profile_json).expanduser().resolve() if args.semantic_profile_json else None
    )
    create_bundle(Path(args.target).expanduser().resolve(), args.force, template_root, semantic_profile_json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
