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
# 模板用户优先级：全可靠用户（01/03/04/06/07 问卷全通过）优先；
# 部分可靠（02/05/08/09）经 answer=1 过滤后补充；未审核用户（10/11）永不使用。
USER_ORDER = ("用户_01", "用户_03", "用户_04", "用户_06", "用户_07", "用户_02", "用户_05", "用户_08", "用户_09")


def word_from_dir(name: str) -> str:
    match = re.match(r"^\d+_(.+)$", name)
    return match.group(1) if match else name


def load_reliable_sample_ids(manifest_path: Optional[Path]) -> set:
    """从 trusted_positive_manifest（answer=1 准入）构建可靠样本 ID 集合。

    数据准入规则：只有人工确认正确（问卷 answer=1）且准入的样本可作模板；
    未审核用户（如 10/11）、切割错误（answer=2）、词汇错位（answer=3）
    的样本一律不纳入。
    """
    if manifest_path is None or not manifest_path.is_file():
        return set()
    import csv as _csv
    return {
        row.get("sample_id", "")
        for row in _csv.DictReader(manifest_path.open(encoding="utf-8-sig"))
        if row.get("sample_id")
    }


def load_reliable_sample_paths(manifest_path: Optional[Path]) -> set:
    """从 trusted_positive_manifest（answer=1 准入）构建可靠样本路径集合。

    数据准入规则：只有人工确认正确（问卷 answer=1）且准入的样本可作模板；
    未审核用户（如 10/11）、切割错误（answer=2）、词汇错位（answer=3）
    的样本一律不纳入。
    """
    if manifest_path is None or not manifest_path.is_file():
        return set()
    import csv as _csv
    paths = set()
    for row in _csv.DictReader(manifest_path.open(encoding="utf-8-sig")):
        shard = row.get("raw_landmark_shard")
        if shard:
            paths.add(str(Path(shard).resolve()))
    return paths


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


def pick_standard_samples(word_dir: Path, reliable_paths: set, count: int) -> List[Path]:
    """选择可靠标准模板样本：仅人工确认正确（answer=1）的样本；
    按用户轮询分散（每个用户先取最优样本，再进入下一轮），避免单用户垄断。"""
    from collections import defaultdict
    samples = list_samples(word_dir)
    if reliable_paths:
        # 只保留可靠样本；若无可靠样本则返回空（宁可缺模板也不用不可靠数据）
        samples = [s for s in samples if str(s.resolve()) in reliable_paths]
    by_user: Dict[str, List[Path]] = defaultdict(list)
    for s in sorted(samples, key=rank_sample):
        user = next((u for u in USER_ORDER if u in s.parts), "其他")
        by_user[user].append(s)
    picked: List[Path] = []
    while len(picked) < count:
        progressed = False
        for user in USER_ORDER:
            if len(picked) >= count:
                break
            if by_user[user]:
                picked.append(by_user[user].pop(0))
                progressed = True
        if not progressed:
            break
    return picked[:count]


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


GROUP_ENVELOPE_GROUPS = (
    "pose", "left_hand", "right_hand", "left_hand_shape", "right_hand_shape", "face", "two_hand_relation",
    # 帧序列动态过程特征（手部打开/移动过程等）
    "left_hand_motion", "right_hand_motion", "left_hand_shape_motion", "right_hand_shape_motion",
    "two_hand_relation_motion",
)


