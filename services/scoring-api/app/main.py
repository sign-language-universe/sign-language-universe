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
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


APP_VERSION = "0.2.0"
REPO_ROOT = Path(__file__).resolve().parents[3]
WORKER_SCRIPT = Path(__file__).with_name("holistic_worker_daemon.py")
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "work" / "generated" / "scoring-api"
OUTPUT_ROOT = Path(os.getenv("SLU_SCORING_OUTPUT_ROOT", str(DEFAULT_OUTPUT_ROOT)))
TEMPLATE_ROOT = os.getenv("SLU_TEMPLATE_ROOT", "").strip()
SEMANTIC_PROFILE_JSON = os.getenv("SLU_SEMANTIC_PROFILE_JSON", "").strip()

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
    {"id": "chan", "label": "馋", "aliases": ["馋"], "available": True},
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


class ScoreRequest(BaseModel):
    template_id: str = Field(default="flower")
    input_type: Literal["frame_slices", "video_path"] = "frame_slices"
    frames: list[FrameSlice] = Field(default_factory=list)
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


def _estimate_fps(request: ScoreRequest) -> float:
    if request.fps and math.isfinite(request.fps):
        return max(1.0, min(float(request.fps), 30.0))
    frames = sorted(request.frames, key=lambda item: item.timestamp_ms)
    if len(frames) >= 2:
        duration_ms = max(1, frames[-1].timestamp_ms - frames[0].timestamp_ms)
        return max(1.0, min(30.0, (len(frames) - 1) * 1000.0 / duration_ms))
    return 5.0


def _frame_duration_ms(request: ScoreRequest) -> int:
    if request.duration_ms is not None:
        return int(request.duration_ms)
    frames = sorted(request.frames, key=lambda item: item.timestamp_ms)
    if len(frames) >= 2:
        return int(max(0, frames[-1].timestamp_ms - frames[0].timestamp_ms))
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


def _fallback_frame_score(request: ScoreRequest) -> tuple[float, bool, dict[str, Any]]:
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
        kwargs["semantic_profile_json"] = Path(SEMANTIC_PROFILE_JSON).expanduser()
    standard = scoring_mvp.load_sequence(template_path, requested_mode="landmark")
    query = scoring_mvp.load_sequence(query_path, requested_mode="landmark")
    result = scoring_mvp.run_pair(standard, query, **kwargs)
    score_value = _clamp_score(float(result.get("prototype_score") or 0.0))
    metrics = _holistic_metrics(worker_response)
    return ScoreResponse(
        request_id=request_id,
        template_id=request.template_id,
        score=score_value,
        level=_level_from_score(score_value),
        score_valid=bool(score_value > 0),
        feedback=[
            {"type": "template", "message": "已使用服务器 Holistic 模板进行原型相似度评分。"},
            {"type": "policy", "message": "当前分数是原型相似度结果，尚未经过真实用户人工标注校准。"},
        ],
        diagnostics={
            "scoring_mode": "holistic_template_similarity",
            "template_path": str(template_path),
            "query_path": str(query_path),
            "worker": worker_service.snapshot(),
            "worker_response": {
                "input_mode": worker_response.get("input_mode"),
                "holistic_eval_sec": worker_response.get("holistic_eval_sec"),
                "request_total_sec": worker_response.get("request_total_sec"),
            },
            "holistic_metrics": metrics,
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
    feedback = [
        {"type": "worker", "message": "已接入 Holistic worker 并完成浏览器帧关键点检测。"},
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
            "scoring_mode": "holistic_capture_quality",
            "template_root_configured": bool(TEMPLATE_ROOT),
            "template_path": None,
            "worker": worker_service.snapshot(),
            "worker_response": {
                "input_mode": worker_response.get("input_mode"),
                "result_file": worker_response.get("result_file"),
                "holistic_eval_sec": worker_response.get("holistic_eval_sec"),
                "request_total_sec": worker_response.get("request_total_sec"),
            },
            "holistic_metrics": metrics,
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
        "template_root_configured": bool(TEMPLATE_ROOT),
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
    return {"templates": templates_payload, "template_root_configured": bool(TEMPLATE_ROOT)}


@app.post("/api/scoring/score", response_model=ScoreResponse)
def score(request: ScoreRequest) -> ScoreResponse:
    request_id = f"score_{uuid4().hex[:12]}"
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
