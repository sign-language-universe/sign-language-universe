#!/usr/bin/env python3
"""
关键帧采样策略公共工具。

这个模块给三种采样方式复用：
1. 全视频均匀采样
2. 两阶段采样
3. 自适应采样

核心职责：
- 读取视频元数据
- 构造采样帧序列
- 在选定帧上运行 MediaPipe Holistic
- 汇总采样覆盖范围、尾部覆盖和基础关键点统计
"""

from __future__ import annotations

import json
import math
import os
import statistics
import time
import base64
from datetime import datetime
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

from .signlanguage_common import probe_video_metadata


DEFAULT_REPO_ROOT = Path("/data/WYC/signLanguage")
DEFAULT_VIDEO_ROOT = DEFAULT_REPO_ROOT / "data" / "Demo词汇视频"


def configure_headless() -> None:
    """在服务器/无头环境里关闭 Qt/X11 依赖。"""

    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    os.environ.setdefault("DISPLAY", "")


def import_optional_backends():
    """按需导入 OpenCV 和 MediaPipe。"""

    cv2 = None
    mp = None
    try:
        import cv2 as _cv2  # type: ignore

        cv2 = _cv2
    except Exception:
        cv2 = None

    try:
        import mediapipe as _mp  # type: ignore

        mp = _mp
    except Exception:
        mp = None

    return cv2, mp


def _mean_or_none(values: Sequence[float]) -> Optional[float]:
    return float(statistics.mean(values)) if values else None


def _bbox_from_landmarks(landmarks, width: int, height: int) -> Optional[Dict[str, float]]:
    """把归一化关键点转成像素级包围框。"""

    xs: List[float] = []
    ys: List[float] = []
    vis: List[float] = []
    for lm in landmarks:
        xs.append(float(lm.x) * width)
        ys.append(float(lm.y) * height)
        vis.append(float(getattr(lm, "visibility", 1.0)))
    if not xs or not ys:
        return None
    return {
        "x_min": min(xs),
        "x_max": max(xs),
        "y_min": min(ys),
        "y_max": max(ys),
        "visibility_mean": _mean_or_none(vis) or 0.0,
    }


def _landmark_presence(landmarks) -> bool:
    return landmarks is not None and len(landmarks.landmark) > 0


def _frame_motion(prev: Optional[Dict[str, Any]], current: Dict[str, Any]) -> Dict[str, float]:
    """计算相邻关键帧之间的简单运动量。"""

    if not prev:
        return {"motion_energy": 0.0, "bbox_shift": 0.0}

    total_energy = 0.0
    total_shift = 0.0
    for group in ["pose", "left_hand", "right_hand", "face"]:
        prev_box = prev.get(group, {}).get("bbox")
        curr_box = current.get(group, {}).get("bbox")
        if not prev_box or not curr_box:
            continue
        dx = ((curr_box["x_min"] + curr_box["x_max"]) / 2) - ((prev_box["x_min"] + prev_box["x_max"]) / 2)
        dy = ((curr_box["y_min"] + curr_box["y_max"]) / 2) - ((prev_box["y_min"] + prev_box["y_max"]) / 2)
        total_shift += math.hypot(dx, dy)
        total_energy += abs(dx) + abs(dy)
    return {"motion_energy": total_energy, "bbox_shift": total_shift}


def normalize_total_frames(meta: Dict[str, Any]) -> int:
    """从元数据中推断总帧数。"""

    frame_count = meta.get("frame_count")
    if isinstance(frame_count, int) and frame_count > 0:
        return frame_count

    duration = meta.get("duration_sec")
    fps = meta.get("fps")
    if isinstance(duration, (int, float)) and isinstance(fps, (int, float)) and duration > 0 and fps > 0:
        return max(1, int(round(duration * fps)))

    return 1


def normalized_video_duration(meta: Dict[str, Any], total_frames: int) -> float:
    """从元数据推断总时长。"""

    duration = meta.get("duration_sec")
    fps = meta.get("fps")
    if isinstance(duration, (int, float)) and duration > 0:
        return float(duration)
    if isinstance(fps, (int, float)) and fps > 0 and total_frames > 0:
        return float(total_frames / fps)
    return float(total_frames)


def even_frame_indices(total_frames: int, count: int) -> List[int]:
    """在整段视频上均匀取帧。"""

    if total_frames <= 1:
        return [0]

    count = max(1, min(count, total_frames))
    if count == 1:
        return [0]
    if count == total_frames:
        return list(range(total_frames))

    raw = [int(round(i * (total_frames - 1) / (count - 1))) for i in range(count)]
    indices: List[int] = []
    for idx in raw:
        if idx not in indices:
            indices.append(idx)
    return indices


def select_even_subsample(frame_indices: Sequence[int], target_count: int) -> List[int]:
    """从已排序的帧序列里均匀抽取一个更小的子集。"""

    if target_count <= 0:
        return []
    unique = [int(idx) for idx in frame_indices if int(idx) >= 0]
    if not unique:
        return []
    if len(unique) <= target_count:
        return list(dict.fromkeys(unique))

    positions = even_frame_indices(len(unique), target_count)
    selected: List[int] = []
    for pos in positions:
        if 0 <= pos < len(unique):
            idx = int(unique[pos])
            if idx not in selected:
                selected.append(idx)
    return selected


