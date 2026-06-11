"""Scoring API for the team frontend.

The public repository intentionally does not include demo videos or generated
Holistic template caches. This entrypoint still supports the full path when a
server provides those files through environment variables:

- browser frame slices -> persistent Holistic worker
- optional template JSON -> prototype similarity score
- no template / no worker -> clearly marked fallback score
"""

from __future__ import annotations

import json
import math
import os
import queue
import statistics
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


APP_VERSION = "0.3.0"
REPO_ROOT = Path(__file__).resolve().parents[3]
WORKER_SCRIPT = Path(__file__).with_name("holistic_worker_daemon.py")
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "work" / "generated" / "scoring-api"
OUTPUT_ROOT = Path(os.getenv("SLU_SCORING_OUTPUT_ROOT", str(DEFAULT_OUTPUT_ROOT)))
TEMPLATE_ROOT = os.getenv("SLU_TEMPLATE_ROOT", "").strip()
SEMANTIC_PROFILE_JSON = os.getenv("SLU_SEMANTIC_PROFILE_JSON", "").strip()
FACE_CORE_INDICES = [33, 133, 159, 145, 362, 263, 386, 374, 61, 291, 13, 14]
FACE_LANDMARK_COUNT = 478

SUPPORTED_TEMPLATES = [
    {"id": "xiangjiao", "label": "香蕉", "aliases": ["banana", "香蕉"], "available": True},
    {"id": "flower", "label": "花", "aliases": ["hua", "花"], "available": True},
    {"id": "car", "label": "汽车", "aliases": ["qiche", "汽车"], "available": True},
    {"id": "tiger", "label": "虎", "aliases": ["hu", "虎"], "available": True},
    {"id": "moon", "label": "月亮", "aliases": ["yueliang", "月亮"], "available": True},
    {"id": "jump", "label": "跳", "aliases": ["tiao", "跳"], "available": True},
    {"id": "friend", "label": "朋友", "aliases": ["pengyou", "朋友"], "available": True},
    {"id": "point", "label": "指示", "aliases": ["zhishi", "指示"], "available": True},
    {"id": "sing", "label": "唱歌", "aliases": ["changge", "唱歌"], "available": True},
    {"id": "chan", "label": "馋", "aliases": ["馋", "谗（羡慕）", "chanxianmu"], "available": True},
    {"id": "nihao", "label": "你好", "aliases": ["ni-hao", "你好"], "available": True},
    {"id": "xiexie", "label": "谢谢", "aliases": ["xie-xie", "谢谢"], "available": True},
    {"id": "baba", "label": "爸爸", "aliases": ["爸爸"], "available": True},
    {"id": "xuexi", "label": "学习", "aliases": ["xue-xi", "学习"], "available": True},
    {"id": "wenhua", "label": "文化", "aliases": ["wen-hua", "文化"], "available": True},
]
TEMPLATE_BY_ALIAS = {
    str(alias).lower(): template
    for template in SUPPORTED_TEMPLATES
    for alias in [template["id"], template["label"], *template.get("aliases", [])]
}


class FrameSlice(BaseModel):
    index: int = Field(ge=0)
    timestamp_ms: int = Field(ge=0)
    image_base64: str


class LandmarkPoint(BaseModel):
    x: float
    y: float
    z: float = 0.0
    visibility: float | None = None
    presence: float | None = None


class LandmarkRowSlice(BaseModel):
    index: int = Field(ge=0)
    timestamp_ms: int = Field(ge=0)
    pose_landmarks: list[Any] = Field(default_factory=list)
    left_hand_landmarks: list[Any] = Field(default_factory=list)
    right_hand_landmarks: list[Any] = Field(default_factory=list)
    face_landmarks: list[Any] = Field(default_factory=list)
    face_core_landmarks: list[Any] = Field(default_factory=list)
    frame_weight: float = Field(default=1.0, gt=0)
    image_width: int | None = Field(default=None, ge=1)
    image_height: int | None = Field(default=None, ge=1)
    processing_ms: int | None = Field(default=None, ge=0)


class ScoreRequest(BaseModel):
    template_id: str = Field(default="flower")
    input_type: Literal["frame_slices", "video_path", "landmark_rows"] = "frame_slices"
    frames: list[FrameSlice] = Field(default_factory=list)
    landmark_rows: list[LandmarkRowSlice] = Field(default_factory=list)
    video_path: str | None = None
    fps: float | None = Field(default=None, gt=0)
    duration_ms: int | None = Field(default=None, ge=0)
    wait_for_ready_sec: float = Field(default=45.0, gt=0, le=180)
    client_meta: dict[str, Any] = Field(default_factory=dict)


