#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从已审核匿名 Avatar 教学视频生成手语评分模板（_holistic_results.json 格式）。

复用现有 10 词模板（scoring_mvp_run2/all_demo_step4_worker_cache_v2）的 record 格式：
records[].row 为帧摘要，records[].result_data 为 legacy 坐标对象（x/y/z/visibility/presence）。

用法：
  python build_avatar_video_templates.py \
      --video apps/web/assets/content/reference-videos/word-03-supermarket-avatar.mp4 \
      --word 超市 --template-id chaoshi --output work/generated/modelscope-space-bundle/templates/holistic/超市
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import mediapipe as mp


def _mean_or_none(values: List[float]) -> Optional[float]:
    return float(statistics.mean(values)) if values else None


def _bbox_from_landmarks(landmarks, width: int, height: int) -> Optional[Dict[str, float]]:
    xs, ys, vis = [], [], []
    for lm in landmarks:
        xs.append(float(lm.x) * width)
        ys.append(float(lm.y) * height)
        vis.append(float(getattr(lm, "visibility", 1.0)))
    if not xs or not ys:
        return None
    return {
        "x_min": min(xs), "x_max": max(xs),
        "y_min": min(ys), "y_max": max(ys),
        "visibility_mean": _mean_or_none(vis) or 0.0,
    }


def _legacy_points(landmarks) -> List[Dict[str, float]]:
    """把归一化关键点转成旧 worker result_data 坐标对象格式。"""
    if not landmarks:
        return []
    rows = []
    for lm in landmarks:
        rows.append({
            "x": round(float(lm.x), 7),
            "y": round(float(lm.y), 7),
            "z": round(float(getattr(lm, "z", 0.0)), 7),
            "visibility": round(float(getattr(lm, "visibility", 1.0)), 7),
            "presence": round(float(getattr(lm, "presence", 0.0)), 7),
        })
    return rows


def _frame_motion(prev: Optional[Dict[str, Any]], current: Dict[str, Any]) -> Dict[str, float]:
    if not prev:
        return {"motion_energy": 0.0, "bbox_shift": 0.0}
    total_energy, total_shift = 0.0, 0.0
    for group in ["pose", "left_hand", "right_hand", "face"]:
        prev_box = prev.get(group, {}).get("bbox")
        curr_box = current.get(group, {}).get("bbox")
        if not prev_box or not curr_box:
            continue
        px = (prev_box["x_min"] + prev_box["x_max"]) / 2
        py = (prev_box["y_min"] + prev_box["y_max"]) / 2
        cx = (curr_box["x_min"] + curr_box["x_max"]) / 2
        cy = (curr_box["y_min"] + curr_box["y_max"]) / 2
        total_shift += math.hypot(cx - px, cy - py)
        total_energy += abs(cx - px) + abs(cy - py)
    return {"motion_energy": round(total_energy, 6), "bbox_shift": round(total_shift, 6)}