def summarize_rows(meta: Dict[str, Any], total_frames: int, rows: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """从一组已经完成 Holistic 评估的帧里汇总视频级统计。"""

    processed = [dict(row) for row in rows]
    fps = float(meta.get("fps") or 25.0)
    first_sample_frame = processed[0]["frame_idx"] if processed else None
    last_sample_frame = processed[-1]["frame_idx"] if processed else None
    frame_span_ratio = None
    tail_coverage_ratio = None
    late_half_fraction = None
    late_75_fraction = None

    if processed and total_frames > 1:
        frame_span_ratio = (last_sample_frame - first_sample_frame) / (total_frames - 1)
        tail_coverage_ratio = last_sample_frame / (total_frames - 1)
        late_half_fraction = sum(1 for r in processed if r["frame_idx"] >= 0.5 * (total_frames - 1)) / len(processed)
        late_75_fraction = sum(1 for r in processed if r["frame_idx"] >= 0.75 * (total_frames - 1)) / len(processed)

    motions = [float(r.get("motion_energy", 0.0)) for r in processed]
    pose_ratio = (sum(1 for r in processed if r.get("pose_present")) / len(processed)) if processed else None
    left_ratio = (sum(1 for r in processed if r.get("left_hand_present")) / len(processed)) if processed else None
    right_ratio = (sum(1 for r in processed if r.get("right_hand_present")) / len(processed)) if processed else None
    face_ratio = (sum(1 for r in processed if r.get("face_present")) / len(processed)) if processed else None

    return {
        "samples": len(processed),
        "sampled_frame_indices": [r["frame_idx"] for r in processed],
        "video_total_frames": total_frames,
        "video_fps": fps,
        "first_sample_frame": first_sample_frame,
        "last_sample_frame": last_sample_frame,
        "pose_presence_ratio": pose_ratio,
        "left_hand_presence_ratio": left_ratio,
        "right_hand_presence_ratio": right_ratio,
        "face_presence_ratio": face_ratio,
        "motion_energy_mean": (sum(motions) / len(motions)) if motions else None,
        "motion_energy_max": max(motions) if motions else None,
        "frame_span_ratio": frame_span_ratio,
        "tail_coverage_ratio": tail_coverage_ratio,
        "late_half_fraction": late_half_fraction,
        "late_75_fraction": late_75_fraction,
    }


def build_candidate_indices(total_frames: int, candidate_step: int, short_video_full_threshold: int = 48) -> Tuple[List[int], str]:
    """构造候选帧索引。

    短视频优先全量 dense 候选，长视频使用固定步长 dense 候选。
    """

    total_frames = max(1, int(total_frames))
    candidate_step = max(1, int(candidate_step))
    short_video_full_threshold = max(1, int(short_video_full_threshold))

    if total_frames <= short_video_full_threshold:
        return list(range(total_frames)), "full_dense"

    indices = list(range(0, total_frames, candidate_step))
    if total_frames > 1 and indices[-1] != total_frames - 1:
        indices.append(total_frames - 1)
    return sorted(dict.fromkeys(indices)), "step_dense"


def build_candidate_cache(
    video_path: Path,
    candidate_step: int,
    short_video_full_threshold: int = 48,
    workers: int = 1,
    result_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """生成候选层缓存，只做一次 Holistic。"""

    meta = probe_video_metadata(video_path)
    total_frames = normalize_total_frames(meta)
    candidate_indices, candidate_mode = build_candidate_indices(total_frames, candidate_step, short_video_full_threshold)
    worker_count = workers if workers and workers > 0 else 1
    cache_eval = extract_holistic_rows(video_path, candidate_indices, result_dir=result_dir, workers=worker_count)
    cache_summary = dict(cache_eval["summary"])
    cache_summary["strategy"] = "candidate_cache"
    cache_summary["candidate_mode"] = candidate_mode
    cache_summary["candidate_step"] = candidate_step
    cache_summary["short_video_full_threshold"] = short_video_full_threshold
    return {
        "video": video_path.name,
        "video_path": str(video_path),
        "candidate_step": candidate_step,
        "short_video_full_threshold": short_video_full_threshold,
        "candidate_mode": candidate_mode,
        "candidate_frame_indices": candidate_indices,
        "candidate_summary": summarize_rows(meta, total_frames, cache_eval["rows"]),
        "cache_summary": cache_summary,
        "candidate_result_file": cache_summary.get("holistic_result_file"),
        "candidate_result_dir": str(result_dir) if result_dir is not None else None,
        "rows": cache_eval["rows"],
        "meta": meta,
    }


def load_candidate_cache(cache_path: Path) -> Dict[str, Any]:
    """读取候选缓存文件。"""

    payload = json.loads(Path(cache_path).read_text(encoding="utf-8"))
    rows = payload.get("rows")
    videos = payload.get("videos")
    video_result = payload.get("video_result")
    records = payload.get("records")
    if not isinstance(rows, list) and not isinstance(videos, list) and not isinstance(video_result, dict) and not isinstance(records, list):
        raise RuntimeError(f"候选缓存缺少 rows/videos/video_result：{cache_path}")
    return payload


def _normalize_candidate_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    """把不同历史格式的缓存条目统一成包含 rows 的结构。"""

    normalized = dict(entry)
    if isinstance(normalized.get("rows"), list):
        return normalized
    records = normalized.get("records")
    if isinstance(records, list):
        rows: List[Dict[str, Any]] = []
        for record in records:
            if not isinstance(record, dict):
                continue
            row = record.get("row")
            if isinstance(row, dict):
                rows.append(dict(row))
        if rows:
            normalized["rows"] = rows
            if "sampled_frame_indices" not in normalized:
                normalized["sampled_frame_indices"] = [int(row["frame_idx"]) for row in rows if "frame_idx" in row]
            return normalized
    return normalized


def get_candidate_video_entry(cache_payload: Dict[str, Any], video_name: Optional[str] = None) -> Dict[str, Any]:
    """从候选缓存顶层 payload 中提取单个视频的条目。"""

    if isinstance(cache_payload.get("rows"), list):
        return _normalize_candidate_entry(cache_payload)

    if isinstance(cache_payload.get("records"), list):
        return _normalize_candidate_entry(cache_payload)

    if isinstance(cache_payload.get("video_result"), dict):
        return _normalize_candidate_entry(cache_payload["video_result"])

    videos = cache_payload.get("videos")
    if not isinstance(videos, list) or not videos:
        raise RuntimeError("候选缓存格式不正确，缺少 videos 或 rows")

    if video_name is not None:
        for row in videos:
            if row.get("video") == video_name or row.get("video_path", "").endswith(video_name):
                return _normalize_candidate_entry(row)
        raise RuntimeError(f"候选缓存中未找到视频：{video_name}")

    if len(videos) == 1:
        return _normalize_candidate_entry(videos[0])

    raise RuntimeError("候选缓存包含多个视频，请显式指定 video_name")


def interior_frame_indices(start: int, end: int, count: int) -> List[int]:
    """在一个区间内部均匀取帧，不包含端点。"""

    if end - start <= 1 or count <= 0:
        return []

    span = end - start
    raw = [int(round(start + (i + 1) * span / (count + 1))) for i in range(count)]
    result: List[int] = []
    for idx in raw:
        idx = max(start + 1, min(end - 1, idx))
        if idx not in result:
            result.append(idx)
    return result


def _open_holistic():
    """构造 Holistic 模型。"""

    cv2, mp = import_optional_backends()
    if cv2 is None or mp is None:
        return cv2, mp, None
    holistic = mp.solutions.holistic
    return cv2, mp, holistic


def encode_frame_payload(cv2, frame, image_format: str = "jpg", jpeg_quality: int = 95) -> Dict[str, Any]:
    """把一帧编码成适合 JSON 传输的帧切片 payload。"""

    fmt = image_format.lower().lstrip(".")
    ext = f".{fmt}"
    params: List[int] = []
    if fmt in {"jpg", "jpeg"}:
        params = [int(cv2.IMWRITE_JPEG_QUALITY), int(jpeg_quality)]
    ok, buffer = cv2.imencode(ext, frame, params)
    if not ok:
        raise RuntimeError(f"无法将帧编码为 {ext}")
    return {
        "image_format": fmt,
        "image_b64": base64.b64encode(buffer.tobytes()).decode("ascii"),
    }


def decode_frame_payload(cv2, payload: Dict[str, Any]):
    """从 JSON 传输的帧切片 payload 中恢复图像帧。"""

    image_b64 = payload.get("image_b64")
    if not isinstance(image_b64, str) or not image_b64:
        raise RuntimeError("帧切片缺少 image_b64")
    try:
        raw = base64.b64decode(image_b64.encode("ascii"), validate=True)
    except Exception as exc:
        raise RuntimeError(f"帧切片 base64 解码失败：{exc}") from exc

    buffer = np.frombuffer(raw, dtype=np.uint8)
    frame = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if frame is None:
        raise RuntimeError("帧切片图像解码失败")
    return frame


def _chunk_sequence(values: Sequence[int], chunk_count: int) -> List[List[int]]:
    """把一个已排序序列切成若干块。"""

    items = [int(v) for v in values]
    if not items:
        return []
    chunk_count = max(1, min(int(chunk_count), len(items)))
    chunk_size = max(1, math.ceil(len(items) / chunk_count))
    return [items[i:i + chunk_size] for i in range(0, len(items), chunk_size)]


def _process_holistic_batch(args: Tuple[str, float, Sequence[int]]) -> Dict[str, Any]:
    """在单个子进程里处理一批帧。"""

    video_path_str, fps, frame_indices = args
    video_path = Path(video_path_str)
    cv2, mp, holistic_cls = _open_holistic()
    if cv2 is None or mp is None or holistic_cls is None:
        raise RuntimeError("需要安装 mediapipe 和 opencv-python 才能运行关键帧采样实验")

    if hasattr(cv2, "setNumThreads"):
        try:
            cv2.setNumThreads(1)
        except Exception:
            pass

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频：{video_path}")

    batch_frames = [int(idx) for idx in frame_indices]
    if not batch_frames:
        cap.release()
        return {"records": [], "init_sec": 0.0}
    start_idx = batch_frames[0]
    end_idx = batch_frames[-1]
    targets = set(batch_frames)

    records: List[Dict[str, Any]] = []
    init_start = time.perf_counter()
    with holistic_cls.Holistic(
        static_image_mode=False,
        model_complexity=1,
        smooth_landmarks=True,
        enable_segmentation=False,
        refine_face_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as holistic:
        init_sec = time.perf_counter() - init_start
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_idx)
        frame_idx = start_idx
        while frame_idx <= end_idx:
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError(f"无法读取帧：{video_path} @ {frame_idx}")
            if frame_idx in targets:
                row_start = time.perf_counter()
                row, result = _process_frame(frame_idx, fps, frame, holistic, cv2)
                frame_eval_sec = time.perf_counter() - row_start
                records.append(
                    {
                        "frame_idx": frame_idx,
                        "timestamp_sec": frame_idx / fps,
                        "row": row,
                        "result_data": _serialize_holistic_result(result),
                        "frame_eval_sec": frame_eval_sec,
                    }
                )
            frame_idx += 1

    cap.release()
    return {"records": records, "init_sec": init_sec}


def _process_frame(frame_idx: int, fps: float, frame, holistic, cv2) -> Tuple[Dict[str, Any], Any]:
    """处理单帧，返回帧级统计与原始 Holistic 结果。"""

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = holistic.process(rgb)

    height, width = frame.shape[:2]
    pose_landmarks = result.pose_landmarks.landmark if result.pose_landmarks else None
    left_landmarks = result.left_hand_landmarks.landmark if result.left_hand_landmarks else None
    right_landmarks = result.right_hand_landmarks.landmark if result.right_hand_landmarks else None
    face_landmarks = result.face_landmarks.landmark if result.face_landmarks else None

    row: Dict[str, Any] = {
        "frame_idx": frame_idx,
        "timestamp_sec": frame_idx / fps,
        "pose_present": _landmark_presence(result.pose_landmarks),
        "left_hand_present": _landmark_presence(result.left_hand_landmarks),
        "right_hand_present": _landmark_presence(result.right_hand_landmarks),
        "face_present": _landmark_presence(result.face_landmarks),
        "pose": {},
        "left_hand": {},
        "right_hand": {},
        "face": {},
    }

    if pose_landmarks:
        row["pose"] = {
            "bbox": _bbox_from_landmarks(pose_landmarks, width, height),
            "visibility_mean": _mean_or_none([float(getattr(lm, "visibility", 1.0)) for lm in pose_landmarks]),
        }
    if left_landmarks:
        row["left_hand"] = {
            "bbox": _bbox_from_landmarks(left_landmarks, width, height),
            "visibility_mean": _mean_or_none([float(getattr(lm, "visibility", 1.0)) for lm in left_landmarks]),
        }
    if right_landmarks:
        row["right_hand"] = {
            "bbox": _bbox_from_landmarks(right_landmarks, width, height),
            "visibility_mean": _mean_or_none([float(getattr(lm, "visibility", 1.0)) for lm in right_landmarks]),
        }
    if face_landmarks:
        row["face"] = {
            "bbox": _bbox_from_landmarks(face_landmarks, width, height),
            "visibility_mean": _mean_or_none([float(getattr(lm, "visibility", 1.0)) for lm in face_landmarks]),
        }

    return row, result


def _build_row_from_frame(frame_idx: int, fps: float, frame, holistic, cv2) -> Dict[str, Any]:
    """把单帧转换成统一的关键点统计结构。"""

    row, _ = _process_frame(frame_idx, fps, frame, holistic, cv2)
    return row


def _serialize_landmark_list(landmarks) -> List[Dict[str, float]]:
    """把 MediaPipe landmark 序列转成可落盘的结构。"""

    if not landmarks:
        return []
    serialized: List[Dict[str, float]] = []
    for lm in landmarks:
        item: Dict[str, float] = {
            "x": float(getattr(lm, "x", 0.0)),
            "y": float(getattr(lm, "y", 0.0)),
            "z": float(getattr(lm, "z", 0.0)),
        }
        if hasattr(lm, "visibility"):
            item["visibility"] = float(getattr(lm, "visibility", 0.0))
        if hasattr(lm, "presence"):
            item["presence"] = float(getattr(lm, "presence", 0.0))
        serialized.append(item)
    return serialized


def _serialize_holistic_result(result) -> Dict[str, Any]:
    """把 Holistic 结果序列化，供后续统一渲染使用。"""

    return {
        "pose_landmarks": _serialize_landmark_list(result.pose_landmarks.landmark if result.pose_landmarks else None),
        "left_hand_landmarks": _serialize_landmark_list(result.left_hand_landmarks.landmark if result.left_hand_landmarks else None),
        "right_hand_landmarks": _serialize_landmark_list(result.right_hand_landmarks.landmark if result.right_hand_landmarks else None),
        "face_landmarks": _serialize_landmark_list(result.face_landmarks.landmark if result.face_landmarks else None),
    }


def _render_visual_cache(
    cv2,
    video_path: Path,
    fps: float,
    total_frames: int,
    visual_cache: List[Dict[str, Any]],
    video_out: Path,
) -> Dict[str, Any]:
    """把缓存的帧和 Holistic 结果统一渲染成图片产物。"""

    from PIL import Image, ImageDraw
    from .visualize_holistic_features import _concat_triptych, _label_frame, _load_font, _draw_text_overlay, _import_drawing_helpers

    contact_images: List[np.ndarray] = []
    frame_outputs: List[Dict[str, Any]] = []
    viz_start = time.perf_counter()

    _, face_connections, pose_connections, hand_connections, _ = _import_drawing_helpers()

    def _draw_serialized_landmarks(
        image: np.ndarray,
        landmark_data: Sequence[Dict[str, Any]],
        connections,
        landmark_color: Tuple[int, int, int],
        connection_color: Tuple[int, int, int],
        circle_radius: int,
        line_thickness: int,
    ) -> np.ndarray:
        """直接根据 JSON 中的坐标画点和连线，不依赖 MediaPipe 的绘图封装。"""

        if not landmark_data:
            return image.copy()

        out = image.copy()
        height, width = out.shape[:2]
        points: List[Optional[Tuple[int, int]]] = []
        for item in landmark_data:
            try:
                x = int(float(item.get("x", 0.0)) * width)
                y = int(float(item.get("y", 0.0)) * height)
            except Exception:
                points.append(None)
                continue
            points.append((x, y))

        for a, b in connections:
            if a >= len(points) or b >= len(points):
                continue
            pa = points[a]
            pb = points[b]
            if pa is None or pb is None:
                continue
            cv2.line(out, pa, pb, connection_color, line_thickness, cv2.LINE_AA)

        for point in points:
            if point is None:
                continue
            cv2.circle(out, point, circle_radius, landmark_color, -1, cv2.LINE_AA)

        return out

    def _draw_timeline(video_name: str, total_frames_value: int, sampled_indices: Sequence[int], output_path: Path) -> None:
        width = 1400
        height = 220
        margin_x = 80
        img = Image.new("RGB", (width, height), (18, 18, 18))
        draw = ImageDraw.Draw(img)
        line_y = 120
        draw.line((margin_x, line_y, width - margin_x, line_y), fill=(210, 210, 210), width=6)

        if total_frames_value <= 1:
            total_frames_value = 2

        font = _load_font(28)
        small_font = _load_font(22)
        for frac, label in [(0.0, "0%"), (0.25, "25%"), (0.5, "50%"), (0.75, "75%"), (1.0, "100%")]:
            x = int(margin_x + frac * (width - 2 * margin_x))
            draw.line((x, line_y - 18, x, line_y + 18), fill=(140, 140, 140), width=3)
            draw.text((x - 18, line_y + 28), label, fill=(230, 230, 230), font=small_font)

        for idx in sampled_indices:
            frac = idx / max(1, total_frames_value - 1)
            x = int(margin_x + frac * (width - 2 * margin_x))
            draw.line((x, line_y - 42, x, line_y + 42), fill=(89, 173, 255), width=5)
            draw.ellipse((x - 8, line_y - 8, x + 8, line_y + 8), fill=(89, 173, 255))

        draw.text((margin_x, 20), f"{video_name} 采样时间轴", fill=(255, 255, 255), font=font)
        draw.text((margin_x, 168), f"总帧数：{total_frames_value}   采样帧数：{len(sampled_indices)}", fill=(220, 220, 220), font=small_font)
        img.save(output_path)

    def _make_contact_sheet(images: List[np.ndarray], cols: int = 2) -> Optional[np.ndarray]:
        if not images:
            return None
        w = max(img.shape[1] for img in images)
        h = max(img.shape[0] for img in images)
        padded: List[np.ndarray] = []
        for img in images:
            canvas = np.zeros((h, w, 3), dtype=np.uint8)
            canvas[:] = (24, 24, 24)
            y0 = (h - img.shape[0]) // 2
            x0 = (w - img.shape[1]) // 2
            canvas[y0:y0 + img.shape[0], x0:x0 + img.shape[1]] = img
            padded.append(canvas)

        rows: List[np.ndarray] = []
        for start in range(0, len(padded), cols):
            row = padded[start:start + cols]
            if len(row) < cols:
                blank = np.zeros((h, w, 3), dtype=np.uint8)
                blank[:] = (24, 24, 24)
                row = row + [blank] * (cols - len(row))
            rows.append(np.hstack(row))
        return np.vstack(rows)

    for item in visual_cache:
        frame = item["frame"]
        frame_idx = int(item["frame_idx"])
        result_data = item["result_data"] or {}
        pose_data = result_data.get("pose_landmarks") or []
        left_hand_data = result_data.get("left_hand_landmarks") or []
        right_hand_data = result_data.get("right_hand_landmarks") or []
        face_data = result_data.get("face_landmarks") or []

        annotated = frame.copy()
        annotated = _draw_serialized_landmarks(
            annotated,
            face_data,
            face_connections.FACEMESH_CONTOURS,
            landmark_color=(120, 255, 120),
            connection_color=(220, 220, 220),
            circle_radius=1,
            line_thickness=1,
        )
        annotated = _draw_serialized_landmarks(
            annotated,
            pose_data,
            pose_connections.POSE_CONNECTIONS,
            landmark_color=(80, 220, 255),
            connection_color=(255, 255, 255),
            circle_radius=2,
            line_thickness=2,
        )
        annotated = _draw_serialized_landmarks(
            annotated,
            left_hand_data,
            hand_connections.HAND_CONNECTIONS,
            landmark_color=(255, 120, 80),
            connection_color=(255, 255, 255),
            circle_radius=2,
            line_thickness=2,
        )
        annotated = _draw_serialized_landmarks(
            annotated,
            right_hand_data,
            hand_connections.HAND_CONNECTIONS,
            landmark_color=(255, 120, 80),
            connection_color=(255, 255, 255),
            circle_radius=2,
            line_thickness=2,
        )

        skeleton = np.zeros((frame.shape[0], frame.shape[1], 3), dtype=np.uint8)
        skeleton[:] = (18, 18, 18)
        skeleton = _draw_serialized_landmarks(
            skeleton,
            face_data,
            face_connections.FACEMESH_CONTOURS,
            landmark_color=(120, 255, 120),
            connection_color=(220, 220, 220),
            circle_radius=1,
            line_thickness=1,
        )
        skeleton = _draw_serialized_landmarks(
            skeleton,
            pose_data,
            pose_connections.POSE_CONNECTIONS,
            landmark_color=(80, 220, 255),
            connection_color=(255, 255, 255),
            circle_radius=2,
            line_thickness=2,
        )
        skeleton = _draw_serialized_landmarks(
            skeleton,
            left_hand_data,
            hand_connections.HAND_CONNECTIONS,
            landmark_color=(255, 120, 80),
            connection_color=(255, 255, 255),
            circle_radius=2,
            line_thickness=2,
        )
        skeleton = _draw_serialized_landmarks(
            skeleton,
            right_hand_data,
            hand_connections.HAND_CONNECTIONS,
            landmark_color=(255, 120, 80),
            connection_color=(255, 255, 255),
            circle_radius=2,
            line_thickness=2,
        )

        triptych = _concat_triptych(
            _label_frame(frame, "原图"),
            _label_frame(annotated, "关键点图"),
            _label_frame(skeleton, "骨骼图"),
        )
        triptych = _draw_text_overlay(
            triptych,
            f"视频={video_path.stem} | 帧={frame_idx} | 时间={frame_idx / fps:.2f}s | "
            f"姿态={bool(pose_data)} | 左手={bool(left_hand_data)} | "
            f"右手={bool(right_hand_data)} | 面部={bool(face_data)}",
            position=(16, 18),
            font_size=24,
        )

        triptych_path = video_out / f"{video_path.stem}_f{frame_idx:04d}_triptych.png"
        annotated_path = video_out / f"{video_path.stem}_f{frame_idx:04d}_annotated.png"
        skeleton_path = video_out / f"{video_path.stem}_f{frame_idx:04d}_skeleton.png"
        cv2.imwrite(str(triptych_path), triptych)
        cv2.imwrite(str(annotated_path), annotated)
        cv2.imwrite(str(skeleton_path), skeleton)

        contact_images.append(triptych)
        frame_outputs.append(
            {
                "frame_idx": frame_idx,
                "timestamp_sec": frame_idx / fps,
                "triptych_path": str(triptych_path),
                "annotated_path": str(annotated_path),
                "skeleton_path": str(skeleton_path),
                "pose_present": bool(pose_data),
                "left_hand_present": bool(left_hand_data),
                "right_hand_present": bool(right_hand_data),
                "face_present": bool(face_data),
            }
        )

    contact_sheet = _make_contact_sheet(contact_images, cols=2)
    contact_sheet_path = video_out / f"{video_path.stem}_contact_sheet.png"
    if contact_sheet is not None:
        cv2.imwrite(str(contact_sheet_path), contact_sheet)
    timeline_path = video_out / f"{video_path.stem}_timeline.png"
    sampled_indices = [int(item["frame_idx"]) for item in visual_cache]
    _draw_timeline(video_path.stem, total_frames, sampled_indices, timeline_path)

    return {
        "frame_outputs": frame_outputs,
        "contact_sheet_path": str(contact_sheet_path) if contact_sheet is not None else None,
        "timeline_path": str(timeline_path),
        "visualization_sec": round(time.perf_counter() - viz_start, 3),
    }


def render_holistic_results_from_file(
    video_path: Path,
    result_file: Path,
    sampled_indices: Sequence[int],
    visualize_dir: Path,
) -> Dict[str, Any]:
    """基于已保存的 Holistic 结果文件，渲染一个子集的可视化。"""

    cv2, _, holistic_cls = _open_holistic()
    if cv2 is None or holistic_cls is None:
        raise RuntimeError("需要安装 mediapipe 和 opencv-python 才能渲染采样可视化")

    payload = json.loads(result_file.read_text(encoding="utf-8"))
    records = {int(item["frame_idx"]): item for item in payload.get("records", [])}
    selected = sorted({int(idx) for idx in sampled_indices if int(idx) >= 0})

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频：{video_path}")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or payload.get("fps") or 25.0)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or payload.get("total_frames") or 0)
    visual_cache: List[Dict[str, Any]] = []
    selected_set = set(selected)
    max_target = selected[-1] if selected else -1
    frame_idx = 0
    target_pos = 0
    target = selected[target_pos] if selected else None

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if target is not None and frame_idx > max_target:
            break
        if target is not None and frame_idx < target:
            frame_idx += 1
            continue

        if target is not None and frame_idx == target and frame_idx in selected_set:
            record = records.get(frame_idx)
            if record is None:
                raise RuntimeError(f"结果文件中缺少帧 {frame_idx} 的 Holistic 记录：{result_file}")
            visual_cache.append(
                {
                    "frame": frame.copy(),
                    "frame_idx": frame_idx,
                    "row": record.get("row", {}),
                    "result_data": record.get("result_data", {}),
                }
            )
            target_pos += 1
            target = selected[target_pos] if target_pos < len(selected) else None

        frame_idx += 1

    cap.release()
    Path(visualize_dir).mkdir(parents=True, exist_ok=True)
    return _render_visual_cache(cv2, video_path, fps, total_frames, visual_cache, Path(visualize_dir))


def extract_holistic_rows(
    video_path: Path,
    frame_indices: Sequence[int],
    visualize_dir: Optional[Path] = None,
    result_dir: Optional[Path] = None,
    workers: int = 1,
    holistic: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    在指定帧上运行 Holistic。

    如果传入 `visualize_dir`，会在同一轮处理中同步生成：
    - 单帧关键点图
    - 黑底骨骼图
    - 三联图
    - 联系表
    - 时间轴
    """

    meta = probe_video_metadata(video_path)
    total_frames = normalize_total_frames(meta)
    fps = float(meta.get("fps") or 25.0)

    selected = sorted({idx for idx in frame_indices if isinstance(idx, int) and idx >= 0})
    if not selected:
        return {
            "meta": meta,
            "rows": [],
            "summary": {
                "samples": 0,
                "sampled_frame_indices": [],
                "video_total_frames": total_frames,
                "video_fps": fps,
                "video_duration_sec": normalized_video_duration(meta, total_frames),
                "pose_presence_ratio": None,
                "left_hand_presence_ratio": None,
                "right_hand_presence_ratio": None,
                "face_presence_ratio": None,
                "motion_energy_mean": None,
                "motion_energy_max": None,
                "frame_span_ratio": None,
                "tail_coverage_ratio": None,
                "late_half_fraction": None,
                "late_75_fraction": None,
                "first_sample_frame": None,
                "last_sample_frame": None,
                "holistic_eval_sec": 0.0,
                "holistic_wall_sec": 0.0,
                "holistic_result_file": None,
            },
        }

    cv2, mp, holistic_cls = _open_holistic()
    if cv2 is None or mp is None or holistic_cls is None:
        raise RuntimeError("需要安装 mediapipe 和 opencv-python 才能运行关键帧采样实验")

    video_out: Optional[Path] = None
    result_out: Optional[Path] = Path(result_dir) if result_dir is not None else None

    if visualize_dir is not None:
        video_out = Path(visualize_dir) / video_path.stem
        video_out.mkdir(parents=True, exist_ok=True)
    if result_out is None and video_out is not None:
        result_out = video_out

    processed: List[Dict[str, Any]] = []
    prev_row: Optional[Dict[str, Any]] = None
    visual_cache: List[Dict[str, Any]] = []
    result_records: List[Dict[str, Any]] = []
    holistic_eval_sec = 0.0
    holistic_init_sec = 0.0
    holistic_wall_sec = 0.0

    shared_holistic = holistic is not None
    parallel_mode = (not shared_holistic) and visualize_dir is None and workers > 1 and len(selected) > 1
    if parallel_mode:
        wall_start = time.perf_counter()
        batches = _chunk_sequence(selected, workers)
        with ProcessPoolExecutor(max_workers=min(max(1, workers), len(batches))) as executor:
            futures = [executor.submit(_process_holistic_batch, (str(video_path), fps, batch)) for batch in batches]
            batch_records: List[Dict[str, Any]] = []
            for future in as_completed(futures):
                payload = future.result()
                holistic_init_sec += float(payload.get("init_sec") or 0.0)
                batch_records.extend(payload.get("records", []))
        holistic_wall_sec = time.perf_counter() - wall_start
        batch_records.sort(key=lambda item: int(item["frame_idx"]))
        for item in batch_records:
            row = item["row"]
            row.update(_frame_motion(prev_row, row))
            prev_row = row
            processed.append(row)
            holistic_eval_sec += float(item.get("frame_eval_sec") or 0.0)
            result_records.append(
                {
                    "frame_idx": int(item["frame_idx"]),
                    "timestamp_sec": float(item["timestamp_sec"]),
                    "row": row,
                    "result_data": item["result_data"],
                    "frame_eval_sec": float(item.get("frame_eval_sec") or 0.0),
                }
            )
    else:
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError(f"无法打开视频：{video_path}")
        selected_set = set(selected)
        target_idx = 0
        target = selected[target_idx]
        max_target = selected[-1]
        frame_idx = 0
        wall_start = time.perf_counter()
        init_start = time.perf_counter()

        def _run_loop(holistic_obj) -> None:
            nonlocal target_idx, target, frame_idx, holistic_eval_sec, prev_row
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                if frame_idx > max_target:
                    break
                if frame_idx < target:
                    frame_idx += 1
                    continue

                if frame_idx == target and frame_idx in selected_set:
                    row_start = time.perf_counter()
                    row, result = _process_frame(frame_idx, fps, frame, holistic_obj, cv2)
                    frame_eval_sec = time.perf_counter() - row_start
                    holistic_eval_sec += frame_eval_sec
                    row.update(_frame_motion(prev_row, row))
                    processed.append(row)
                    prev_row = row
                    result_data = _serialize_holistic_result(result)
                    result_records.append(
                        {
                            "frame_idx": frame_idx,
                            "timestamp_sec": frame_idx / fps,
                            "row": row,
                            "result_data": result_data,
                            "frame_eval_sec": frame_eval_sec,
                        }
                    )

                    if video_out is not None:
                        visual_cache.append(
                            {
                                "frame": frame.copy(),
                                "frame_idx": frame_idx,
                                "row": row,
                                "result_data": result_data,
                            }
                        )

                    if target_idx + 1 < len(selected):
                        target_idx += 1
                        target = selected[target_idx]
                    else:
                        target = max_target + 1

                frame_idx += 1

        if shared_holistic:
            holistic_init_sec = 0.0
            _run_loop(holistic)
        else:
            with holistic_cls.Holistic(
                static_image_mode=False,
                model_complexity=1,
                smooth_landmarks=True,
                enable_segmentation=False,
                refine_face_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            ) as holistic_obj:
                holistic_init_sec = time.perf_counter() - init_start
                _run_loop(holistic_obj)
        holistic_wall_sec = time.perf_counter() - wall_start

        cap.release()

    contact_sheet_path = None
    timeline_path = None
    visualization_sec = None
    if result_out is not None:
        result_out.mkdir(parents=True, exist_ok=True)
        result_file_path = result_out / f"{video_path.stem}_holistic_results.json"
        result_payload = {
            "video": str(video_path),
            "video_stem": video_path.stem,
            "fps": fps,
            "total_frames": total_frames,
            "sampled_frame_indices": selected,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "records": result_records,
        }
        result_file_path.write_text(json.dumps(result_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        if video_out is not None:
            rendered = _render_visual_cache(cv2, video_path, fps, total_frames, visual_cache, video_out)
            frame_outputs = rendered["frame_outputs"]
            contact_sheet_path = Path(rendered["contact_sheet_path"]) if rendered["contact_sheet_path"] is not None else None
            timeline_path = Path(rendered["timeline_path"])
            visualization_sec = float(rendered["visualization_sec"])
    else:
        result_file_path = None

    pose_vis = [float(r["pose"]["visibility_mean"]) for r in processed if r.get("pose_present") and r["pose"].get("visibility_mean") is not None]
    left_vis = [float(r["left_hand"]["visibility_mean"]) for r in processed if r.get("left_hand_present") and r["left_hand"].get("visibility_mean") is not None]
    right_vis = [float(r["right_hand"]["visibility_mean"]) for r in processed if r.get("right_hand_present") and r["right_hand"].get("visibility_mean") is not None]
    face_vis = [float(r["face"]["visibility_mean"]) for r in processed if r.get("face_present") and r["face"].get("visibility_mean") is not None]
    motions = [float(r["motion_energy"]) for r in processed]
    frame_span_ratio = None
    tail_coverage_ratio = None
    late_half_fraction = None
    late_75_fraction = None
    first_sample_frame = processed[0]["frame_idx"] if processed else None
    last_sample_frame = processed[-1]["frame_idx"] if processed else None
    if processed and total_frames > 1:
        frame_span_ratio = (last_sample_frame - first_sample_frame) / (total_frames - 1)
        tail_coverage_ratio = last_sample_frame / (total_frames - 1)
        late_half_fraction = sum(1 for r in processed if r["frame_idx"] >= 0.5 * (total_frames - 1)) / len(processed)
        late_75_fraction = sum(1 for r in processed if r["frame_idx"] >= 0.75 * (total_frames - 1)) / len(processed)

    summary = {
        "samples": len(processed),
        "sampled_frame_indices": [r["frame_idx"] for r in processed],
        "video_total_frames": total_frames,
        "video_fps": fps,
        "video_duration_sec": normalized_video_duration(meta, total_frames),
        "first_sample_sec": processed[0]["timestamp_sec"] if processed else None,
        "last_sample_sec": processed[-1]["timestamp_sec"] if processed else None,
        "pose_presence_ratio": (sum(1 for r in processed if r.get("pose_present")) / len(processed)) if processed else None,
        "left_hand_presence_ratio": (sum(1 for r in processed if r.get("left_hand_present")) / len(processed)) if processed else None,
        "right_hand_presence_ratio": (sum(1 for r in processed if r.get("right_hand_present")) / len(processed)) if processed else None,
        "face_presence_ratio": (sum(1 for r in processed if r.get("face_present")) / len(processed)) if processed else None,
        "motion_energy_mean": _mean_or_none(motions),
        "motion_energy_max": max(motions) if motions else None,
        "body_visibility_mean": _mean_or_none(pose_vis),
        "hand_visibility_mean": _mean_or_none(left_vis + right_vis),
        "face_visibility_mean": _mean_or_none(face_vis),
        "frame_span_ratio": frame_span_ratio,
        "tail_coverage_ratio": tail_coverage_ratio,
        "late_half_fraction": late_half_fraction,
        "late_75_fraction": late_75_fraction,
        "first_sample_frame": first_sample_frame,
        "last_sample_frame": last_sample_frame,
        "holistic_init_sec": round(holistic_init_sec, 3),
        "holistic_eval_sec": round(holistic_eval_sec, 3),
        "holistic_wall_sec": round(holistic_wall_sec, 3),
        "visualization_sec": round(visualization_sec, 3) if visualization_sec is not None else None,
    }
    if video_out is not None:
        summary["contact_sheet"] = str(contact_sheet_path) if contact_sheet_path is not None else None
        summary["timeline"] = str(timeline_path) if timeline_path is not None else None
        summary["frames"] = frame_outputs
    if result_out is not None:
        summary["holistic_result_file"] = str(result_file_path)

    return {"meta": meta, "rows": processed, "summary": summary}


def extract_single_holistic_row(video_path: Path, frame_idx: int) -> Dict[str, Any]:
    """提取单帧的 Holistic 结果。"""

    meta = probe_video_metadata(video_path)
    fps = float(meta.get("fps") or 25.0)
    cv2, mp, holistic_cls = _open_holistic()
    if cv2 is None or mp is None or holistic_cls is None:
        raise RuntimeError("需要安装 mediapipe 和 opencv-python 才能运行关键帧采样实验")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频：{video_path}")

    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise RuntimeError(f"无法读取帧：{video_path} @ {frame_idx}")

    with holistic_cls.Holistic(
        static_image_mode=False,
        model_complexity=1,
        smooth_landmarks=True,
        enable_segmentation=False,
        refine_face_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as holistic:
        row = _build_row_from_frame(frame_idx, fps, frame, holistic, cv2)
        row.update({"motion_energy": 0.0, "bbox_shift": 0.0})
        return row


def rows_to_map(rows: Sequence[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    """把帧列表转成以 frame_idx 为键的字典。"""

    return {int(row["frame_idx"]): dict(row) for row in rows}


def segment_score(left_idx: int, right_idx: int, row_map: Dict[int, Dict[str, Any]], total_frames: int) -> float:
    """
    给一个区间打分。

    打分越高，表示越值得在该区间内继续加密采样。
    """

    if right_idx <= left_idx:
        return 0.0

    left_row = row_map[left_idx]
    right_row = row_map[right_idx]
    span_ratio = (right_idx - left_idx) / max(1, total_frames - 1)
    center_ratio = ((left_idx + right_idx) / 2) / max(1, total_frames - 1)
    max_motion = max((float(r.get("motion_energy", 0.0)) for r in row_map.values()), default=0.0)
    motion_peak = max(float(left_row.get("motion_energy", 0.0)), float(right_row.get("motion_energy", 0.0)))
    motion_norm = motion_peak / max_motion if max_motion > 0 else 0.0

    left_presence = sum(
        1 for key in ["pose_present", "left_hand_present", "right_hand_present", "face_present"]
        if left_row.get(key)
    ) / 4.0
    right_presence = sum(
        1 for key in ["pose_present", "left_hand_present", "right_hand_present", "face_present"]
        if right_row.get(key)
    ) / 4.0
    presence_score = max(left_presence, right_presence)
    return 0.42 * span_ratio + 0.33 * motion_norm + 0.15 * presence_score + 0.10 * center_ratio


def choose_interior_frame(left_idx: int, right_idx: int, selected: Iterable[int]) -> Optional[int]:
    """在区间内部选择一个尚未采样的帧。"""

    if right_idx - left_idx <= 1:
        return None

    selected_set = set(selected)
    mid = (left_idx + right_idx) // 2
    if mid not in selected_set and left_idx < mid < right_idx:
        return mid

    # 如果整数中点已经被占用，向两侧寻找最近的空位。
    for offset in range(1, right_idx - left_idx):
        candidates = [mid - offset, mid + offset]
        for cand in candidates:
            if left_idx < cand < right_idx and cand not in selected_set:
                return cand
    return None


def _rows_by_position(rows: Sequence[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    """把候选行按位置编号映射，供纯选择策略使用。"""

    return {idx: dict(row) for idx, row in enumerate(rows)}


def select_uniform_keyframes(rows: Sequence[Dict[str, Any]], sample_budget: int) -> List[int]:
    """从候选缓存里均匀选关键帧。"""

    indexed_rows = [dict(row) for row in rows]
    if not indexed_rows or sample_budget <= 0:
        return []
    positions = even_frame_indices(len(indexed_rows), sample_budget)
    return sorted({int(indexed_rows[pos]["frame_idx"]) for pos in positions if 0 <= pos < len(indexed_rows)})


def select_energy_coverage_keyframes(rows: Sequence[Dict[str, Any]], sample_budget: int) -> List[int]:
    """按运动能量和双手覆盖率，从候选缓存里筛关键帧。"""

    indexed_rows = [dict(row) for row in rows]
    if not indexed_rows or sample_budget <= 0:
        return []

    half = max(1, sample_budget // 2)
    motion_rank = sorted(
        enumerate(indexed_rows),
        key=lambda item: (
            -float(item[1].get("motion_energy", 0.0)),
            int(item[1].get("frame_idx", item[0])),
        ),
    )
    hand_rank = sorted(
        enumerate(indexed_rows),
        key=lambda item: (
            -int(bool(item[1].get("left_hand_present"))) - int(bool(item[1].get("right_hand_present"))),
            -int(bool(item[1].get("left_hand_present")) and bool(item[1].get("right_hand_present"))),
            -float(item[1].get("motion_energy", 0.0)),
            int(item[1].get("frame_idx", item[0])),
        ),
    )

    selected: List[int] = []
    selected_set = set()

    for pos, row in motion_rank:
        if len(selected) >= half:
            break
        idx = int(row["frame_idx"])
        if idx not in selected_set:
            selected.append(idx)
            selected_set.add(idx)

    for pos, row in hand_rank:
        if len(selected) >= sample_budget:
            break
        idx = int(row["frame_idx"])
        if idx not in selected_set:
            selected.append(idx)
            selected_set.add(idx)

    if len(selected) < sample_budget:
        fallback_rank = sorted(
            indexed_rows,
            key=lambda r: (
                -(
                    float(r.get("motion_energy", 0.0))
                    + int(bool(r.get("left_hand_present")))
                    + int(bool(r.get("right_hand_present")))
                ),
                int(r.get("frame_idx", 0)),
            ),
        )
        for row in fallback_rank:
            if len(selected) >= sample_budget:
                break
            idx = int(row["frame_idx"])
            if idx not in selected_set:
                selected.append(idx)
                selected_set.add(idx)

    return sorted(selected)


def select_two_stage_keyframes(rows: Sequence[Dict[str, Any]], sample_budget: int) -> List[int]:
    """从候选缓存里执行两阶段选择。"""

    indexed_rows = [dict(row) for row in rows]
    if not indexed_rows or sample_budget <= 0:
        return []
    if len(indexed_rows) <= sample_budget:
        return sorted({int(row["frame_idx"]) for row in indexed_rows})

    total_candidates = len(indexed_rows)
    coarse_count = min(max(6, sample_budget // 2 + 1), sample_budget, total_candidates)
    coarse_positions = even_frame_indices(total_candidates, coarse_count)
    row_map = _rows_by_position(indexed_rows)
    selected = set(coarse_positions)

    if len(selected) < sample_budget and len(coarse_positions) > 1:
        segments = []
        for left, right in zip(coarse_positions[:-1], coarse_positions[1:]):
            score = segment_score(left, right, row_map, total_candidates)
            segments.append((score, left, right))
        segments.sort(reverse=True)

        for _, left, right in segments:
            if len(selected) >= sample_budget:
                break
            cand = choose_interior_frame(left, right, selected)
            if cand is not None:
                selected.add(cand)

        while len(selected) < sample_budget:
            ordered = sorted(selected)
            gaps = [(b - a, a, b) for a, b in zip(ordered[:-1], ordered[1:]) if b - a > 1]
            if not gaps:
                break
            gaps.sort(reverse=True)
            _, left, right = gaps[0]
            cand = choose_interior_frame(left, right, selected)
            if cand is None:
                break
            selected.add(cand)

    selected_positions = sorted(selected)
    return sorted({int(indexed_rows[pos]["frame_idx"]) for pos in selected_positions if 0 <= pos < len(indexed_rows)})


def select_adaptive_keyframes(rows: Sequence[Dict[str, Any]], sample_budget: int) -> List[int]:
    """从候选缓存里执行自适应选择。"""

    indexed_rows = [dict(row) for row in rows]
    if not indexed_rows or sample_budget <= 0:
        return []
    if len(indexed_rows) <= sample_budget:
        return sorted({int(row["frame_idx"]) for row in indexed_rows})

    total_candidates = len(indexed_rows)
    pilot_count = min(max(5, sample_budget // 2), sample_budget, total_candidates)
    selected = set(even_frame_indices(total_candidates, pilot_count))
    row_map = _rows_by_position(indexed_rows)

    while len(selected) < sample_budget:
        ordered = sorted(selected)
        segments = []
        for left, right in zip(ordered[:-1], ordered[1:]):
            if right - left <= 1:
                continue
            score = segment_score(left, right, row_map, total_candidates)
            segments.append((score, left, right))

        if not segments:
            break

        segments.sort(reverse=True)
        _, left, right = segments[0]
        cand = choose_interior_frame(left, right, selected)
        if cand is None:
            break
        selected.add(cand)

    selected_positions = sorted(selected)
    return sorted({int(indexed_rows[pos]["frame_idx"]) for pos in selected_positions if 0 <= pos < len(indexed_rows)})


def build_report(payload: Dict[str, Any], title: str) -> str:
    """生成便于汇报的 Markdown 报告。"""

    rows = payload["videos"]
    lines: List[str] = []
    lines.append(f"# {title}")
    lines.append("")
    lines.append(f"- 生成时间：{payload.get('generated_at')}")
    lines.append(f"- 视频数量：{len(rows)}")
    lines.append(f"- 采样预算：{payload.get('sample_budget')}")
    lines.append("")

    metrics = ["frame_span_ratio", "tail_coverage_ratio", "late_half_fraction", "late_75_fraction"]
    lines.append("## 总体统计")
    lines.append("")
    if payload.get("combined_sec") is not None:
        lines.append(f"- `combined_sec` 总计：{payload.get('combined_sec')}s")
    for key in metrics:
        vals = [r["evaluation"].get(key) for r in rows if isinstance(r["evaluation"].get(key), (int, float))]
        lines.append(f"- `{key}` 均值：{_mean_or_none([float(v) for v in vals])}")
    lines.append("")

    lines.append("## 视频级结果")
    lines.append("")
    for row in rows:
        eval_ = row["evaluation"]
        lines.append(f"### {row['video']}")
        lines.append(f"- 采样帧：{', '.join(str(x) for x in row['sampled_frame_indices'])}")
        lines.append(f"- 时间覆盖：{eval_.get('first_sample_sec')}s -> {eval_.get('last_sample_sec')}s")
        lines.append(f"- 帧覆盖比例：{eval_.get('frame_span_ratio')}")
        lines.append(f"- 尾部覆盖比例：{eval_.get('tail_coverage_ratio')}")
        lines.append(f"- 后半段采样占比：{eval_.get('late_half_fraction')}")
        lines.append(f"- 后 75% 采样占比：{eval_.get('late_75_fraction')}")
        lines.append(f"- pose/left/right/face：{eval_.get('pose_presence_ratio')}/{eval_.get('left_hand_presence_ratio')}/{eval_.get('right_hand_presence_ratio')}/{eval_.get('face_presence_ratio')}")
        lines.append(f"- 平均运动能量：{eval_.get('motion_energy_mean')}")
        if row.get("holistic_init_sec") is not None:
            lines.append(f"- Holistic 初始化耗时：{row.get('holistic_init_sec')}s")
        if row.get("candidate_generation_sec") is not None:
            lines.append(f"- 候选生成耗时：{row.get('candidate_generation_sec')}s")
        if row.get("pilot_eval_sec") is not None:
            lines.append(f"- pilot 识别耗时：{row.get('pilot_eval_sec')}s")
        if row.get("selection_sec") is not None:
            lines.append(f"- 采样选择耗时：{row.get('selection_sec')}s")
        if row.get("final_eval_sec") is not None:
            lines.append(f"- final 识别耗时：{row.get('final_eval_sec')}s")
        if row.get("combined_sec") is not None:
            lines.append(f"- 采样+Holistic总耗时：{row.get('combined_sec')}s")
        for tip in row.get("strategy_notes", []):
            lines.append(f"- 建议：{tip}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