class ScoreResponse(BaseModel):
    request_id: str
    template_id: str
    score: float | None
    level: str
    score_valid: bool
    feedback: list[dict[str, str]]
    diagnostics: dict[str, Any]


def _env_flag(name: str, default: str = "auto") -> bool:
    value = os.getenv(name, default).strip().lower()
    return value not in {"0", "false", "no", "off", "disabled"}


def _readline_with_timeout(stream, timeout_sec: float) -> str:
    result: queue.Queue[str] = queue.Queue(maxsize=1)

    def reader() -> None:
        try:
            result.put(stream.readline())
        except Exception as exc:  # pragma: no cover - defensive thread boundary
            result.put(json.dumps({"type": "error", "error": str(exc)}))

    thread = threading.Thread(target=reader, name="holistic-worker-readline", daemon=True)
    thread.start()
    try:
        return result.get(timeout=timeout_sec)
    except queue.Empty as exc:
        raise TimeoutError("Holistic worker response timed out") from exc


def _tail_text(path_value: str | None, max_chars: int = 6000) -> str | None:
    if not path_value:
        return None
    try:
        path = Path(path_value)
        if not path.is_file():
            return None
        with path.open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - max_chars))
            data = handle.read(max_chars)
        return data.decode("utf-8", errors="replace")
    except Exception as exc:  # pragma: no cover - diagnostic path
        return f"<failed to read stderr tail: {exc}>"


class HolisticWorkerService:
    """Small persistent subprocess wrapper for ``holistic_worker_daemon.py``."""

    def __init__(self, worker_script: Path) -> None:
        self.worker_script = worker_script
        self.process: subprocess.Popen[str] | None = None
        self.lock = threading.Lock()
        self.status = "idle"
        self.error: str | None = None
        self.ready_payload: dict[str, Any] | None = None
        self.stderr_log: str | None = None

    @property
    def enabled(self) -> bool:
        return _env_flag("SLU_ENABLE_HOLISTIC_WORKER", "false")

    @property
    def ready(self) -> bool:
        return self.process is not None and self.process.poll() is None and self.status == "ready"

    def snapshot(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "status": self.status,
            "ready": self.ready,
            "pid": self.process.pid if self.process and self.process.poll() is None else None,
            "error": self.error,
            "stderr_log": self.stderr_log,
            "stderr_tail": _tail_text(self.stderr_log) if self.status == "error" else None,
            "startup": self.ready_payload,
        }

    def _start_locked(self, timeout_sec: float) -> None:
        if not self.enabled:
            raise RuntimeError("Holistic worker is disabled by SLU_ENABLE_HOLISTIC_WORKER")
        if self.ready:
            return
        if self.process and self.process.poll() is None:
            self.stop_locked()

        OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
        log_dir = REPO_ROOT / "work" / "logs" / "scoring-api"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / f"holistic_worker_{datetime.now().strftime('%Y%m%d_%H%M%S')}.stderr.log"
        env = os.environ.copy()
        pythonpath_parts = [str(REPO_ROOT / "packages" / "scoring-core")]
        if env.get("PYTHONPATH"):
            pythonpath_parts.append(env["PYTHONPATH"])
        env["PYTHONPATH"] = os.pathsep.join(pythonpath_parts)
        env.setdefault("PYTHONUNBUFFERED", "1")
        env.setdefault("QT_QPA_PLATFORM", "offscreen")
        env.setdefault("DISPLAY", "")

        stderr_handle = log_path.open("a", encoding="utf-8")
        self.status = "starting"
        self.error = None
        self.ready_payload = None
        self.stderr_log = str(log_path)
        try:
            self.process = subprocess.Popen(
                [sys.executable, str(self.worker_script)],
                cwd=str(REPO_ROOT),
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=stderr_handle,
                text=True,
                bufsize=1,
            )
        except Exception:
            stderr_handle.close()
            self.status = "error"
            raise

        assert self.process.stdout is not None
        try:
            line = _readline_with_timeout(self.process.stdout, timeout_sec)
        except Exception as exc:
            self._kill_process_locked(f"worker_start_failed: {exc}")
            raise
        if not line:
            self._kill_process_locked("Holistic worker exited before ready message")
            raise RuntimeError(self.error)
        payload = json.loads(line)
        if payload.get("type") != "ready":
            self._kill_process_locked(f"unexpected worker startup payload: {payload}")
            raise RuntimeError(self.error)
        self.ready_payload = payload
        self.status = "ready"

    def request(self, payload: dict[str, Any], timeout_sec: float) -> dict[str, Any]:
        with self.lock:
            self._start_locked(timeout_sec)
            if not self.process or self.process.poll() is not None:
                self.status = "error"
                self.error = "Holistic worker is not running"
                raise RuntimeError(self.error)
            if self.process.stdin is None or self.process.stdout is None:
                raise RuntimeError("Holistic worker pipes are not available")

            self.process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
            self.process.stdin.flush()
            try:
                line = _readline_with_timeout(self.process.stdout, timeout_sec)
            except Exception as exc:
                self._kill_process_locked(f"worker_request_failed: {exc}")
                raise
            if not line:
                self._kill_process_locked("Holistic worker returned an empty response")
                raise RuntimeError("Holistic worker returned an empty response")
            response = json.loads(line)
            if response.get("type") == "error":
                raise RuntimeError(str(response.get("error") or response))
            return response

    def _kill_process_locked(self, error: str) -> None:
        self.error = error
        self.status = "error"
        if self.process and self.process.poll() is None:
            self.process.kill()
            try:
                self.process.wait(timeout=5)
            except Exception:
                pass
        self.process = None

    def stop_locked(self) -> None:
        if not self.process:
            return
        process = self.process
        try:
            if process.poll() is None and process.stdin:
                process.stdin.write(json.dumps({"cmd": "shutdown"}) + "\n")
                process.stdin.flush()
                process.wait(timeout=5)
        except Exception:
            if process.poll() is None:
                process.kill()
        finally:
            self.process = None
            self.status = "stopped"

    def shutdown(self) -> None:
        with self.lock:
            self.stop_locked()