def compute_group_envelope(args):
    """多进程 worker：估计单词各组局部距离分位数包络。

    args = (word, sources, manifest_path, profile_json, force_bbox)
    返回 (word, envelope)。仅使用人工确认正样本（trusted_positive_manifest）。
    """
    word, sources, manifest_path, profile_json, force_bbox = args
    import csv as _csv
    from scoring_core.score_holistic_sequence_mvp import dtw_align, load_sequence as _load_sequence

    manifest_path = Path(manifest_path)
    if not manifest_path.is_file():
        return word, {}
    rows = list(_csv.DictReader(manifest_path.open(encoding="utf-8-sig")))
    refs = [row for row in rows if row.get("word") == word]
    if not refs:
        return word, {}
    template_seqs = [
        _load_sequence(Path(src), force_bbox=force_bbox)
        for src in sources
    ]
    profile = load_semantic_profile(word, Path(profile_json))
    group_distances = {group: [] for group in GROUP_ENVELOPE_GROUPS}
    for row in refs:
        shard = Path(row.get("raw_landmark_shard", ""))
        if not shard.is_file():
            continue
        try:
            query = _load_sequence(shard, force_bbox=force_bbox)
        except Exception:
            continue
        best_group = None
        best_dtw = float("inf")
        for standard in template_seqs:
            try:
                result = dtw_align(standard, query, profile)
            except Exception:
                continue
            dtw = float(result.get("dtw_distance", float("inf")))
            if dtw < best_dtw:
                best_dtw = dtw
                best_group = result.get("group_mean_distance") or result.get("group_mean") or {}
        if best_group is None:
            continue
        for group in GROUP_ENVELOPE_GROUPS:
            value = float(best_group.get(group, 0.0))
            if value >= 0:
                group_distances[group].append(value)
    envelope = {}
    for group, values in group_distances.items():
        if len(values) < 3:
            continue
        values.sort()
        q50 = values[min(len(values) - 1, int(len(values) * 0.50))]
        q90 = values[min(len(values) - 1, int(len(values) * 0.90))]
        if q90 > q50 + 1e-9:
            envelope[group] = {"q50": round(float(q50), 6), "q90": round(float(q90), 6)}
    return word, envelope


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-root", type=Path, required=True)
    parser.add_argument("--profile-json", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--templates-per-word", type=int, default=3, help="每词模板数（默认 3）")
    parser.add_argument("--positive-manifest", type=Path, default=None, help="trusted_positive_manifest.csv（计算各组局部距离包络）")
    parser.add_argument("--force-bbox", action="store_true")
    args = parser.parse_args(argv)

    raw_root = args.raw_root.resolve()
    profile_json = args.profile_json.resolve()
    out_path = args.output.resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # 可靠样本（answer=1 准入）路径集合：模板选择与局部包络均只用可靠数据
    reliable_paths = load_reliable_sample_paths(args.positive_manifest)

    profiles_payload = json.loads(profile_json.read_text(encoding="utf-8"))
    profile_names = set(profiles_payload.get("profiles", {}).keys())

    templates: Dict[str, Any] = {}
    skipped: List[str] = []
    for word_dir in sorted(p for p in raw_root.iterdir() if p.is_dir()):
        word = word_from_dir(word_dir.name)
        if word not in profile_names:
            skipped.append(f"{word}（无 profile）")
            continue
        samples = pick_standard_samples(word_dir, reliable_paths, args.templates_per_word)
        if not samples:
            skipped.append(f"{word}（无可靠样本）")
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
            "envelope": None,  # 前端交叉验证后填充 q50/q90（总体距离）
            "group_envelope": {},  # 各组局部距离包络（局部语义评分参考）
        }

    # 各组局部距离包络（基于人工确认正样本的加权数据库，多进程并行）
    if args.positive_manifest is not None:
        import multiprocessing as mp
        import os as _os

        tasks = [
            (word, [t["source"] for t in templates[word]["templates"]],
             str(args.positive_manifest.resolve()), str(args.profile_json.resolve()), args.force_bbox)
            for word in templates
        ]
        workers = max(2, min(int(_os.environ.get("SLU_BUILD_WORKERS", "10")), 16))
        print(f"计算各组局部距离包络（多进程 ×{workers}，{len(tasks)} 词）…", file=sys.stderr)
        import time as _time
        t0 = _time.time()
        results = []
        with mp.Pool(processes=workers) as pool:
            for i, (word, _, envelope) in enumerate(pool.imap_unordered(compute_group_envelope, tasks), 1):
                results.append((word, envelope))
                elapsed = _time.time() - t0
                avg = elapsed / i
                eta = avg * (len(tasks) - i)
                print(f"[进度] {i}/{len(tasks)} {word} | 已用 {elapsed:.0f}s | 每词 {avg:.1f}s | 预计剩余 {eta:.0f}s", file=sys.stderr, flush=True)
        for (word, *_), (_, envelope) in zip(tasks, results):
            templates[word]["group_envelope"] = envelope or {}
        n_with = sum(1 for t in templates.values() if t["group_envelope"])
        print(f"完成：{n_with}/{len(templates)} 词含 group_envelope（总耗时 {_time.time()-t0:.0f}s）", file=sys.stderr)

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
