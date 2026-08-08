#!/usr/bin/env python3
"""build_frontend_templates.py — 预计算前端评分模板。

输入：私有仓库 Holistic 模板 results 目录 + 语义权重 profile JSON。
处理：对每个词的模板 JSON 执行 load_sequence + with_dynamic_frame_weights，
导出包含 motion 组、语义帧权重、semantic_phase 的完整特征，供前端
scoring-core.js 直接做 DTW 评分（standard 侧特征由 Python 预计算，
保证与后端评分完全一致）。

用法：
  python scripts/build_frontend_templates.py \
    --template-root /data/WYC/signLanguage/work/generated/scoring_mvp_run3/all_demo_step2_worker_cache_semantic_v1/results \
    --semantic-profile /data/WYC/signLanguage/work/generated/scoring_semantic_profiles/sign_semantic_weights.json \
    --output apps/web/assets/content/scoring_templates_v1.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict

REPO_ROOT = Path(__file__).resolve().parents[1]
SCORING_CORE_ROOT = REPO_ROOT / "packages" / "scoring-core"
if str(SCORING_CORE_ROOT) not in sys.path:
    sys.path.insert(0, str(SCORING_CORE_ROOT))

from scoring_core.score_holistic_sequence_mvp import (  # noqa: E402
    load_sequence,
    load_semantic_profile,
    with_dynamic_frame_weights,
)


def feature_to_compact(feature) -> Dict[str, Any]:
    """FrameFeature → compact dict（数组切片，groups 用 [start, end]）"""
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


def build_template(word_dir: Path, profile_json: Path, force_bbox: bool = False) -> Dict[str, Any]:
    template_json = next(word_dir.glob("*_holistic_results.json"), None)
    if template_json is None:
        raise RuntimeError(f"未找到模板 JSON: {word_dir}")
    word = word_dir.name
    seq = load_sequence(template_json, force_bbox=force_bbox)
    profile = load_semantic_profile(word, profile_json)
    dynamic = with_dynamic_frame_weights(seq, profile)
    return {
        "word": word,
        "source": str(template_json),
        "fps": float(seq.fps),
        "total_frames": int(seq.total_frames),
        "mode": seq.mode,
        "feature_dim": int(len(dynamic.features[0].vector)),
        "frame_count": int(len(dynamic.features)),
        "features": [feature_to_compact(f) for f in dynamic.features],
        "profile": profile_to_compact(profile),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="预计算前端评分模板")
    parser.add_argument("--template-root", required=True, help="Holistic 模板 results 目录")
    parser.add_argument("--semantic-profile", required=True, help="语义权重 profile JSON")
    parser.add_argument("--output", required=True, help="输出 JSON 路径")
    parser.add_argument("--force-bbox", action="store_true", help="强制 bbox 特征模式")
    args = parser.parse_args(argv)

    root = Path(args.template_root)
    profile_json = Path(args.semantic_profile)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    templates: Dict[str, Any] = {}
    for word_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        try:
            templates[word_dir.name] = build_template(word_dir, profile_json, force_bbox=args.force_bbox)
        except Exception as exc:
            print(f"[warn] 跳过 {word_dir.name}: {exc}", file=sys.stderr)

    if not templates:
        print("错误：没有可用的模板", file=sys.stderr)
        return 1

    payload = {
        "version": "v1",
        "generated_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "template_root": str(root),
        "words": templates,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    size_kb = out_path.stat().st_size / 1024
    print(f"已生成 {len(templates)} 个模板 → {out_path} ({size_kb:.1f} KB)")
    for word, tpl in templates.items():
        print(f"  {word}: {tpl['frame_count']} 帧, 特征维度 {tpl['feature_dim']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