worker_service = HolisticWorkerService(WORKER_SCRIPT)


app = FastAPI(
    title="Sign Language Universe Scoring API",
    version=APP_VERSION,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "service": "Sign Language Universe Scoring API",
        "version": APP_VERSION,
        "health": "/api/scoring/health",
        "docs": "/docs",
    }


def _template_info(template_id: str) -> dict[str, Any]:
    key = template_id.strip().lower()
    if key in TEMPLATE_BY_ALIAS:
        return TEMPLATE_BY_ALIAS[key]
    return {"id": template_id, "label": template_id, "aliases": [], "available": False}


def _template_aliases(template_id: str) -> list[str]:
    info = _template_info(template_id)
    aliases = [info.get("id"), info.get("label"), *info.get("aliases", [])]
    return [str(item) for item in aliases if item]


def _find_template_path(template_id: str) -> Path | None:
    if not TEMPLATE_ROOT:
        return None
    root = Path(TEMPLATE_ROOT).expanduser()
    if not root.exists():
        return None
    candidates: list[Path] = []
    for alias in _template_aliases(template_id):
        candidates.extend(
            [
                root / alias / f"{alias}_holistic_results.json",
                root / alias / f"{alias}_results.json",
                root / f"{alias}_holistic_results.json",
                root / f"{alias}.json",
            ]
        )
    return next((path for path in candidates if path.exists() and path.is_file()), None)


def _template_root_has_templates() -> bool:
    if not TEMPLATE_ROOT:
        return False
    root = Path(TEMPLATE_ROOT).expanduser()
    return root.exists() and any(root.rglob("*_holistic_results.json"))


def _request_temporal_samples(request: ScoreRequest) -> list[FrameSlice] | list[LandmarkRowSlice]:
    if request.input_type == "landmark_rows":
        return request.landmark_rows
    return request.frames


def _estimate_fps(request: ScoreRequest) -> float:
    if request.fps and math.isfinite(request.fps):
        return max(1.0, min(float(request.fps), 30.0))
    samples = sorted(_request_temporal_samples(request), key=lambda item: item.timestamp_ms)
    if len(samples) >= 2:
        duration_ms = max(1, samples[-1].timestamp_ms - samples[0].timestamp_ms)
        return max(1.0, min(30.0, (len(samples) - 1) * 1000.0 / duration_ms))
    return 5.0


def _frame_duration_ms(request: ScoreRequest) -> int:
    if request.duration_ms is not None:
        return int(request.duration_ms)
    samples = sorted(_request_temporal_samples(request), key=lambda item: item.timestamp_ms)
    if len(samples) >= 2:
        return int(max(0, samples[-1].timestamp_ms - samples[0].timestamp_ms))
    return 0


def _level_from_score(score: float) -> str:
    if score >= 85:
        return "excellent"
    if score >= 70:
        return "good"
    if score >= 55:
        return "needs_practice"
    return "retry"


def _clamp_score(value: float) -> float:
    return round(max(0.0, min(100.0, value)), 1)


def _mean(values: list[float]) -> float:
    return float(statistics.mean(values)) if values else 0.0


