#!/usr/bin/env python3
"""build_frontend_templates_v2.py — 21 词前端评分模板打包（v2，每词多模板）。

从 21 词人工确认库（手语宇宙_原始Holistic_Landmark数据库_v3_step2_dense）
为每个词选择 3 个标准样本（用户01/02/03 正视角优先，逐级回退重复02/其他视角），
用语义 profile（demo21 v2 patch 或 v3 校准版）生成动态帧权重与语义相位，
打包为前端 scoring-core.js 可用的 21 词多模板 JSON。

每词输出 templates 数组（多用户模板并集）+ profile + envelope（占位，由
前端交叉验证后填充 q50/q90 包络参数）。

用法：
  python scripts/build_frontend_templates_v2.py \
    --raw-root /data/WYC/signLanguage/data/手语宇宙_原始Holistic_Landmark数据库_v3_step2_dense_待人工审核_20260802/landmarks \
    --profile-json /data/WYC/signLanguage/work/generated/.../calibrated_profile_candidates.json \
    --output apps/web/assets/content/scoring_templates_v2.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[1]
SCORING_CORE_ROOT = REPO_ROOT / "packages" / "scoring-core"
if str(SCORING_CORE_ROOT) not in sys.path:
    sys.path.insert(0, str(SCORING_CORE_ROOT))
from scoring_core.score_holistic_sequence_mvp import (  # noqa: E402
    load_sequence,
    load_semantic_profile,
    with_dynamic_frame_weights,
)


VIEW_ORDER = ("正", "左30", "右30")
USER_ORDER = ("用户_01", "用户_02", "用户_03")


def word_from_dir(name: str) -> str:
    match = re.match(r"^\d+_(.+)$", name)
    return match.group(1) if match else name


def list_samples(word_dir: Path) -> List[Path]:
    """列出该词全部样本，按（用户序, 视角序, 重复序）排序。"""
    samples: List[Path] = []
    for user in USER_ORDER:
        user_dir = word_dir / user
        if not user_dir.is_dir():
            continue
        for view in VIEW_ORDER:
            view_dir = user_dir / view
            if not view_dir.is_dir():
                continue
            for repeat in ("重复_01.json", "重复_02.json"):
                path = view_dir / repeat
                if path.is_file():
                    samples.append(path)
    return samples


def rank_sample(path: Path) -> tuple:
    user = next((i for i, u in enumerate(USER_ORDER) if u in path.parts), len(USER_ORDER))
    view = next((i for i, v in enumerate(VIEW_ORDER) if v in path.parts), len(VIEW_ORDER))
    repeat = 0 if "重复_01" in path.name else 1
    return (user, view, repeat)


def feature_to_compact(feature) -> Dict[str, Any]:
    groups = {name: [int(sl.start), int(sl.stop)] for name, sl in feature.groups.items()}
    return {
        "frame_idx": int(feature.frame_idx),
        "timestamp_sec": float(feature.timestamp_sec),
        "vector": [round(float(v), 9) for v in feature.vector],
        "mask": [int(m) for m in feature.mask],
        "groups": groups,
        "presence": {k: bool(v) for k, v in feature.presence.items()},
        "frame_weight": round(float(feature.frame_weight), 9),
        "semantic_phase": round(float(feature.semantic_phase), 9),
    }


def profile_to_compact(profile) -> Dict[str, Any]:
    return {
        "word": profile.word,
        "version": profile.version,
        "description": profile.description,
        "group_weights": {k: round(float(v), 6) for k, v in profile.group_weights.items()},
        "keypoint_weights": profile.keypoint_weights,
        "focus_groups": list(profile.focus_groups),
        "allow_hand_swap": bool(profile.allow_hand_swap),
        "semantic_notes": list(profile.semantic_notes),
        "semantic_dtw": profile.semantic_dtw,
    }


def build_template(word: str, sample: Path, profile_json: Path, force_bbox: bool) -> Optional[Dict[str, Any]]:
    try:
        seq = load_sequence(sample, force_bbox=force_bbox)
        profile = load_semantic_profile(word, profile_json)
        dynamic = with_dynamic_frame_weights(seq, profile)
        return {
            "source": str(sample),
            "source_name": sample.name,
            "fps": float(seq.fps),
            "total_frames": int(seq.total_frames),
            "frame_count": int(len(dynamic.features)),
            "features": [feature_to_compact(f) for f in dynamic.features],
        }
    except Exception as exc:
        print(f"[warn] {word} 模板 {sample.name} 失败: {exc}", file=sys.stderr)
        return None


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-root", type=Path, required=True)
    parser.add_argument("--profile-json", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--templates-per-word", type=int, default=3, help="每词模板数（默认 3）")
    parser.add_argument("--force-bbox", action="store_true")
    args = parser.parse_args(argv)

    raw_root = args.raw_root.resolve()
    profile_json = args.profile_json.resolve()
    out_path = args.output.resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    profiles_payload = json.loads(profile_json.read_text(encoding="utf-8"))
    profile_names = set(profiles_payload.get("profiles", {}).keys())

    templates: Dict[str, Any] = {}
    skipped: List[str] = []
    for word_dir in sorted(p for p in raw_root.iterdir() if p.is_dir()):
        word = word_from_dir(word_dir.name)
        if word not in profile_names:
            skipped.append(f"{word}（无 profile）")
            continue
        samples = sorted(list_samples(word_dir), key=rank_sample)[:args.templates_per_word]
        if not samples:
            skipped.append(f"{word}（无样本）")
            continue
        built = [build_template(word, sample, profile_json, args.force_bbox) for sample in samples]
        built = [item for item in built if item is not None]
        if not built:
            skipped.append(f"{word}（全部模板构建失败）")
            continue
        profile = load_semantic_profile(word, profile_json)
        templates[word] = {
            "word": word,
            "fps": float(built[0]["fps"]),
            "feature_dim": int(len(built[0]["features"][0]["vector"])),
            "template_count": len(built),
            "templates": built,
            "profile": profile_to_compact(profile),
            "envelope": None,  # 前端交叉验证后填充 q50/q90
        }

    if not templates:
        print("错误：没有可用的模板", file=sys.stderr)
        return 1

    payload = {
        "version": "v2_21words_multitemplate",
        "generated_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "raw_root": str(raw_root),
        "profile_json": str(profile_json),
        "template_policy": "每词 3 个标准样本（用户01/02/03 正视角优先），多用户模板并集",
        "words": templates,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    size_kb = out_path.stat().st_size / 1024
    print(f"已生成 {len(templates)} 个 21 词多模板 → {out_path} ({size_kb:.1f} KB)")
    for word, tpl in sorted(templates.items()):
        sources = ", ".join(item["source_name"] for item in tpl["templates"])
        print(f"  {word}: {tpl['template_count']} 模板 × {tpl['templates'][0]['frame_count']} 帧, 特征 {tpl['feature_dim']} 维")
    if skipped:
        print(f"跳过 {len(skipped)} 词：{skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
