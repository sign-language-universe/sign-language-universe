#!/usr/bin/env python3
"""
手语 Holistic 序列打分 MVP。

这个脚本只读取已经落盘的 Holistic JSON，不重新运行 MediaPipe。
第一阶段目标是验证“标准序列 vs 查询序列”的离线打分链路：
- 特征抽取
- 坐标/尺度归一化
- DTW 时序对齐
- 分组误差统计
- 临时相似度分数与诊断输出

当前项目还没有真实用户视频流样本和人工评分标签，因此这里输出的是
prototype_score，不是已校准的正式评分。
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np


POSE_CORE_INDICES = [0, 11, 12, 13, 14, 15, 16, 23, 24]
FACE_CORE_INDICES = [33, 133, 159, 145, 362, 263, 386, 374, 61, 291, 13, 14]
POSE_LANDMARK_COUNT = 33
HAND_LANDMARK_COUNT = 21
FACE_LANDMARK_COUNT = 478

GROUP_WEIGHTS = {
    "left_hand": 0.32,
    "right_hand": 0.32,
    "left_hand_shape": 0.00,
    "right_hand_shape": 0.00,
    "pose": 0.24,
    "face": 0.06,
    "missing": 0.06,
}

SCORE_SCALE = 0.12
DEFAULT_REPO_ROOT = Path("/data/WYC/signLanguage")
DEFAULT_SEMANTIC_PROFILE_JSON = DEFAULT_REPO_ROOT / "work/generated/scoring_semantic_profiles/sign_semantic_weights.json"
DEFAULT_DENSE_TEMPLATE_ROOT = DEFAULT_REPO_ROOT / "work/generated/scoring_mvp_run3/all_demo_step2_worker_cache_semantic_v1/results"
BASE_GROUPS = ["left_hand", "right_hand", "pose", "face"]
HAND_GROUPS = ["left_hand", "right_hand", "left_hand_shape", "right_hand_shape"]
HAND_SHAPE_GROUPS = ["left_hand_shape", "right_hand_shape"]
RELATIVE_MOTION_GROUPS = [
    "left_hand_motion",
    "right_hand_motion",
    "left_hand_shape_motion",
    "right_hand_shape_motion",
    "two_hand_relation",
    "two_hand_relation_motion",
]
FINGER_TIPS = [4, 8, 12, 16, 20]
FINGER_MCPS = [1, 5, 9, 13, 17]
FINGER_PIPS = [2, 6, 10, 14, 18]
FINGER_DIPS = [3, 7, 11, 15, 19]
HAND_FINGER_CHAINS = (
    (1, 2, 3, 4),
    (5, 6, 7, 8),
    (9, 10, 11, 12),
    (13, 14, 15, 16),
    (17, 18, 19, 20),
)
SPREAD_PAIRS = [(4, 8), (8, 12), (12, 16), (16, 20), (8, 20)]
FINGER_NAMES = ["thumb", "index", "middle", "ring", "pinky"]
POSITIVE_VARIANTS = [
    "self",
    "subsample_even",
    "trim_start_20pct",
    "trim_end_20pct",
    "trim_both_10pct",
    "amplitude_0.85",
    "amplitude_1.15",
]
FAKE_VARIANTS = [
    "fake_reverse_time",
    "fake_shuffle_frames",
    "fake_static_hold",
    "fake_random_landmarks",
    "fake_random_walk",
]
LANDMARK_XY_VISIBLE_MIN = -0.15
LANDMARK_XY_VISIBLE_MAX = 1.15
LANDMARK_Z_VISIBLE_MIN = -1.0
LANDMARK_Z_VISIBLE_MAX = 1.0
LANDMARK_ZERO_MISSING_EPS = 1e-7
HAND_DEGENERATE_VISIBLE_MIN_POINTS = 8
HAND_DEGENERATE_XY_SPAN_MIN = 0.012
HAND_WRIST_Z_ORIGIN_MAX = 2e-6
HAND_LANDMARK_COLLISION_DISTANCE_MAX = 1e-5
HAND_GLOBAL_QUANTIZATION_VISIBLE_MIN_POINTS = 16
HAND_GLOBAL_QUANTIZATION_RESIDUAL_MAX = 5e-4
HAND_GLOBAL_QUANTIZATION_STEPS = (
    1.0 / 1024.0,
    1.0 / 640.0,
    1.0 / 512.0,
    1.0 / 480.0,
    1.0 / 320.0,
    1.0 / 256.0,
    1.0 / 240.0,
)
HAND_BONE_LENGTH_RATIO_MIN = 0.003
HAND_BONE_LENGTH_RATIO_MAX = 2.0
HAND_BONE_LENGTH_VISIBLE_MIN_POINTS = 16
HAND_BONE_LENGTH_PALM_REF_MIN = 3
HAND_INTERNAL_TOPOLOGY_BACKTRACK_TURN_MIN = 6
HAND_INTERNAL_TOPOLOGY_PROXIMAL_DISTAL_RATIO_MIN = 0.5
HAND_INTERNAL_TOPOLOGY_REVERSED_CHAIN_MIN = 5
HAND_INTERNAL_TOPOLOGY_REVERSED_RATIO_MAX = 0.8
POSE_SHOULDER_X_MIN = -0.25
POSE_SHOULDER_X_MAX = 1.25
POSE_SHOULDER_Y_MIN = -0.25
POSE_SHOULDER_Y_MAX = 1.40
POSE_SHOULDER_Z_MIN = -2.0
POSE_SHOULDER_Z_MAX = 1.0
POSE_SHOULDER_SCALE_MIN = 0.06
POSE_SHOULDER_SCALE_MAX = 0.85
POSE_SHOULDER_NOSE_Y_GAP_MIN = 0.0
POSE_SHOULDER_NOSE_Y_GAP_MAX = 0.50
POSE_SHOULDER_NOSE_Z_GAP_MIN = 0.05
POSE_SHOULDER_NOSE_Z_GAP_MAX = 1.10
POSE_SHOULDER_HIP_Y_GAP_MIN = 0.02
POSE_SHOULDER_HIP_Y_GAP_MAX = 1.00
POSE_SHOULDER_HIP_Z_GAP_MIN = -1.20
POSE_SHOULDER_HIP_Z_GAP_MAX = 0.50
POSE_SHOULDER_HIP_X_DELTA_MAX = 0.35
POSE_SHOULDER_HIP_WIDTH_RATIO_MIN = 0.75
POSE_SHOULDER_HIP_WIDTH_RATIO_MAX = 2.50
POSE_HAND_WRIST_XY_DISTANCE_MAX = 0.35
POSE_SEQUENCE_SHOULDER_HAND_Z_MEDIAN_MIN = -0.80
POSE_SEQUENCE_SHOULDER_HAND_Z_MEDIAN_MAX = 0.35
POSE_SEQUENCE_RELATION_MIN_FRAMES = 3
POSE_FALLBACK_HAND_SCALE_FACTOR = 4.0
POSE_FALLBACK_SCALE_MIN = 0.06
POSE_FALLBACK_SCALE_MAX = 0.85
POSE_FALLBACK_XY_MIN = -1.0
POSE_FALLBACK_XY_MAX = 2.0
POSE_FALLBACK_Z_MIN = -4.0
POSE_FALLBACK_Z_MAX = 2.0
FRAME_WEIGHT_MIN = 0.05
FRAME_WEIGHT_RAW_MAX = 10.0
DEFAULT_FPS = 25.0
FPS_MIN = 1.0
FPS_MAX = 240.0
TOTAL_FRAMES_MAX = 10_000_000
FRAME_INDEX_MIN_LIMIT = 10_000
FRAME_INDEX_RECORD_MULTIPLIER = 1_000
TIMESTAMP_MIN_LIMIT_SEC = 60.0
TIMESTAMP_DURATION_MULTIPLIER = 10.0


@dataclass
class FrameFeature:
    frame_idx: int
    timestamp_sec: float
    vector: np.ndarray
    mask: np.ndarray
    groups: Dict[str, slice]
    presence: Dict[str, bool]
    frame_weight: float = 1.0
    semantic_phase: float = 0.0


@dataclass
class SequenceData:
    source: str
    mode: str
    fps: float
    total_frames: int
    features: List[FrameFeature]


@dataclass
class SemanticProfile:
    word: str
    version: str
    description: str
    group_weights: Dict[str, float]
    keypoint_weights: Dict[str, Dict[str, float]]
    focus_groups: List[str]
    allow_hand_swap: bool
    semantic_notes: List[str]
    semantic_dtw: Dict[str, Any]


def _load_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _default_semantic_profile(word: str = "generic") -> SemanticProfile:
    return SemanticProfile(
        word=word,
        version="builtin-default",
        description="默认均衡手部优先 profile；未命中文本语义配置时使用。",
        group_weights=dict(GROUP_WEIGHTS),
        keypoint_weights={},
        focus_groups=["left_hand", "right_hand"],
        allow_hand_swap=True,
        semantic_notes=["no_word_specific_profile"],
        semantic_dtw={},
    )


def _infer_word_from_source(source: str) -> str:
    path = Path(source.split("::", 1)[0])
    names = [path.parent.name, path.stem]
    for name in names:
        if not name:
            continue
        cleaned = name.replace("_holistic_results", "")
        cleaned = cleaned.replace("_results", "")
        if cleaned:
            return cleaned
    return "generic"


def _normalize_group_weights(raw: Dict[str, Any]) -> Dict[str, float]:
    merged = dict(GROUP_WEIGHTS)
    for key, value in raw.items():
        try:
            merged[key] = max(0.0, float(value))
        except (TypeError, ValueError):
            continue
    missing = max(0.0, min(float(merged.get("missing", GROUP_WEIGHTS["missing"])), 0.35))
    groups = [key for key in merged if key != "missing" and merged.get(key, 0.0) > 0]
    total = sum(float(merged[key]) for key in groups)
    if total <= 1e-8:
        return dict(GROUP_WEIGHTS)
    scale = (1.0 - missing) / total
    normalized = {key: float(merged.get(key, 0.0)) * scale for key in merged if key != "missing"}
    normalized["missing"] = missing
    return normalized


def load_semantic_profile(
    word: str,
    profile_json: Path = DEFAULT_SEMANTIC_PROFILE_JSON,
    disabled: bool = False,
) -> SemanticProfile:
    if disabled:
        return _default_semantic_profile(word)
    if not profile_json.exists():
        return _default_semantic_profile(word)
    payload = _load_json(profile_json)
    profiles = payload.get("profiles") or {}
    raw = profiles.get(word)
    if raw is None and "（" in word:
        raw = profiles.get(word.split("（", 1)[0])
    if raw is None:
        raw = profiles.get("generic")
    if raw is None:
        return _default_semantic_profile(word)
    return SemanticProfile(
        word=str(raw.get("word") or word),
        version=str(payload.get("version") or raw.get("version") or "semantic-profile"),
        description=str(raw.get("description") or ""),
        group_weights=_normalize_group_weights(raw.get("group_weights") or {}),
        keypoint_weights=dict(raw.get("keypoint_weights") or {}),
        focus_groups=list(raw.get("focus_groups") or ["left_hand", "right_hand"]),
        allow_hand_swap=bool(raw.get("allow_hand_swap", True)),
        semantic_notes=list(raw.get("semantic_notes") or []),
        semantic_dtw=dict(raw.get("semantic_dtw") or {}),
    )


def _profile_summary(profile: SemanticProfile) -> Dict[str, Any]:
    return {
        "word": profile.word,
        "version": profile.version,
        "description": profile.description,
        "group_weights": profile.group_weights,
        "keypoint_weights": profile.keypoint_weights,
        "focus_groups": profile.focus_groups,
        "allow_hand_swap": profile.allow_hand_swap,
        "semantic_notes": profile.semantic_notes,
        "semantic_dtw": profile.semantic_dtw,
    }


def _records_from_payload(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    if isinstance(payload.get("records"), list):
        return [item if isinstance(item, dict) else {} for item in payload["records"]]
    if isinstance(payload.get("frames"), list):
        rows = [item if isinstance(item, dict) else {} for item in payload["frames"]]
        return [
            {
                "frame_idx": row.get("frame_idx"),
                "timestamp_sec": row.get("timestamp_sec"),
                "frame_weight": row.get("frame_weight", 1.0),
                "result_data": row.get("result_data") if isinstance(row.get("result_data"), dict) else {},
                "row": row,
            }
            for row in rows
        ]
    if isinstance(payload.get("rows"), list):
        rows = [item if isinstance(item, dict) else {} for item in payload["rows"]]
        return [
            {
                "frame_idx": row.get("frame_idx"),
                "timestamp_sec": row.get("timestamp_sec"),
                "frame_weight": row.get("frame_weight", 1.0),
                "result_data": row.get("result_data") if isinstance(row.get("result_data"), dict) else {},
                "row": row,
            }
            for row in rows
        ]
    raise RuntimeError("不支持的 Holistic JSON 格式：缺少 records / frames / rows")


def _has_landmark_records(records: Sequence[Dict[str, Any]]) -> bool:
    expected_counts = {
        "pose_landmarks": POSE_LANDMARK_COUNT,
        "left_hand_landmarks": HAND_LANDMARK_COUNT,
        "right_hand_landmarks": HAND_LANDMARK_COUNT,
    }
    for item in records:
        result_data = _record_dict(item, "result_data")
        for group, expected_count in expected_counts.items():
            landmarks = result_data.get(group)
            if (
                isinstance(landmarks, (list, tuple))
                and len(landmarks) == expected_count
                and any(isinstance(point, dict) for point in landmarks)
            ):
                return True
    return False


def _landmark_array(
    items: Any,
    indices: Optional[Sequence[int]] = None,
    expected_count: Optional[int] = None,
    required_input_count: Optional[int] = None,
    xy_bounds: Optional[Tuple[float, float]] = None,
    z_bounds: Optional[Tuple[float, float]] = None,
    zero_missing_eps: Optional[float] = None,
) -> Tuple[np.ndarray, np.ndarray]:
    if not isinstance(items, (list, tuple)):
        items = []
    elif items and required_input_count is not None and len(items) != required_input_count:
        items = []
    if indices is not None:
        selected = list(indices)
    elif expected_count is not None:
        selected = list(range(expected_count))
    else:
        selected = list(range(len(items)))
    coords: List[List[float]] = []
    mask: List[float] = []
    for idx in selected:
        if 0 <= idx < len(items):
            lm = items[idx]
            if not isinstance(lm, dict):
                point = [0.0, 0.0, 0.0]
                visible = False
            else:
                try:
                    point = [float(lm.get("x", 0.0)), float(lm.get("y", 0.0)), float(lm.get("z", 0.0))]
                except (TypeError, ValueError):
                    point = [0.0, 0.0, 0.0]
                    visible = False
                else:
                    visible = bool(np.isfinite(point).all())
                    if visible and xy_bounds is not None:
                        low, high = xy_bounds
                        visible = low <= point[0] <= high and low <= point[1] <= high
                    if visible and z_bounds is not None:
                        low, high = z_bounds
                        visible = low <= point[2] <= high
                    if visible and zero_missing_eps is not None and all(abs(value) <= zero_missing_eps for value in point):
                        visible = False
                    if not visible:
                        point = [0.0, 0.0, 0.0]
            coords.append(point)
            mask.append(1.0 if visible else 0.0)
        else:
            coords.append([0.0, 0.0, 0.0])
            mask.append(0.0)
    return np.asarray(coords, dtype=np.float32), np.asarray(mask, dtype=np.float32)


def _mask_degenerate_hand(hand: np.ndarray, hand_mask: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    if hand.size == 0 or hand_mask.size == 0:
        return hand, hand_mask
    visible = hand_mask > 0
    if int(visible.sum()) < HAND_DEGENERATE_VISIBLE_MIN_POINTS:
        return hand, hand_mask
    xy = hand[visible, :2]
    if not np.isfinite(xy).all():
        return hand, hand_mask
    span = np.ptp(xy, axis=0)
    if float(max(span[0], span[1])) > HAND_DEGENERATE_XY_SPAN_MIN:
        return hand, hand_mask
    out = hand.copy()
    out_mask = hand_mask.copy()
    out[visible, :] = 0.0
    out_mask[visible] = 0.0
    return out, out_mask


def _mask_hand_wrist_identity_corruption(hand: np.ndarray, hand_mask: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    if hand.shape != (HAND_LANDMARK_COUNT, 3) or hand_mask.size != HAND_LANDMARK_COUNT:
        return hand, hand_mask
    if hand_mask[0] <= 0 or not np.isfinite(hand[0, 2]):
        return hand, hand_mask
    # MediaPipe hand z is wrist-relative, so landmark 0 must stay at the z
    # origin. A displaced z origin means an exact-length array was reordered.
    if abs(float(hand[0, 2])) <= HAND_WRIST_Z_ORIGIN_MAX:
        return hand, hand_mask
    out = hand.copy()
    out_mask = hand_mask.copy()
    visible = out_mask > 0
    out[visible, :] = 0.0
    out_mask[visible] = 0.0
    return out, out_mask


def _hand_global_quantization_signature(hand: np.ndarray, hand_mask: np.ndarray) -> Optional[Dict[str, Any]]:
    if hand.shape != (HAND_LANDMARK_COUNT, 3) or hand_mask.size != HAND_LANDMARK_COUNT:
        return None
    visible_indices = np.flatnonzero(hand_mask > 0)
    if visible_indices.size < HAND_GLOBAL_QUANTIZATION_VISIBLE_MIN_POINTS:
        return None
    visible = hand[visible_indices]
    if not np.isfinite(visible).all():
        return None
    matched_steps: List[float] = []
    for axis in range(3):
        deltas = visible[:, axis] - visible[0, axis]
        matched_step = next(
            (
                step
                for step in HAND_GLOBAL_QUANTIZATION_STEPS
                if float(np.max(np.abs(deltas / step - np.round(deltas / step))))
                <= HAND_GLOBAL_QUANTIZATION_RESIDUAL_MAX
            ),
            None,
        )
        if matched_step is None:
            return None
        matched_steps.append(float(matched_step))
    return {
        "visible_point_count": int(visible_indices.size),
        "axis_steps": matched_steps,
    }


def _hand_landmark_collision_metrics(hand: np.ndarray, hand_mask: np.ndarray) -> Optional[Dict[str, Any]]:
    if hand.shape != (HAND_LANDMARK_COUNT, 3) or hand_mask.size != HAND_LANDMARK_COUNT:
        return None
    visible_indices = np.flatnonzero(hand_mask > 0)
    quantization_signature = _hand_global_quantization_signature(hand, hand_mask)
    if visible_indices.size < 2 or not np.isfinite(hand[visible_indices]).all():
        return {
            "collision_pair_count": 0,
            "collision_participant_count": 0,
            "max_collision_cluster_size": 0,
            "collision_indices": [],
            "global_quantization_signature": quantization_signature,
            "corrupted": False,
        }

    adjacency: Dict[int, set[int]] = {}
    collision_pair_count = 0
    distance_sq_max = HAND_LANDMARK_COLLISION_DISTANCE_MAX**2
    for offset, left_index in enumerate(visible_indices[:-1]):
        for right_index in visible_indices[offset + 1 :]:
            delta = hand[int(left_index)] - hand[int(right_index)]
            if float(np.dot(delta, delta)) > distance_sq_max:
                continue
            left = int(left_index)
            right = int(right_index)
            adjacency.setdefault(left, set()).add(right)
            adjacency.setdefault(right, set()).add(left)
            collision_pair_count += 1

    collision_indices = sorted(adjacency)
    visited: set[int] = set()
    max_cluster_size = 0
    for index in collision_indices:
        if index in visited:
            continue
        stack = [index]
        visited.add(index)
        cluster_size = 0
        while stack:
            current = stack.pop()
            cluster_size += 1
            for neighbor in adjacency[current]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    stack.append(neighbor)
        max_cluster_size = max(max_cluster_size, cluster_size)

    return {
        "collision_pair_count": collision_pair_count,
        "collision_participant_count": len(collision_indices),
        "max_collision_cluster_size": max_cluster_size,
        "collision_indices": collision_indices,
        "global_quantization_signature": quantization_signature,
        "corrupted": bool(collision_indices and quantization_signature is None),
    }


def _mask_hand_landmark_collisions(hand: np.ndarray, hand_mask: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    metrics = _hand_landmark_collision_metrics(hand, hand_mask)
    if not metrics or not bool(metrics["corrupted"]):
        return hand, hand_mask
    out = hand.copy()
    out_mask = hand_mask.copy()
    collision_indices = np.asarray(metrics["collision_indices"], dtype=np.int64)
    out[collision_indices, :] = 0.0
    out_mask[collision_indices] = 0.0
    return out, out_mask


def _hand_bone_length_integrity_metrics(hand: np.ndarray, hand_mask: np.ndarray) -> Optional[Dict[str, Any]]:
    if hand.shape != (HAND_LANDMARK_COUNT, 3) or hand_mask.size != HAND_LANDMARK_COUNT:
        return None
    quantization_signature = _hand_global_quantization_signature(hand, hand_mask)
    if quantization_signature is not None:
        return {
            "palm_scale": None,
            "visible_point_count": int(np.sum(hand_mask > 0)),
            "palm_ref_count": None,
            "evaluated_edge_count": 0,
            "minimum_bone_length_ratio": None,
            "maximum_bone_length_ratio": None,
            "short_edge_count": 0,
            "long_edge_count": 0,
            "corrupted_edges": [],
            "corrupted_indices": [],
            "global_quantization_signature": quantization_signature,
            "quantization_bypassed": True,
            "corrupted": False,
        }
    visible = (hand_mask > 0) & np.isfinite(hand).all(axis=1)
    visible_point_count = int(visible.sum())
    if visible_point_count < HAND_BONE_LENGTH_VISIBLE_MIN_POINTS or not bool(visible[0]):
        return None

    palm_refs = [_dist(hand[idx], hand[0]) for idx in (5, 9, 13, 17) if visible[idx]]
    if visible[5] and visible[17]:
        palm_refs.append(_dist(hand[5], hand[17]))
    palm_refs = [value for value in palm_refs if math.isfinite(value) and value > 1e-8]
    if len(palm_refs) < HAND_BONE_LENGTH_PALM_REF_MIN:
        return None
    palm_scale = float(np.median(np.asarray(palm_refs, dtype=np.float32)))
    if not math.isfinite(palm_scale) or palm_scale <= 1e-8:
        return None

    ratios: List[float] = []
    short_edges: List[Tuple[int, int]] = []
    long_edges: List[Tuple[int, int]] = []
    for chain in HAND_FINGER_CHAINS:
        for start, end in zip(chain[:-1], chain[1:]):
            if not (visible[start] and visible[end]):
                continue
            ratio = _dist(hand[start], hand[end]) / palm_scale
            ratios.append(ratio)
            if ratio < HAND_BONE_LENGTH_RATIO_MIN:
                short_edges.append((start, end))
            elif ratio > HAND_BONE_LENGTH_RATIO_MAX:
                long_edges.append((start, end))

    corrupted_edges = short_edges + long_edges
    corrupted_indices = sorted({index for edge in corrupted_edges for index in edge})
    if not ratios:
        return None
    return {
        "palm_scale": palm_scale,
        "visible_point_count": visible_point_count,
        "palm_ref_count": len(palm_refs),
        "evaluated_edge_count": len(ratios),
        "minimum_bone_length_ratio": min(ratios),
        "maximum_bone_length_ratio": max(ratios),
        "short_edge_count": len(short_edges),
        "long_edge_count": len(long_edges),
        "corrupted_edges": corrupted_edges,
        "corrupted_indices": corrupted_indices,
        "global_quantization_signature": None,
        "quantization_bypassed": False,
        "corrupted": bool(corrupted_edges),
    }


def _mask_hand_bone_length_corruption(hand: np.ndarray, hand_mask: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    metrics = _hand_bone_length_integrity_metrics(hand, hand_mask)
    if not metrics or not bool(metrics["corrupted"]):
        return hand, hand_mask
    out = hand.copy()
    out_mask = hand_mask.copy()
    corrupted_indices = np.asarray(metrics["corrupted_indices"], dtype=np.int64)
    out[corrupted_indices, :] = 0.0
    out_mask[corrupted_indices] = 0.0
    return out, out_mask


def _hand_internal_topology_metrics(hand: np.ndarray, hand_mask: np.ndarray) -> Optional[Dict[str, Any]]:
    if hand.shape != (HAND_LANDMARK_COUNT, 3) or hand_mask.size != HAND_LANDMARK_COUNT:
        return None
    if not bool(np.all(hand_mask > 0)) or not np.isfinite(hand).all():
        return None

    xy = hand[:, :2]
    wrist = xy[0]
    backtrack_turn_count = 0
    reversed_chain_count = 0
    proximal_distal_ratios: List[float] = []
    for chain_index, chain in enumerate(HAND_FINGER_CHAINS):
        points_xy = xy[list(chain)]
        vectors = np.diff(points_xy, axis=0)
        for vector_index in range(len(vectors) - 1):
            if float(np.dot(vectors[vector_index], vectors[vector_index + 1])) < 0.0:
                backtrack_turn_count += 1
        if float(np.linalg.norm(points_xy[0] - wrist)) > float(np.linalg.norm(points_xy[-1] - wrist)):
            reversed_chain_count += 1
        if chain_index > 0:
            points_xyz = hand[list(chain)]
            proximal = float(np.linalg.norm(points_xyz[1] - points_xyz[0]))
            distal = float(np.linalg.norm(points_xyz[3] - points_xyz[2]))
            proximal_distal_ratios.append(proximal / max(distal, 1e-12))

    median_proximal_distal_ratio = float(np.median(proximal_distal_ratios))
    corrupted = bool(
        backtrack_turn_count >= HAND_INTERNAL_TOPOLOGY_BACKTRACK_TURN_MIN
        or median_proximal_distal_ratio < HAND_INTERNAL_TOPOLOGY_PROXIMAL_DISTAL_RATIO_MIN
        or (
            reversed_chain_count >= HAND_INTERNAL_TOPOLOGY_REVERSED_CHAIN_MIN
            and median_proximal_distal_ratio < HAND_INTERNAL_TOPOLOGY_REVERSED_RATIO_MAX
        )
    )
    return {
        "backtrack_turn_count": backtrack_turn_count,
        "reversed_chain_count": reversed_chain_count,
        "median_proximal_distal_ratio": median_proximal_distal_ratio,
        "corrupted": corrupted,
    }


def _mask_hand_internal_topology_corruption(
    hand: np.ndarray,
    hand_mask: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray]:
    metrics = _hand_internal_topology_metrics(hand, hand_mask)
    if not metrics or not bool(metrics["corrupted"]):
        return hand, hand_mask
    out = hand.copy()
    out_mask = hand_mask.copy()
    visible = out_mask > 0
    out[visible, :] = 0.0
    out_mask[visible] = 0.0
    return out, out_mask


def _hand_landmark_arrays(result_data: Dict[str, Any]) -> Tuple[Tuple[np.ndarray, np.ndarray], Tuple[np.ndarray, np.ndarray]]:
    xy_bounds = (LANDMARK_XY_VISIBLE_MIN, LANDMARK_XY_VISIBLE_MAX)
    z_bounds = (LANDMARK_Z_VISIBLE_MIN, LANDMARK_Z_VISIBLE_MAX)
    left, left_mask = _landmark_array(
        result_data.get("left_hand_landmarks") or [],
        expected_count=21,
        required_input_count=HAND_LANDMARK_COUNT,
        xy_bounds=xy_bounds,
        z_bounds=z_bounds,
        zero_missing_eps=LANDMARK_ZERO_MISSING_EPS,
    )
    right, right_mask = _landmark_array(
        result_data.get("right_hand_landmarks") or [],
        expected_count=21,
        required_input_count=HAND_LANDMARK_COUNT,
        xy_bounds=xy_bounds,
        z_bounds=z_bounds,
        zero_missing_eps=LANDMARK_ZERO_MISSING_EPS,
    )
    left, left_mask = _mask_degenerate_hand(left, left_mask)
    right, right_mask = _mask_degenerate_hand(right, right_mask)
    left, left_mask = _mask_hand_wrist_identity_corruption(left, left_mask)
    right, right_mask = _mask_hand_wrist_identity_corruption(right, right_mask)
    left, left_mask = _mask_hand_landmark_collisions(left, left_mask)
    right, right_mask = _mask_hand_landmark_collisions(right, right_mask)
    left, left_mask = _mask_hand_bone_length_corruption(left, left_mask)
    right, right_mask = _mask_hand_bone_length_corruption(right, right_mask)
    left, left_mask = _mask_degenerate_hand(left, left_mask)
    right, right_mask = _mask_degenerate_hand(right, right_mask)
    return _mask_hand_internal_topology_corruption(left, left_mask), _mask_hand_internal_topology_corruption(
        right,
        right_mask,
    )


def _sanitize_frame_weight(value: Any, default: float = 1.0) -> float:
    try:
        weight = float(value)
    except (TypeError, ValueError):
        return float(default)
    if not math.isfinite(weight):
        return float(default)
    return max(FRAME_WEIGHT_MIN, min(FRAME_WEIGHT_RAW_MAX, weight))


def _finite_float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return float(default)
    return number if math.isfinite(number) else float(default)


def _parse_temporal_int(value: Any, minimum: int = 0, maximum: Optional[int] = None) -> Optional[int]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    parsed = int(number)
    if abs(number - parsed) > 1e-6 or parsed < minimum:
        return None
    if maximum is not None and parsed > maximum:
        return None
    return parsed


def _sanitize_fps(value: Any, default: float = DEFAULT_FPS) -> float:
    try:
        fps = float(value)
    except (TypeError, ValueError):
        return float(default)
    if not math.isfinite(fps) or fps < FPS_MIN or fps > FPS_MAX:
        return float(default)
    return fps


def _record_dict(record: Any, key: str) -> Dict[str, Any]:
    if not isinstance(record, dict):
        return {}
    value = record.get(key)
    return value if isinstance(value, dict) else {}


def _frame_index_limit(record_count: int) -> int:
    return min(TOTAL_FRAMES_MAX - 1, max(FRAME_INDEX_MIN_LIMIT, int(record_count) * FRAME_INDEX_RECORD_MULTIPLIER))


def _first_valid_frame_idx(record: Dict[str, Any], maximum: int, *, prefer_row: bool = False) -> Optional[int]:
    row = _record_dict(record, "row")
    sources = (row, record) if prefer_row else (record, row)
    for source in sources:
        parsed = _parse_temporal_int(source.get("frame_idx"), minimum=0, maximum=maximum)
        if parsed is not None:
            return parsed
    return None


def _observed_frame_count(records: Sequence[Dict[str, Any]], maximum: int) -> int:
    observed = [
        frame_idx
        for record in records
        if isinstance(record, dict)
        for frame_idx in [_first_valid_frame_idx(record, maximum)]
        if frame_idx is not None
    ]
    return max(observed, default=-1) + 1


def _sanitize_total_frames(value: Any, record_count: int, observed_frame_count: int, maximum: int) -> int:
    parsed = _parse_temporal_int(value, minimum=1, maximum=min(TOTAL_FRAMES_MAX, maximum + 1))
    return max(int(record_count), int(observed_frame_count), parsed if parsed is not None else 0)


def _fallback_frame_idx(record_index: int, record_count: int, total_frames: int) -> int:
    if record_count <= 1 or total_frames <= 1:
        return 0
    return int(round(float(record_index) * float(total_frames - 1) / float(record_count - 1)))


def _parse_timestamp(value: Any, frame_idx: int, fps: float, total_frames: int) -> Optional[float]:
    safe_fps = _sanitize_fps(fps)
    duration_hint = max(float(total_frames), float(frame_idx + 1)) / safe_fps
    maximum = max(TIMESTAMP_MIN_LIMIT_SEC, duration_hint * TIMESTAMP_DURATION_MULTIPLIER)
    try:
        timestamp = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(timestamp) or timestamp < 0.0 or timestamp > maximum:
        return None
    return timestamp


def _frame_temporal_metadata(
    record: Dict[str, Any],
    fps: float,
    fallback_frame_idx: int,
    max_frame_idx: Optional[int],
    total_frames: int,
    *,
    prefer_row: bool = False,
) -> Tuple[int, float]:
    row = _record_dict(record, "row")
    sources = (row, record) if prefer_row else (record, row)
    frame_idx = _first_valid_frame_idx(record, max_frame_idx, prefer_row=prefer_row)
    if frame_idx is None:
        frame_idx = int(fallback_frame_idx)
    timestamp = None
    for source in sources:
        timestamp = _parse_timestamp(source.get("timestamp_sec"), frame_idx, fps, total_frames)
        if timestamp is not None:
            break
    if timestamp is None:
        timestamp = float(frame_idx) / _sanitize_fps(fps)
    return frame_idx, timestamp


def _stabilize_feature_temporal_metadata(features: List[FrameFeature], total_frames: int, fps: float) -> None:
    if not features:
        return
    frame_indices = [int(feature.frame_idx) for feature in features]
    frame_indices_strict = all(
        0 <= value < total_frames for value in frame_indices
    ) and all(left < right for left, right in zip(frame_indices, frame_indices[1:]))
    if not frame_indices_strict:
        for index, feature in enumerate(features):
            feature.frame_idx = _fallback_frame_idx(index, len(features), total_frames)

    timestamps = [float(feature.timestamp_sec) for feature in features]
    timestamps_strict = all(math.isfinite(value) and value >= 0.0 for value in timestamps) and all(
        left < right for left, right in zip(timestamps, timestamps[1:])
    )
    if not timestamps_strict or not frame_indices_strict:
        safe_fps = _sanitize_fps(fps)
        for feature in features:
            feature.timestamp_sec = float(feature.frame_idx) / safe_fps


def _hand_fallback_normalization(
    hands: Sequence[Tuple[np.ndarray, np.ndarray]],
) -> Optional[Tuple[np.ndarray, float]]:
    centers: List[np.ndarray] = []
    palm_scales: List[float] = []
    for hand, hand_mask in hands:
        if hand.size == 0 or hand_mask.size == 0:
            continue
        visible = (hand_mask > 0) & np.isfinite(hand[:, :3]).all(axis=1)
        if not visible.any():
            continue
        if visible[0]:
            centers.append(np.asarray(hand[0, :3], dtype=np.float32))
        else:
            centers.append(np.asarray(np.median(hand[visible, :3], axis=0), dtype=np.float32))

        if not visible[0]:
            continue
        distances: List[float] = []
        for idx in [5, 9, 13, 17]:
            if idx < len(visible) and visible[idx]:
                distances.append(_dist(hand[idx], hand[0]))
        if len(visible) > 17 and visible[5] and visible[17]:
            distances.append(_dist(hand[5], hand[17]))
        finite_distances = [value for value in distances if math.isfinite(value) and value > 1e-6]
        if len(finite_distances) >= 2:
            palm_scales.append(float(np.mean(finite_distances)))

    if not centers or not palm_scales:
        return None
    center = np.asarray(np.mean(np.stack(centers, axis=0), axis=0), dtype=np.float32)
    scale = float(np.median(np.asarray(palm_scales, dtype=np.float32))) * POSE_FALLBACK_HAND_SCALE_FACTOR
    scale = max(POSE_FALLBACK_SCALE_MIN, min(POSE_FALLBACK_SCALE_MAX, scale))
    return center, scale


def _shoulder_normalization(
    pose: np.ndarray,
    pose_mask: np.ndarray,
    hands: Sequence[Tuple[np.ndarray, np.ndarray]] = (),
) -> Optional[Tuple[np.ndarray, float]]:
    finite_points = np.isfinite(pose[:, :3]).all(axis=1) if pose.size else np.zeros(0, dtype=bool)
    if not (pose.shape[0] >= 3 and pose_mask[1] > 0 and pose_mask[2] > 0 and finite_points[1] and finite_points[2]):
        return None
    scale = float(np.linalg.norm(pose[1, :2] - pose[2, :2]))
    shoulders = pose[[1, 2], :3]
    center = np.asarray((pose[1] + pose[2]) / 2.0, dtype=np.float32)
    shoulders_valid = (
        np.all((shoulders[:, 0] >= POSE_SHOULDER_X_MIN) & (shoulders[:, 0] <= POSE_SHOULDER_X_MAX))
        and np.all((shoulders[:, 1] >= POSE_SHOULDER_Y_MIN) & (shoulders[:, 1] <= POSE_SHOULDER_Y_MAX))
        and np.all((shoulders[:, 2] >= POSE_SHOULDER_Z_MIN) & (shoulders[:, 2] <= POSE_SHOULDER_Z_MAX))
        and POSE_SHOULDER_SCALE_MIN <= scale <= POSE_SHOULDER_SCALE_MAX
    )
    if not shoulders_valid:
        return None

    def pose_point_valid(idx: int) -> bool:
        return idx < len(pose_mask) and pose_mask[idx] > 0 and idx < len(finite_points) and finite_points[idx]

    if pose_point_valid(0):
        shoulder_nose_y_gap = float(center[1] - pose[0, 1])
        shoulder_nose_z_gap = float(center[2] - pose[0, 2])
        if not (
            POSE_SHOULDER_NOSE_Y_GAP_MIN <= shoulder_nose_y_gap <= POSE_SHOULDER_NOSE_Y_GAP_MAX
            and POSE_SHOULDER_NOSE_Z_GAP_MIN <= shoulder_nose_z_gap <= POSE_SHOULDER_NOSE_Z_GAP_MAX
        ):
            return None

    if pose_point_valid(7) and pose_point_valid(8):
        hip_center = (pose[7] + pose[8]) / 2.0
        hip_width = float(np.linalg.norm(pose[7, :2] - pose[8, :2]))
        shoulder_hip_y_gap = float(hip_center[1] - center[1])
        shoulder_hip_z_gap = float(center[2] - hip_center[2])
        shoulder_hip_x_delta = abs(float(center[0] - hip_center[0]))
        if not (
            POSE_SHOULDER_HIP_Y_GAP_MIN <= shoulder_hip_y_gap <= POSE_SHOULDER_HIP_Y_GAP_MAX
            and POSE_SHOULDER_HIP_Z_GAP_MIN <= shoulder_hip_z_gap <= POSE_SHOULDER_HIP_Z_GAP_MAX
            and shoulder_hip_x_delta <= POSE_SHOULDER_HIP_X_DELTA_MAX
        ):
            return None
        if hip_width > 1e-6:
            shoulder_hip_width_ratio = scale / hip_width
            if not POSE_SHOULDER_HIP_WIDTH_RATIO_MIN <= shoulder_hip_width_ratio <= POSE_SHOULDER_HIP_WIDTH_RATIO_MAX:
                return None

    pose_wrists = [pose[idx] for idx in (5, 6) if pose_point_valid(idx)]
    if pose_wrists:
        for hand, hand_mask in hands:
            if hand.size == 0 or hand_mask.size == 0 or hand_mask[0] <= 0 or not np.isfinite(hand[0, :3]).all():
                continue
            wrist_distance = min(float(np.linalg.norm(hand[0, :2] - pose_wrist[:2])) for pose_wrist in pose_wrists)
            if wrist_distance > POSE_HAND_WRIST_XY_DISTANCE_MAX:
                return None
    return center, scale


def _normalization_from_pose(
    pose: np.ndarray,
    pose_mask: np.ndarray,
    hands: Sequence[Tuple[np.ndarray, np.ndarray]] = (),
    allow_shoulders: bool = True,
) -> Tuple[np.ndarray, float]:
    finite_points = np.isfinite(pose[:, :3]).all(axis=1) if pose.size else np.zeros(0, dtype=bool)
    if allow_shoulders:
        shoulder_normalization = _shoulder_normalization(pose, pose_mask, hands)
        if shoulder_normalization is not None:
            return shoulder_normalization

    hand_fallback = _hand_fallback_normalization(hands)
    if hand_fallback is not None:
        return hand_fallback

    valid_mask = (pose_mask > 0) & finite_points
    if pose.size:
        valid_mask &= (
            (pose[:, 0] >= POSE_FALLBACK_XY_MIN)
            & (pose[:, 0] <= POSE_FALLBACK_XY_MAX)
            & (pose[:, 1] >= POSE_FALLBACK_XY_MIN)
            & (pose[:, 1] <= POSE_FALLBACK_XY_MAX)
            & (pose[:, 2] >= POSE_FALLBACK_Z_MIN)
            & (pose[:, 2] <= POSE_FALLBACK_Z_MAX)
        )
    valid = pose[valid_mask]
    if len(valid) > 0:
        center = np.asarray(np.median(valid[:, :3], axis=0), dtype=np.float32)
        if len(valid) >= 3:
            low = np.quantile(valid[:, :2], 0.10, axis=0)
            high = np.quantile(valid[:, :2], 0.90, axis=0)
            scale = float(np.linalg.norm(high - low))
        else:
            scale = float(np.linalg.norm(np.ptp(valid[:, :2], axis=0)))
        scale = max(POSE_FALLBACK_SCALE_MIN, min(POSE_FALLBACK_SCALE_MAX, scale))
        return center, scale
    return np.zeros(3, dtype=np.float32), 1.0


def _dist(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a[:3] - b[:3]))


def _angle_straightness(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    left = a[:3] - b[:3]
    right = c[:3] - b[:3]
    denom = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denom <= 1e-8:
        return 0.0
    cos_value = float(np.dot(left, right) / denom)
    cos_value = max(-1.0, min(1.0, cos_value))
    return (1.0 - cos_value) / 2.0


def _hand_shape_feature(hand: np.ndarray, hand_mask: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    values: List[float] = []
    masks: List[float] = []

    wrist_ok = hand_mask[0] > 0 if len(hand_mask) > 0 else False
    palm_refs: List[float] = []
    for idx in [5, 9, 13, 17]:
        if wrist_ok and idx < len(hand_mask) and hand_mask[idx] > 0:
            palm_refs.append(_dist(hand[idx], hand[0]))
    if hand_mask[5] > 0 and hand_mask[17] > 0:
        palm_refs.append(_dist(hand[5], hand[17]))
    if not palm_refs:
        # Hand-shape ratios need a trustworthy palm scale. If wrist/MCP anchors
        # are absent, visible fingertips should still contribute through the raw
        # hand landmark group, but derived shape ratios would be numerically
        # unstable and should be treated as missing for this frame.
        return np.zeros(20, dtype=np.float32), np.zeros(20, dtype=np.float32)
    palm_scale = max(float(np.mean(palm_refs)), 1e-3)

    def append_distance(a_idx: int, b_idx: int) -> None:
        ok = a_idx < len(hand_mask) and b_idx < len(hand_mask) and hand_mask[a_idx] > 0 and hand_mask[b_idx] > 0
        values.append((_dist(hand[a_idx], hand[b_idx]) / palm_scale) if ok else 0.0)
        masks.append(1.0 if ok else 0.0)

    for tip in FINGER_TIPS:
        append_distance(0, tip)
    for a_idx, b_idx in SPREAD_PAIRS:
        append_distance(a_idx, b_idx)
    for mcp, tip in zip(FINGER_MCPS, FINGER_TIPS):
        append_distance(mcp, tip)
    for mcp, pip, tip in zip(FINGER_MCPS, FINGER_PIPS, FINGER_TIPS):
        ok = hand_mask[mcp] > 0 and hand_mask[pip] > 0 and hand_mask[tip] > 0
        values.append(_angle_straightness(hand[mcp], hand[pip], hand[tip]) if ok else 0.0)
        masks.append(1.0 if ok else 0.0)

    return np.asarray(values, dtype=np.float32), np.asarray(masks, dtype=np.float32)


def _append_group(parts: List[np.ndarray], masks: List[np.ndarray], groups: Dict[str, slice], name: str, arr: np.ndarray, mask: np.ndarray) -> None:
    start = sum(part.size for part in parts)
    flat = arr.reshape(-1)
    parts.append(flat)
    repeat = max(1, int(flat.size / max(int(mask.size), 1)))
    masks.append(np.repeat(mask, repeat))
    groups[name] = slice(start, start + flat.size)


def _landmark_feature(
    record: Dict[str, Any],
    fps: float,
    fallback_frame_idx: int = 0,
    max_frame_idx: Optional[int] = None,
    total_frames: int = 0,
    normalization_override: Optional[Tuple[np.ndarray, float]] = None,
) -> FrameFeature:
    result_data = _record_dict(record, "result_data")
    row = _record_dict(record, "row")
    pose, pose_mask = _landmark_array(
        result_data.get("pose_landmarks") or [],
        POSE_CORE_INDICES,
        required_input_count=POSE_LANDMARK_COUNT,
    )
    xy_bounds = (LANDMARK_XY_VISIBLE_MIN, LANDMARK_XY_VISIBLE_MAX)
    z_bounds = (LANDMARK_Z_VISIBLE_MIN, LANDMARK_Z_VISIBLE_MAX)
    (left, left_mask), (right, right_mask) = _hand_landmark_arrays(result_data)
    face, face_mask = _landmark_array(
        result_data.get("face_landmarks") or [],
        FACE_CORE_INDICES,
        required_input_count=FACE_LANDMARK_COUNT,
        xy_bounds=xy_bounds,
        z_bounds=z_bounds,
        zero_missing_eps=LANDMARK_ZERO_MISSING_EPS,
    )

    center, scale = normalization_override or _normalization_from_pose(
        pose,
        pose_mask,
        ((left, left_mask), (right, right_mask)),
    )

    def norm(arr: np.ndarray) -> np.ndarray:
        if arr.size == 0:
            return arr
        out = arr.copy()
        out[:, :3] = (out[:, :3] - center) / scale
        return out

    parts: List[np.ndarray] = []
    masks: List[np.ndarray] = []
    groups: Dict[str, slice] = {}
    _append_group(parts, masks, groups, "pose", norm(pose), pose_mask)
    _append_group(parts, masks, groups, "left_hand", norm(left), left_mask)
    _append_group(parts, masks, groups, "right_hand", norm(right), right_mask)
    left_shape, left_shape_mask = _hand_shape_feature(norm(left), left_mask)
    right_shape, right_shape_mask = _hand_shape_feature(norm(right), right_mask)
    _append_group(parts, masks, groups, "left_hand_shape", left_shape.reshape(-1, 1), left_shape_mask)
    _append_group(parts, masks, groups, "right_hand_shape", right_shape.reshape(-1, 1), right_shape_mask)
    _append_group(parts, masks, groups, "face", norm(face), face_mask)

    frame_idx, timestamp = _frame_temporal_metadata(
        record,
        fps,
        fallback_frame_idx,
        max_frame_idx,
        total_frames,
    )
    raw_weight = record.get("frame_weight", row.get("frame_weight", 1.0))
    frame_weight = _sanitize_frame_weight(raw_weight)
    return FrameFeature(
        frame_idx=frame_idx,
        timestamp_sec=timestamp,
        vector=np.concatenate(parts).astype(np.float32),
        mask=np.concatenate(masks).astype(np.float32),
        groups=groups,
        presence={
            "pose": bool(pose_mask.sum() > 0),
            "left_hand": bool(left_mask.sum() > 0),
            "right_hand": bool(right_mask.sum() > 0),
            "face": bool(face_mask.sum() > 0),
        },
        frame_weight=frame_weight,
    )


def _bbox_to_features(row: Dict[str, Any]) -> Tuple[np.ndarray, np.ndarray, Dict[str, slice], Dict[str, bool]]:
    pose_box = _record_dict(_record_dict(row, "pose"), "bbox")
    pose_x_min = _finite_float(pose_box.get("x_min"), 0.0)
    pose_x_max = _finite_float(pose_box.get("x_max"), 1.0)
    pose_y_min = _finite_float(pose_box.get("y_min"), 0.0)
    pose_y_max = _finite_float(pose_box.get("y_max"), 1.0)
    center_x = (pose_x_min + pose_x_max) / 2.0
    center_y = (pose_y_min + pose_y_max) / 2.0
    span_x = max(pose_x_max - pose_x_min, 1.0)
    span_y = max(pose_y_max - pose_y_min, 1.0)
    scale = max(math.hypot(span_x, span_y), 1.0)

    parts: List[np.ndarray] = []
    masks: List[np.ndarray] = []
    groups: Dict[str, slice] = {}
    presence: Dict[str, bool] = {}
    for group in ["pose", "left_hand", "right_hand", "face"]:
        group_data = _record_dict(row, group)
        raw_box = group_data.get("bbox")
        box = raw_box if isinstance(raw_box, dict) else {}
        present = bool(row.get(f"{group}_present")) and isinstance(raw_box, dict)
        presence[group] = present
        if present:
            x_min = (_finite_float(box.get("x_min"), center_x) - center_x) / scale
            x_max = (_finite_float(box.get("x_max"), center_x) - center_x) / scale
            y_min = (_finite_float(box.get("y_min"), center_y) - center_y) / scale
            y_max = (_finite_float(box.get("y_max"), center_y) - center_y) / scale
            vis = _finite_float(box.get("visibility_mean", group_data.get("visibility_mean", 0.0)), 0.0)
            arr = np.asarray([x_min, x_max, y_min, y_max, vis], dtype=np.float32)
            mask = np.ones(5, dtype=np.float32)
        else:
            arr = np.zeros(5, dtype=np.float32)
            mask = np.zeros(5, dtype=np.float32)
        start = sum(part.size for part in parts)
        parts.append(arr)
        masks.append(mask)
        groups[group] = slice(start, start + arr.size)

    return np.concatenate(parts), np.concatenate(masks), groups, presence


def _bbox_feature(
    record: Dict[str, Any],
    fps: float,
    fallback_frame_idx: int = 0,
    max_frame_idx: Optional[int] = None,
    total_frames: int = 0,
) -> FrameFeature:
    row = _record_dict(record, "row") or record
    vector, mask, groups, presence = _bbox_to_features(row)
    frame_idx, timestamp = _frame_temporal_metadata(
        record,
        fps,
        fallback_frame_idx,
        max_frame_idx,
        total_frames,
        prefer_row=True,
    )
    raw_weight = record.get("frame_weight", row.get("frame_weight", 1.0))
    frame_weight = _sanitize_frame_weight(raw_weight)
    return FrameFeature(frame_idx, timestamp, vector.astype(np.float32), mask.astype(np.float32), groups, presence, frame_weight)


def _apply_sidecar_frame_weights(path: Path, features: List[FrameFeature]) -> None:
    manifest_path = path.parent / "semantic_frame_weights.json"
    if not manifest_path.exists():
        return
    try:
        payload = _load_json(manifest_path)
    except Exception:
        return
    if not isinstance(payload, dict):
        return
    rows = payload.get("frame_weights") or []
    weight_by_idx: Dict[int, float] = {}
    max_frame_idx = max((feature.frame_idx for feature in features), default=None)
    for row in rows:
        if not isinstance(row, dict):
            continue
        frame_idx = _parse_temporal_int(row.get("frame_idx"), minimum=0, maximum=max_frame_idx)
        if frame_idx is None:
            continue
        weight = _sanitize_frame_weight(row.get("semantic_frame_weight", row.get("frame_weight", row.get("weight", 1.0))))
        weight_by_idx[frame_idx] = weight
    if not weight_by_idx:
        return
    for feature in features:
        if feature.frame_idx in weight_by_idx:
            feature.frame_weight = weight_by_idx[feature.frame_idx]


def _pose_normalization_overrides(records: Sequence[Dict[str, Any]]) -> List[Optional[Tuple[np.ndarray, float]]]:
    frame_data: List[Tuple[np.ndarray, np.ndarray, Tuple[Tuple[np.ndarray, np.ndarray], Tuple[np.ndarray, np.ndarray]]]] = []
    anchors: List[Optional[Tuple[np.ndarray, float]]] = []
    shoulder_hand_z_offsets: List[float] = []
    for record in records:
        result_data = _record_dict(record, "result_data")
        pose, pose_mask = _landmark_array(
            result_data.get("pose_landmarks") or [],
            POSE_CORE_INDICES,
            required_input_count=POSE_LANDMARK_COUNT,
        )
        hands = _hand_landmark_arrays(result_data)
        frame_data.append((pose, pose_mask, hands))
        anchors.append(_shoulder_normalization(pose, pose_mask, hands))
        finite_points = np.isfinite(pose[:, :3]).all(axis=1) if pose.size else np.zeros(0, dtype=bool)
        if (
            pose.shape[0] >= 3
            and pose_mask[1] > 0
            and pose_mask[2] > 0
            and finite_points[1]
            and finite_points[2]
        ):
            hand_wrist_z = [
                float(hand[0, 2])
                for hand, hand_mask in hands
                if hand.size > 0 and hand_mask.size > 0 and hand_mask[0] > 0 and np.isfinite(hand[0, :3]).all()
            ]
            if hand_wrist_z:
                shoulder_center_z = float((pose[1, 2] + pose[2, 2]) / 2.0)
                shoulder_hand_z_offsets.append(shoulder_center_z - float(np.mean(hand_wrist_z)))

    if len(shoulder_hand_z_offsets) >= POSE_SEQUENCE_RELATION_MIN_FRAMES:
        median_shoulder_hand_z = float(np.median(np.asarray(shoulder_hand_z_offsets, dtype=np.float32)))
        if not POSE_SEQUENCE_SHOULDER_HAND_Z_MEDIAN_MIN <= median_shoulder_hand_z <= POSE_SEQUENCE_SHOULDER_HAND_Z_MEDIAN_MAX:
            return [
                _normalization_from_pose(pose, pose_mask, hands, allow_shoulders=False)
                for pose, pose_mask, hands in frame_data
            ]

    valid_indices = [idx for idx, anchor in enumerate(anchors) if anchor is not None]
    if not valid_indices:
        return anchors

    previous_valid: List[Optional[int]] = []
    last_valid: Optional[int] = None
    for anchor in anchors:
        previous_valid.append(last_valid)
        if anchor is not None:
            last_valid = len(previous_valid) - 1
    next_valid: List[Optional[int]] = [None] * len(anchors)
    last_valid = None
    for idx in range(len(anchors) - 1, -1, -1):
        next_valid[idx] = last_valid
        if anchors[idx] is not None:
            last_valid = idx

    for idx, anchor in enumerate(anchors):
        if anchor is not None:
            continue
        left_idx = previous_valid[idx]
        right_idx = next_valid[idx]
        if left_idx is not None and right_idx is not None:
            left_center, left_scale = anchors[left_idx]  # type: ignore[misc]
            right_center, right_scale = anchors[right_idx]  # type: ignore[misc]
            fraction = float(idx - left_idx) / float(right_idx - left_idx)
            center = (1.0 - fraction) * left_center + fraction * right_center
            scale = (1.0 - fraction) * float(left_scale) + fraction * float(right_scale)
            anchors[idx] = np.asarray(center, dtype=np.float32), float(scale)
        elif left_idx is not None:
            left_center, left_scale = anchors[left_idx]  # type: ignore[misc]
            anchors[idx] = np.asarray(left_center, dtype=np.float32).copy(), float(left_scale)
        elif right_idx is not None:
            right_center, right_scale = anchors[right_idx]  # type: ignore[misc]
            anchors[idx] = np.asarray(right_center, dtype=np.float32).copy(), float(right_scale)
    return anchors


def load_sequence(
    path: Path,
    requested_mode: str = "auto",
    force_bbox: bool = False,
    apply_sidecar_weights: bool = True,
) -> SequenceData:
    payload = _load_json(path)
    if not isinstance(payload, dict):
        raise RuntimeError(f"不支持的 Holistic JSON 顶层结构：{path}")
    records = _records_from_payload(payload)
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    raw_fps = payload.get("fps") if payload.get("fps") is not None else meta.get("fps")
    raw_total_frames = payload.get("total_frames") if payload.get("total_frames") is not None else meta.get("frame_count")
    fps = _sanitize_fps(raw_fps)
    frame_idx_limit = _frame_index_limit(len(records))
    observed_frame_count = _observed_frame_count(records, frame_idx_limit)
    total_frames = _sanitize_total_frames(raw_total_frames, len(records), observed_frame_count, frame_idx_limit)
    max_frame_idx = min(frame_idx_limit, max(total_frames - 1, len(records) - 1))

    mode = requested_mode
    if requested_mode == "auto":
        mode = "landmark" if _has_landmark_records(records) and not force_bbox else "bbox"
    if force_bbox:
        mode = "bbox"

    if mode == "landmark":
        normalization_overrides = _pose_normalization_overrides(records)
        features = [
            _landmark_feature(
                record,
                fps,
                _fallback_frame_idx(idx, len(records), total_frames),
                max_frame_idx,
                total_frames,
                normalization_overrides[idx],
            )
            for idx, record in enumerate(records)
        ]
    elif mode == "bbox":
        features = [
            _bbox_feature(
                record,
                fps,
                _fallback_frame_idx(idx, len(records), total_frames),
                max_frame_idx,
                total_frames,
            )
            for idx, record in enumerate(records)
        ]
    else:
        raise RuntimeError(f"未知特征模式：{mode}")

    _stabilize_feature_temporal_metadata(features, total_frames, fps)
    features = sorted(features, key=lambda item: item.frame_idx)
    if apply_sidecar_weights:
        _apply_sidecar_frame_weights(path, features)
    if not features:
        raise RuntimeError(f"序列为空：{path}")
    return SequenceData(str(path), mode, fps, total_frames, features)


def _presence_ratio(seq: SequenceData) -> Dict[str, float]:
    result: Dict[str, float] = {}
    for group in ["pose", "left_hand", "right_hand", "face"]:
        result[group] = sum(1 for f in seq.features if f.presence.get(group)) / len(seq.features)
    return result


def _clone_frame(feature: FrameFeature, vector: Optional[np.ndarray] = None, mask: Optional[np.ndarray] = None) -> FrameFeature:
    return FrameFeature(
        frame_idx=feature.frame_idx,
        timestamp_sec=feature.timestamp_sec,
        vector=np.asarray(vector if vector is not None else feature.vector, dtype=np.float32).copy(),
        mask=np.asarray(mask if mask is not None else feature.mask, dtype=np.float32).copy(),
        groups=dict(feature.groups),
        presence=dict(feature.presence),
        frame_weight=float(feature.frame_weight),
        semantic_phase=float(feature.semantic_phase),
    )


def _clone_sequence(seq: SequenceData, source_suffix: str, features: Sequence[FrameFeature]) -> SequenceData:
    cloned: List[FrameFeature] = []
    for idx, feature in enumerate(features):
        item = _clone_frame(feature)
        item.frame_idx = idx
        item.timestamp_sec = idx / max(seq.fps, 1e-6)
        cloned.append(item)
    return SequenceData(f"{seq.source}::{source_suffix}", seq.mode, seq.fps, seq.total_frames, cloned)


def _append_feature_group(feature: FrameFeature, name: str, values: np.ndarray, mask: np.ndarray) -> FrameFeature:
    start = int(feature.vector.size)
    flat = np.asarray(values, dtype=np.float32).reshape(-1)
    flat_mask = np.asarray(mask, dtype=np.float32).reshape(-1)
    vector = np.concatenate([feature.vector, flat]).astype(np.float32)
    full_mask = np.concatenate([feature.mask, flat_mask]).astype(np.float32)
    groups = dict(feature.groups)
    groups[name] = slice(start, start + int(flat.size))
    return FrameFeature(
        frame_idx=feature.frame_idx,
        timestamp_sec=feature.timestamp_sec,
        vector=vector,
        mask=full_mask,
        groups=groups,
        presence=dict(feature.presence),
        frame_weight=float(feature.frame_weight),
        semantic_phase=float(feature.semantic_phase),
    )


def _directional_motion_feature(motion: np.ndarray, mask: np.ndarray) -> np.ndarray:
    valid = np.asarray(mask, dtype=np.float32) > 0
    out = np.asarray(motion, dtype=np.float32).copy()
    if not valid.any():
        return out
    norm = float(np.sqrt(np.mean(out[valid] ** 2)))
    if norm <= 1e-8:
        return out
    # Compare motion direction/trend more than frame-density-dependent magnitude.
    return (out / norm).astype(np.float32)


def _two_hand_relation_feature(feature: FrameFeature) -> Tuple[np.ndarray, np.ndarray]:
    relation = np.zeros(8, dtype=np.float32)
    relation_mask = np.zeros(8, dtype=np.float32)
    if "left_hand" not in feature.groups or "right_hand" not in feature.groups:
        return relation, relation_mask

    left_sl = feature.groups["left_hand"]
    right_sl = feature.groups["right_hand"]
    left_values = feature.vector[left_sl]
    right_values = feature.vector[right_sl]
    left_mask_values = feature.mask[left_sl]
    right_mask_values = feature.mask[right_sl]
    if (
        left_values.size < 21 * 3
        or right_values.size < 21 * 3
        or left_values.size % 3
        or right_values.size % 3
        or left_mask_values.size != left_values.size
        or right_mask_values.size != right_values.size
    ):
        return relation, relation_mask
    left = left_values.reshape(-1, 3)
    right = right_values.reshape(-1, 3)
    left_mask = left_mask_values.reshape(-1, 3).mean(axis=1) > 0.5
    right_mask = right_mask_values.reshape(-1, 3).mean(axis=1) > 0.5
    left_mask &= np.isfinite(left[:, :3]).all(axis=1)
    right_mask &= np.isfinite(right[:, :3]).all(axis=1)

    left_ground_indices = [0, 5, 9, 13, 17]
    right_tip_indices = [8, 12]
    right_base_indices = [5, 9]
    if not all(left_mask[idx] for idx in left_ground_indices):
        return relation, relation_mask
    if not all(right_mask[idx] for idx in right_tip_indices + right_base_indices):
        return relation, relation_mask

    left_ground = left[left_ground_indices, :2].mean(axis=0)
    right_tips = right[right_tip_indices, :2].mean(axis=0)
    right_bases = right[right_base_indices, :2].mean(axis=0)
    tip_rel = right_tips - left_ground
    base_rel = right_bases - left_ground
    finger_axis = right_tips - right_bases
    relation_values = np.asarray(
        [
            tip_rel[0],
            tip_rel[1],
            base_rel[0],
            base_rel[1],
            finger_axis[0],
            finger_axis[1],
            float(np.linalg.norm(tip_rel)),
            float(np.linalg.norm(base_rel)),
        ],
        dtype=np.float32,
    )
    return relation_values, np.ones(8, dtype=np.float32)


def _sequence_with_relative_motion_features(seq: SequenceData, profile: Optional[SemanticProfile]) -> SequenceData:
    config = _semantic_dtw_config(profile)
    if not seq.features:
        return seq

    features: List[FrameFeature] = []
    prev_relation: Optional[np.ndarray] = None
    prev_relation_valid = False
    base_groups = ["left_hand", "right_hand", "left_hand_shape", "right_hand_shape"]
    motion_enabled = bool(config.get("relative_motion_enabled", True))

    for idx, feature in enumerate(seq.features):
        item = _clone_frame(feature)
        prev = seq.features[idx - 1] if idx > 0 else None
        if motion_enabled:
            for group in base_groups:
                if group not in item.groups:
                    continue
                sl = item.groups[group]
                curr_values = item.vector[sl]
                curr_mask = item.mask[sl]
                if prev is not None and group in prev.groups:
                    prev_sl = prev.groups[group]
                    prev_values = prev.vector[prev_sl]
                    prev_mask = prev.mask[prev_sl]
                    if curr_values.shape == prev_values.shape:
                        motion_mask = ((curr_mask > 0) & (prev_mask > 0)).astype(np.float32)
                        motion = _directional_motion_feature((curr_values - prev_values) * motion_mask, motion_mask)
                    else:
                        motion = np.zeros_like(curr_values, dtype=np.float32)
                        motion_mask = np.zeros_like(curr_mask, dtype=np.float32)
                else:
                    motion = np.zeros_like(curr_values, dtype=np.float32)
                    motion_mask = np.zeros_like(curr_mask, dtype=np.float32)
                item = _append_feature_group(item, f"{group}_motion", motion, motion_mask)

        relation, relation_mask = _two_hand_relation_feature(item)
        relation_valid = bool(relation_mask.mean() > 0.5)
        item = _append_feature_group(item, "two_hand_relation", relation, relation_mask)
        if motion_enabled and prev_relation is not None and prev_relation_valid and relation_valid:
            relation_motion_mask = np.ones(3, dtype=np.float32)
            relation_motion = _directional_motion_feature((relation[:3] - prev_relation[:3]), relation_motion_mask)
            item = _append_feature_group(item, "two_hand_relation_motion", relation_motion, relation_motion_mask)
        elif motion_enabled:
            relation_motion = np.zeros(3, dtype=np.float32)
            relation_motion_mask = np.zeros(3, dtype=np.float32)
            item = _append_feature_group(item, "two_hand_relation_motion", relation_motion, relation_motion_mask)
        prev_relation = relation
        prev_relation_valid = relation_valid
        features.append(item)

    return SequenceData(seq.source, seq.mode, seq.fps, seq.total_frames, features)


def _visible_matrix(seq: SequenceData) -> Tuple[np.ndarray, np.ndarray]:
    vectors = np.stack([feature.vector for feature in seq.features], axis=0)
    masks = np.stack([feature.mask for feature in seq.features], axis=0)
    return vectors, masks


def _sequence_groups(seq: SequenceData) -> List[str]:
    if not seq.features:
        return []
    names = list(seq.features[0].groups.keys())
    ordered = [
        "left_hand",
        "right_hand",
        "left_hand_shape",
        "right_hand_shape",
        "left_hand_motion",
        "right_hand_motion",
        "left_hand_shape_motion",
        "right_hand_shape_motion",
        "two_hand_relation",
        "two_hand_relation_motion",
        "pose",
        "face",
    ]
    return [group for group in ordered if group in names]


def _sequence_motion_by_group(seq: SequenceData) -> Dict[str, float]:
    if len(seq.features) < 2:
        return {group: 0.0 for group in _sequence_groups(seq)}
    result: Dict[str, float] = {}
    for group in _sequence_groups(seq):
        values: List[float] = []
        for prev, curr in zip(seq.features[:-1], seq.features[1:]):
            sl = prev.groups[group]
            both = (prev.mask[sl] > 0) & (curr.mask[sl] > 0)
            if both.any():
                values.append(float(np.sqrt(np.mean((curr.vector[sl][both] - prev.vector[sl][both]) ** 2))))
        result[group] = float(np.mean(values)) if values else 0.0
    return result


def _sequence_roughness_by_group(seq: SequenceData) -> Dict[str, float]:
    if len(seq.features) < 3:
        return {group: 0.0 for group in _sequence_groups(seq)}
    result: Dict[str, float] = {}
    for group in _sequence_groups(seq):
        values: List[float] = []
        for a, b, c in zip(seq.features[:-2], seq.features[1:-1], seq.features[2:]):
            sl = a.groups[group]
            both = (a.mask[sl] > 0) & (b.mask[sl] > 0) & (c.mask[sl] > 0)
            if both.any():
                accel = c.vector[sl][both] - 2.0 * b.vector[sl][both] + a.vector[sl][both]
                values.append(float(np.sqrt(np.mean(accel ** 2))))
        result[group] = float(np.mean(values)) if values else 0.0
    return result


def _safe_log_ratio(a: float, b: float, eps: float = 1e-4) -> float:
    return abs(math.log((a + eps) / (b + eps)))


def _profile_group_weights(profile: Optional[SemanticProfile], groups: Sequence[str]) -> Dict[str, float]:
    raw = profile.group_weights if profile else GROUP_WEIGHTS
    missing = max(0.0, min(float(raw.get("missing", GROUP_WEIGHTS["missing"])), 0.35))
    present = [group for group in groups if group != "missing"]
    if not present:
        return {"missing": missing}

    semantic_dtw = dict(profile.semantic_dtw) if profile is not None else {}
    relative_motion_weight = max(0.0, min(float(semantic_dtw.get("relative_motion_weight", 0.28)), 1.0))
    two_hand_relation_weight = max(0.0, min(float(semantic_dtw.get("two_hand_relation_weight", 0.22)), 1.0))

    def raw_group_weight(group: str) -> float:
        if group in raw:
            return max(0.0, float(raw.get(group, 0.0)))
        if group.endswith("_motion"):
            base = group[: -len("_motion")]
            if base in raw:
                return relative_motion_weight * max(0.0, float(raw.get(base, 0.0)))
        if group == "two_hand_relation":
            left = max(0.0, float(raw.get("left_hand", 0.0))) + max(0.0, float(raw.get("left_hand_shape", 0.0)))
            right = max(0.0, float(raw.get("right_hand", 0.0))) + max(0.0, float(raw.get("right_hand_shape", 0.0)))
            return two_hand_relation_weight * min(left, right)
        return 0.0

    total = sum(raw_group_weight(group) for group in present)
    if total <= 1e-8:
        return _profile_group_weights(_default_semantic_profile(), groups)
    scale = (1.0 - missing) / total
    weights = {group: raw_group_weight(group) * scale for group in present}
    weights["missing"] = missing
    return weights


def _required_presence_groups(profile: Optional[SemanticProfile]) -> set[str]:
    if profile is None:
        return set()
    raw = profile.semantic_dtw.get("required_presence_groups") or []
    if not isinstance(raw, list):
        return set()
    return {str(item) for item in raw}


def _sequence_hand_swap_allowed(profile: Optional[SemanticProfile]) -> bool:
    if profile is None or not profile.allow_hand_swap:
        return False
    # Role-specific two-hand signs need stable left/right semantics. Keep
    # sequence-level swap tolerance for non-role single-hand or symmetric signs.
    if "two_hand_relation" in set(profile.focus_groups or []):
        return False
    if "two_hand_relation" in _required_presence_groups(profile):
        return False
    return True


def _swapped_hand_group(group: str) -> str:
    swaps = {
        "left_hand": "right_hand",
        "right_hand": "left_hand",
        "left_hand_shape": "right_hand_shape",
        "right_hand_shape": "left_hand_shape",
        "left_hand_motion": "right_hand_motion",
        "right_hand_motion": "left_hand_motion",
        "left_hand_shape_motion": "right_hand_shape_motion",
        "right_hand_shape_motion": "left_hand_shape_motion",
    }
    return swaps.get(group, group)


def _maybe_swap_hand_delta(
    standard_values: Dict[str, float],
    query_values: Dict[str, float],
    groups: Sequence[str],
    weights: Dict[str, float],
    profile: Optional[SemanticProfile],
    *,
    log_ratio: bool,
) -> Tuple[Dict[str, float], bool]:
    direct: Dict[str, float] = {}
    swapped: Dict[str, float] = {}
    direct_weighted = 0.0
    swapped_weighted = 0.0
    hand_groups = {
        "left_hand",
        "right_hand",
        "left_hand_shape",
        "right_hand_shape",
        "left_hand_motion",
        "right_hand_motion",
        "left_hand_shape_motion",
        "right_hand_shape_motion",
    }
    for group in groups:
        std_value = float(standard_values.get(group, 0.0))
        qry_value = float(query_values.get(group, 0.0))
        if log_ratio:
            direct_value = min(_safe_log_ratio(std_value, qry_value), 3.0)
        else:
            direct_value = abs(std_value - qry_value)
        direct[group] = direct_value
        direct_weighted += weights.get(group, 0.0) * direct_value

        swapped_group = _swapped_hand_group(group)
        if group in hand_groups and swapped_group in query_values:
            swapped_qry_value = float(query_values.get(swapped_group, 0.0))
            if log_ratio:
                swapped_value = min(_safe_log_ratio(std_value, swapped_qry_value), 3.0)
            else:
                swapped_value = abs(std_value - swapped_qry_value)
        else:
            swapped_value = direct_value
        swapped[group] = swapped_value
        swapped_weighted += weights.get(group, 0.0) * swapped_value

    use_swapped = _sequence_hand_swap_allowed(profile) and swapped_weighted < direct_weighted
    return (swapped if use_swapped else direct), use_swapped


def _hand_presence_value(presence: Dict[str, float], profile: Optional[SemanticProfile]) -> float:
    left = float(presence.get("left_hand", 0.0))
    right = float(presence.get("right_hand", 0.0))
    required = _required_presence_groups(profile)
    focus = set(profile.focus_groups) if profile is not None else set()
    if "two_hand_relation" in required or "two_hand_relation" in focus or {"left_hand", "right_hand"}.issubset(required):
        return min(left, right)
    return max(left, right)


def _presence_ratio_for_features(features: Sequence[FrameFeature]) -> Dict[str, float]:
    if not features:
        return {"pose": 0.0, "left_hand": 0.0, "right_hand": 0.0, "face": 0.0}
    result: Dict[str, float] = {}
    for group in ["pose", "left_hand", "right_hand", "face"]:
        result[group] = sum(1 for f in features if f.presence.get(group)) / len(features)
    return result


def _window_features(seq: SequenceData, window: Optional[Dict[str, Any]]) -> List[FrameFeature]:
    if not window or not bool(window.get("used", False)):
        return []
    try:
        start = int(window.get("start_index", 0))
        end = int(window.get("end_index", -1))
    except (TypeError, ValueError):
        return []
    if end < start:
        return []
    start = max(0, min(start, len(seq.features) - 1))
    end = max(start, min(end, len(seq.features) - 1))
    selected = seq.features[start : end + 1]
    if len(selected) < 3:
        return []
    return list(selected)


def _semantic_core_hand_presence(
    seq: SequenceData,
    profile: Optional[SemanticProfile],
    action_window: Optional[Dict[str, Any]] = None,
) -> float:
    full_presence = _hand_presence_value(_presence_ratio(seq), profile)
    window_items = _window_features(seq, action_window)
    if not window_items:
        return full_presence
    window_presence = _hand_presence_value(_presence_ratio_for_features(window_items), profile)
    return max(full_presence, window_presence)


def _group_missing_distance_weight(profile: Optional[SemanticProfile], group: str) -> float:
    config = _semantic_dtw_config(profile)
    base = float(config["group_missing_distance_weight"])
    focus = float(config["focus_missing_distance_weight"])
    relation = float(config["relation_missing_distance_weight"])
    required = _required_presence_groups(profile)
    if group == "two_hand_relation":
        return relation
    if group == "two_hand_relation_motion":
        return 0.5 * relation
    if group in required or (profile is not None and group in profile.focus_groups):
        return max(base, focus)
    if group.endswith("_motion"):
        return 0.65 * base
    if group in {"pose", "face"}:
        return min(base, 0.06)
    return base


def _sequence_delta_by_group(seq: SequenceData, group: str) -> Tuple[np.ndarray, np.ndarray]:
    if not seq.features or group not in seq.features[0].groups:
        return np.zeros(0, dtype=np.float32), np.zeros(0, dtype=np.float32)
    valid_indices: List[int] = []
    for idx, item in enumerate(seq.features):
        sl = item.groups[group]
        if float(item.mask[sl].mean()) >= 0.35:
            valid_indices.append(idx)
    if not valid_indices:
        return np.zeros(0, dtype=np.float32), np.zeros(0, dtype=np.float32)
    window = max(1, min(3, int(round(len(valid_indices) * 0.20))))
    start_set = set(valid_indices[:window])
    end_set = set(valid_indices[-window:])
    start_items = [seq.features[idx] for idx in valid_indices if idx in start_set]
    end_items = [seq.features[idx] for idx in valid_indices if idx in end_set]

    def masked_mean(items: Sequence[FrameFeature]) -> Tuple[np.ndarray, np.ndarray]:
        sl = items[0].groups[group]
        vectors = np.stack([item.vector[sl] for item in items], axis=0)
        masks = np.stack([item.mask[sl] for item in items], axis=0)
        denom = np.maximum(masks.sum(axis=0), 1e-6)
        mean = (vectors * masks).sum(axis=0) / denom
        valid = (masks.sum(axis=0) > 0).astype(np.float32)
        return mean.astype(np.float32), valid

    start_mean, start_mask = masked_mean(start_items)
    end_mean, end_mask = masked_mean(end_items)
    valid = (start_mask > 0) & (end_mask > 0)
    return (end_mean - start_mean).astype(np.float32), valid.astype(np.float32)


def _semantic_delta_penalty(standard: SequenceData, query: SequenceData, profile: Optional[SemanticProfile]) -> Tuple[float, Dict[str, float]]:
    if profile is None:
        return 0.0, {}
    focus = [group for group in profile.focus_groups if standard.features and group in standard.features[0].groups]
    if not focus:
        return 0.0, {}
    weights = _profile_group_weights(profile, focus)
    details: Dict[str, float] = {}
    weighted = 0.0
    weight_sum = 0.0
    for group in focus:
        std_delta, std_mask = _sequence_delta_by_group(standard, group)
        qry_delta, qry_mask = _sequence_delta_by_group(query, group)
        if std_delta.size == 0 or qry_delta.size == 0:
            continue
        both = (std_mask > 0) & (qry_mask > 0)
        if not both.any():
            value = 1.0
            details[group] = value
            group_weight = float(weights.get(group, 0.0))
            weighted += group_weight * value
            weight_sum += group_weight
            continue
        rmse = float(np.sqrt(np.mean((std_delta[both] - qry_delta[both]) ** 2)))
        std_vec = std_delta[both]
        qry_vec = qry_delta[both]
        denom = float(np.linalg.norm(std_vec) * np.linalg.norm(qry_vec))
        if denom <= 1e-8:
            direction_error = 0.0
        else:
            cosine = max(-1.0, min(1.0, float(np.dot(std_vec, qry_vec) / denom)))
            direction_error = max(0.0, (0.25 - cosine) / 1.25)
        value = 0.35 * rmse + 0.65 * direction_error
        details[group] = value
        group_weight = float(weights.get(group, 0.0))
        weighted += group_weight * value
        weight_sum += group_weight
    if weight_sum <= 1e-8:
        return 0.0, details
    return 0.14 * (weighted / weight_sum), details


def _hand_dynamic_scale(profile: Optional[SemanticProfile], groups: Sequence[str]) -> float:
    if profile is None:
        return 1.0
    weights = _profile_group_weights(profile, groups)
    hand_mass = sum(float(weights.get(group, 0.0)) for group in HAND_GROUPS)
    non_hand_mass = float(weights.get("pose", 0.0)) + float(weights.get("face", 0.0))
    if hand_mass >= 0.85 and non_hand_mass <= 0.03:
        return 1.55
    if hand_mass >= 0.75 and non_hand_mass <= 0.06:
        return 1.25
    return 1.0


def _semantic_dtw_config(profile: Optional[SemanticProfile]) -> Dict[str, Any]:
    raw = dict(profile.semantic_dtw) if profile is not None else {}
    enabled = bool(raw.get("enabled", True))
    local_phase_weight = float(raw.get("local_phase_weight", 0.018))
    anchor_penalty_weight = float(raw.get("anchor_penalty_weight", 0.10))
    hand_global_position_weight = float(raw.get("hand_global_position_weight", 0.25))
    pose_robust_hand_position = bool(raw.get("pose_robust_hand_position", True))
    relative_motion_enabled = bool(raw.get("relative_motion_enabled", True))
    relative_motion_weight = float(raw.get("relative_motion_weight", 0.28))
    two_hand_relation_weight = float(raw.get("two_hand_relation_weight", 0.22))
    group_missing_distance_weight = float(raw.get("group_missing_distance_weight", 0.0))
    focus_missing_distance_weight = float(raw.get("focus_missing_distance_weight", 0.0))
    relation_missing_distance_weight = float(raw.get("relation_missing_distance_weight", 0.0))
    required_presence_weight = float(raw.get("required_presence_weight", 0.08))
    visible_core_tolerance_cap = float(raw.get("visible_core_tolerance_cap", 0.034))
    core_visible_score_scale = float(raw.get("core_visible_score_scale", SCORE_SCALE))
    core_visible_dtw_threshold = float(raw.get("core_visible_dtw_threshold", 0.045))
    core_visible_presence_threshold = float(raw.get("core_visible_presence_threshold", 0.65))
    core_visible_max_normalized_distance = float(raw.get("core_visible_max_normalized_distance", 0.080))
    short_core_capture_tolerance_cap = float(raw.get("short_core_capture_tolerance_cap", 0.0))
    short_core_capture_max_length_ratio = float(raw.get("short_core_capture_max_length_ratio", 0.70))
    flower_opening_guard_enabled = bool(raw.get("flower_opening_guard_enabled", False))
    flower_opening_min_score = float(raw.get("flower_opening_min_score", 0.30))
    flower_visible_core_floor_enabled = bool(raw.get("flower_visible_core_floor_enabled", False))
    flower_visible_core_floor_min_score = float(raw.get("flower_visible_core_floor_min_score", 72.0))
    flower_visible_core_floor_max_score = float(raw.get("flower_visible_core_floor_max_score", 80.0))
    flower_visible_core_floor_max_length_ratio = float(raw.get("flower_visible_core_floor_max_length_ratio", 0.32))
    flower_visible_core_floor_min_presence = float(raw.get("flower_visible_core_floor_min_presence", 0.62))
    flower_visible_core_floor_min_opening_score = float(raw.get("flower_visible_core_floor_min_opening_score", 0.60))
    flower_visible_core_floor_max_dtw = float(raw.get("flower_visible_core_floor_max_dtw", 0.042))
    flower_visible_core_floor_min_action_coverage = float(raw.get("flower_visible_core_floor_min_action_coverage", 0.62))
    flower_jump_confusion_guard_enabled = bool(
        raw.get("flower_jump_confusion_guard_enabled", profile is not None and profile.word == "花")
    )
    flower_jump_confusion_min_two_hand_presence = float(raw.get("flower_jump_confusion_min_two_hand_presence", 0.58))
    flower_jump_confusion_min_relation_valid_count = int(raw.get("flower_jump_confusion_min_relation_valid_count", 3))
    flower_jump_confusion_max_opening_score = float(raw.get("flower_jump_confusion_max_opening_score", 0.45))
    flower_jump_confusion_min_two_finger_shape_mean = float(raw.get("flower_jump_confusion_min_two_finger_shape_mean", 1.05))
    jump_relation_semantic_floor_enabled = bool(raw.get("jump_relation_semantic_floor_enabled", False))
    jump_relation_semantic_max_score = float(raw.get("jump_relation_semantic_max_score", 0.0))
    jump_relation_semantic_min_presence = float(raw.get("jump_relation_semantic_min_presence", 0.65))
    jump_relation_semantic_min_direction = float(raw.get("jump_relation_semantic_min_direction", 0.55))
    jump_relation_local_fallback_enabled = bool(raw.get("jump_relation_local_fallback_enabled", False))
    jump_relation_local_min_direction = float(raw.get("jump_relation_local_min_direction", 0.92))
    jump_relation_local_min_amplitude_ratio = float(raw.get("jump_relation_local_min_amplitude_ratio", 0.80))
    jump_relation_local_max_horizontal_to_vertical = float(raw.get("jump_relation_local_max_horizontal_to_vertical", 0.60))
    jump_relation_local_min_coverage = float(raw.get("jump_relation_local_min_coverage", 0.48))
    jump_relation_local_max_coverage = float(raw.get("jump_relation_local_max_coverage", 0.78))
    jump_relation_local_min_two_finger_shape_mean = float(raw.get("jump_relation_local_min_two_finger_shape_mean", 0.95))
    phase_order_guard_enabled = bool(raw.get("phase_order_guard_enabled", False))
    phase_order_guard_min_disorder_span_score = float(raw.get("phase_order_guard_min_disorder_span_score", 0.0))
    phase_order_guard_min_adjacent_disorder_span_score = float(
        raw.get("phase_order_guard_min_adjacent_disorder_span_score", 0.0)
    )
    phase_order_guard_max_score = float(raw.get("phase_order_guard_max_score", 45.0))
    required_presence_groups = raw.get("required_presence_groups") or []
    if not isinstance(required_presence_groups, list):
        required_presence_groups = []
    anchors = raw.get("anchor_phases") or [0.10, 0.50, 0.90]
    clean_anchors: List[float] = []
    for value in anchors:
        try:
            clean_anchors.append(max(0.0, min(1.0, float(value))))
        except (TypeError, ValueError):
            continue
    if not clean_anchors:
        clean_anchors = [0.10, 0.50, 0.90]
    phase_order_anchors = raw.get("phase_order_guard_anchor_phases") or [0.10, 0.25, 0.50, 0.75, 0.90]
    clean_phase_order_anchors: List[float] = []
    for value in phase_order_anchors:
        try:
            clean_phase_order_anchors.append(max(0.0, min(1.0, float(value))))
        except (TypeError, ValueError):
            continue
    if len(clean_phase_order_anchors) < 3:
        clean_phase_order_anchors = [0.10, 0.25, 0.50, 0.75, 0.90]
    return {
        "enabled": enabled,
        "local_phase_weight": max(0.0, min(local_phase_weight, 0.08)),
        "anchor_penalty_weight": max(0.0, min(anchor_penalty_weight, 0.25)),
        "anchor_phases": clean_anchors,
        "pose_robust_hand_position": pose_robust_hand_position,
        "hand_global_position_weight": max(0.0, min(hand_global_position_weight, 1.0)),
        "relative_motion_enabled": relative_motion_enabled,
        "relative_motion_weight": max(0.0, min(relative_motion_weight, 1.0)),
        "two_hand_relation_weight": max(0.0, min(two_hand_relation_weight, 1.0)),
        "group_missing_distance_weight": max(0.0, min(group_missing_distance_weight, 0.60)),
        "focus_missing_distance_weight": max(0.0, min(focus_missing_distance_weight, 0.75)),
        "relation_missing_distance_weight": max(0.0, min(relation_missing_distance_weight, 1.00)),
        "required_presence_groups": [str(item) for item in required_presence_groups],
        "required_presence_weight": max(0.0, min(required_presence_weight, 0.40)),
        "visible_core_tolerance_cap": max(0.0, min(visible_core_tolerance_cap, 0.080)),
        "core_visible_score_scale": max(SCORE_SCALE, min(core_visible_score_scale, 0.180)),
        "core_visible_dtw_threshold": max(0.0, min(core_visible_dtw_threshold, 0.120)),
        "core_visible_presence_threshold": max(0.0, min(core_visible_presence_threshold, 1.0)),
        "core_visible_max_normalized_distance": max(0.0, min(core_visible_max_normalized_distance, 0.180)),
        "short_core_capture_tolerance_cap": max(0.0, min(short_core_capture_tolerance_cap, 0.180)),
        "short_core_capture_max_length_ratio": max(0.20, min(short_core_capture_max_length_ratio, 1.0)),
        "flower_opening_guard_enabled": flower_opening_guard_enabled,
        "flower_opening_min_score": max(0.0, min(flower_opening_min_score, 1.0)),
        "flower_visible_core_floor_enabled": flower_visible_core_floor_enabled,
        "flower_visible_core_floor_min_score": max(0.0, min(flower_visible_core_floor_min_score, 95.0)),
        "flower_visible_core_floor_max_score": max(0.0, min(flower_visible_core_floor_max_score, 95.0)),
        "flower_visible_core_floor_max_length_ratio": max(0.05, min(flower_visible_core_floor_max_length_ratio, 1.0)),
        "flower_visible_core_floor_min_presence": max(0.0, min(flower_visible_core_floor_min_presence, 1.0)),
        "flower_visible_core_floor_min_opening_score": max(0.0, min(flower_visible_core_floor_min_opening_score, 1.0)),
        "flower_visible_core_floor_max_dtw": max(0.0, min(flower_visible_core_floor_max_dtw, 0.120)),
        "flower_visible_core_floor_min_action_coverage": max(0.0, min(flower_visible_core_floor_min_action_coverage, 1.0)),
        "flower_jump_confusion_guard_enabled": flower_jump_confusion_guard_enabled,
        "flower_jump_confusion_min_two_hand_presence": max(0.0, min(flower_jump_confusion_min_two_hand_presence, 1.0)),
        "flower_jump_confusion_min_relation_valid_count": max(3, min(flower_jump_confusion_min_relation_valid_count, 80)),
        "flower_jump_confusion_max_opening_score": max(0.0, min(flower_jump_confusion_max_opening_score, 1.0)),
        "flower_jump_confusion_min_two_finger_shape_mean": max(0.0, min(flower_jump_confusion_min_two_finger_shape_mean, 3.0)),
        "jump_relation_semantic_floor_enabled": jump_relation_semantic_floor_enabled,
        "jump_relation_semantic_max_score": max(0.0, min(jump_relation_semantic_max_score, 90.0)),
        "jump_relation_semantic_min_presence": max(0.0, min(jump_relation_semantic_min_presence, 1.0)),
        "jump_relation_semantic_min_direction": max(-1.0, min(jump_relation_semantic_min_direction, 1.0)),
        "jump_relation_local_fallback_enabled": jump_relation_local_fallback_enabled,
        "jump_relation_local_min_direction": max(-1.0, min(jump_relation_local_min_direction, 1.0)),
        "jump_relation_local_min_amplitude_ratio": max(0.0, min(jump_relation_local_min_amplitude_ratio, 3.0)),
        "jump_relation_local_max_horizontal_to_vertical": max(0.0, min(jump_relation_local_max_horizontal_to_vertical, 3.0)),
        "jump_relation_local_min_coverage": max(0.10, min(jump_relation_local_min_coverage, 1.0)),
        "jump_relation_local_max_coverage": max(0.10, min(jump_relation_local_max_coverage, 1.0)),
        "jump_relation_local_min_two_finger_shape_mean": max(0.0, min(jump_relation_local_min_two_finger_shape_mean, 3.0)),
        "phase_order_guard_enabled": phase_order_guard_enabled,
        "phase_order_guard_anchor_phases": clean_phase_order_anchors,
        "phase_order_guard_min_disorder_span_score": max(
            0.0, min(phase_order_guard_min_disorder_span_score, 1.0)
        ),
        "phase_order_guard_min_adjacent_disorder_span_score": max(
            0.0, min(phase_order_guard_min_adjacent_disorder_span_score, 1.0)
        ),
        "phase_order_guard_max_score": max(0.0, min(phase_order_guard_max_score, 60.0)),
    }


def _phase_anchor_frame(seq: SequenceData, target_phase: float) -> Optional[FrameFeature]:
    if not seq.features:
        return None
    phases = np.asarray([float(feature.semantic_phase) for feature in seq.features], dtype=np.float32)
    if not np.isfinite(phases).all() or float(phases.max() - phases.min()) <= 1e-6:
        idx = int(round(max(0.0, min(1.0, target_phase)) * (len(seq.features) - 1)))
        return seq.features[idx]
    idx = int(np.argmin(np.abs(phases - float(target_phase))))
    return seq.features[idx]


def _semantic_phase_anchor_penalty(
    standard: SequenceData,
    query: SequenceData,
    profile: Optional[SemanticProfile],
) -> Tuple[float, Dict[str, Any]]:
    config = _semantic_dtw_config(profile)
    if not config["enabled"] or config["anchor_penalty_weight"] <= 0.0:
        return 0.0, {"enabled": False}
    rows: List[Dict[str, float]] = []
    weighted = 0.0
    weight_sum = 0.0
    for phase in config["anchor_phases"]:
        std_frame = _phase_anchor_frame(standard, float(phase))
        qry_frame = _phase_anchor_frame(query, float(phase))
        if std_frame is None or qry_frame is None:
            continue
        dist, metrics = frame_distance(std_frame, qry_frame, profile)
        semantic_focus_distance = float(metrics.get("weighted", dist))
        phase_gap = abs(float(std_frame.semantic_phase) - float(qry_frame.semantic_phase))
        # Middle-phase mismatch is usually more informative than exact edges.
        anchor_weight = 1.25 if 0.35 <= float(phase) <= 0.65 else 1.0
        weighted += anchor_weight * semantic_focus_distance
        weight_sum += anchor_weight
        rows.append(
            {
                "target_phase": float(phase),
                "standard_phase": float(std_frame.semantic_phase),
                "query_phase": float(qry_frame.semantic_phase),
                "standard_frame_idx": float(std_frame.frame_idx),
                "query_frame_idx": float(qry_frame.frame_idx),
                "phase_gap": phase_gap,
                "distance": semantic_focus_distance,
            }
        )
    if weight_sum <= 1e-8:
        return 0.0, {"enabled": False, "reason": "no_anchor_frames"}
    mean_distance = weighted / weight_sum
    penalty = float(config["anchor_penalty_weight"]) * mean_distance
    return penalty, {
        "enabled": True,
        "anchor_penalty_weight": float(config["anchor_penalty_weight"]),
        "mean_anchor_distance": mean_distance,
        "anchors": rows,
    }


def _semantic_phase_order_nearest_query_frame(
    anchor: FrameFeature,
    query: SequenceData,
    profile: Optional[SemanticProfile],
) -> Tuple[int, FrameFeature, float]:
    best_idx = 0
    best_frame = query.features[0]
    best_distance = float("inf")
    for idx, candidate in enumerate(query.features):
        dist, metrics = frame_distance(anchor, candidate, profile)
        weighted = float(metrics.get("weighted", dist))
        if weighted < best_distance:
            best_idx = idx
            best_frame = candidate
            best_distance = weighted
    return best_idx, best_frame, best_distance


def _semantic_phase_order_metrics(indices: Sequence[int], max_index: int) -> Dict[str, float]:
    pair_count = 0
    concordant = 0
    discordant = 0
    inversions = 0
    ties = 0
    for a in range(len(indices)):
        for b in range(a + 1, len(indices)):
            pair_count += 1
            delta = int(indices[b]) - int(indices[a])
            if delta > 0:
                concordant += 1
            elif delta < 0:
                discordant += 1
                inversions += 1
            else:
                ties += 1

    adjacent_count = max(0, len(indices) - 1)
    adjacent_backtracks = 0
    max_backtrack = 0.0
    for a, b in zip(indices[:-1], indices[1:]):
        delta = int(b) - int(a)
        if delta < 0:
            adjacent_backtracks += 1
            max_backtrack = max(max_backtrack, abs(delta) / max(float(max_index), 1.0))

    inversion_rate = inversions / pair_count if pair_count else 0.0
    adjacent_backtrack_rate = adjacent_backtracks / adjacent_count if adjacent_count else 0.0
    tau = (concordant - discordant) / pair_count if pair_count else 0.0
    span = (max(indices) - min(indices)) / max(float(max_index), 1.0) if indices else 0.0
    unique_ratio = len(set(indices)) / max(float(len(indices)), 1.0)
    large_span = min(span / 0.45, 1.0)
    return {
        "pair_count": float(pair_count),
        "concordant": float(concordant),
        "discordant": float(discordant),
        "ties": float(ties),
        "inversions": float(inversions),
        "inversion_rate": float(inversion_rate),
        "kendall_tau": float(tau),
        "adjacent_backtracks": float(adjacent_backtracks),
        "adjacent_backtrack_rate": float(adjacent_backtrack_rate),
        "max_backtrack_norm": float(max_backtrack),
        "span_norm": float(span),
        "large_span_norm": float(large_span),
        "unique_index_ratio": float(unique_ratio),
        "disorder_span_score": float(inversion_rate * large_span * unique_ratio),
        "adjacent_disorder_span_score": float(adjacent_backtrack_rate * large_span * unique_ratio),
        "backtrack_span_score": float(max_backtrack * large_span * unique_ratio),
    }


def _semantic_phase_order_guard(
    standard: SequenceData,
    query: SequenceData,
    profile: Optional[SemanticProfile],
    config: Dict[str, Any],
) -> Dict[str, Any]:
    if profile is None or not bool(config.get("phase_order_guard_enabled", False)):
        return {"enabled": False}
    if not standard.features or not query.features:
        return {"enabled": True, "blocked": False, "reason": "empty_sequence"}

    rows: List[Dict[str, Any]] = []
    best_indices: List[int] = []
    distances: List[float] = []
    for phase in config.get("phase_order_guard_anchor_phases") or [0.10, 0.25, 0.50, 0.75, 0.90]:
        std_frame = _phase_anchor_frame(standard, float(phase))
        if std_frame is None:
            continue
        best_idx, best_frame, best_dist = _semantic_phase_order_nearest_query_frame(std_frame, query, profile)
        best_indices.append(best_idx)
        distances.append(best_dist)
        rows.append(
            {
                "target_phase": float(phase),
                "standard_frame_idx": int(std_frame.frame_idx),
                "standard_semantic_phase": float(std_frame.semantic_phase),
                "query_local_index": int(best_idx),
                "query_frame_idx": int(best_frame.frame_idx),
                "query_semantic_phase": float(best_frame.semantic_phase),
                "nearest_distance": float(best_dist),
            }
        )

    if len(best_indices) < 3:
        return {
            "enabled": True,
            "blocked": False,
            "reason": "too_few_anchor_matches",
            "anchor_count": int(len(best_indices)),
            "anchors": rows,
        }

    metrics = _semantic_phase_order_metrics(best_indices, len(query.features) - 1)
    min_disorder_span = float(config.get("phase_order_guard_min_disorder_span_score", 0.0))
    min_adjacent_disorder_span = float(config.get("phase_order_guard_min_adjacent_disorder_span_score", 0.0))
    triggered_by: List[str] = []
    if min_disorder_span > 0.0 and float(metrics["disorder_span_score"]) >= min_disorder_span:
        triggered_by.append("disorder_span_score")
    if (
        min_adjacent_disorder_span > 0.0
        and float(metrics["adjacent_disorder_span_score"]) >= min_adjacent_disorder_span
    ):
        triggered_by.append("adjacent_disorder_span_score")
    blocked = bool(triggered_by)
    return {
        "enabled": True,
        "blocked": blocked,
        "reason": "phase_order_disorder" if blocked else "passed",
        "triggered_by": triggered_by,
        "anchor_count": int(len(best_indices)),
        "query_length": int(len(query.features)),
        "best_query_indices": [int(idx) for idx in best_indices],
        "mean_nearest_distance": float(np.mean(distances)) if distances else 0.0,
        "max_nearest_distance": float(np.max(distances)) if distances else 0.0,
        "min_disorder_span_score": min_disorder_span,
        "min_adjacent_disorder_span_score": min_adjacent_disorder_span,
        "max_score": float(config.get("phase_order_guard_max_score", 45.0)),
        "anchors": rows,
        **metrics,
    }


def _relation_value_series(seq: SequenceData, group: str = "two_hand_relation") -> List[Tuple[int, np.ndarray]]:
    if not seq.features or group not in seq.features[0].groups:
        return []
    valid: List[np.ndarray] = []
    for item in seq.features:
        sl = item.groups[group]
        if float(item.mask[sl].mean()) >= 0.50:
            valid.append((int(item.frame_idx), np.asarray(item.vector[sl], dtype=np.float32)))
    return valid


def _relation_delta_from_values(values: Sequence[Tuple[int, np.ndarray]], source: str) -> Optional[Dict[str, Any]]:
    if len(values) < 3:
        return None
    arr = np.stack([value for _, value in values], axis=0)
    window = max(1, min(3, int(round(len(arr) * 0.25))))
    start = arr[:window].mean(axis=0)
    end = arr[-window:].mean(axis=0)
    delta = (end - start).astype(np.float32)
    return {
        "valid_count": len(values),
        "start": start,
        "end": end,
        "delta": delta,
        "source": source,
        "start_frame_idx": int(values[0][0]),
        "end_frame_idx": int(values[-1][0]),
    }


def _relation_delta_summary(seq: SequenceData, group: str = "two_hand_relation") -> Optional[Dict[str, Any]]:
    valid = _relation_value_series(seq, group)
    if len(valid) < 3:
        return None
    return _relation_delta_from_values(valid, "net")


def _jump_relation_delta_metrics(
    std_delta: np.ndarray,
    qry_delta: np.ndarray,
    *,
    min_direction: float,
    min_amplitude_ratio: float,
    max_horizontal_to_vertical: float,
) -> Dict[str, Any]:
    semantic_dims = np.asarray([0, 1, 2, 3], dtype=np.int64)
    vertical_dims = np.asarray([1, 3], dtype=np.int64)
    horizontal_dims = np.asarray([0, 2], dtype=np.int64)
    std_vec = std_delta[semantic_dims]
    qry_vec = qry_delta[semantic_dims]
    std_norm = float(np.linalg.norm(std_vec))
    qry_norm = float(np.linalg.norm(qry_vec))
    if std_norm <= 1e-6 or qry_norm <= 1e-6:
        return {"passed": False, "reason": "weak_relation_delta"}
    cosine = max(-1.0, min(1.0, float(np.dot(std_vec, qry_vec) / (std_norm * qry_norm))))
    if cosine < min_direction:
        return {
            "passed": False,
            "reason": "relation_direction_mismatch",
            "direction_cosine": cosine,
            "min_direction": min_direction,
        }

    vertical_scores: List[float] = []
    for dim in vertical_dims:
        std_value = float(std_delta[int(dim)])
        qry_value = float(qry_delta[int(dim)])
        if abs(std_value) <= 1e-6:
            continue
        signed_ratio = (qry_value * (1.0 if std_value >= 0 else -1.0)) / max(abs(std_value), 1e-6)
        vertical_scores.append(max(0.0, min(1.0, signed_ratio / 0.45)))
    vertical_score = float(np.mean(vertical_scores)) if vertical_scores else 0.0
    if vertical_score < 0.70:
        return {
            "passed": False,
            "reason": "weak_same_direction_vertical_jump",
            "direction_cosine": cosine,
            "vertical_score": vertical_score,
        }

    std_vertical_mag = float(np.linalg.norm(std_delta[vertical_dims]))
    qry_vertical_mag = float(np.linalg.norm(qry_delta[vertical_dims]))
    amplitude_ratio = qry_vertical_mag / max(std_vertical_mag, 1e-6)
    if amplitude_ratio < min_amplitude_ratio:
        return {
            "passed": False,
            "reason": "relation_jump_amplitude_too_small",
            "direction_cosine": cosine,
            "vertical_score": vertical_score,
            "amplitude_ratio": amplitude_ratio,
            "min_amplitude_ratio": min_amplitude_ratio,
        }
    qry_horizontal_mag = float(np.linalg.norm(qry_delta[horizontal_dims]))
    query_horizontal_to_vertical = qry_horizontal_mag / max(qry_vertical_mag, 1e-6)
    if query_horizontal_to_vertical > max_horizontal_to_vertical:
        return {
            "passed": False,
            "reason": "relation_motion_too_horizontal",
            "direction_cosine": cosine,
            "vertical_score": vertical_score,
            "amplitude_ratio": amplitude_ratio,
            "query_horizontal_to_vertical": query_horizontal_to_vertical,
            "max_horizontal_to_vertical": max_horizontal_to_vertical,
        }
    amplitude_score = float(math.exp(-0.32 * min(abs(math.log(max(amplitude_ratio, 1e-6))), 3.0)))
    direction_score = (cosine - min_direction) / max(1.0 - min_direction, 1e-6)
    direction_score = max(0.0, min(1.0, direction_score))
    return {
        "passed": True,
        "reason": "used",
        "direction_cosine": cosine,
        "direction_score": direction_score,
        "vertical_score": vertical_score,
        "amplitude_ratio": amplitude_ratio,
        "amplitude_score": amplitude_score,
        "query_horizontal_to_vertical": query_horizontal_to_vertical,
    }


def _right_two_finger_shape_summary(seq: SequenceData, start_frame_idx: int, end_frame_idx: int) -> Optional[Dict[str, Any]]:
    # right_hand_shape layout: wrist-tip distances, spreads, mcp-tip distances,
    # then straightness. Index/middle dimensions encode the "two legs" handshape.
    two_finger_indices = np.asarray([1, 2, 6, 7, 11, 12, 16, 17], dtype=np.int64)
    values: List[float] = []
    for item in seq.features:
        if item.frame_idx < start_frame_idx or item.frame_idx > end_frame_idx:
            continue
        if "right_hand_shape" not in item.groups:
            continue
        sl = item.groups["right_hand_shape"]
        vector = item.vector[sl]
        mask = item.mask[sl]
        valid = two_finger_indices[two_finger_indices < len(vector)]
        valid = valid[mask[valid] > 0.5] if len(valid) else valid
        if len(valid) < 4:
            continue
        values.append(float(np.mean(vector[valid])))
    if len(values) < 3:
        return None
    arr = np.asarray(values, dtype=np.float32)
    window = max(1, min(3, int(round(len(arr) * 0.25))))
    return {
        "valid_count": int(len(values)),
        "mean": float(arr.mean()),
        "start": float(arr[:window].mean()),
        "end": float(arr[-window:].mean()),
        "range": float(arr.max() - arr.min()),
        "min": float(arr.min()),
        "max": float(arr.max()),
    }


def _best_local_relation_delta_summary(
    seq: SequenceData,
    std_delta: np.ndarray,
    config: Dict[str, Any],
    group: str = "two_hand_relation",
) -> Optional[Dict[str, Any]]:
    values = _relation_value_series(seq, group)
    if len(values) < 4:
        return None
    min_coverage = float(config.get("jump_relation_local_min_coverage", 0.48))
    max_coverage = max(min_coverage, float(config.get("jump_relation_local_max_coverage", 0.78)))
    min_len = max(3, int(math.ceil(len(values) * min_coverage)))
    max_len = max(min_len, int(math.ceil(len(values) * max_coverage)))
    max_len = min(max_len, len(values))
    min_direction = float(config.get("jump_relation_local_min_direction", 0.92))
    min_amplitude_ratio = float(config.get("jump_relation_local_min_amplitude_ratio", 0.80))
    max_horizontal = float(config.get("jump_relation_local_max_horizontal_to_vertical", 0.60))
    min_two_finger_shape_mean = float(config.get("jump_relation_local_min_two_finger_shape_mean", 0.95))
    best: Optional[Dict[str, Any]] = None
    best_rank = -1.0
    for length in range(min_len, max_len + 1):
        for start_idx in range(0, len(values) - length + 1):
            segment = values[start_idx:start_idx + length]
            summary = _relation_delta_from_values(segment, "full_sequence_local_relation_segment")
            if summary is None:
                continue
            qry_delta = np.asarray(summary["delta"], dtype=np.float32)
            metrics = _jump_relation_delta_metrics(
                std_delta,
                qry_delta,
                min_direction=min_direction,
                min_amplitude_ratio=min_amplitude_ratio,
                max_horizontal_to_vertical=max_horizontal,
            )
            if not bool(metrics.get("passed")):
                continue
            shape_summary = _right_two_finger_shape_summary(
                seq,
                int(summary["start_frame_idx"]),
                int(summary["end_frame_idx"]),
            )
            if shape_summary is None or float(shape_summary.get("mean", 0.0)) < min_two_finger_shape_mean:
                continue
            coverage = length / max(len(values), 1)
            rank = (
                0.55 * float(metrics["direction_cosine"])
                + 0.20 * min(float(metrics["amplitude_ratio"]), 2.0) / 2.0
                + 0.15 * max(0.0, 1.0 - float(metrics["query_horizontal_to_vertical"]) / max(max_horizontal, 1e-6))
                + 0.10 * coverage
            )
            if rank > best_rank:
                best_rank = rank
                best = {
                    **summary,
                    "coverage": coverage,
                    "candidate_rank": rank,
                    "candidate_metrics": metrics,
                    "total_relation_valid_count": len(values),
                    "right_two_finger_shape": shape_summary,
                    "min_two_finger_shape_mean": min_two_finger_shape_mean,
                }
    return best


def _flower_opening_guard(seq: SequenceData, profile: Optional[SemanticProfile], config: Dict[str, Any]) -> Dict[str, Any]:
    if profile is None or profile.word != "花" or not bool(config.get("flower_opening_guard_enabled", False)):
        return {"enabled": False, "passed": True}

    opening_indices = np.asarray([5, 6, 7, 8, 9, 15, 16, 17, 18, 19], dtype=np.int64)
    candidates: List[Dict[str, Any]] = []
    for group in ["right_hand_shape", "left_hand_shape"]:
        if not seq.features or group not in seq.features[0].groups:
            continue
        values: List[float] = []
        for item in seq.features:
            sl = item.groups[group]
            vector = item.vector[sl]
            mask = item.mask[sl]
            valid = opening_indices[opening_indices < len(vector)]
            valid = valid[mask[valid] > 0.5] if len(valid) else valid
            if len(valid) < 4:
                continue
            values.append(float(np.mean(vector[valid])))
        if len(values) < 3:
            continue
        arr = np.asarray(values, dtype=np.float32)
        window = max(1, min(3, int(round(len(arr) * 0.25))))
        start = float(arr[:window].mean())
        end = float(arr[-window:].mean())
        delta = end - start
        value_range = float(arr.max() - arr.min())
        delta_score = max(0.0, min(1.0, (delta - 0.035) / 0.120))
        range_score = max(0.0, min(1.0, (value_range - 0.420) / 0.200))
        opening_score = 0.45 * delta_score + 0.55 * range_score
        candidates.append(
            {
                "group": group,
                "valid_count": len(values),
                "start": start,
                "end": end,
                "delta": float(delta),
                "range": value_range,
                "delta_score": float(delta_score),
                "range_score": float(range_score),
                "opening_score": float(opening_score),
            }
        )

    min_score = float(config.get("flower_opening_min_score", 0.30))
    best = max(candidates, key=lambda item: float(item["opening_score"]), default=None)
    best_score = float(best["opening_score"]) if best else 0.0
    return {
        "enabled": True,
        "passed": best_score >= min_score,
        "best_score": best_score,
        "min_score": min_score,
        "best": best,
        "candidates": candidates,
    }


def _flower_jump_confusion_guard(
    seq: SequenceData,
    profile: Optional[SemanticProfile],
    config: Dict[str, Any],
    flower_opening_guard: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if profile is None or profile.word != "花" or not bool(config.get("flower_jump_confusion_guard_enabled", False)):
        return {"enabled": False, "blocked": False}

    presence = _presence_ratio(seq)
    left_presence = float(presence.get("left_hand", 0.0))
    right_presence = float(presence.get("right_hand", 0.0))
    two_hand_presence = min(left_presence, right_presence)
    min_two_hand_presence = float(config.get("flower_jump_confusion_min_two_hand_presence", 0.58))
    base: Dict[str, Any] = {
        "enabled": True,
        "blocked": False,
        "left_hand_presence": left_presence,
        "right_hand_presence": right_presence,
        "two_hand_presence": two_hand_presence,
        "min_two_hand_presence": min_two_hand_presence,
    }
    if two_hand_presence < min_two_hand_presence:
        return {**base, "reason": "two_hand_presence_low"}

    opening_score = float((flower_opening_guard or {}).get("best_score") or 0.0)
    max_opening_score = float(config.get("flower_jump_confusion_max_opening_score", 0.45))
    base.update(
        {
            "flower_opening_score": opening_score,
            "max_opening_score": max_opening_score,
        }
    )
    if opening_score > max_opening_score:
        return {**base, "reason": "flower_opening_strong"}

    relation_summary = _relation_delta_summary(seq)
    min_relation_valid_count = int(config.get("flower_jump_confusion_min_relation_valid_count", 3))
    if relation_summary is None or int(relation_summary.get("valid_count") or 0) < min_relation_valid_count:
        return {
            **base,
            "reason": "relation_not_stable",
            "relation_valid_count": int((relation_summary or {}).get("valid_count") or 0),
            "min_relation_valid_count": min_relation_valid_count,
        }

    shape_summary = _right_two_finger_shape_summary(
        seq,
        int(relation_summary["start_frame_idx"]),
        int(relation_summary["end_frame_idx"]),
    )
    shape_mean = float((shape_summary or {}).get("mean") or 0.0)
    min_shape_mean = float(config.get("flower_jump_confusion_min_two_finger_shape_mean", 1.05))
    delta = np.asarray(relation_summary["delta"], dtype=np.float32)
    vertical_mag = float(np.linalg.norm(delta[[1, 3]]))
    horizontal_mag = float(np.linalg.norm(delta[[0, 2]]))
    horizontal_to_vertical = horizontal_mag / max(vertical_mag, 1e-6)
    detail = {
        **base,
        "relation_valid_count": int(relation_summary.get("valid_count") or 0),
        "min_relation_valid_count": min_relation_valid_count,
        "relation_delta": [float(value) for value in delta.tolist()],
        "relation_vertical_magnitude": vertical_mag,
        "relation_horizontal_to_vertical": horizontal_to_vertical,
        "right_two_finger_shape": shape_summary,
        "right_two_finger_shape_mean": shape_mean,
        "min_two_finger_shape_mean": min_shape_mean,
    }
    if shape_summary is None or shape_mean < min_shape_mean:
        return {**detail, "reason": "two_finger_shape_not_clear"}

    return {
        **detail,
        "blocked": True,
        "reason": "jump_like_two_hand_relation_with_weak_flower_opening",
    }


def _flower_visible_core_semantic_floor(
    *,
    dtw_distance: float,
    scoring_length_ratio: float,
    action_window: Dict[str, Any],
    score_scale: Dict[str, Any],
    sequence_penalty: Dict[str, Any],
    group_mean: Dict[str, float],
    profile: Optional[SemanticProfile],
    config: Dict[str, Any],
) -> Tuple[float, Dict[str, Any]]:
    if profile is None or profile.word != "花" or not bool(config.get("flower_visible_core_floor_enabled", False)):
        return 0.0, {"enabled": False}

    confusion_guard = score_scale.get("flower_jump_confusion_guard") or {}
    if bool(confusion_guard.get("blocked")):
        return 0.0, {
            "enabled": True,
            "used": False,
            "source": "short_visible_core",
            "reason": "jump_like_two_hand_confusion",
            "flower_jump_confusion_guard": confusion_guard,
        }

    phase_order_guard = score_scale.get("semantic_phase_order_guard") or {}
    if bool(phase_order_guard.get("blocked")):
        return 0.0, {
            "enabled": True,
            "used": False,
            "source": "short_visible_core",
            "reason": "phase_order_disorder",
            "semantic_phase_order_guard": phase_order_guard,
        }

    min_score = float(config.get("flower_visible_core_floor_min_score", 72.0))
    max_score = float(config.get("flower_visible_core_floor_max_score", 80.0))
    if max_score <= 0.0 or max_score < min_score:
        return 0.0, {"enabled": False, "reason": "max_score_disabled"}

    max_length_ratio = float(config.get("flower_visible_core_floor_max_length_ratio", 0.32))
    if scoring_length_ratio > max_length_ratio:
        return 0.0, {
            "enabled": True,
            "used": False,
            "source": "short_visible_core",
            "reason": "query_not_short_core_capture",
            "scoring_length_ratio": scoring_length_ratio,
            "max_length_ratio": max_length_ratio,
        }

    min_presence = float(config.get("flower_visible_core_floor_min_presence", 0.62))
    core_presence = float(score_scale.get("semantic_core_query_hand_presence", 0.0))
    if core_presence < min_presence:
        return 0.0, {
            "enabled": True,
            "used": False,
            "source": "short_visible_core",
            "reason": "insufficient_core_hand_presence",
            "core_presence": core_presence,
            "min_presence": min_presence,
        }

    guard = score_scale.get("flower_opening_guard") or {}
    opening_score = float(guard.get("best_score") or 0.0)
    min_opening = float(config.get("flower_visible_core_floor_min_opening_score", 0.60))
    if not bool(guard.get("passed", True)) or opening_score < min_opening:
        return 0.0, {
            "enabled": True,
            "used": False,
            "source": "short_visible_core",
            "reason": "opening_guard_too_weak",
            "opening_score": opening_score,
            "min_opening_score": min_opening,
        }

    max_dtw = float(config.get("flower_visible_core_floor_max_dtw", 0.042))
    if dtw_distance > max_dtw:
        return 0.0, {
            "enabled": True,
            "used": False,
            "source": "short_visible_core",
            "reason": "core_dtw_too_far",
            "dtw_distance": dtw_distance,
            "max_dtw": max_dtw,
        }

    query_window = (action_window.get("query") or {}) if isinstance(action_window, dict) else {}
    action_coverage = float(query_window.get("energy_coverage") or 0.0)
    min_action_coverage = float(config.get("flower_visible_core_floor_min_action_coverage", 0.62))
    if action_coverage < min_action_coverage:
        return 0.0, {
            "enabled": True,
            "used": False,
            "source": "short_visible_core",
            "reason": "action_window_coverage_low",
            "action_coverage": action_coverage,
            "min_action_coverage": min_action_coverage,
        }

    if float(sequence_penalty.get("required_presence_penalty", 0.0)) > 0.04:
        return 0.0, {
            "enabled": True,
            "used": False,
            "source": "short_visible_core",
            "reason": "required_presence_penalty_too_high",
            "required_presence_penalty": float(sequence_penalty.get("required_presence_penalty", 0.0)),
        }
    if float(group_mean.get("right_hand_shape", 0.0)) > 0.10 or float(group_mean.get("right_hand", 0.0)) > 0.10:
        return 0.0, {
            "enabled": True,
            "used": False,
            "source": "short_visible_core",
            "reason": "main_hand_geometry_too_far",
            "right_hand": float(group_mean.get("right_hand", 0.0)),
            "right_hand_shape": float(group_mean.get("right_hand_shape", 0.0)),
        }

    opening_quality = max(0.0, min(1.0, (opening_score - min_opening) / max(1.0 - min_opening, 1e-6)))
    presence_quality = max(0.0, min(1.0, (core_presence - min_presence) / max(1.0 - min_presence, 1e-6)))
    dtw_quality = max(0.0, min(1.0, (max_dtw - dtw_distance) / max(max_dtw, 1e-6)))
    coverage_quality = max(0.0, min(1.0, (action_coverage - min_action_coverage) / max(1.0 - min_action_coverage, 1e-6)))
    quality = 0.50 * opening_quality + 0.22 * presence_quality + 0.18 * dtw_quality + 0.10 * coverage_quality
    semantic_score = min_score + (max_score - min_score) * quality
    semantic_score = max(0.0, min(max_score, semantic_score))
    return semantic_score, {
        "enabled": True,
        "used": semantic_score > 0.0,
        "reason": "used",
        "source": "short_visible_core",
        "score": semantic_score,
        "min_score": min_score,
        "max_score": max_score,
        "quality": quality,
        "opening_score": opening_score,
        "opening_quality": opening_quality,
        "core_presence": core_presence,
        "presence_quality": presence_quality,
        "dtw_distance": dtw_distance,
        "dtw_quality": dtw_quality,
        "scoring_length_ratio": scoring_length_ratio,
        "action_coverage": action_coverage,
        "coverage_quality": coverage_quality,
        "query_segment_start_frame_idx": query_window.get("start_frame_idx"),
        "query_segment_end_frame_idx": query_window.get("end_frame_idx"),
        "query_segment_coverage": action_coverage,
    }


def _jump_relation_semantic_floor(
    standard: SequenceData,
    query: SequenceData,
    group_mean: Dict[str, float],
    sequence_penalty: Dict[str, Any],
    profile: Optional[SemanticProfile],
    config: Dict[str, Any],
    full_standard: Optional[SequenceData] = None,
    full_query: Optional[SequenceData] = None,
) -> Tuple[float, Dict[str, Any]]:
    if profile is None or profile.word != "跳" or not bool(config.get("jump_relation_semantic_floor_enabled", False)):
        return 0.0, {"enabled": False}
    max_score = float(config.get("jump_relation_semantic_max_score", 0.0))
    if max_score <= 0.0:
        return 0.0, {"enabled": False, "reason": "max_score_disabled"}

    query_presence = sequence_penalty.get("query_presence") or _presence_ratio(query)
    relation_presence = min(float(query_presence.get("left_hand", 0.0)), float(query_presence.get("right_hand", 0.0)))
    min_presence = float(config.get("jump_relation_semantic_min_presence", 0.65))
    if relation_presence < min_presence:
        return 0.0, {
            "enabled": True,
            "used": False,
            "reason": "insufficient_two_hand_presence",
            "relation_presence": relation_presence,
            "min_presence": min_presence,
        }
    if float(sequence_penalty.get("required_presence_penalty", 0.0)) > 0.06:
        return 0.0, {
            "enabled": True,
            "used": False,
            "reason": "required_presence_penalty_too_high",
            "relation_presence": relation_presence,
            "required_presence_penalty": float(sequence_penalty.get("required_presence_penalty", 0.0)),
        }
    if float(group_mean.get("right_hand_shape", 0.0)) > 0.36 or float(group_mean.get("right_hand", 0.0)) > 0.36:
        return 0.0, {
            "enabled": True,
            "used": False,
            "reason": "right_hand_geometry_too_far",
            "right_hand": float(group_mean.get("right_hand", 0.0)),
            "right_hand_shape": float(group_mean.get("right_hand_shape", 0.0)),
        }

    primary_std_summary = _relation_delta_summary(standard)
    primary_qry_summary = _relation_delta_summary(query)
    if primary_std_summary is None:
        return 0.0, {"enabled": True, "used": False, "reason": "missing_relation_delta"}
    fallback_std_summary = _relation_delta_summary(full_standard) if full_standard is not None else primary_std_summary
    if fallback_std_summary is None:
        fallback_std_summary = primary_std_summary

    def evaluate_summary(
        std_summary: Dict[str, Any],
        qry_summary: Optional[Dict[str, Any]],
        *,
        source: str,
        min_direction_value: float,
        min_amplitude_ratio: float,
        max_horizontal_to_vertical: float,
    ) -> Tuple[float, Dict[str, Any]]:
        if qry_summary is None:
            return 0.0, {"enabled": True, "used": False, "reason": "missing_relation_delta", "source": source}
        std_delta = np.asarray(std_summary["delta"], dtype=np.float32)
        qry_delta = np.asarray(qry_summary["delta"], dtype=np.float32)
        metrics = _jump_relation_delta_metrics(
            std_delta,
            qry_delta,
            min_direction=min_direction_value,
            min_amplitude_ratio=min_amplitude_ratio,
            max_horizontal_to_vertical=max_horizontal_to_vertical,
        )
        if not bool(metrics.get("passed")):
            return 0.0, {
                "enabled": True,
                "used": False,
                "source": source,
                "standard_valid_count": int(std_summary.get("valid_count") or 0),
                "query_valid_count": int(qry_summary.get("valid_count") or 0),
                "standard_delta": [float(x) for x in std_delta.tolist()],
                "query_delta": [float(x) for x in qry_delta.tolist()],
                **{key: value for key, value in metrics.items() if key != "passed"},
            }
        presence_factor = 0.88 + 0.12 * max(0.0, min(1.0, (relation_presence - min_presence) / max(1.0 - min_presence, 1e-6)))
        relation_quality = 0.45 * float(metrics["direction_score"]) + 0.35 * float(metrics["vertical_score"]) + 0.20 * float(metrics["amplitude_score"])
        semantic_score = max_score * (0.62 + 0.38 * relation_quality) * presence_factor
        semantic_score = max(0.0, min(max_score, semantic_score))
        return semantic_score, {
            "enabled": True,
            "used": semantic_score > 0.0,
            "reason": "used",
            "source": source,
            "score": semantic_score,
            "max_score": max_score,
            "relation_presence": relation_presence,
            "relation_quality": relation_quality,
            "standard_valid_count": int(std_summary.get("valid_count") or 0),
            "query_valid_count": int(qry_summary.get("valid_count") or 0),
            "standard_delta": [float(x) for x in std_delta.tolist()],
            "query_delta": [float(x) for x in qry_delta.tolist()],
            "query_segment_start_frame_idx": qry_summary.get("start_frame_idx"),
            "query_segment_end_frame_idx": qry_summary.get("end_frame_idx"),
            "query_segment_coverage": qry_summary.get("coverage"),
            **{key: value for key, value in metrics.items() if key not in {"passed", "reason"}},
        }

    min_direction = float(config.get("jump_relation_semantic_min_direction", 0.55))
    primary_score, primary_detail = evaluate_summary(
        primary_std_summary,
        primary_qry_summary,
        source="action_window_net",
        min_direction_value=min_direction,
        min_amplitude_ratio=0.42,
        max_horizontal_to_vertical=1.25,
    )
    if primary_score > 0.0:
        return primary_score, primary_detail

    local_candidate: Optional[Dict[str, Any]] = None
    if bool(config.get("jump_relation_local_fallback_enabled", True)):
        local_seq = full_query if full_query is not None else query
        local_candidate = _best_local_relation_delta_summary(
            local_seq,
            np.asarray(fallback_std_summary["delta"], dtype=np.float32),
            config,
        )
    if local_candidate is not None:
        local_score, local_detail = evaluate_summary(
            fallback_std_summary,
            local_candidate,
            source="full_sequence_local_relation_segment",
            min_direction_value=float(config.get("jump_relation_local_min_direction", 0.92)),
            min_amplitude_ratio=float(config.get("jump_relation_local_min_amplitude_ratio", 0.80)),
            max_horizontal_to_vertical=float(config.get("jump_relation_local_max_horizontal_to_vertical", 0.60)),
        )
        if local_score > 0.0:
            local_detail["fallback_from"] = primary_detail
            local_detail["local_candidate_rank"] = local_candidate.get("candidate_rank")
            local_detail["right_two_finger_shape"] = local_candidate.get("right_two_finger_shape")
            local_detail["min_two_finger_shape_mean"] = local_candidate.get("min_two_finger_shape_mean")
            return local_score, local_detail
        primary_detail["local_candidate"] = local_detail
    else:
        primary_detail["local_candidate"] = {
            "used": False,
            "reason": "no_matching_local_relation_segment",
        }
    return 0.0, primary_detail


def _capture_quality_assessment(
    profile: Optional[SemanticProfile],
    prototype_score: float,
    score_scale: Dict[str, Any],
    sequence_penalty: Dict[str, Any],
) -> Dict[str, Any]:
    word = profile.word if profile is not None else ""
    query_presence = sequence_penalty.get("query_presence") or {}
    left_presence = float(query_presence.get("left_hand", 0.0))
    right_presence = float(query_presence.get("right_hand", 0.0))
    two_hand_presence = min(left_presence, right_presence)
    core_presence = float(score_scale.get("semantic_core_query_hand_presence", max(left_presence, right_presence)))
    floor = score_scale.get("semantic_floor") or {}
    floor_reason = str(floor.get("reason") or "")
    flower_guard = score_scale.get("flower_opening_guard") or {}
    result: Dict[str, Any] = {
        "status": "score_valid",
        "reason": "score_valid",
        "reliable_for_scoring": True,
        "message": "核心语义可评分。",
        "left_hand_presence": left_presence,
        "right_hand_presence": right_presence,
        "two_hand_presence": two_hand_presence,
        "semantic_core_presence": core_presence,
    }

    phase_order_guard = score_scale.get("semantic_phase_order_guard") or {}
    if bool(phase_order_guard.get("blocked")):
        result.update(
            {
                "status": "semantic_mismatch",
                "reason": "phase_order_disorder",
                "reliable_for_scoring": True,
                "message": "检测到关键语义锚点跨大段时间反序，动作起止顺序不一致。",
            }
        )
        return result

    if word == "跳":
        if floor_reason in {"insufficient_two_hand_presence", "required_presence_penalty_too_high"} or two_hand_presence < 0.60:
            result.update(
                {
                    "status": "needs_recapture",
                    "reason": "jump_two_hand_presence_low",
                    "reliable_for_scoring": False,
                    "message": "左手地面和右手跳跃没有同时稳定入画，建议重采后再评分。",
                }
            )
        elif floor_reason in {
            "relation_direction_mismatch",
            "weak_same_direction_vertical_jump",
            "relation_jump_amplitude_too_small",
            "relation_motion_too_horizontal",
            "missing_relation_delta",
            "weak_relation_delta",
            "right_hand_geometry_too_far",
        }:
            result.update(
                {
                    "status": "semantic_mismatch",
                    "reason": floor_reason,
                    "reliable_for_scoring": True,
                    "message": "双手关系已入画，但未满足右手在左手基础上弹跳的核心语义。",
                }
            )
    elif word == "花":
        confusion_guard = score_scale.get("flower_jump_confusion_guard") or {}
        if core_presence < 0.58:
            result.update(
                {
                    "status": "needs_recapture",
                    "reason": "flower_core_hand_presence_low",
                    "reliable_for_scoring": False,
                    "message": "核心手部覆盖不足，建议让开花手势稳定入画后重采。",
                }
            )
        elif bool(confusion_guard.get("blocked")):
            result.update(
                {
                    "status": "semantic_mismatch",
                    "reason": "flower_jump_like_two_hand_confusion",
                    "reliable_for_scoring": True,
                    "message": "检测到稳定的双手关系和弱开花动态，更像双手交互动作，不符合“花”的一手张开语义。",
                }
            )
        elif floor_reason == "opening_guard_too_weak" and prototype_score < 60.0:
            if max(left_presence, right_presence) < 0.58:
                result.update(
                    {
                        "status": "needs_recapture",
                        "reason": "flower_core_hand_presence_low",
                        "reliable_for_scoring": False,
                        "message": "开花手势的核心手部覆盖和张开动态都不足，建议重采。",
                    }
                )
            else:
                result.update(
                    {
                        "status": "semantic_mismatch",
                        "reason": "flower_opening_guard_failed",
                        "reliable_for_scoring": True,
                        "message": "手部已入画，但手指张开/绽放动态不够清晰。",
                    }
                )
        elif bool(flower_guard.get("enabled")) and not bool(flower_guard.get("passed", True)):
            result.update(
                {
                    "status": "semantic_mismatch",
                    "reason": "flower_opening_guard_failed",
                    "reliable_for_scoring": True,
                    "message": "手部已入画，但未检测到清晰的手指张开/绽放动态。",
                }
            )
    elif prototype_score < 60.0 and max(left_presence, right_presence) < 0.50:
        result.update(
            {
                "status": "needs_recapture",
                "reason": "hand_presence_low",
                "reliable_for_scoring": False,
                "message": "核心手部覆盖不足，建议重采。",
            }
        )

    return result


def _sequence_penalty(
    standard: SequenceData,
    query: SequenceData,
    group_mean: Dict[str, float],
    profile: Optional[SemanticProfile] = None,
) -> Dict[str, Any]:
    n = len(standard.features)
    m = len(query.features)
    length_ratio = min(n, m) / max(n, m, 1)
    positive_like_floor = 0.50
    length_penalty = 0.0
    if length_ratio < positive_like_floor:
        length_penalty = 0.28 * ((positive_like_floor - length_ratio) / positive_like_floor)
    temporal_profile_factor = 0.0 if length_ratio <= 0.50 else min(1.0, (length_ratio - 0.50) / 0.45)

    standard_presence = _presence_ratio(standard)
    query_presence = _presence_ratio(query)
    penalty_weights = _profile_group_weights(profile, _sequence_groups(standard))
    presence_delta, presence_hand_side_swapped = _maybe_swap_hand_delta(
        standard_presence,
        query_presence,
        ["left_hand", "right_hand", "pose", "face"],
        penalty_weights,
        profile,
        log_ratio=False,
    )
    hand_dynamic_scale = _hand_dynamic_scale(profile, _sequence_groups(standard))
    presence_penalty = 0.14 * sum(penalty_weights.get(group, 0.0) * presence_delta[group] for group in presence_delta)

    required_presence_penalty = 0.0
    required_presence_detail: Dict[str, float] = {}
    if profile is not None:
        config = _semantic_dtw_config(profile)
        required_groups = _required_presence_groups(profile)
        required_weight = float(config["required_presence_weight"])
        if required_groups and required_weight > 0.0:
            required_sum = 0.0
            required_weight_sum = 0.0
            for group in ["left_hand", "right_hand"]:
                if group not in required_groups:
                    continue
                deficit = max(0.0, float(standard_presence.get(group, 0.0)) - float(query_presence.get(group, 0.0)))
                group_weight = max(float(penalty_weights.get(group, 0.0)), 0.08)
                required_presence_detail[f"{group}_deficit"] = deficit
                required_sum += group_weight * deficit
                required_weight_sum += group_weight
            if "two_hand_relation" in required_groups:
                standard_pair = min(float(standard_presence.get("left_hand", 0.0)), float(standard_presence.get("right_hand", 0.0)))
                query_pair = min(float(query_presence.get("left_hand", 0.0)), float(query_presence.get("right_hand", 0.0)))
                relation_deficit = max(0.0, standard_pair - query_pair)
                relation_weight = max(float(penalty_weights.get("two_hand_relation", 0.0)), 0.12)
                required_presence_detail["two_hand_relation_deficit"] = relation_deficit
                required_sum += relation_weight * relation_deficit
                required_weight_sum += relation_weight
            if required_weight_sum > 1e-8:
                required_presence_penalty = required_weight * (required_sum / required_weight_sum)

    standard_motion = _sequence_motion_by_group(standard)
    query_motion = _sequence_motion_by_group(query)
    motion_delta, motion_hand_side_swapped = _maybe_swap_hand_delta(
        standard_motion,
        query_motion,
        _sequence_groups(standard),
        penalty_weights,
        profile,
        log_ratio=True,
    )
    motion_penalty = temporal_profile_factor * 0.025 * hand_dynamic_scale * sum(
        penalty_weights.get(group, 0.0) * motion_delta[group] for group in motion_delta
    )
    dynamic_required_penalty = 0.0
    dynamic_required_detail: Dict[str, float] = {}
    if profile is not None and profile.word in {"跳"}:
        focus_groups = [group for group in profile.focus_groups if group in standard_motion]
        if not focus_groups:
            focus_groups = ["right_hand", "right_hand_shape"]
        standard_focus_motion = max(float(standard_motion.get(group, 0.0)) for group in focus_groups)
        query_focus_motion = max(float(query_motion.get(group, 0.0)) for group in focus_groups)
        motion_ratio = query_focus_motion / max(standard_focus_motion, 1e-6)
        dynamic_required_detail = {
            "standard_focus_motion": standard_focus_motion,
            "query_focus_motion": query_focus_motion,
            "motion_ratio": motion_ratio,
        }
        if standard_focus_motion > 1e-6 and motion_ratio < 0.25:
            dynamic_required_penalty = 0.045 * ((0.25 - motion_ratio) / 0.25)

    standard_roughness = _sequence_roughness_by_group(standard)
    query_roughness = _sequence_roughness_by_group(query)
    roughness_delta, roughness_hand_side_swapped = _maybe_swap_hand_delta(
        standard_roughness,
        query_roughness,
        _sequence_groups(standard),
        penalty_weights,
        profile,
        log_ratio=True,
    )
    # Shuffled or jittery sequences can look locally similar under DTW. Keep a
    # separate temporal roughness penalty so the semantic order is not erased.
    roughness_penalty = temporal_profile_factor * 0.095 * hand_dynamic_scale * sum(
        penalty_weights.get(group, 0.0) * roughness_delta[group] for group in roughness_delta
    )

    info_penalty = 0.0
    if m < 4 and n >= 8:
        info_penalty = 0.16
    elif m < 0.25 * n:
        info_penalty = 0.08

    endpoint_penalty = 0.0
    if n >= 12 and length_ratio >= 0.90 and standard.features and query.features:
        start_dist = frame_distance(standard.features[0], query.features[0], profile)[0]
        end_dist = frame_distance(standard.features[-1], query.features[-1], profile)[0]
        endpoint_penalty = 0.30 * max(0.0, ((start_dist + end_dist) / 2.0) - 0.02)

    # 手部是主要语义源。若标准或查询的手部信息极弱，不能直接给出高置信分。
    hand_info_standard = max(standard_presence["left_hand"], standard_presence["right_hand"])
    hand_info_query = max(query_presence["left_hand"], query_presence["right_hand"])
    confidence_warning_penalty = 0.0
    if hand_info_standard < 0.20 or hand_info_query < 0.20:
        confidence_warning_penalty = 0.04

    semantic_delta_penalty, semantic_delta_detail = _semantic_delta_penalty(standard, query, profile)
    semantic_delta_penalty *= hand_dynamic_scale
    semantic_anchor_penalty, semantic_anchor_detail = _semantic_phase_anchor_penalty(standard, query, profile)
    semantic_anchor_penalty *= min(hand_dynamic_scale, 1.35)

    total_penalty = (
        length_penalty
        + presence_penalty
        + required_presence_penalty
        + motion_penalty
        + dynamic_required_penalty
        + roughness_penalty
        + info_penalty
        + endpoint_penalty
        + confidence_warning_penalty
        + semantic_delta_penalty
        + semantic_anchor_penalty
    )
    return {
        "length_ratio": length_ratio,
        "length_penalty": length_penalty,
        "temporal_profile_factor": temporal_profile_factor,
        "hand_dynamic_scale": hand_dynamic_scale,
        "presence_delta": presence_delta,
        "presence_hand_side_swapped": presence_hand_side_swapped,
        "presence_penalty": presence_penalty,
        "required_presence_penalty": required_presence_penalty,
        "required_presence_detail": required_presence_detail,
        "motion_delta": motion_delta,
        "motion_hand_side_swapped": motion_hand_side_swapped,
        "motion_penalty": motion_penalty,
        "dynamic_required_penalty": dynamic_required_penalty,
        "dynamic_required_detail": dynamic_required_detail,
        "roughness_delta": roughness_delta,
        "roughness_hand_side_swapped": roughness_hand_side_swapped,
        "roughness_penalty": roughness_penalty,
        "info_penalty": info_penalty,
        "endpoint_penalty": endpoint_penalty,
        "confidence_warning_penalty": confidence_warning_penalty,
        "semantic_delta_penalty": semantic_delta_penalty,
        "semantic_delta_detail": semantic_delta_detail,
        "semantic_anchor_penalty": semantic_anchor_penalty,
        "semantic_anchor_detail": semantic_anchor_detail,
        "total_sequence_penalty": total_penalty,
        "standard_presence": standard_presence,
        "query_presence": query_presence,
        "standard_motion": standard_motion,
        "query_motion": query_motion,
        "standard_roughness": standard_roughness,
        "query_roughness": query_roughness,
    }


def _dimension_weights(group: str, size: int, profile: Optional[SemanticProfile]) -> np.ndarray:
    weights = np.ones(size, dtype=np.float32)
    if profile is None:
        return weights
    if group == "two_hand_relation" and size == 8:
        # [tip_rel_x, tip_rel_y, base_rel_x, base_rel_y, finger_axis_x,
        #  finger_axis_y, |tip_rel|, |base_rel|]. For 跳 the vertical
        # relation of the right "legs" above the left "ground" is semantic.
        if profile.word == "跳":
            return np.asarray([0.90, 2.25, 0.75, 1.45, 0.65, 1.55, 1.25, 0.85], dtype=np.float32)
        return np.asarray([1.00, 1.35, 0.85, 1.10, 0.80, 1.10, 1.05, 0.90], dtype=np.float32)
    spec: Dict[str, float] = {}
    if group.startswith("left_hand"):
        spec.update(profile.keypoint_weights.get("left_hand") or {})
        spec.update(profile.keypoint_weights.get("hand") or {})
    elif group.startswith("right_hand"):
        spec.update(profile.keypoint_weights.get("right_hand") or {})
        spec.update(profile.keypoint_weights.get("hand") or {})
    elif group == "pose":
        spec.update(profile.keypoint_weights.get("pose") or {})
    elif group == "face":
        spec.update(profile.keypoint_weights.get("face") or {})
    if not spec:
        return weights

    if group in {"left_hand", "right_hand"}:
        for raw_idx, raw_weight in spec.items():
            try:
                idx = int(raw_idx)
                value = max(0.0, float(raw_weight))
            except (TypeError, ValueError):
                continue
            start = idx * 3
            if 0 <= start < size:
                weights[start : start + 3] *= value
    elif group in {"left_hand_shape", "right_hand_shape"}:
        shape_alias = {
            "thumb": [0, 5, 10, 15],
            "index": [1, 6, 11, 16],
            "middle": [2, 7, 12, 17],
            "ring": [3, 8, 13, 18],
            "pinky": [4, 9, 14, 19],
            "spread": [5, 6, 7, 8, 9],
            "opening": [5, 6, 7, 8, 9, 15, 16, 17, 18, 19],
        }
        landmark_shape_alias = {
            "4": shape_alias["thumb"],
            "8": shape_alias["index"],
            "12": shape_alias["middle"],
            "16": shape_alias["ring"],
            "20": shape_alias["pinky"],
            "1": shape_alias["thumb"],
            "5": shape_alias["index"],
            "9": shape_alias["middle"],
            "13": shape_alias["ring"],
            "17": shape_alias["pinky"],
        }
        for raw_key, raw_weight in spec.items():
            try:
                value = max(0.0, float(raw_weight))
            except (TypeError, ValueError):
                continue
            key = str(raw_key)
            if key in landmark_shape_alias:
                indices = landmark_shape_alias[key]
            elif key.isdigit():
                indices = [int(raw_key)]
            else:
                indices = shape_alias.get(key, [])
            for idx in indices:
                if 0 <= idx < size:
                    weights[idx] *= value
    return weights


def _weighted_rmse(left: np.ndarray, right: np.ndarray, weights: np.ndarray, cap: Optional[float] = None) -> float:
    weights = np.asarray(weights, dtype=np.float32)
    finite = np.isfinite(left) & np.isfinite(right) & np.isfinite(weights)
    weights = np.where(finite, weights, 0.0)
    denom = float(weights.sum())
    if denom <= 1e-8:
        return 0.0
    diff = left - right
    if cap is not None and cap > 0:
        diff = np.clip(diff, -float(cap), float(cap))
    return float(np.sqrt(np.sum(weights * (diff ** 2)) / denom))


def _similarity_aligned_xy_rmse(a_pts: np.ndarray, b_pts: np.ndarray, point_weights: np.ndarray) -> float:
    """2D similarity-align one hand to another before measuring geometry.

    This keeps the hand-shape/relative skeleton comparison, but reduces
    sensitivity to camera angle, wrist rotation, and small palm orientation
    changes that are visible in real browser captures.
    """

    if a_pts.shape != b_pts.shape or a_pts.shape[0] < 3:
        return float("inf")
    weights = np.asarray(point_weights, dtype=np.float64).reshape(-1)
    weights = np.where(np.isfinite(weights), weights, 0.0)
    weights = np.maximum(weights, 0.0)
    if float(weights.sum()) <= 1e-8:
        weights = np.ones(a_pts.shape[0], dtype=np.float64)
    weights = weights / max(float(weights.sum()), 1e-8)

    a_xy = np.asarray(a_pts[:, :2], dtype=np.float64)
    b_xy = np.asarray(b_pts[:, :2], dtype=np.float64)
    a_center = np.sum(a_xy * weights[:, None], axis=0)
    b_center = np.sum(b_xy * weights[:, None], axis=0)
    a0 = a_xy - a_center
    b0 = b_xy - b_center
    denom = float(np.sum(weights * np.sum(b0 * b0, axis=1)))
    if denom <= 1e-8:
        return float("inf")
    h = (b0 * weights[:, None]).T @ a0
    try:
        u, singular_values, vt = np.linalg.svd(h)
    except np.linalg.LinAlgError:
        return float("inf")
    r = vt.T @ u.T
    if np.linalg.det(r) < 0:
        vt[-1, :] *= -1
        r = vt.T @ u.T
    scale = max(0.70, min(1.45, float(np.sum(singular_values) / denom)))
    aligned = scale * (b0 @ r) + a_center
    diff = a_xy - aligned
    return float(np.sqrt(np.sum(weights * np.sum(diff * diff, axis=1))))


def _pose_robust_hand_distance(
    av: np.ndarray,
    bv: np.ndarray,
    am: np.ndarray,
    bm: np.ndarray,
    dim_weights: np.ndarray,
    raw_dist: float,
    profile: Optional[SemanticProfile],
) -> Tuple[float, Dict[str, float]]:
    """Compare hand landmarks mostly in wrist-relative coordinates.

    For pure hand semantics, sitting/standing mainly shifts the whole hand in
    body-normalized space. The local hand geometry should dominate; a small
    global residual keeps direction/placement from disappearing entirely.
    """

    if av.size % 3 != 0 or av.shape != bv.shape:
        return raw_dist, {"hand_pose_robust_used": 0.0}
    config = _semantic_dtw_config(profile)
    if not config["pose_robust_hand_position"]:
        return raw_dist, {"hand_pose_robust_used": 0.0}

    a_pts = av.reshape(-1, 3)
    b_pts = bv.reshape(-1, 3)
    a_mask = am.reshape(-1, 3)
    b_mask = bm.reshape(-1, 3)
    w_pts = dim_weights.reshape(-1, 3)
    a_valid = (a_mask.mean(axis=1) > 0.5) & np.isfinite(a_pts[:, :3]).all(axis=1)
    b_valid = (b_mask.mean(axis=1) > 0.5) & np.isfinite(b_pts[:, :3]).all(axis=1)
    both_points = a_valid & b_valid
    if int(both_points.sum()) < 2:
        return raw_dist, {"hand_pose_robust_used": 0.0}

    if both_points[0]:
        a_anchor = a_pts[0]
        b_anchor = b_pts[0]
    else:
        a_anchor = a_pts[both_points].mean(axis=0)
        b_anchor = b_pts[both_points].mean(axis=0)
    a_local = a_pts - a_anchor
    b_local = b_pts - b_anchor
    flat_mask = np.repeat(both_points.astype(bool), 3)
    local_dist = _weighted_rmse(a_local.reshape(-1)[flat_mask], b_local.reshape(-1)[flat_mask], w_pts.reshape(-1)[flat_mask])
    point_weights = w_pts[both_points, :2].mean(axis=1)
    aligned_xy_dist = _similarity_aligned_xy_rmse(a_pts[both_points], b_pts[both_points], point_weights)
    global_anchor_dist = float(np.linalg.norm(a_anchor[:3] - b_anchor[:3]))
    global_weight = float(config["hand_global_position_weight"])
    orientation_dist = aligned_xy_dist + global_weight * global_anchor_dist if math.isfinite(aligned_xy_dist) else float("inf")
    robust_dist = min(local_dist + global_weight * global_anchor_dist, orientation_dist)
    return min(raw_dist, robust_dist), {
        "hand_pose_robust_used": 1.0,
        "hand_local_distance": float(local_dist),
        "hand_similarity_aligned_xy_distance": float(aligned_xy_dist) if math.isfinite(aligned_xy_dist) else -1.0,
        "hand_global_anchor_distance": global_anchor_dist,
        "hand_global_position_weight": global_weight,
        "hand_pose_robust_distance": float(robust_dist),
    }


def _group_distance_between(
    a: FrameFeature,
    b: FrameFeature,
    a_group: str,
    b_group: str,
    metric_group: str,
    profile: Optional[SemanticProfile] = None,
) -> Tuple[float, float]:
    if a_group not in a.groups or b_group not in b.groups:
        return 0.0, 0.0
    sl = a.groups[a_group]
    br = b.groups[b_group]
    av = a.vector[sl]
    bv = b.vector[br]
    am = a.mask[sl]
    bm = b.mask[br]
    if av.shape != bv.shape or am.shape != bm.shape:
        return 0.0, 1.0
    a_visible = (am > 0) & np.isfinite(av)
    b_visible = (bm > 0) & np.isfinite(bv)
    both = a_visible & b_visible
    either = a_visible | b_visible
    mismatch = a_visible != b_visible
    if both.any():
        left = av[both]
        right = bv[both]
        dim_weights = _dimension_weights(metric_group, av.shape[0], profile)[both]
        full_dim_weights = _dimension_weights(metric_group, av.shape[0], profile)
        cap = 0.35 if metric_group in HAND_SHAPE_GROUPS else None
        raw_dist = _weighted_rmse(left, right, dim_weights, cap=cap)
        dist = raw_dist
        extra_metrics: Dict[str, float] = {}
        if metric_group in {"left_hand", "right_hand"}:
            dist, extra_metrics = _pose_robust_hand_distance(av, bv, am, bm, full_dim_weights, raw_dist, profile)
        if metric_group in {"left_hand", "right_hand", "pose"}:
            denom = float(np.dot(dim_weights * right, right))
            if denom > 1e-8:
                alpha = float(np.dot(dim_weights * left, right) / denom)
                alpha = max(0.70, min(1.45, alpha))
                scaled_dist = _weighted_rmse(left, alpha * right, dim_weights)
                scale_penalty = 0.004 * abs(math.log(max(alpha, 1e-6)))
                dist = min(raw_dist, scaled_dist + scale_penalty)
                if metric_group in {"left_hand", "right_hand"} and extra_metrics:
                    robust_distance = extra_metrics.get("hand_pose_robust_distance")
                    if robust_distance is not None:
                        dist = min(dist, float(robust_distance))
    else:
        dist = 0.0
        extra_metrics = {}
    missing_penalty = float(mismatch.sum()) / float(either.sum()) if either.any() else 0.0
    if extra_metrics:
        # Store the diagnostics on the function object for the caller that
        # immediately consumes this result. This keeps the public tuple stable.
        _group_distance_between.last_extra_metrics = extra_metrics  # type: ignore[attr-defined]
    else:
        _group_distance_between.last_extra_metrics = {}  # type: ignore[attr-defined]
    return dist, missing_penalty


def _group_distance(a: FrameFeature, b: FrameFeature, group: str, profile: Optional[SemanticProfile] = None) -> Tuple[float, float]:
    return _group_distance_between(a, b, group, group, group, profile)


def frame_distance(a: FrameFeature, b: FrameFeature, profile: Optional[SemanticProfile] = None) -> Tuple[float, Dict[str, float]]:
    group_metrics: Dict[str, float] = {}
    weighted = 0.0
    missing = 0.0
    groups = [
        group
        for group in [
            "left_hand",
            "right_hand",
            "left_hand_shape",
            "right_hand_shape",
            "left_hand_motion",
            "right_hand_motion",
            "left_hand_shape_motion",
            "right_hand_shape_motion",
            "two_hand_relation",
            "two_hand_relation_motion",
            "pose",
            "face",
        ]
        if group in a.groups and group in b.groups
    ]
    weights = _profile_group_weights(profile, groups)

    hand_like_groups = [*HAND_GROUPS, *RELATIVE_MOTION_GROUPS]
    hand_groups = [group for group in hand_like_groups if group in groups]
    non_hand_groups = [group for group in groups if group not in hand_like_groups]

    direct_hand: Dict[str, Tuple[float, float]] = {}
    swapped_hand: Dict[str, Tuple[float, float]] = {}
    for group in hand_groups:
        direct_hand[group] = _group_distance(a, b, group, profile)
    if profile is not None and profile.allow_hand_swap:
        swap_pairs = {
            "left_hand": ("left_hand", "right_hand"),
            "right_hand": ("right_hand", "left_hand"),
            "left_hand_shape": ("left_hand_shape", "right_hand_shape"),
            "right_hand_shape": ("right_hand_shape", "left_hand_shape"),
            "left_hand_motion": ("left_hand_motion", "right_hand_motion"),
            "right_hand_motion": ("right_hand_motion", "left_hand_motion"),
            "left_hand_shape_motion": ("left_hand_shape_motion", "right_hand_shape_motion"),
            "right_hand_shape_motion": ("right_hand_shape_motion", "left_hand_shape_motion"),
        }
        for group, (a_group, b_group) in swap_pairs.items():
            if group in hand_groups and a_group in a.groups and b_group in b.groups:
                swapped_hand[group] = _group_distance_between(a, b, a_group, b_group, group, profile)
    def contribution_distance(group: str, dist: float, miss: float) -> float:
        return dist + _group_missing_distance_weight(profile, group) * miss

    direct_weighted = sum(
        weights.get(group, 0.0) * contribution_distance(group, direct_hand[group][0], direct_hand[group][1])
        for group in direct_hand
    )
    swapped_weighted = sum(
        weights.get(group, 0.0)
        * contribution_distance(group, *swapped_hand.get(group, direct_hand.get(group, (0.0, 0.0))))
        for group in hand_groups
    )
    use_swapped = bool(swapped_hand) and swapped_weighted < direct_weighted
    selected_hand = swapped_hand if use_swapped else direct_hand

    missing_weighted = 0.0
    missing_weight_sum = 0.0
    for group in hand_groups:
        dist, miss = selected_hand.get(group, direct_hand.get(group, (0.0, 0.0)))
        missing_distance = _group_missing_distance_weight(profile, group) * miss
        group_metrics[group] = dist
        group_metrics[f"{group}_missing_penalty"] = miss
        group_metrics[f"{group}_missing_distance"] = missing_distance
        group_weight = weights.get(group, 0.0)
        weighted += group_weight * (dist + missing_distance)
        missing_weighted += group_weight * miss
        missing_weight_sum += group_weight
    group_metrics["hand_side_swapped"] = 1.0 if use_swapped else 0.0

    for group in non_hand_groups:
        dist, miss = _group_distance(a, b, group, profile)
        missing_distance = _group_missing_distance_weight(profile, group) * miss
        group_metrics[group] = dist
        group_metrics[f"{group}_missing_penalty"] = miss
        group_metrics[f"{group}_missing_distance"] = missing_distance
        group_weight = weights.get(group, 0.0)
        weighted += group_weight * (dist + missing_distance)
        missing_weighted += group_weight * miss
        missing_weight_sum += group_weight

    missing = missing_weighted / max(missing_weight_sum, 1e-6)
    weighted += weights.get("missing", GROUP_WEIGHTS["missing"]) * missing
    group_metrics["missing"] = missing
    group_metrics["weighted"] = weighted
    return weighted, group_metrics


def _normalize_frame_weights(values: np.ndarray, low: float = 0.45, high: float = 2.75) -> np.ndarray:
    if values.size == 0:
        return values.astype(np.float32)
    clean = np.asarray(values, dtype=np.float32)
    clean = np.where(np.isfinite(clean), clean, 1.0)
    clean = np.maximum(clean, 0.05)
    mean = float(clean.mean())
    if mean <= 1e-8:
        clean = np.ones_like(clean, dtype=np.float32)
    else:
        clean = clean / mean
    clean = np.clip(clean, low, high)
    mean = float(clean.mean())
    if mean > 1e-8:
        clean = clean / mean
    return clean.astype(np.float32)


def _semantic_phase_from_weights(values: np.ndarray) -> np.ndarray:
    """Map frames onto [0, 1] by cumulative semantic energy, not by frame id."""

    n = int(values.size)
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    if n == 1:
        return np.zeros(1, dtype=np.float32)
    clean = np.asarray(values, dtype=np.float32)
    clean = np.where(np.isfinite(clean), clean, 1.0)
    clean = np.maximum(clean, 0.05)
    baseline = float(np.percentile(clean, 20))
    energy = np.maximum(clean - baseline, 0.0)
    if float(energy.sum()) <= 1e-8:
        return np.linspace(0.0, 1.0, n, dtype=np.float32)
    centered_cumulative = np.cumsum(energy, dtype=np.float64) - 0.5 * energy
    denom = max(float(energy.sum()), 1e-8)
    phases = np.asarray(centered_cumulative / denom, dtype=np.float32)
    phases = np.clip(phases, 0.0, 1.0)
    phases[0] = min(float(phases[0]), 0.02)
    phases[-1] = max(float(phases[-1]), 0.98)
    return phases.astype(np.float32)


def _adjacent_group_motion(
    prev: FrameFeature,
    curr: FrameFeature,
    group: str,
    profile: Optional[SemanticProfile],
) -> float:
    if group not in prev.groups or group not in curr.groups:
        return 0.0
    sl = prev.groups[group]
    both = (prev.mask[sl] > 0) & (curr.mask[sl] > 0)
    if not both.any():
        return 0.0
    dim_weights = _dimension_weights(group, prev.vector[sl].shape[0], profile)[both]
    return _weighted_rmse(prev.vector[sl][both], curr.vector[sl][both], dim_weights)


def compute_semantic_frame_weight_values(
    seq: SequenceData,
    profile: Optional[SemanticProfile] = None,
    combine_stored: bool = True,
) -> np.ndarray:
    """Return mean-normalized per-frame weights from semantic motion density.

    The template/action semantics define which feature groups matter. Within
    those groups, adjacent-frame motion is converted into a dense temporal
    importance curve. Stored weights, when available, are treated as an external
    prior from the database or browser-side sampler and combined conservatively.
    """

    n = len(seq.features)
    if n == 0:
        return np.zeros(0, dtype=np.float32)

    groups_in_seq = _sequence_groups(seq)
    if profile is not None:
        focus_groups = [group for group in profile.focus_groups if group in groups_in_seq]
    else:
        focus_groups = []
    if not focus_groups:
        raw_weights = _profile_group_weights(profile, groups_in_seq)
        focus_groups = [group for group in groups_in_seq if raw_weights.get(group, 0.0) > 0.0]
    if not focus_groups:
        dynamic = np.ones(n, dtype=np.float32)
    else:
        group_weights = _profile_group_weights(profile, focus_groups)
        energy = np.zeros(n, dtype=np.float32)
        for idx, (prev, curr) in enumerate(zip(seq.features[:-1], seq.features[1:]), start=1):
            weighted_motion = 0.0
            weight_sum = 0.0
            for group in focus_groups:
                group_weight = float(group_weights.get(group, 0.0))
                if group_weight <= 0.0:
                    continue
                motion = _adjacent_group_motion(prev, curr, group, profile)
                weighted_motion += group_weight * motion
                weight_sum += group_weight
            edge_energy = weighted_motion / weight_sum if weight_sum > 1e-8 else 0.0
            energy[idx - 1] += 0.5 * edge_energy
            energy[idx] += 0.5 * edge_energy

        if n >= 3:
            smooth = energy.copy()
            smooth[1:-1] = 0.25 * energy[:-2] + 0.50 * energy[1:-1] + 0.25 * energy[2:]
            smooth[0] = 0.75 * energy[0] + 0.25 * energy[1]
            smooth[-1] = 0.75 * energy[-1] + 0.25 * energy[-2]
            energy = smooth

        positive = energy[energy > 1e-8]
        if positive.size == 0:
            dynamic = np.ones(n, dtype=np.float32)
        else:
            floor = float(np.mean(positive)) * 0.20
            dynamic = _normalize_frame_weights(energy + floor)

    if not combine_stored:
        return dynamic

    stored = np.asarray([_sanitize_frame_weight(feature.frame_weight) for feature in seq.features], dtype=np.float32)
    stored = _normalize_frame_weights(stored, low=0.35, high=3.0)
    combined = np.sqrt(np.maximum(dynamic, 0.05) * np.maximum(stored, 0.05))
    return _normalize_frame_weights(combined, low=0.40, high=2.85)


def with_dynamic_frame_weights(seq: SequenceData, profile: Optional[SemanticProfile] = None) -> SequenceData:
    working = _sequence_with_relative_motion_features(seq, profile)
    values = compute_semantic_frame_weight_values(working, profile=profile, combine_stored=True)
    phases = _semantic_phase_from_weights(values)
    features: List[FrameFeature] = []
    for idx, (feature, weight) in enumerate(zip(working.features, values)):
        item = _clone_frame(feature)
        item.frame_weight = float(weight)
        item.semantic_phase = float(phases[idx]) if idx < len(phases) else 0.0
        features.append(item)
    return SequenceData(working.source, working.mode, working.fps, working.total_frames, features)


def _pair_temporal_weight(standard_frame: FrameFeature, query_frame: FrameFeature) -> float:
    standard_weight = max(0.20, min(3.50, _sanitize_frame_weight(standard_frame.frame_weight)))
    query_weight = max(0.20, min(3.50, _sanitize_frame_weight(query_frame.frame_weight)))
    return 0.70 * standard_weight + 0.30 * query_weight


def _frame_weight_summary(seq: SequenceData) -> Dict[str, Any]:
    values = np.asarray([_sanitize_frame_weight(feature.frame_weight) for feature in seq.features], dtype=np.float32)
    if values.size == 0:
        return {"count": 0}
    top_indices = list(np.argsort(values)[-min(8, values.size) :][::-1])
    return {
        "count": int(values.size),
        "mean": float(values.mean()),
        "min": float(values.min()),
        "max": float(values.max()),
        "top_frames": [
            {
                "rank": rank + 1,
                "frame_idx": int(seq.features[idx].frame_idx),
                "timestamp_sec": float(seq.features[idx].timestamp_sec),
                "weight": float(values[idx]),
                "semantic_phase": float(seq.features[idx].semantic_phase),
            }
            for rank, idx in enumerate(top_indices)
        ],
    }


def _semantic_action_window(seq: SequenceData) -> Dict[str, Any]:
    values = np.asarray([float(feature.frame_weight) for feature in seq.features], dtype=np.float32)
    n = int(values.size)
    if n == 0:
        return {"start_index": 0, "end_index": -1, "length": 0, "used": False, "reason": "empty"}
    if n < 5:
        return {
            "start_index": 0,
            "end_index": n - 1,
            "length": n,
            "used": False,
            "reason": "too_short",
            "energy_coverage": 1.0,
        }

    baseline = float(np.percentile(values, 20))
    energy = np.maximum(values - baseline, 0.0)
    total_energy = float(energy.sum())
    peak_index = int(np.argmax(values))
    peak_weight = float(values[peak_index])
    contrast = peak_weight / max(float(values.min()), 1e-6)
    if total_energy <= 1e-8 or contrast < 1.12:
        return {
            "start_index": 0,
            "end_index": n - 1,
            "length": n,
            "used": False,
            "reason": "weak_energy_contrast",
            "energy_coverage": 1.0,
            "peak_index": peak_index,
            "peak_frame_idx": int(seq.features[peak_index].frame_idx),
            "peak_timestamp_sec": float(seq.features[peak_index].timestamp_sec),
            "peak_weight": peak_weight,
            "contrast": contrast,
        }

    active_threshold = max(float(np.percentile(values, 65)), baseline + 0.42 * (peak_weight - baseline))
    active = values >= active_threshold
    active[peak_index] = True

    components: List[Tuple[int, int]] = []
    idx = 0
    while idx < n:
        if not active[idx]:
            idx += 1
            continue
        start = idx
        while idx + 1 < n and active[idx + 1]:
            idx += 1
        components.append((start, idx))
        idx += 1

    peak_component = next(((a, b) for a, b in components if a <= peak_index <= b), (peak_index, peak_index))
    left, right = peak_component
    merge_gap = max(1, int(round(n * 0.06)))
    min_component_energy = 0.08 * float(energy[left : right + 1].sum())
    changed = True
    while changed:
        changed = False
        for a, b in components:
            if b < left and (left - b - 1) <= merge_gap and float(energy[a : b + 1].sum()) >= min_component_energy:
                left = a
                changed = True
            if a > right and (a - right - 1) <= merge_gap and float(energy[a : b + 1].sum()) >= min_component_energy:
                right = b
                changed = True

    left_padding = 0
    right_padding = max(1, int(round(n * 0.03)))
    left = max(0, left - left_padding)
    right = min(n - 1, right + right_padding)

    min_fraction = 0.40 if n < 24 else 0.28
    min_base = 6 if n >= 8 else 4
    min_window = min(n, max(min_base, int(round(n * min_fraction))))
    if right - left + 1 < min_window:
        extra = min_window - (right - left + 1)
        left = max(0, left - max(0, extra // 3))
        right = min(n - 1, right + extra - max(0, extra // 3))
        if right - left + 1 < min_window:
            left = max(0, right - min_window + 1)
            right = min(n - 1, left + min_window - 1)

    window_energy = float(energy[left : right + 1].sum())
    coverage = window_energy / total_energy if total_energy > 1e-8 else 1.0
    used = bool(left > 0 or right < n - 1)
    return {
        "start_index": left,
        "end_index": right,
        "length": right - left + 1,
        "used": used,
        "reason": "semantic_energy_window" if used else "full_sequence_already_active",
        "energy_coverage": coverage,
        "baseline_weight": baseline,
        "active_threshold": active_threshold,
        "peak_index": peak_index,
        "peak_frame_idx": int(seq.features[peak_index].frame_idx),
        "peak_timestamp_sec": float(seq.features[peak_index].timestamp_sec),
        "peak_weight": peak_weight,
        "contrast": contrast,
        "discarded_prefix_frames": left,
        "discarded_suffix_frames": n - 1 - right,
        "start_frame_idx": int(seq.features[left].frame_idx),
        "end_frame_idx": int(seq.features[right].frame_idx),
        "start_timestamp_sec": float(seq.features[left].timestamp_sec),
        "end_timestamp_sec": float(seq.features[right].timestamp_sec),
    }


def _slice_sequence_window(seq: SequenceData, window: Dict[str, Any], suffix: str) -> SequenceData:
    start = int(window.get("start_index", 0))
    end = int(window.get("end_index", len(seq.features) - 1))
    if start < 0 or end < start or not seq.features:
        selected = list(seq.features)
    else:
        selected = seq.features[start : end + 1]
    return SequenceData(
        source=f"{seq.source}::{suffix}[{start}:{end}]",
        mode=seq.mode,
        fps=seq.fps,
        total_frames=seq.total_frames,
        features=[_clone_frame(feature) for feature in selected],
    )


def _presence_from_groups(feature: FrameFeature) -> Dict[str, bool]:
    presence: Dict[str, bool] = {}
    for group in ["pose", "left_hand", "right_hand", "face"]:
        if group not in feature.groups:
            presence[group] = False
            continue
        sl = feature.groups[group]
        presence[group] = bool(float(feature.mask[sl].mean()) >= 0.35)
    return presence


def _resample_sequence_to_length(seq: SequenceData, target_len: int, suffix: str) -> SequenceData:
    current_len = len(seq.features)
    if current_len == 0 or target_len <= 0 or current_len == target_len:
        return seq
    if current_len == 1:
        features = [_clone_frame(seq.features[0]) for _ in range(target_len)]
        for idx, feature in enumerate(features):
            feature.frame_idx = int(round(seq.features[0].frame_idx))
            feature.timestamp_sec = seq.features[0].timestamp_sec
        return SequenceData(f"{seq.source}::{suffix}", seq.mode, seq.fps, seq.total_frames, features)

    positions = np.linspace(0.0, float(current_len - 1), target_len)
    features: List[FrameFeature] = []
    for pos in positions:
        left_idx = int(math.floor(float(pos)))
        right_idx = min(current_len - 1, left_idx + 1)
        alpha = float(pos - left_idx)
        left = seq.features[left_idx]
        right = seq.features[right_idx]
        vector = ((1.0 - alpha) * left.vector + alpha * right.vector).astype(np.float32)
        mask = np.minimum(left.mask, right.mask).astype(np.float32)
        frame = _clone_frame(left, vector=vector, mask=mask)
        frame.frame_idx = int(round((1.0 - alpha) * left.frame_idx + alpha * right.frame_idx))
        frame.timestamp_sec = float((1.0 - alpha) * left.timestamp_sec + alpha * right.timestamp_sec)
        frame.frame_weight = float((1.0 - alpha) * left.frame_weight + alpha * right.frame_weight)
        frame.semantic_phase = float((1.0 - alpha) * left.semantic_phase + alpha * right.semantic_phase)
        frame.presence = _presence_from_groups(frame)
        features.append(frame)
    return SequenceData(f"{seq.source}::{suffix}", seq.mode, seq.fps, seq.total_frames, features)


def _maybe_resample_query_window(standard: SequenceData, query: SequenceData) -> Tuple[SequenceData, Dict[str, Any]]:
    n = len(standard.features)
    m = len(query.features)
    if n <= 0 or m <= 0:
        return query, {"used": False, "reason": "empty"}
    ratio = m / max(n, 1)
    if m >= 4 and ratio < 0.45:
        return _resample_sequence_to_length(query, n, "query_temporal_resample"), {
            "used": True,
            "from_length": m,
            "to_length": n,
            "ratio": ratio,
            "method": "linear_feature_interpolation_after_action_window",
        }
    return query, {"used": False, "ratio": ratio}


def _score_scale_for_action_window(standard: SequenceData, action_window: Dict[str, Any]) -> Tuple[float, Dict[str, Any]]:
    n = len(standard.features)
    query_window = action_window.get("query") or {}
    query_contrast = float(query_window.get("contrast", 1.0) or 1.0)
    query_has_action = query_contrast >= 1.15 and query_window.get("reason") != "weak_energy_contrast"
    if n < 12 and query_has_action:
        scale = min(0.180, SCORE_SCALE * math.sqrt(18.0 / max(float(n), 1.0)))
        return scale, {
            "base_scale": SCORE_SCALE,
            "effective_scale": scale,
            "reason": "short_action_window_with_query_energy_peak",
            "standard_action_length": n,
            "query_contrast": query_contrast,
        }
    return SCORE_SCALE, {
        "base_scale": SCORE_SCALE,
        "effective_scale": SCORE_SCALE,
        "reason": "default",
        "standard_action_length": n,
        "query_contrast": query_contrast,
    }


def _alignment_policy_for_window(
    full_standard: SequenceData,
    standard_window: Dict[str, Any],
    profile: Optional[SemanticProfile],
) -> Dict[str, Any]:
    full_len = len(full_standard.features)
    action_len = int(standard_window.get("length") or full_len)
    action_ratio = action_len / max(float(full_len), 1.0)
    word = profile.word if profile else None
    short_standard_action = action_len < 12 and full_len <= 24
    if short_standard_action:
        return {
            "mode": "semantic_action_window",
            "used_action_window_for_scoring": True,
            "reason": "short_standard_action_window",
            "word": word,
            "standard_full_length": full_len,
            "standard_action_length": action_len,
            "standard_action_ratio": action_ratio,
        }
    return {
        "mode": "full_sequence_with_action_window_diagnostics",
        "used_action_window_for_scoring": False,
        "reason": "long_or_context_sensitive_action_keep_full_sequence",
        "word": word,
        "standard_full_length": full_len,
        "standard_action_length": action_len,
        "standard_action_ratio": action_ratio,
    }


def _trim_tolerant_scoring_path(
    path: Sequence[Tuple[int, int]],
    local_metrics: Sequence[Sequence[Dict[str, float]]],
    n: int,
    m: int,
) -> Tuple[List[Tuple[int, int]], Dict[str, Any]]:
    if not path:
        return list(path), {"enabled": False}
    length_ratio = min(n, m) / max(n, m, 1)
    if length_ratio < 0.65 or length_ratio > 0.95:
        return list(path), {"enabled": False, "reason": "length_ratio_out_of_range"}

    def path_distance(items: Sequence[Tuple[int, int]]) -> Tuple[float, float]:
        weighted = 0.0
        weight_sum = 0.0
        for i, j in items:
            metrics = local_metrics[i][j]
            pair_weight = float(metrics.get("frame_pair_weight", 1.0))
            weighted += pair_weight * float(metrics.get("weighted", 0.0))
            weight_sum += pair_weight
        return (weighted / max(weight_sum, 1e-6), weight_sum)

    original_distance, original_weight_sum = path_distance(path)
    best_path = list(path)
    best_distance = original_distance
    best_penalized = original_distance
    best_detail: Dict[str, Any] = {
        "enabled": True,
        "used": False,
        "raw_distance": original_distance,
        "raw_path_weight_sum": original_weight_sum,
    }

    max_std_skip = max(0, int(round(n * 0.22)))
    max_qry_skip = max(0, int(round(m * 0.22)))
    min_query_coverage = 0.82
    min_standard_coverage = max(0.62, length_ratio - 0.08)

    for std_prefix in range(max_std_skip + 1):
        for std_suffix in range(max_std_skip + 1 - std_prefix):
            std_lo = std_prefix
            std_hi = n - 1 - std_suffix
            if std_lo > std_hi:
                continue
            for qry_prefix in range(max_qry_skip + 1):
                for qry_suffix in range(max_qry_skip + 1 - qry_prefix):
                    qry_lo = qry_prefix
                    qry_hi = m - 1 - qry_suffix
                    if qry_lo > qry_hi:
                        continue
                    if std_prefix == std_suffix == qry_prefix == qry_suffix == 0:
                        continue
                    selected = [
                        (i, j)
                        for i, j in path
                        if std_lo <= i <= std_hi and qry_lo <= j <= qry_hi
                    ]
                    if not selected:
                        continue
                    std_covered = len({i for i, _ in selected}) / max(n, 1)
                    qry_covered = len({j for _, j in selected}) / max(m, 1)
                    if std_covered < min_standard_coverage or qry_covered < min_query_coverage:
                        continue
                    distance, weight_sum = path_distance(selected)
                    skip_fraction = (std_prefix + std_suffix) / max(n, 1) + (qry_prefix + qry_suffix) / max(m, 1)
                    skip_penalty = 0.018 * skip_fraction
                    penalized = distance + skip_penalty
                    if penalized < best_penalized:
                        best_path = selected
                        best_distance = distance
                        best_penalized = penalized
                        best_detail = {
                            "enabled": True,
                            "used": True,
                            "raw_distance": original_distance,
                            "raw_path_weight_sum": original_weight_sum,
                            "trimmed_distance": distance,
                            "penalized_distance": penalized,
                            "skip_penalty": skip_penalty,
                            "std_prefix_skip": std_prefix,
                            "std_suffix_skip": std_suffix,
                            "query_prefix_skip": qry_prefix,
                            "query_suffix_skip": qry_suffix,
                            "standard_coverage": std_covered,
                            "query_coverage": qry_covered,
                            "path_weight_sum": weight_sum,
                        }

    if best_detail.get("used"):
        return best_path, best_detail
    return list(path), best_detail


def dtw_align(standard: SequenceData, query: SequenceData, profile: Optional[SemanticProfile] = None) -> Dict[str, Any]:
    full_standard = with_dynamic_frame_weights(standard, profile)
    full_query = with_dynamic_frame_weights(query, profile)
    standard_window = _semantic_action_window(full_standard)
    query_window = _semantic_action_window(full_query)
    standard_action = _slice_sequence_window(full_standard, standard_window, "semantic_action_window")
    query_action = _slice_sequence_window(full_query, query_window, "semantic_action_window")
    alignment_policy = _alignment_policy_for_window(full_standard, standard_window, profile)
    if alignment_policy["used_action_window_for_scoring"]:
        standard = standard_action
        query = query_action
        query, temporal_resample = _maybe_resample_query_window(standard, query)
    else:
        standard = full_standard
        query = full_query
        temporal_resample = {
            "used": False,
            "reason": "full_sequence_alignment_policy",
            "ratio": len(query.features) / max(float(len(standard.features)), 1.0),
        }
    n = len(standard.features)
    m = len(query.features)
    local = np.zeros((n, m), dtype=np.float32)
    local_metrics: List[List[Dict[str, float]]] = [[{} for _ in range(m)] for _ in range(n)]
    semantic_dtw_config = _semantic_dtw_config(profile)
    local_phase_weight = float(semantic_dtw_config["local_phase_weight"]) if semantic_dtw_config["enabled"] else 0.0

    for i, a in enumerate(standard.features):
        for j, b in enumerate(query.features):
            dist, metrics = frame_distance(a, b, profile)
            phase_gap = abs(float(a.semantic_phase) - float(b.semantic_phase))
            phase_penalty = local_phase_weight * (phase_gap ** 1.35)
            scoring_dist = dist + phase_penalty
            pair_weight = _pair_temporal_weight(a, b)
            local[i, j] = scoring_dist * pair_weight
            metrics["base_weighted"] = float(dist)
            metrics["semantic_phase_gap"] = phase_gap
            metrics["semantic_phase_penalty"] = phase_penalty
            metrics["frame_pair_weight"] = pair_weight
            metrics["temporal_weighted_distance"] = float(local[i, j])
            metrics["standard_frame_weight"] = float(a.frame_weight)
            metrics["query_frame_weight"] = float(b.frame_weight)
            metrics["standard_semantic_phase"] = float(a.semantic_phase)
            metrics["query_semantic_phase"] = float(b.semantic_phase)
            metrics["weighted"] = float(scoring_dist)
            local_metrics[i][j] = metrics

    acc = np.full((n, m), np.inf, dtype=np.float32)
    back = np.zeros((n, m, 2), dtype=np.int32) - 1
    acc[0, 0] = local[0, 0]
    for i in range(n):
        for j in range(m):
            if i == 0 and j == 0:
                continue
            candidates: List[Tuple[float, int, int]] = []
            if i > 0:
                candidates.append((float(acc[i - 1, j]), i - 1, j))
            if j > 0:
                candidates.append((float(acc[i, j - 1]), i, j - 1))
            if i > 0 and j > 0:
                candidates.append((float(acc[i - 1, j - 1]), i - 1, j - 1))
            best, bi, bj = min(candidates, key=lambda item: item[0])
            acc[i, j] = local[i, j] + best
            back[i, j] = [bi, bj]

    path: List[Tuple[int, int]] = []
    i, j = n - 1, m - 1
    while i >= 0 and j >= 0:
        path.append((i, j))
        pi, pj = back[i, j]
        if pi < 0 or pj < 0:
            break
        i, j = int(pi), int(pj)
    path.reverse()
    raw_path = list(path)

    scoring_path, trim_tolerance = _trim_tolerant_scoring_path(path, local_metrics, n, m)
    path = scoring_path

    metric_keys = [
        "left_hand",
        "right_hand",
        "left_hand_shape",
        "right_hand_shape",
        "left_hand_motion",
        "right_hand_motion",
        "left_hand_shape_motion",
        "right_hand_shape_motion",
        "two_hand_relation",
        "two_hand_relation_motion",
        "pose",
        "face",
        "missing",
        "base_weighted",
        "semantic_phase_gap",
        "semantic_phase_penalty",
        "weighted",
        "hand_side_swapped",
    ]
    group_sums: Dict[str, float] = {key: 0.0 for key in metric_keys}
    worst: List[Dict[str, Any]] = []
    path_weight_sum = 0.0
    for i, j in path:
        metrics = local_metrics[i][j]
        pair_weight = float(metrics.get("frame_pair_weight", 1.0))
        path_weight_sum += pair_weight
        for key in group_sums:
            group_sums[key] += pair_weight * float(metrics.get(key, 0.0))
        worst.append(
            {
                "standard_frame_idx": standard.features[i].frame_idx,
                "query_frame_idx": query.features[j].frame_idx,
                "standard_timestamp_sec": standard.features[i].timestamp_sec,
                "query_timestamp_sec": query.features[j].timestamp_sec,
                "weighted_distance": float(metrics.get("weighted", 0.0)),
                "temporal_weighted_distance": float(metrics.get("temporal_weighted_distance", 0.0)),
                "frame_pair_weight": pair_weight,
                "standard_frame_weight": float(metrics.get("standard_frame_weight", 1.0)),
                "query_frame_weight": float(metrics.get("query_frame_weight", 1.0)),
                "standard_semantic_phase": float(metrics.get("standard_semantic_phase", 0.0)),
                "query_semantic_phase": float(metrics.get("query_semantic_phase", 0.0)),
                "semantic_phase_gap": float(metrics.get("semantic_phase_gap", 0.0)),
                "semantic_phase_penalty": float(metrics.get("semantic_phase_penalty", 0.0)),
                "left_hand_distance": float(metrics.get("left_hand", 0.0)),
                "right_hand_distance": float(metrics.get("right_hand", 0.0)),
                "left_hand_shape_distance": float(metrics.get("left_hand_shape", 0.0)),
                "right_hand_shape_distance": float(metrics.get("right_hand_shape", 0.0)),
                "pose_distance": float(metrics.get("pose", 0.0)),
                "face_distance": float(metrics.get("face", 0.0)),
                "missing_penalty": float(metrics.get("missing", 0.0)),
                "hand_side_swapped": float(metrics.get("hand_side_swapped", 0.0)),
            }
        )

    denom = max(path_weight_sum, 1e-6)
    group_mean = {key: value / denom for key, value in group_sums.items()}
    dtw_distance = float(group_mean.get("weighted", 0.0))
    if trim_tolerance.get("used"):
        dtw_distance = float(trim_tolerance.get("penalized_distance", dtw_distance))
    sequence_penalty = _sequence_penalty(standard, query, group_mean, profile)
    normalized_distance = dtw_distance + float(sequence_penalty["total_sequence_penalty"])
    action_window = {
        "standard": standard_window,
        "query": query_window,
        "used_for_scoring": bool(alignment_policy["used_action_window_for_scoring"]),
    }
    score_scale, score_scale_detail = _score_scale_for_action_window(standard, action_window)
    noise_floor = 0.0
    short_action_tolerance = 0.0
    semantic_phase_trim_tolerance = 0.0
    scoring_length_ratio = min(n, m) / max(n, m, 1)
    if (
        score_scale_detail.get("reason") == "short_action_window_with_query_energy_peak"
        and 0.60 <= scoring_length_ratio <= 1.05
        and dtw_distance < 0.055
        and float(sequence_penalty.get("total_sequence_penalty", 0.0)) > 0.0
    ):
        short_action_tolerance = min(0.045, 0.65 * float(sequence_penalty["total_sequence_penalty"]))
        normalized_distance = max(dtw_distance, normalized_distance - short_action_tolerance)
        sequence_penalty["short_action_subsample_tolerance"] = -short_action_tolerance
        sequence_penalty["total_sequence_penalty_after_tolerance"] = normalized_distance - dtw_distance
    elif (
        not alignment_policy["used_action_window_for_scoring"]
        and 0.70 <= scoring_length_ratio <= 1.0
        and dtw_distance < 0.012
        and float(sequence_penalty.get("total_sequence_penalty", 0.0)) > 0.0
    ):
        # If semantic DTW found a near-identical core path, moderate prefix/suffix
        # trimming should not be treated as a semantic error.
        semantic_phase_trim_tolerance = min(0.018, 0.45 * float(sequence_penalty["total_sequence_penalty"]))
        normalized_distance = max(dtw_distance, normalized_distance - semantic_phase_trim_tolerance)
        sequence_penalty["semantic_phase_trim_tolerance"] = -semantic_phase_trim_tolerance
        sequence_penalty["total_sequence_penalty_after_tolerance"] = normalized_distance - dtw_distance
    query_action_window = (action_window.get("query") or {}) if isinstance(action_window, dict) else {}
    semantic_core_query_hand_presence_full = _hand_presence_value(_presence_ratio(query), profile)
    semantic_core_query_hand_presence_window = _hand_presence_value(
        _presence_ratio_for_features(_window_features(query, query_action_window)),
        profile,
    )
    semantic_core_query_hand_presence = _semantic_core_hand_presence(query, profile, query_action_window)
    core_presence_threshold = float(semantic_dtw_config["core_visible_presence_threshold"])
    flower_opening_guard = _flower_opening_guard(query, profile, semantic_dtw_config)
    flower_jump_confusion_guard = _flower_jump_confusion_guard(
        full_query,
        profile,
        semantic_dtw_config,
        flower_opening_guard,
    )
    semantic_phase_order_guard = _semantic_phase_order_guard(
        full_standard,
        full_query,
        profile,
        semantic_dtw_config,
    )
    semantic_core_guard_passed = bool(flower_opening_guard.get("passed", True)) and not bool(
        flower_jump_confusion_guard.get("blocked")
    ) and not bool(semantic_phase_order_guard.get("blocked"))
    score_scale_detail["semantic_core_query_hand_presence"] = semantic_core_query_hand_presence
    score_scale_detail["semantic_core_query_hand_presence_full"] = semantic_core_query_hand_presence_full
    score_scale_detail["semantic_core_query_hand_presence_window"] = semantic_core_query_hand_presence_window
    score_scale_detail["semantic_core_guard_passed"] = semantic_core_guard_passed
    score_scale_detail["flower_opening_guard"] = flower_opening_guard
    score_scale_detail["flower_jump_confusion_guard"] = flower_jump_confusion_guard
    score_scale_detail["semantic_phase_order_guard"] = semantic_phase_order_guard
    short_core_capture_tolerance = 0.0
    if (
        profile is not None
        and not alignment_policy["used_action_window_for_scoring"]
        and float(semantic_dtw_config["short_core_capture_tolerance_cap"]) > 0.0
        and scoring_length_ratio <= float(semantic_dtw_config["short_core_capture_max_length_ratio"])
        and semantic_core_query_hand_presence >= core_presence_threshold
        and semantic_core_guard_passed
        and dtw_distance <= float(semantic_dtw_config["core_visible_dtw_threshold"])
        and float(sequence_penalty.get("total_sequence_penalty_after_tolerance", sequence_penalty["total_sequence_penalty"])) > 0.0
    ):
        # For single-stage hand signs, real browser captures may include only
        # the semantic action while the template retains long static context.
        # If the visible core DTW path is already close, discount context
        # length and phase-summary penalties without changing the local DTW.
        context_penalty = (
            float(sequence_penalty.get("length_penalty", 0.0))
            + 0.75 * float(sequence_penalty.get("semantic_delta_penalty", 0.0))
            + float(sequence_penalty.get("semantic_anchor_penalty", 0.0))
        )
        current_penalty = float(sequence_penalty.get("total_sequence_penalty_after_tolerance", sequence_penalty["total_sequence_penalty"]))
        short_core_capture_tolerance = min(
            float(semantic_dtw_config["short_core_capture_tolerance_cap"]),
            max(0.0, context_penalty),
            max(0.0, current_penalty),
        )
        if short_core_capture_tolerance > 0.0:
            normalized_distance = max(dtw_distance, normalized_distance - short_core_capture_tolerance)
            sequence_penalty["short_core_capture_tolerance"] = -short_core_capture_tolerance
            sequence_penalty["short_core_capture_context_penalty"] = context_penalty
            sequence_penalty["total_sequence_penalty_after_tolerance"] = normalized_distance - dtw_distance
    visible_semantic_core_tolerance = 0.0
    if (
        profile is not None
        and float(sequence_penalty.get("hand_dynamic_scale", 1.0)) > 1.0
        and semantic_core_query_hand_presence >= core_presence_threshold
        and semantic_core_guard_passed
        and dtw_distance < 0.045
        and float(sequence_penalty.get("total_sequence_penalty_after_tolerance", sequence_penalty["total_sequence_penalty"])) > 0.0
    ):
        # Real browser captures often have visible semantic skeletons but noisy
        # roughness / semantic-delta summaries due to short occlusions. If the
        # main DTW path is already close, treat most sequence penalties as
        # diagnostics instead of hard errors.
        current_penalty = float(sequence_penalty.get("total_sequence_penalty_after_tolerance", sequence_penalty["total_sequence_penalty"]))
        visible_semantic_core_tolerance = min(float(semantic_dtw_config["visible_core_tolerance_cap"]), 0.82 * current_penalty)
        normalized_distance = max(dtw_distance, normalized_distance - visible_semantic_core_tolerance)
        sequence_penalty["visible_semantic_core_tolerance"] = -visible_semantic_core_tolerance
        sequence_penalty["total_sequence_penalty_after_tolerance"] = normalized_distance - dtw_distance
    core_visible_scale_used = False
    if (
        profile is not None
        and semantic_core_query_hand_presence >= core_presence_threshold
        and semantic_core_guard_passed
        and dtw_distance <= float(semantic_dtw_config["core_visible_dtw_threshold"])
        and normalized_distance <= float(semantic_dtw_config["core_visible_max_normalized_distance"])
        and float(semantic_dtw_config["core_visible_score_scale"]) > score_scale
    ):
        score_scale = float(semantic_dtw_config["core_visible_score_scale"])
        core_visible_scale_used = True
        score_scale_detail["reason"] = "visible_semantic_core_scale"
    if (
        score_scale_detail.get("reason") == "short_action_window_with_query_energy_peak"
        and dtw_distance < 0.060
        and semantic_core_query_hand_presence >= 0.50
    ):
        noise_floor = min(0.020, 0.35 * dtw_distance)
    elif (
        float(sequence_penalty.get("hand_dynamic_scale", 1.0)) > 1.0
        and dtw_distance < 0.025
        and normalized_distance < 0.060
        and semantic_core_query_hand_presence >= 0.60
    ):
        noise_floor = min(0.016, 0.65 * dtw_distance)
    score_distance = max(0.0, normalized_distance - noise_floor)
    prototype_score = float(100.0 * math.exp(-score_distance / score_scale))
    flower_floor_score, flower_floor_detail = _flower_visible_core_semantic_floor(
        dtw_distance=dtw_distance,
        scoring_length_ratio=scoring_length_ratio,
        action_window=action_window,
        score_scale=score_scale_detail,
        sequence_penalty=sequence_penalty,
        group_mean=group_mean,
        profile=profile,
        config=semantic_dtw_config,
    )
    jump_floor_score, jump_floor_detail = _jump_relation_semantic_floor(
        standard,
        query,
        group_mean,
        sequence_penalty,
        profile,
        semantic_dtw_config,
        full_standard=full_standard,
        full_query=full_query,
    )
    semantic_floor_score = 0.0
    semantic_floor_detail: Dict[str, Any] = {"enabled": False}
    for floor_score, floor_detail in [
        (flower_floor_score, flower_floor_detail),
        (jump_floor_score, jump_floor_detail),
    ]:
        if float(floor_score) > semantic_floor_score:
            semantic_floor_score = float(floor_score)
            semantic_floor_detail = floor_detail
        elif bool(floor_detail.get("enabled")) and not bool(semantic_floor_detail.get("enabled")):
            semantic_floor_detail = floor_detail
    if semantic_floor_score > prototype_score:
        prototype_score = semantic_floor_score
        source = str(semantic_floor_detail.get("source") or "semantic")
        if profile is not None and profile.word == "跳":
            score_scale_detail["reason"] = "jump_relation_semantic_floor"
        elif profile is not None and profile.word == "花":
            score_scale_detail["reason"] = f"flower_{source}_semantic_floor"
        else:
            score_scale_detail["reason"] = f"{source}_semantic_floor"
    if bool(semantic_phase_order_guard.get("blocked")):
        max_phase_order_score = float(semantic_phase_order_guard.get("max_score") or 45.0)
        if prototype_score > max_phase_order_score:
            prototype_score = max_phase_order_score
            score_scale_detail["reason"] = "semantic_phase_order_guard"
    score_scale_detail["effective_scale"] = score_scale
    score_scale_detail["noise_floor_distance"] = noise_floor
    score_scale_detail["short_action_subsample_tolerance"] = short_action_tolerance
    score_scale_detail["semantic_phase_trim_tolerance"] = semantic_phase_trim_tolerance
    score_scale_detail["short_core_capture_tolerance"] = short_core_capture_tolerance
    score_scale_detail["visible_semantic_core_tolerance"] = visible_semantic_core_tolerance
    score_scale_detail["semantic_core_query_hand_presence"] = semantic_core_query_hand_presence
    score_scale_detail["semantic_core_guard_passed"] = semantic_core_guard_passed
    score_scale_detail["flower_opening_guard"] = flower_opening_guard
    score_scale_detail["flower_jump_confusion_guard"] = flower_jump_confusion_guard
    score_scale_detail["semantic_phase_order_guard"] = semantic_phase_order_guard
    score_scale_detail["core_visible_scale_used"] = core_visible_scale_used
    score_scale_detail["semantic_floor_score"] = semantic_floor_score
    score_scale_detail["semantic_floor"] = semantic_floor_detail
    score_scale_detail["score_distance"] = score_distance
    prototype_score = max(0.0, min(100.0, prototype_score))
    score_scale_detail["capture_quality"] = _capture_quality_assessment(
        profile,
        prototype_score,
        score_scale_detail,
        sequence_penalty,
    )
    worst_sorted = sorted(worst, key=lambda item: item["temporal_weighted_distance"], reverse=True)[:10]

    return {
        "standard_length": n,
        "query_length": m,
        "standard_full_length": len(full_standard.features),
        "query_full_length": len(full_query.features),
        "alignment_policy": alignment_policy,
        "action_window": action_window,
        "temporal_resample": temporal_resample,
        "score_scale": score_scale_detail,
        "path_length": len(path),
        "raw_path_length": len(raw_path),
        "path_weight_sum": path_weight_sum,
        "trim_tolerance": trim_tolerance,
        "dtw_distance": dtw_distance,
        "normalized_distance": normalized_distance,
        "prototype_score": prototype_score,
        "sequence_penalty": sequence_penalty,
        "group_mean_distance": group_mean,
        "frame_weight_summary": {
            "standard_full": _frame_weight_summary(full_standard),
            "query_full": _frame_weight_summary(full_query),
            "standard_action": _frame_weight_summary(standard_action),
            "query_action": _frame_weight_summary(query_action),
            "standard_scoring": _frame_weight_summary(standard),
            "query_scoring": _frame_weight_summary(query),
        },
        "semantic_profile": _profile_summary(profile) if profile else None,
        "semantic_dtw": semantic_dtw_config,
        "alignment_path": [
            {
                "standard_frame_idx": standard.features[i].frame_idx,
                "query_frame_idx": query.features[j].frame_idx,
                "standard_timestamp_sec": standard.features[i].timestamp_sec,
                "query_timestamp_sec": query.features[j].timestamp_sec,
                "distance": float(local_metrics[i][j].get("weighted", 0.0)),
                "base_distance": float(local_metrics[i][j].get("base_weighted", local_metrics[i][j].get("weighted", 0.0))),
                "semantic_phase_gap": float(local_metrics[i][j].get("semantic_phase_gap", 0.0)),
                "semantic_phase_penalty": float(local_metrics[i][j].get("semantic_phase_penalty", 0.0)),
                "temporal_weighted_distance": float(local_metrics[i][j].get("temporal_weighted_distance", 0.0)),
                "frame_pair_weight": float(local_metrics[i][j].get("frame_pair_weight", 1.0)),
                "standard_frame_weight": float(local_metrics[i][j].get("standard_frame_weight", 1.0)),
                "query_frame_weight": float(local_metrics[i][j].get("query_frame_weight", 1.0)),
                "standard_semantic_phase": float(local_metrics[i][j].get("standard_semantic_phase", 0.0)),
                "query_semantic_phase": float(local_metrics[i][j].get("query_semantic_phase", 0.0)),
            }
            for i, j in path
        ],
        "worst_alignment_points": worst_sorted,
    }


def _variant(seq: SequenceData, name: str) -> SequenceData:
    items = seq.features
    if name == "self":
        selected = list(items)
    elif name == "subsample_even":
        selected = items[::2] if len(items) > 2 else list(items)
    elif name == "trim_start_20pct":
        cut = max(1, int(round(len(items) * 0.2)))
        selected = items[cut:] or list(items)
    elif name == "trim_end_20pct":
        cut = max(1, int(round(len(items) * 0.2)))
        selected = items[:-cut] or list(items)
    elif name == "middle_60pct":
        cut = max(1, int(round(len(items) * 0.2)))
        selected = items[cut:-cut] or list(items)
    elif name == "trim_both_10pct":
        cut = max(1, int(round(len(items) * 0.1)))
        selected = items[cut:-cut] or list(items)
    elif name.startswith("amplitude_"):
        factor = float(name.split("_", 1)[1])
        selected = []
        for item in items:
            vector = item.vector.copy()
            for group in ["left_hand", "right_hand", "pose"]:
                sl = item.groups[group]
                vector[sl] = vector[sl] * factor
            selected.append(_clone_frame(item, vector=vector))
    elif name == "fake_reverse_time":
        selected = list(reversed(items))
    elif name == "fake_shuffle_frames":
        rng = np.random.default_rng(20260520)
        order = list(range(len(items)))
        rng.shuffle(order)
        selected = [items[idx] for idx in order]
    elif name == "fake_static_hold":
        anchor = items[len(items) // 2]
        selected = [_clone_frame(anchor) for _ in items]
    elif name == "fake_random_landmarks":
        rng = np.random.default_rng(20260521)
        selected = []
        vectors, masks = _visible_matrix(seq)
        visible = masks > 0
        scale = float(np.std(vectors[visible])) if visible.any() else 1.0
        scale = max(scale, 0.35)
        for item in items:
            vector = rng.normal(loc=0.0, scale=scale * 1.8, size=item.vector.shape).astype(np.float32)
            vector = vector * item.mask
            selected.append(_clone_frame(item, vector=vector))
    elif name == "fake_random_walk":
        rng = np.random.default_rng(20260522)
        selected = []
        current = items[0].vector.copy()
        for item in items:
            current = current + rng.normal(loc=0.0, scale=0.35, size=current.shape).astype(np.float32) * item.mask
            selected.append(_clone_frame(item, vector=current * item.mask))
    else:
        raise RuntimeError(f"未知 sanity variant：{name}")
    return _clone_sequence(seq, name, selected)


def _case_row(case_id: str, case_type: str, result: Dict[str, Any], query: SequenceData, expected: str) -> Dict[str, Any]:
    score = float(result["prototype_score"])
    return {
        "case_id": case_id,
        "case_type": case_type,
        "expected": expected,
        "query_source": query.source,
        "query_length": len(query.features),
        "prototype_score": score,
        "dtw_distance": result["dtw_distance"],
        "normalized_distance": result["normalized_distance"],
        "sequence_penalty": result["sequence_penalty"],
        "group_mean_distance": result["group_mean_distance"],
    }


def _parse_labeled_path(value: str) -> Tuple[str, Path]:
    if "=" in value:
        label, raw = value.split("=", 1)
        return label.strip() or Path(raw).stem, Path(raw)
    path = Path(value)
    return path.parent.name or path.stem, path


def _slug(text: str) -> str:
    slug = re.sub(r"[^\w._-]+", "_", text.strip(), flags=re.UNICODE)
    return slug.strip("_") or "case"


def run_discrimination_suite(
    standard: SequenceData,
    negative_jsons: Sequence[str],
    feature_mode: str,
    force_bbox: bool,
    positive_threshold: float,
    negative_threshold: float,
    profile: Optional[SemanticProfile] = None,
) -> Dict[str, Any]:
    cases: List[Dict[str, Any]] = []
    for name in POSITIVE_VARIANTS:
        query = _variant(standard, name)
        result = run_pair(standard, query, semantic_profile=profile)
        cases.append(_case_row(name, "target_positive_variant", result, query, "high"))

    for name in FAKE_VARIANTS:
        query = _variant(standard, name)
        result = run_pair(standard, query, semantic_profile=profile)
        cases.append(_case_row(name, "synthetic_fake_action", result, query, "low"))

    for item in negative_jsons:
        label, path = _parse_labeled_path(item)
        query = load_sequence(path, feature_mode, force_bbox=force_bbox)
        if standard.mode != query.mode:
            query = load_sequence(path, feature_mode, force_bbox=True)
        result = run_pair(standard, query, semantic_profile=profile)
        cases.append(_case_row(f"other_demo_{_slug(label)}", "other_demo_action", result, query, "low"))

    positive_scores = [row["prototype_score"] for row in cases if row["case_type"] == "target_positive_variant"]
    negative_scores = [row["prototype_score"] for row in cases if row["case_type"] != "target_positive_variant"]
    min_positive = min(positive_scores) if positive_scores else None
    max_negative = max(negative_scores) if negative_scores else None
    margin = (min_positive - max_negative) if min_positive is not None and max_negative is not None else None
    gate_pass = bool(
        min_positive is not None
        and max_negative is not None
        and min_positive >= positive_threshold
        and max_negative <= negative_threshold
        and margin is not None
        and margin >= 15.0
    )
    return {
        "positive_threshold": positive_threshold,
        "negative_threshold": negative_threshold,
        "required_margin": 15.0,
        "min_positive_score": min_positive,
        "max_negative_score": max_negative,
        "margin": margin,
        "gate_pass": gate_pass,
        "cases": cases,
    }


def _write_alignment_csv(path: Path, alignment_path: Sequence[Dict[str, Any]]) -> None:
    if not alignment_path:
        return
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(alignment_path[0].keys()))
        writer.writeheader()
        writer.writerows(alignment_path)


def _write_cases_csv(path: Path, cases: Sequence[Dict[str, Any]]) -> None:
    if not cases:
        return
    fields = [
        "case_id",
        "case_type",
        "expected",
        "query_length",
        "prototype_score",
        "dtw_distance",
        "normalized_distance",
    ]
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in cases:
            writer.writerow({key: row.get(key) for key in fields})


def _build_markdown(payload: Dict[str, Any]) -> str:
    lines: List[str] = []
    lines.append("# Holistic 序列打分 MVP 结果")
    lines.append("")
    lines.append("## 口径说明")
    lines.append("")
    lines.append("- 本结果是 prototype sanity check，不是已校准的真实用户评分。")
    lines.append("- 当前项目尚无真实用户视频流样本和人工评分标签，因此不能据此设定合格阈值。")
    lines.append("- 脚本只读取已有 Holistic JSON，不重新运行 MediaPipe。")
    lines.append("")
    lines.append("## 输入")
    lines.append("")
    lines.append(f"- 标准序列：`{payload['standard']['source']}`")
    lines.append(f"- 查询序列：`{payload['query']['source']}`")
    lines.append(f"- 特征模式：`{payload['feature_mode']}`")
    lines.append("")
    lines.append("## 主对齐结果")
    lines.append("")
    score = payload["main_result"]["prototype_score"]
    dist = payload["main_result"]["normalized_distance"]
    lines.append(f"- prototype_score：`{score:.3f}`")
    lines.append(f"- dtw_distance：`{payload['main_result']['dtw_distance']:.6f}`")
    lines.append(f"- normalized_distance：`{dist:.6f}`")
    lines.append(f"- DTW path length：`{payload['main_result']['path_length']}`")
    lines.append(f"- sequence_penalty：`{payload['main_result']['sequence_penalty']['total_sequence_penalty']:.6f}`")
    lines.append("")
    lines.append("### 分组平均距离")
    lines.append("")
    for key, value in payload["main_result"]["group_mean_distance"].items():
        lines.append(f"- {key}: `{value:.6f}`")
    lines.append("")
    lines.append("### 最差对齐点")
    lines.append("")
    for item in payload["main_result"]["worst_alignment_points"][:5]:
        lines.append(
            f"- standard frame {item['standard_frame_idx']} vs query frame {item['query_frame_idx']}: "
            f"weighted={item['weighted_distance']:.6f}, "
            f"left={item['left_hand_distance']:.6f}, right={item['right_hand_distance']:.6f}, "
            f"pose={item['pose_distance']:.6f}, missing={item['missing_penalty']:.6f}"
        )
    if payload.get("sanity_results"):
        lines.append("")
        lines.append("## 伪用户 sanity check")
        lines.append("")
        for row in payload["sanity_results"]:
            lines.append(
                f"- {row['variant']}: score=`{row['prototype_score']:.3f}`, "
                f"distance=`{row['normalized_distance']:.6f}`, query_length=`{row['query_length']}`"
            )
    if payload.get("discrimination_suite"):
        suite = payload["discrimination_suite"]
        lines.append("")
        lines.append("## 判别性套件")
        lines.append("")
        lines.append(f"- 正例最低分：`{suite.get('min_positive_score'):.3f}`")
        lines.append(f"- 负例最高分：`{suite.get('max_negative_score'):.3f}`")
        lines.append(f"- 分离 margin：`{suite.get('margin'):.3f}`")
        lines.append(f"- 门控是否通过：`{suite.get('gate_pass')}`")
        lines.append("")
        for row in sorted(suite.get("cases", []), key=lambda item: item["prototype_score"], reverse=True):
            lines.append(
                f"- {row['case_id']} [{row['case_type']}]: "
                f"score=`{row['prototype_score']:.3f}`, "
                f"dtw=`{row['dtw_distance']:.6f}`, "
                f"total_dist=`{row['normalized_distance']:.6f}`, "
                f"expected={row['expected']}"
            )
    lines.append("")
    return "\n".join(lines)


def _is_web_scoring_query(seq: SequenceData) -> bool:
    source = str(seq.source)
    return "web_scoring_mvp" in source or "/holistic/user_" in source or "\\holistic\\user_" in source


def _compact_cross_score_result(result: Dict[str, Any]) -> Dict[str, Any]:
    score_scale = result.get("score_scale") or {}
    capture_quality = score_scale.get("capture_quality") or {}
    semantic_floor = score_scale.get("semantic_floor") or {}
    return {
        "prototype_score": result.get("prototype_score"),
        "dtw_distance": result.get("dtw_distance"),
        "normalized_distance": result.get("normalized_distance"),
        "score_scale_reason": score_scale.get("reason"),
        "capture_quality_status": capture_quality.get("status"),
        "capture_quality_reason": capture_quality.get("reason"),
        "semantic_floor_reason": semantic_floor.get("reason"),
        "semantic_floor_source": semantic_floor.get("source"),
    }


def _flower_jump_online_cross_check(
    target_word: str,
    query: SequenceData,
    target_score_result: Dict[str, Any],
    semantic_profile_json: Path,
    disable_semantic_profile: bool,
) -> Dict[str, Any]:
    pair = {"花": "跳", "跳": "花"}
    other_word = pair.get(target_word)
    if other_word is None:
        return {"enabled": False, "reason": "target_not_in_flower_jump_pair"}
    if not _is_web_scoring_query(query):
        return {"enabled": False, "reason": "query_not_web_scoring_sample"}

    other_standard_json = DEFAULT_DENSE_TEMPLATE_ROOT / other_word / f"{other_word}_holistic_results.json"
    if not other_standard_json.exists():
        return {
            "enabled": True,
            "target_word": target_word,
            "other_word": other_word,
            "passed": False,
            "reason": "other_template_missing",
            "other_standard_json": str(other_standard_json),
        }

    try:
        other_standard = load_sequence(other_standard_json, requested_mode="landmark")
        other_profile = load_semantic_profile(other_word, semantic_profile_json, disabled=disable_semantic_profile)
        other_score_result = run_pair(
            other_standard,
            query,
            semantic_profile=other_profile,
            semantic_profile_json=semantic_profile_json,
            disable_semantic_profile=disable_semantic_profile,
            target_word=other_word,
            enable_cross_check=False,
        )
        target_score = float(target_score_result.get("prototype_score") or 0.0)
        other_score = float(other_score_result.get("prototype_score") or 0.0)
        margin = target_score - other_score
        max_cross_score = 55.0
        min_margin = 15.0
        passed = bool(other_score <= max_cross_score and margin >= min_margin)
        return {
            "enabled": True,
            "target_word": target_word,
            "other_word": other_word,
            "target_score": target_score,
            "other_score": other_score,
            "margin": margin,
            "passed": passed,
            "max_cross_score": max_cross_score,
            "min_margin": min_margin,
            "reason": "passed" if passed else "cross_word_confusion_risk",
            "source": "score_scale_hot_reload",
            "other_standard_json": str(other_standard_json),
            "target_score_summary": _compact_cross_score_result(target_score_result),
            "other_score_summary": _compact_cross_score_result(other_score_result),
        }
    except Exception as exc:
        return {
            "enabled": True,
            "target_word": target_word,
            "other_word": other_word,
            "passed": False,
            "reason": "cross_check_error",
            "source": "score_scale_hot_reload",
            "error": str(exc),
        }


def run_pair(
    standard: SequenceData,
    query: SequenceData,
    semantic_profile: Optional[SemanticProfile] = None,
    semantic_profile_json: Path = DEFAULT_SEMANTIC_PROFILE_JSON,
    disable_semantic_profile: bool = False,
    target_word: Optional[str] = None,
    enable_cross_check: bool = True,
) -> Dict[str, Any]:
    if standard.mode != query.mode:
        raise RuntimeError(f"特征模式不一致：standard={standard.mode}, query={query.mode}")
    profile = semantic_profile
    if profile is None:
        word = target_word or _infer_word_from_source(standard.source)
        profile = load_semantic_profile(word, semantic_profile_json, disabled=disable_semantic_profile)
    result = dtw_align(standard, query, profile)
    if enable_cross_check and profile is not None and profile.word in {"花", "跳"}:
        score_scale = result.setdefault("score_scale", {})
        score_scale["cross_word_check"] = _flower_jump_online_cross_check(
            profile.word,
            query,
            result,
            semantic_profile_json,
            disable_semantic_profile,
        )
    return result


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Holistic 序列打分 MVP")
    parser.add_argument("--standard-json", required=True, help="标准样本 Holistic JSON")
    parser.add_argument("--query-json", help="查询样本 Holistic JSON；不传时默认和标准样本相同")
    parser.add_argument("--feature-mode", choices=["auto", "landmark", "bbox"], default="auto")
    parser.add_argument("--force-bbox", action="store_true", help="强制使用 bbox 摘要特征，便于兼容旧 probe JSON")
    parser.add_argument("--run-sanity", action="store_true", help="基于标准序列生成伪用户 sanity variants")
    parser.add_argument("--run-discrimination-suite", action="store_true", help="生成目标动作正例、随机假动作和其他 demo 负例的判别性套件")
    parser.add_argument("--negative-json", action="append", default=[], help="其他 demo 负例 JSON，格式 label=path，可重复传入")
    parser.add_argument("--positive-threshold", type=float, default=75.0, help="判别性套件正例最低分门槛")
    parser.add_argument("--negative-threshold", type=float, default=50.0, help="判别性套件负例最高分门槛")
    parser.add_argument("--semantic-profile-json", default=str(DEFAULT_SEMANTIC_PROFILE_JSON), help="文本语义权重 profile JSON")
    parser.add_argument("--target-word", help="显式指定目标词；默认从 standard-json 路径推断")
    parser.add_argument("--disable-semantic-profile", action="store_true", help="关闭文本语义加权，使用旧的均衡手部优先权重")
    parser.add_argument("--output-dir", default="/data/WYC/signLanguage/work/generated/scoring_mvp_run1")
    args = parser.parse_args(argv)

    standard_path = Path(args.standard_json)
    query_path = Path(args.query_json) if args.query_json else standard_path
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    standard = load_sequence(standard_path, args.feature_mode, force_bbox=args.force_bbox)
    force_bbox = args.force_bbox or standard.mode == "bbox"
    query = load_sequence(query_path, args.feature_mode, force_bbox=force_bbox)
    if standard.mode != query.mode:
        standard = load_sequence(standard_path, args.feature_mode, force_bbox=True)
        query = load_sequence(query_path, args.feature_mode, force_bbox=True)

    profile = load_semantic_profile(
        args.target_word or _infer_word_from_source(standard.source),
        Path(args.semantic_profile_json),
        disabled=args.disable_semantic_profile,
    )
    main_result = run_pair(standard, query, semantic_profile=profile)
    sanity_results: List[Dict[str, Any]] = []
    if args.run_sanity:
        for name in POSITIVE_VARIANTS:
            variant = _variant(standard, name)
            result = run_pair(standard, variant, semantic_profile=profile)
            sanity_results.append(
                {
                    "variant": name,
                    "query_length": result["query_length"],
                    "normalized_distance": result["normalized_distance"],
                    "prototype_score": result["prototype_score"],
                    "group_mean_distance": result["group_mean_distance"],
                }
            )
    discrimination_suite = None
    if args.run_discrimination_suite:
        discrimination_suite = run_discrimination_suite(
            standard=standard,
            negative_jsons=args.negative_json,
            feature_mode=args.feature_mode,
            force_bbox=force_bbox,
            positive_threshold=args.positive_threshold,
            negative_threshold=args.negative_threshold,
            profile=profile,
        )

    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "claim_policy": "prototype sanity check only; no calibrated real-user score or pass/fail threshold",
        "feature_mode": standard.mode,
        "semantic_profile": _profile_summary(profile),
        "standard": {
            "source": standard.source,
            "length": len(standard.features),
            "fps": standard.fps,
            "total_frames": standard.total_frames,
            "presence_ratio": _presence_ratio(standard),
        },
        "query": {
            "source": query.source,
            "length": len(query.features),
            "fps": query.fps,
            "total_frames": query.total_frames,
            "presence_ratio": _presence_ratio(query),
        },
        "main_result": main_result,
        "sanity_results": sanity_results,
        "discrimination_suite": discrimination_suite,
    }

    json_path = out_dir / "scoring_mvp_result.json"
    md_path = out_dir / "scoring_mvp_result.md"
    csv_path = out_dir / "alignment_path.csv"
    cases_csv_path = out_dir / "discrimination_cases.csv"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(_build_markdown(payload), encoding="utf-8")
    _write_alignment_csv(csv_path, main_result["alignment_path"])
    if discrimination_suite:
        _write_cases_csv(cases_csv_path, discrimination_suite["cases"])

    print(f"已生成打分结果 JSON：{json_path}")
    print(f"已生成打分结果报告：{md_path}")
    print(f"已生成对齐路径 CSV：{csv_path}")
    if discrimination_suite:
        print(f"已生成判别性套件 CSV：{cases_csv_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