def build_template(video_path: Path, word: str, sample_fps: float = 5.0,
                   model_complexity: int = 1) -> Dict[str, Any]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频：{video_path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = max(1, round(fps / sample_fps))
    max_width = 704

    mp_holistic = mp.solutions.holistic
    records: List[Dict[str, Any]] = []
    prev_row: Optional[Dict[str, Any]] = None
    frame_idx = 0

    with mp_holistic.Holistic(
        static_image_mode=True,
        model_complexity=model_complexity,
        smooth_landmarks=False,
        refine_face_landmarks=True,
        min_detection_confidence=0.5,
    ) as holistic:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_idx % step != 0:
                frame_idx += 1
                continue
            # 限制处理宽度，避免大图过慢
            height, width = frame.shape[:2]
            scale = max_width / width if width > max_width else 1.0
            if scale < 1.0:
                frame = cv2.resize(frame, (int(width * scale), int(height * scale)))
                height, width = frame.shape[:2]

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = holistic.process(rgb)
            pose_lms = result.pose_landmarks.landmark if result.pose_landmarks else None
            left_lms = result.left_hand_landmarks.landmark if result.left_hand_landmarks else None
            right_lms = result.right_hand_landmarks.landmark if result.right_hand_landmarks else None
            face_lms = result.face_landmarks.landmark if result.face_landmarks else None

            row: Dict[str, Any] = {
                "frame_idx": frame_idx,
                "timestamp_sec": round(frame_idx / fps, 6),
                "pose_present": pose_lms is not None,
                "left_hand_present": left_lms is not None,
                "right_hand_present": right_lms is not None,
                "face_present": face_lms is not None,
                "pose": {}, "left_hand": {}, "right_hand": {}, "face": {},
            }
            if pose_lms:
                row["pose"] = {
                    "bbox": _bbox_from_landmarks(pose_lms, width, height),
                    "visibility_mean": _mean_or_none([float(getattr(lm, "visibility", 1.0)) for lm in pose_lms]),
                }
            if left_lms:
                row["left_hand"] = {
                    "bbox": _bbox_from_landmarks(left_lms, width, height),
                    "visibility_mean": _mean_or_none([float(getattr(lm, "visibility", 1.0)) for lm in left_lms]),
                }
            if right_lms:
                row["right_hand"] = {
                    "bbox": _bbox_from_landmarks(right_lms, width, height),
                    "visibility_mean": _mean_or_none([float(getattr(lm, "visibility", 1.0)) for lm in right_lms]),
                }
            if face_lms:
                row["face"] = {
                    "bbox": _bbox_from_landmarks(face_lms, width, height),
                    "visibility_mean": _mean_or_none([float(getattr(lm, "visibility", 1.0)) for lm in face_lms]),
                }
            row.update(_frame_motion(prev_row, row))

            record = {
                "frame_idx": frame_idx,
                "timestamp_sec": round(frame_idx / fps, 6),
                "row": row,
                "result_data": {
                    "pose_landmarks": _legacy_points(pose_lms),
                    "left_hand_landmarks": _legacy_points(left_lms),
                    "right_hand_landmarks": _legacy_points(right_lms),
                    "face_landmarks": _legacy_points(face_lms),
                },
                "frame_eval_sec": 0.05,
            }
            records.append(record)
            prev_row = row
            frame_idx += 1

    cap.release()
    if not records:
        raise RuntimeError("未提取到任何 landmark 帧")

    sampled_indices = [r["frame_idx"] for r in records]
    payload: Dict[str, Any] = {
        "schema_version": "slu-holistic-results-v1",
        "video": str(video_path),
        "video_stem": word,
        "fps": fps,
        "total_frames": total_frames,
        "sampled_frame_indices": sampled_indices,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "static_image_mode": True,
        "input_mode": "frame_slices",
        "records": records,
    }
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True, help="已审核 Avatar 教学视频")
    parser.add_argument("--word", required=True, help="中文词名（模板目录名，如 超市）")
    parser.add_argument("--output", type=Path, required=True, help="输出目录（如 templates/holistic/超市）")
    parser.add_argument("--sample-fps", type=float, default=5.0, help="有效采样帧率（默认 5fps）")
    args = parser.parse_args()

    payload = build_template(args.video, args.word, sample_fps=args.sample_fps)
    out_dir = args.output.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{args.word}_holistic_results.json"
    out_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    records = payload["records"]
    valid = {
        "pose": sum(1 for r in records if r["row"]["pose_present"]),
        "left_hand": sum(1 for r in records if r["row"]["left_hand_present"]),
        "right_hand": sum(1 for r in records if r["row"]["right_hand_present"]),
        "face": sum(1 for r in records if r["row"]["face_present"]),
    }
    print(f"已生成模板：{out_file}")
    print(f"采样帧数：{len(records)}（{payload['fps']:.1f}fps 视频，step={round(payload['fps']/args.sample_fps)}）")
    print(f"存在率 pose={valid['pose']}/{len(records)} left_hand={valid['left_hand']}/{len(records)} "
          f"right_hand={valid['right_hand']}/{len(records)} face={valid['face']}/{len(records)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