def _presence_ratio(rows: list[dict[str, Any]], key: str) -> float:
    if not rows:
        return 0.0
    return sum(1 for row in rows if bool(row.get(key))) / len(rows)


def _worker_rows(worker_response: dict[str, Any]) -> list[dict[str, Any]]:
    rows = worker_response.get("rows")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def _holistic_metrics(worker_response: dict[str, Any]) -> dict[str, Any]:
    rows = _worker_rows(worker_response)
    left_ratio = _presence_ratio(rows, "left_hand_present")
    right_ratio = _presence_ratio(rows, "right_hand_present")
    hand_ratio = max(left_ratio, right_ratio, (left_ratio + right_ratio) / 2.0)
    pose_ratio = _presence_ratio(rows, "pose_present")
    face_ratio = _presence_ratio(rows, "face_present")
    motions = [float(row.get("motion_energy") or 0.0) for row in rows]
    bbox_shifts = [float(row.get("bbox_shift") or 0.0) for row in rows]
    return {
        "samples": int(worker_response.get("samples") or len(rows)),
        "pose_presence_ratio": round(pose_ratio, 3),
        "left_hand_presence_ratio": round(left_ratio, 3),
        "right_hand_presence_ratio": round(right_ratio, 3),
        "hand_presence_ratio": round(hand_ratio, 3),
        "face_presence_ratio": round(face_ratio, 3),
        "motion_energy_mean": round(_mean(motions), 3),
        "motion_energy_max": round(max(motions) if motions else 0.0, 3),
        "bbox_shift_mean": round(_mean(bbox_shifts), 3),
    }


def _score_holistic_capture(worker_response: dict[str, Any], request: ScoreRequest) -> tuple[float, bool, dict[str, Any]]:
    metrics = _holistic_metrics(worker_response)
    samples = float(metrics["samples"])
    coverage = min(1.0, samples / 12.0)
    duration_score = min(1.0, max(0.0, _frame_duration_ms(request) / 3500.0))
    hand = float(metrics["hand_presence_ratio"])
    pose = float(metrics["pose_presence_ratio"])
    face = float(metrics["face_presence_ratio"])
    motion = min(1.0, float(metrics["motion_energy_mean"]) / 35.0)
    score = _clamp_score(18.0 + 34.0 * hand + 18.0 * pose + 8.0 * face + 12.0 * coverage + 10.0 * motion + 8.0 * duration_score)
    valid = bool(samples >= 3 and (hand >= 0.15 or pose >= 0.35))
    return score, valid, metrics


def _finite_or_default(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return float(default)
    return number if math.isfinite(number) else float(default)


def _sanitize_frame_weight(value: Any) -> float:
    return max(0.05, min(10.0, _finite_or_default(value, 1.0)))


def _point_field(point: Any, key: str, index: int, default: float = 0.0) -> float | None:
    if isinstance(point, LandmarkPoint):
        value = getattr(point, key, None)
    elif isinstance(point, dict):
        value = point.get(key)
    elif isinstance(point, (list, tuple)):
        value = point[index] if len(point) > index else None
    else:
        value = None
    if value is None:
        return None
    return _finite_or_default(value, default)


def _serialize_landmark_points(points: list[Any], group: str) -> list[dict[str, float]]:
    max_points = 512
    serialized: list[dict[str, float]] = []
    for point in points[:max_points]:
        item = {
            "x": _point_field(point, "x", 0, 0.0) or 0.0,
            "y": _point_field(point, "y", 1, 0.0) or 0.0,
            "z": _point_field(point, "z", 2, 0.0) or 0.0,
        }
        visibility = _point_field(point, "visibility", 3, 0.0)
        presence = _point_field(point, "presence", 4, 0.0)
        if visibility is not None:
            item["visibility"] = visibility
        if presence is not None:
            item["presence"] = presence
        serialized.append(item)
    if group == "face_landmarks" and len(serialized) == 468:
        serialized.extend({"x": 0.0, "y": 0.0, "z": 0.0, "visibility": 0.0, "presence": 0.0} for _ in range(10))
    return serialized


def _expand_face_core_landmarks(points: list[Any]) -> list[dict[str, float]]:
    core = _serialize_landmark_points(points, "face_core_landmarks")
    if not core:
        return []
    expanded = [
        {"x": 0.0, "y": 0.0, "z": 0.0, "visibility": 0.0, "presence": 0.0}
        for _ in range(FACE_LANDMARK_COUNT)
    ]
    for target_index, point in zip(FACE_CORE_INDICES, core):
        expanded[target_index] = point
    return expanded


def _landmarks_present(points: list[dict[str, float]], group: str) -> bool:
    expected_counts = {
        "pose_landmarks": 33,
        "left_hand_landmarks": 21,
        "right_hand_landmarks": 21,
        "face_landmarks": 468,
    }
    minimum = expected_counts.get(group, 1)
    return len(points) >= minimum


def _bbox_from_serialized_landmarks(
    points: list[dict[str, float]],
    image_width: int,
    image_height: int,
) -> dict[str, float] | None:
    if not points:
        return None
    xs: list[float] = []
    ys: list[float] = []
    visibilities: list[float] = []
    for point in points:
        x = _finite_or_default(point.get("x"))
        y = _finite_or_default(point.get("y"))
        xs.append(x * image_width)
        ys.append(y * image_height)
        visibilities.append(_finite_or_default(point.get("visibility"), 1.0))
    if not xs or not ys:
        return None
    return {
        "x_min": min(xs),
        "x_max": max(xs),
        "y_min": min(ys),
        "y_max": max(ys),
        "visibility_mean": _mean(visibilities),
    }


def _frame_motion(prev: dict[str, Any] | None, current: dict[str, Any]) -> dict[str, float]:
    if not prev:
        return {"motion_energy": 0.0, "bbox_shift": 0.0}

    total_energy = 0.0
    total_shift = 0.0
    for group in ["pose", "left_hand", "right_hand", "face"]:
        prev_box = prev.get(group, {}).get("bbox")
        curr_box = current.get(group, {}).get("bbox")
        if not prev_box or not curr_box:
            continue
        prev_cx = (float(prev_box["x_min"]) + float(prev_box["x_max"])) / 2.0
        prev_cy = (float(prev_box["y_min"]) + float(prev_box["y_max"])) / 2.0
        curr_cx = (float(curr_box["x_min"]) + float(curr_box["x_max"])) / 2.0
        curr_cy = (float(curr_box["y_min"]) + float(curr_box["y_max"])) / 2.0
        dx = curr_cx - prev_cx
        dy = curr_cy - prev_cy
        total_shift += math.hypot(dx, dy)
        total_energy += abs(dx) + abs(dy)
    return {"motion_energy": total_energy, "bbox_shift": total_shift}


def _landmark_record_from_slice(
    item: LandmarkRowSlice,
    fps: float,
    image_width: int,
    image_height: int,
) -> dict[str, Any]:
    frame_idx = int(item.index)
    timestamp_sec = max(0.0, int(item.timestamp_ms) / 1000.0)
    face_landmarks = _serialize_landmark_points(item.face_landmarks, "face_landmarks")
    if not face_landmarks and item.face_core_landmarks:
        face_landmarks = _expand_face_core_landmarks(item.face_core_landmarks)
    result_data = {
        "pose_landmarks": _serialize_landmark_points(item.pose_landmarks, "pose_landmarks"),
        "left_hand_landmarks": _serialize_landmark_points(item.left_hand_landmarks, "left_hand_landmarks"),
        "right_hand_landmarks": _serialize_landmark_points(item.right_hand_landmarks, "right_hand_landmarks"),
        "face_landmarks": face_landmarks,
    }
    row: dict[str, Any] = {
        "frame_idx": frame_idx,
        "timestamp_sec": timestamp_sec if timestamp_sec > 0 else frame_idx / fps,
        "pose_present": _landmarks_present(result_data["pose_landmarks"], "pose_landmarks"),
        "left_hand_present": _landmarks_present(result_data["left_hand_landmarks"], "left_hand_landmarks"),
        "right_hand_present": _landmarks_present(result_data["right_hand_landmarks"], "right_hand_landmarks"),
        "face_present": _landmarks_present(result_data["face_landmarks"], "face_landmarks"),
        "pose": {},
        "left_hand": {},
        "right_hand": {},
        "face": {},
        "frame_weight": _sanitize_frame_weight(item.frame_weight),
    }
    for group_key, row_key in [
        ("pose_landmarks", "pose"),
        ("left_hand_landmarks", "left_hand"),
        ("right_hand_landmarks", "right_hand"),
        ("face_landmarks", "face"),
    ]:
        bbox = _bbox_from_serialized_landmarks(result_data[group_key], image_width, image_height)
        if bbox:
            row[row_key] = {"bbox": bbox, "visibility_mean": bbox["visibility_mean"]}

    return {
        "frame_idx": frame_idx,
        "timestamp_sec": row["timestamp_sec"],
        "row": row,
        "result_data": result_data,
        "frame_eval_sec": round(float(item.processing_ms or 0) / 1000.0, 3),
        "frame_weight": row["frame_weight"],
    }


def _landmark_rows_worker_response(
    request: ScoreRequest,
    request_id: str,
    write_result: bool = True,
) -> dict[str, Any]:
    started = time.perf_counter()
    fps = _estimate_fps(request)
    items = sorted(request.landmark_rows, key=lambda item: (item.index, item.timestamp_ms))
    image_width = max(1, int(next((item.image_width for item in items if item.image_width), 320)))
    image_height = max(1, int(next((item.image_height for item in items if item.image_height), 240)))
    records: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    prev_row: dict[str, Any] | None = None

    for item in items:
        record = _landmark_record_from_slice(item, fps, image_width, image_height)
        row = record["row"]
        row.update(_frame_motion(prev_row, row))
        prev_row = row
        records.append(record)
        rows.append(row)

    frame_indices = [int(record["frame_idx"]) for record in records]
    total_frames = max(max(frame_indices, default=-1) + 1, len(records))
    result_file: Path | None = None
    if write_result:
        result_dir = OUTPUT_ROOT / request_id / "web_holistic"
        result_dir.mkdir(parents=True, exist_ok=True)
        result_file = result_dir / f"user_{request.template_id}_{request_id}_holistic_results.json"
        payload = {
            "video": f"browser_web_holistic_{request_id}",
            "video_stem": f"user_{request.template_id}_{request_id}",
            "fps": fps,
            "total_frames": total_frames,
            "sampled_frame_indices": frame_indices,
            "frame_weights": [{"frame_idx": int(row["frame_idx"]), "frame_weight": row["frame_weight"]} for row in rows],
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "static_image_mode": False,
            "input_mode": "web_holistic_landmarks",
            "records": records,
        }
        result_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    processing_ms = [int(item.processing_ms or 0) for item in items]
    return {
        "type": "result",
        "request_id": request_id,
        "input_mode": "web_holistic_landmarks",
        "result_file": str(result_file) if result_file else None,
        "rows": rows,
        "samples": len(records),
        "holistic_eval_sec": round(sum(processing_ms) / 1000.0, 3),
        "request_total_sec": round(time.perf_counter() - started, 3),
        "client_processing_ms_total": sum(processing_ms),
        "client_processing_ms_mean": round(_mean([float(value) for value in processing_ms]), 1) if processing_ms else 0.0,
    }


def _fallback_frame_score(request: ScoreRequest) -> tuple[float, bool, dict[str, Any]]:
    if request.input_type == "landmark_rows" and request.landmark_rows:
        worker_response = _landmark_rows_worker_response(request, f"fallback_{uuid4().hex[:8]}", write_result=False)
        score_value, valid, metrics = _score_holistic_capture(worker_response, request)
        return score_value, valid, {
            "fallback_scoring": True,
            "frame_count": len(request.landmark_rows),
            "duration_ms": _frame_duration_ms(request),
            "holistic_metrics": metrics,
            "input_mode": "web_holistic_landmarks",
        }
    sizes = [len(frame.image_base64 or "") for frame in request.frames]
    frame_count = len(sizes)
    mean_size = _mean([float(size) for size in sizes])
    if len(sizes) >= 2 and mean_size > 0:
        variation = _mean([abs(float(a - b)) for a, b in zip(sizes[:-1], sizes[1:])]) / mean_size
    else:
        variation = 0.0
    coverage = min(1.0, frame_count / 12.0)
    duration_score = min(1.0, max(0.0, _frame_duration_ms(request) / 3500.0))
    payload_score = min(1.0, mean_size / 24_000.0)
    variation_score = min(1.0, variation * 12.0)
    score = _clamp_score(25.0 + 32.0 * coverage + 20.0 * duration_score + 13.0 * payload_score + 10.0 * variation_score)
    valid = frame_count >= 3
    return score, valid, {
        "fallback_scoring": True,
        "frame_count": frame_count,
        "duration_ms": _frame_duration_ms(request),
        "payload_size_mean": round(mean_size, 1),
        "payload_size_variation_ratio": round(variation, 4),
    }


def _worker_payload(request: ScoreRequest, request_id: str) -> dict[str, Any]:
    fps = _estimate_fps(request)
    frames = sorted(request.frames, key=lambda item: (item.index, item.timestamp_ms))
    frame_indices = [int(frame.index) for frame in frames]
    total_frames = max(frame_indices, default=-1) + 1
    worker_frames = [{"image_format": "jpg", "image_b64": frame.image_base64} for frame in frames]
    result_dir = OUTPUT_ROOT / request_id / "holistic"
    return {
        "cmd": "process",
        "request_id": request_id,
        "video_stem": f"user_{request.template_id}_{request_id}",
        "fps": fps,
        "total_frames": max(total_frames, len(frames)),
        "frame_indices": frame_indices,
        "frame_weights": [1.0 for _ in frames],
        "frames": worker_frames,
        "result_dir": str(result_dir),
    }


def _template_similarity_response(
    request: ScoreRequest,
    request_id: str,
    worker_response: dict[str, Any],
    template_path: Path,
) -> ScoreResponse:
    from scoring_core import score_holistic_sequence_mvp as scoring_mvp

    query_path = Path(str(worker_response.get("result_file") or ""))
    if not query_path.exists():
        raise RuntimeError("Holistic worker did not produce a result_file for template scoring")

    target = _template_info(request.template_id)
    kwargs: dict[str, Any] = {"target_word": str(target.get("label") or request.template_id)}
    if SEMANTIC_PROFILE_JSON:
        semantic_profile_path = Path(SEMANTIC_PROFILE_JSON).expanduser()
        if semantic_profile_path.exists():
            kwargs["semantic_profile_json"] = semantic_profile_path
    standard = scoring_mvp.load_sequence(template_path, requested_mode="landmark")
    query = scoring_mvp.load_sequence(query_path, requested_mode="landmark")
    result = scoring_mvp.run_pair(standard, query, **kwargs)
    score_value = _clamp_score(float(result.get("prototype_score") or 0.0))
    metrics = _holistic_metrics(worker_response)
    input_mode = str(worker_response.get("input_mode") or "")
    scoring_mode = "web_holistic_template_similarity" if input_mode == "web_holistic_landmarks" else "holistic_template_similarity"
    feedback_message = (
        "已使用浏览器 Holistic 关键点和服务器模板进行原型相似度评分。"
        if scoring_mode == "web_holistic_template_similarity"
        else "已使用服务器 Holistic 模板进行原型相似度评分。"
    )
    return ScoreResponse(
        request_id=request_id,
        template_id=request.template_id,
        score=score_value,
        level=_level_from_score(score_value),
        score_valid=bool(score_value > 0),
        feedback=[
            {"type": "template", "message": feedback_message},
            {"type": "policy", "message": "当前分数是原型相似度结果，尚未经过真实用户人工标注校准。"},
        ],
        diagnostics={
            "scoring_mode": scoring_mode,
            "template_path": str(template_path),
            "query_path": str(query_path),
            "worker": worker_service.snapshot(),
            "worker_response": {
                "input_mode": input_mode,
                "holistic_eval_sec": worker_response.get("holistic_eval_sec"),
                "request_total_sec": worker_response.get("request_total_sec"),
                "client_processing_ms_total": worker_response.get("client_processing_ms_total"),
                "client_processing_ms_mean": worker_response.get("client_processing_ms_mean"),
            },
            "holistic_metrics": metrics,
            "client_meta": request.client_meta,
            "prototype": {
                "dtw_distance": result.get("dtw_distance"),
                "normalized_distance": result.get("normalized_distance"),
                "sequence_penalty": result.get("sequence_penalty"),
                "score_scale": result.get("score_scale"),
                "frame_weight_summary": result.get("frame_weight_summary"),
            },
        },
    )


def _holistic_quality_response(request: ScoreRequest, request_id: str, worker_response: dict[str, Any]) -> ScoreResponse:
    score_value, valid, metrics = _score_holistic_capture(worker_response, request)
    input_mode = str(worker_response.get("input_mode") or "")
    scoring_mode = "web_holistic_capture_quality" if input_mode == "web_holistic_landmarks" else "holistic_capture_quality"
    feedback = [
        {
            "type": "worker",
            "message": "已接收浏览器 Holistic 关键点。"
            if scoring_mode == "web_holistic_capture_quality"
            else "已接入 Holistic worker 并完成浏览器帧关键点检测。",
        },
        {"type": "template", "message": "当前未配置服务器模板目录，返回捕获质量分而不是标准动作相似度分。"},
    ]
    if not valid:
        feedback.append({"type": "capture", "message": "画面中手部或人体关键点不足，请调整距离、光线和取景后重试。"})
    return ScoreResponse(
        request_id=request_id,
        template_id=request.template_id,
        score=score_value,
        level="holistic_capture_quality" if valid else "insufficient_capture",
        score_valid=valid,
        feedback=feedback,
        diagnostics={
            "scoring_mode": scoring_mode,
            "template_root_configured": bool(TEMPLATE_ROOT),
            "template_path": None,
            "worker": worker_service.snapshot(),
            "worker_response": {
                "input_mode": input_mode,
                "result_file": worker_response.get("result_file"),
                "holistic_eval_sec": worker_response.get("holistic_eval_sec"),
                "request_total_sec": worker_response.get("request_total_sec"),
                "client_processing_ms_total": worker_response.get("client_processing_ms_total"),
                "client_processing_ms_mean": worker_response.get("client_processing_ms_mean"),
            },
            "holistic_metrics": metrics,
            "client_meta": request.client_meta,
        },
    )


def _fallback_response(
    request: ScoreRequest,
    request_id: str,
    reason: str,
    worker_error: str | None = None,
) -> ScoreResponse:
    score_value, valid, diagnostics = _fallback_frame_score(request)
    feedback = [
        {"type": "fallback", "message": "未使用 Holistic worker，已按浏览器帧数量、时长和画面变化返回预览分。"},
    ]
    if worker_error:
        feedback.append({"type": "worker", "message": f"Holistic worker 未完成：{worker_error}"})
    if not valid:
        feedback.append({"type": "capture", "message": "采集帧不足，至少需要 3 帧。"})
    return ScoreResponse(
        request_id=request_id,
        template_id=request.template_id,
        score=score_value if valid else None,
        level="browser_frame_fallback" if valid else "insufficient_capture",
        score_valid=valid,
        feedback=feedback,
        diagnostics={
            **diagnostics,
            "scoring_mode": "browser_frame_fallback",
            "fallback_reason": reason,
            "worker": worker_service.snapshot(),
            "worker_error": worker_error,
        },
    )


@app.get("/api/scoring/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": APP_VERSION,
        "worker_enabled": worker_service.enabled,
        "worker_ready": worker_service.ready,
        "worker": worker_service.snapshot(),
        "template_root_configured": _template_root_has_templates(),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


@app.get("/api/scoring/templates")
def templates() -> dict[str, Any]:
    templates_payload: list[dict[str, Any]] = []
    for item in SUPPORTED_TEMPLATES:
        template_path = _find_template_path(str(item["id"]))
        templates_payload.append(
            {
                **item,
                "template_configured": template_path is not None,
                "template_path": str(template_path) if template_path else None,
            }
        )
    return {"templates": templates_payload, "template_root_configured": _template_root_has_templates()}


@app.post("/api/scoring/worker/warmup")
def warmup_worker(wait_for_ready_sec: float = Query(default=180.0, gt=0, le=300)) -> dict[str, Any]:
    if not worker_service.enabled:
        return {
            "status": "disabled",
            "worker": worker_service.snapshot(),
            "message": "Set SLU_ENABLE_HOLISTIC_WORKER=true to enable Holistic worker startup.",
        }
    try:
        response = worker_service.request({"cmd": "ping", "request_id": f"warmup_{uuid4().hex[:8]}"}, wait_for_ready_sec)
        return {"status": "ok", "worker": worker_service.snapshot(), "response": response}
    except Exception as exc:
        return {"status": "error", "worker": worker_service.snapshot(), "error": str(exc)}


@app.post("/api/scoring/score", response_model=ScoreResponse)
def score(request: ScoreRequest) -> ScoreResponse:
    request_id = f"score_{uuid4().hex[:12]}"
    if request.input_type == "landmark_rows":
        if not request.landmark_rows:
            return _fallback_response(request, request_id, "empty_landmark_rows")
        try:
            worker_response = _landmark_rows_worker_response(request, request_id)
            template_path = _find_template_path(request.template_id)
            if template_path is not None:
                return _template_similarity_response(request, request_id, worker_response, template_path)
            return _holistic_quality_response(request, request_id, worker_response)
        except Exception as exc:
            return _fallback_response(request, request_id, "landmark_rows_error", worker_error=str(exc))

    if request.input_type == "frame_slices" and not request.frames:
        return _fallback_response(request, request_id, "empty_frame_slices")

    if request.input_type != "frame_slices":
        return _fallback_response(request, request_id, "video_path_worker_integration_pending")

    if not worker_service.enabled:
        return _fallback_response(request, request_id, "worker_disabled")

    try:
        payload = _worker_payload(request, request_id)
        worker_response = worker_service.request(payload, timeout_sec=request.wait_for_ready_sec)
        template_path = _find_template_path(request.template_id)
        if template_path is not None:
            return _template_similarity_response(request, request_id, worker_response, template_path)
        return _holistic_quality_response(request, request_id, worker_response)
    except Exception as exc:
        return _fallback_response(request, request_id, "worker_error", worker_error=str(exc))


@app.on_event("shutdown")
def shutdown_worker() -> None:
    worker_service.shutdown()
