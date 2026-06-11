#!/usr/bin/env python3
"""Web API for the signLanguage Holistic scoring MVP.

The service serves a browser frontend and keeps one MediaPipe Holistic worker
alive in a subprocess. Browser frames are sent as JPEG base64 slices, converted
to raw Holistic JSON by the worker, then scored against the cached demo
templates with the existing scoring MVP module.
"""

from __future__ import annotations

import json
import importlib
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


REPO_ROOT = Path(__file__).resolve().parents[2]
WORK_DIR = REPO_ROOT / "work"
SCRIPT_DIR = WORK_DIR / "scripts"
STATIC_DIR = Path(__file__).resolve().parent / "static"
WORKER_SCRIPT = SCRIPT_DIR / "holistic_worker_daemon.py"
LEGACY_TEMPLATE_ROOT = WORK_DIR / "generated/scoring_mvp_run2/all_demo_step4_worker_cache_v2/results"
DENSE_TEMPLATE_ROOT = WORK_DIR / "generated/scoring_mvp_run3/all_demo_step2_worker_cache_semantic_v1/results"
OUTPUT_ROOT = WORK_DIR / "generated/web_scoring_mvp"
LOG_DIR = WORK_DIR / "logs"
DEMO_VIDEO_ROOT = REPO_ROOT / "data/Demo词汇视频/Demo词汇视频"
SEMANTIC_PROFILE_JSON = WORK_DIR / "generated/scoring_semantic_profiles/sign_semantic_weights.json"
WATCH_STATUS_JSON = WORK_DIR / "generated/scoring_mvp_run3/web_sample_marker_watch_status.json"
WATCH_STATUS_MD = WORK_DIR / "generated/scoring_mvp_run3/web_sample_marker_watch_status.md"
DEFAULT_MODEL_COMPLEXITY = 1

if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import score_holistic_sequence_mvp as scoring_mvp  # noqa: E402


class ScoreRequest(BaseModel):
    target_word: str = Field(default="花", description="Template word/folder name")
    fps: float = Field(default=5.0, gt=0.0, le=60.0)
    duration_sec: Optional[float] = Field(default=None, ge=0.0, le=30.0)
    frame_indices: Optional[List[int]] = None
    frame_weights: Optional[List[float]] = None
    client_source: Optional[str] = None
    client_session_id: Optional[str] = None
    client_capture_id: Optional[str] = None
    frames: List[Dict[str, Any]] = Field(default_factory=list)
    wait_for_ready_sec: float = Field(default=600.0, ge=0.0, le=900.0)


class TemplateCacheRequest(BaseModel):
    dense_step: int = Field(default=2, ge=1, le=20)
    words: Optional[List[str]] = None
    output_root: Optional[str] = None
    force: bool = False
    wait_for_ready_sec: float = Field(default=900.0, ge=0.0, le=1800.0)


class ScoringModuleService:
    def __init__(self, module: Any) -> None:
        self._module = module
        self._path = Path(module.__file__).resolve()
        self._lock = threading.Lock()
        self._mtime_ns = self._read_mtime_ns()
        self._loaded_at = datetime.now().isoformat(timespec="seconds")
        self._reload_count = 0
        self._last_reload_error: Optional[str] = None

    def _read_mtime_ns(self) -> int:
        return self._path.stat().st_mtime_ns

    def get(self, auto_reload: bool = True) -> Any:
        if auto_reload:
            self.reload_if_changed()
        return self._module

    def reload_if_changed(self) -> bool:
        current_mtime = self._read_mtime_ns()
        if current_mtime == self._mtime_ns:
            return False
        self.reload(force=True, expected_mtime_ns=current_mtime)
        return True

    def reload(self, force: bool = True, expected_mtime_ns: Optional[int] = None) -> Dict[str, Any]:
        with self._lock:
            current_mtime = expected_mtime_ns if expected_mtime_ns is not None else self._read_mtime_ns()
            if not force and current_mtime == self._mtime_ns:
                return self.snapshot()
            try:
                importlib.invalidate_caches()
                self._module = importlib.reload(self._module)
                self._path = Path(self._module.__file__).resolve()
                self._mtime_ns = self._read_mtime_ns()
                self._loaded_at = datetime.now().isoformat(timespec="seconds")
                self._reload_count += 1
                self._last_reload_error = None
            except Exception as exc:
                self._last_reload_error = str(exc)
                raise
            return self.snapshot()

    def snapshot(self) -> Dict[str, Any]:
        return {
            "module": self._module.__name__,
            "module_file": str(self._path),
            "mtime_ns": self._mtime_ns,
            "loaded_at": self._loaded_at,
            "reload_count": self._reload_count,
            "last_reload_error": self._last_reload_error,
        }


class HolisticWorkerService:
    def __init__(self, worker_script: Path, model_complexity: int = DEFAULT_MODEL_COMPLEXITY) -> None:
        self.worker_script = worker_script
        self.model_complexity = model_complexity
        self.process: Optional[subprocess.Popen[str]] = None
        self.status = "stopped"
        self.error: Optional[str] = None
        self.ready_payload: Optional[Dict[str, Any]] = None
        self.started_at: Optional[str] = None
        self.ready_at: Optional[str] = None
        self.stderr_log: Optional[Path] = None
        self._ready_event = threading.Event()
        self._request_lock = threading.Lock()
        self._lifecycle_lock = threading.Lock()
        self._stderr_handle = None

    def start_async(self) -> None:
        with self._lifecycle_lock:
            if self.status in {"starting", "ready"}:
                return
            self.status = "starting"
            self.error = None
            self.ready_payload = None
            self.ready_at = None
            self.started_at = datetime.now().isoformat(timespec="seconds")
            self._ready_event.clear()
            thread = threading.Thread(target=self._start_worker, name="holistic-worker-start", daemon=True)
            thread.start()

    def _start_worker(self) -> None:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        log_name = f"web_holistic_worker_{datetime.now().strftime('%Y%m%d_%H%M%S')}.stderr.log"
        self.stderr_log = LOG_DIR / log_name
        try:
            self._stderr_handle = self.stderr_log.open("a", encoding="utf-8")
            cmd = [
                sys.executable,
                str(self.worker_script),
                "--model-complexity",
                str(self.model_complexity),
            ]
            self.process = subprocess.Popen(
                cmd,
                cwd=str(SCRIPT_DIR),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=self._stderr_handle,
                text=True,
                bufsize=1,
            )
            if self.process.stdout is None or self.process.stdin is None:
                raise RuntimeError("worker pipes are not available")
            line = self.process.stdout.readline()
            if not line:
                raise RuntimeError("worker exited before ready message")
            payload = json.loads(line)
            if payload.get("type") != "ready":
                raise RuntimeError(f"unexpected worker startup payload: {payload}")
            self.ready_payload = payload
            self.ready_at = datetime.now().isoformat(timespec="seconds")
            self.status = "ready"
            self._ready_event.set()
        except Exception as exc:
            self.error = str(exc)
            self.status = "error"
            self._ready_event.set()

    def wait_ready(self, timeout_sec: float) -> None:
        self.start_async()
        if not self._ready_event.wait(timeout=max(0.0, timeout_sec)):
            raise TimeoutError("Holistic worker is still starting")
        if self.status != "ready":
            raise RuntimeError(self.error or f"Holistic worker status is {self.status}")

    def request(self, payload: Dict[str, Any], timeout_sec: float = 600.0) -> Dict[str, Any]:
        self.wait_ready(timeout_sec)
        with self._request_lock:
            if self.process is None or self.process.stdin is None or self.process.stdout is None:
                raise RuntimeError("worker process is not available")
            if self.process.poll() is not None:
                self.status = "error"
                self.error = f"worker process exited with code {self.process.returncode}"
                self._ready_event.set()
                raise RuntimeError(self.error)
            self.process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
            self.process.stdin.flush()
            line = self.process.stdout.readline()
            if not line:
                raise RuntimeError("worker returned empty response")
            response = json.loads(line)
            if response.get("type") == "error":
                raise RuntimeError(str(response.get("error") or response))
            return response

    def snapshot(self) -> Dict[str, Any]:
        proc_state = None
        if self.process is not None:
            proc_state = {
                "pid": self.process.pid,
                "returncode": self.process.poll(),
            }
        return {
            "status": self.status,
            "started_at": self.started_at,
            "ready_at": self.ready_at,
            "ready_payload": self.ready_payload,
            "error": self.error,
            "stderr_log": str(self.stderr_log) if self.stderr_log else None,
            "process": proc_state,
        }

    def shutdown(self) -> None:
        with self._lifecycle_lock:
            proc = self.process
            if proc is not None and proc.poll() is None and proc.stdin is not None:
                try:
                    proc.stdin.write(json.dumps({"cmd": "shutdown"}, ensure_ascii=False) + "\n")
                    proc.stdin.flush()
                    proc.wait(timeout=20)
                except Exception:
                    proc.terminate()
            self.status = "stopped"
            self._ready_event.clear()
            if self._stderr_handle is not None:
                try:
                    self._stderr_handle.close()
                except Exception:
                    pass


scoring_service = ScoringModuleService(scoring_mvp)
worker_service = HolisticWorkerService(WORKER_SCRIPT)
app = FastAPI(title="signLanguage Scoring MVP", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def _active_template_root() -> Path:
    if DENSE_TEMPLATE_ROOT.exists() and any(item.is_dir() for item in DENSE_TEMPLATE_ROOT.iterdir()):
        return DENSE_TEMPLATE_ROOT
    return LEGACY_TEMPLATE_ROOT


def _template_roots() -> List[Path]:
    roots = [DENSE_TEMPLATE_ROOT, LEGACY_TEMPLATE_ROOT]
    return [root for root in roots if root.exists()]


def _template_path(word: str) -> Path:
    for root in _template_roots():
        direct = root / word / f"{word}_holistic_results.json"
        if direct.exists():
            return direct
        folder = root / word
        matches = sorted(folder.glob("*_holistic_results.json")) if folder.exists() else []
        if matches:
            return matches[0]
    raise KeyError(word)


def _reference_video_path(word: str) -> Path:
    direct = DEMO_VIDEO_ROOT / f"{word}.mp4"
    if direct.exists():
        return direct
    matches = sorted(DEMO_VIDEO_ROOT.glob(f"{word}.*"))
    for item in matches:
        if item.suffix.lower() == ".mp4":
            return item
    raise KeyError(word)


def _semantic_profile_item(word: str) -> Optional[Dict[str, Any]]:
    if not SEMANTIC_PROFILE_JSON.exists():
        return None
    try:
        payload = json.loads(SEMANTIC_PROFILE_JSON.read_text(encoding="utf-8"))
        profile = (payload.get("profiles") or {}).get(word)
        if profile is None and "（" in word:
            profile = (payload.get("profiles") or {}).get(word.split("（", 1)[0])
        if profile is None:
            return None
        return {
            "profile_version": payload.get("version"),
            "description": profile.get("description"),
            "group_weights": profile.get("group_weights"),
            "focus_groups": profile.get("focus_groups"),
            "allow_hand_swap": profile.get("allow_hand_swap"),
        }
    except Exception:
        return None


def _write_template_weight_manifest(template_json: Path, word: str) -> Optional[Path]:
    try:
        scoring = scoring_service.get(auto_reload=True)
        seq = scoring.load_sequence(template_json, requested_mode="landmark", apply_sidecar_weights=False)
        profile = scoring.load_semantic_profile(word, SEMANTIC_PROFILE_JSON)
        weights = scoring.compute_semantic_frame_weight_values(seq, profile=profile, combine_stored=True)
        top_indices = list(weights.argsort()[-min(12, len(weights)) :][::-1]) if len(weights) else []
        frames = [
            {
                "frame_idx": int(feature.frame_idx),
                "timestamp_sec": float(feature.timestamp_sec),
                "semantic_frame_weight": float(weights[idx]) if idx < len(weights) else 1.0,
                "source_frame_weight": float(feature.frame_weight),
            }
            for idx, feature in enumerate(seq.features)
        ]
        manifest = {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "template_json": str(template_json),
            "word": word,
            "version": "semantic_dynamic_frame_weights_v1",
            "strategy": "semantic_focus_motion_energy_density",
            "semantic_profile": scoring._profile_summary(profile),
            "records": len(seq.features),
            "fps": seq.fps,
            "total_frames": seq.total_frames,
            "frame_weights": frames,
            "top_weighted_frames": [frames[idx] for idx in top_indices],
        }
        manifest_path = template_json.parent / "semantic_frame_weights.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        return manifest_path
    except Exception:
        return None


def _list_templates() -> List[Dict[str, Any]]:
    templates: List[Dict[str, Any]] = []
    roots = _template_roots()
    if not roots:
        return templates
    words = sorted({folder.name for root in roots for folder in root.iterdir() if folder.is_dir()})
    for word in words:
        try:
            template_json = _template_path(word)
        except KeyError:
            continue
        root = template_json.parent.parent
        count = None
        fps = None
        try:
            payload = json.loads(template_json.read_text(encoding="utf-8"))
            count = len(payload.get("records") or [])
            fps = payload.get("fps")
        except Exception:
            pass
        item = {
            "word": word,
            "label": word,
            "template_json": str(template_json),
            "template_root": str(root),
            "records": count,
            "fps": fps,
        }
        weight_manifest = template_json.parent / "semantic_frame_weights.json"
        item["template_weight_manifest"] = str(weight_manifest) if weight_manifest.exists() else None
        try:
            ref = _reference_video_path(word)
            item["reference_video"] = str(ref)
            item["reference_video_url"] = f"/api/reference-video/{word}"
        except KeyError:
            item["reference_video"] = None
            item["reference_video_url"] = None
        item["semantic_profile"] = _semantic_profile_item(word)
        templates.append(item)
    return templates


def _watch_status_snapshot() -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "status_json": str(WATCH_STATUS_JSON),
        "status_md": str(WATCH_STATUS_MD),
        "exists": WATCH_STATUS_JSON.exists(),
        "markdown_exists": WATCH_STATUS_MD.exists(),
        "payload": None,
        "markdown": "",
        "error": None,
    }
    if WATCH_STATUS_JSON.exists():
        try:
            payload["payload"] = json.loads(WATCH_STATUS_JSON.read_text(encoding="utf-8"))
        except Exception as exc:
            payload["error"] = f"cannot read watch status json: {exc}"
    if WATCH_STATUS_MD.exists():
        try:
            payload["markdown"] = WATCH_STATUS_MD.read_text(encoding="utf-8")
        except Exception as exc:
            payload["error"] = f"cannot read watch status markdown: {exc}"
    return payload


def _compact_score_result(result: Dict[str, Any]) -> Dict[str, Any]:
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


def _flower_jump_cross_check(
    scoring: Any,
    target_word: str,
    target_score_result: Dict[str, Any],
    query: Any,
) -> Dict[str, Any]:
    pair = {"花": "跳", "跳": "花"}
    other_word = pair.get(target_word)
    if not other_word:
        return {"enabled": False, "reason": "target_not_in_flower_jump_pair"}
    try:
        other_standard_json = _template_path(other_word)
        other_standard = scoring.load_sequence(other_standard_json, requested_mode="landmark")
        other_score_result = scoring.run_pair(other_standard, query, target_word=other_word)
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
            "other_standard_json": str(other_standard_json),
            "target_score_summary": _compact_score_result(target_score_result),
            "other_score_summary": _compact_score_result(other_score_result),
        }
    except Exception as exc:
        return {
            "enabled": True,
            "target_word": target_word,
            "other_word": other_word,
            "passed": False,
            "reason": "cross_check_error",
            "error": str(exc),
        }


@app.on_event("startup")
def _startup() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    worker_service.start_async()


@app.on_event("shutdown")
def _shutdown() -> None:
    worker_service.shutdown()


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/reference-video/{word}")
def reference_video(word: str) -> FileResponse:
    try:
        path = _reference_video_path(word)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown reference video: {word}") from None
    return FileResponse(path, media_type="video/mp4", filename=path.name)


@app.get("/api/status")
def api_status() -> Dict[str, Any]:
    return {
        "service": "signLanguage scoring MVP",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "claim_policy": "prototype similarity only; not a calibrated real-user score",
        "template_root": str(_active_template_root()),
        "legacy_template_root": str(LEGACY_TEMPLATE_ROOT),
        "dense_template_root": str(DENSE_TEMPLATE_ROOT),
        "output_root": str(OUTPUT_ROOT),
        "semantic_profile_json": str(SEMANTIC_PROFILE_JSON),
        "scoring_module": scoring_service.snapshot(),
        "templates": _list_templates(),
        "worker": worker_service.snapshot(),
    }


@app.get("/api/templates")
def api_templates() -> Dict[str, Any]:
    return {"templates": _list_templates()}


@app.get("/api/watch-status")
def api_watch_status() -> Dict[str, Any]:
    return _watch_status_snapshot()


@app.post("/api/admin/reload-scoring")
def api_reload_scoring() -> Dict[str, Any]:
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "scoring_module": scoring_service.reload(force=True),
        "worker": worker_service.snapshot(),
    }


def _demo_videos_for_words(words: Optional[List[str]]) -> List[Path]:
    available = sorted([item for item in DEMO_VIDEO_ROOT.glob("*.mp4") if item.is_file()], key=lambda p: p.stem)
    if not words:
        return available
    wanted = {word.strip() for word in words if word and word.strip()}
    return [path for path in available if path.stem in wanted]


def _dense_frame_indices(video_path: Path, dense_step: int) -> Dict[str, Any]:
    try:
        import cv2  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"OpenCV unavailable for template probing: {exc}") from exc
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {video_path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total_frames <= 0:
        cap.release()
        raise RuntimeError(f"cannot read frame count: {video_path}")
    raw_indices = list(range(0, total_frames, max(1, int(dense_step))))
    if (total_frames - 1) not in raw_indices:
        raw_indices.append(total_frames - 1)
    valid_indices: List[int] = []
    dropped_indices: List[int] = []
    for idx in sorted(set(raw_indices)):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ok, _ = cap.read()
        if ok:
            valid_indices.append(int(idx))
        else:
            dropped_indices.append(int(idx))
    cap.release()
    if not valid_indices:
        raise RuntimeError(f"no readable sampled frames: {video_path}")
    return {
        "fps": fps,
        "total_frames": total_frames,
        "frame_indices": valid_indices,
        "dropped_frame_indices": dropped_indices,
    }


@app.post("/api/admin/build-template-cache")
def api_build_template_cache(request: TemplateCacheRequest) -> Dict[str, Any]:
    output_root = Path(request.output_root) if request.output_root else DENSE_TEMPLATE_ROOT
    videos = _demo_videos_for_words(request.words)
    if not videos:
        raise HTTPException(status_code=404, detail="no matching demo videos")

    output_root.mkdir(parents=True, exist_ok=True)
    built: List[Dict[str, Any]] = []
    started = time.perf_counter()
    for video_path in videos:
        word = video_path.stem
        result_dir = output_root / word
        result_file = result_dir / f"{word}_holistic_results.json"
        if result_file.exists() and not request.force:
            manifest_path = _write_template_weight_manifest(result_file, word)
            try:
                payload = json.loads(result_file.read_text(encoding="utf-8"))
                built.append(
                    {
                        "word": word,
                        "status": "skipped_existing",
                        "result_file": str(result_file),
                        "weight_manifest": str(manifest_path) if manifest_path else None,
                        "records": len(payload.get("records") or []),
                        "fps": payload.get("fps"),
                    }
                )
                continue
            except Exception:
                pass

        meta = _dense_frame_indices(video_path, request.dense_step)
        worker_payload = {
            "cmd": "process",
            "request_id": f"dense_template_{word}_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            "video_path": str(video_path),
            "frame_indices": meta["frame_indices"],
            "result_dir": str(result_dir),
        }
        try:
            response = worker_service.request(worker_payload, timeout_sec=request.wait_for_ready_sec)
        except TimeoutError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"{word}: {exc}") from exc

        response_file = Path(response.get("result_file") or result_file)
        manifest_path = _write_template_weight_manifest(response_file, word)
        built.append(
            {
                "word": word,
                "status": "built",
                "result_file": response.get("result_file"),
                "weight_manifest": str(manifest_path) if manifest_path else None,
                "records": response.get("samples"),
                "fps": meta["fps"],
                "total_frames": meta["total_frames"],
                "dropped_frame_indices": meta.get("dropped_frame_indices"),
                "dense_step": request.dense_step,
                "holistic_eval_sec": response.get("holistic_eval_sec"),
                "request_total_sec": response.get("request_total_sec"),
            }
        )

    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "output_root": str(output_root),
        "dense_step": request.dense_step,
        "elapsed_sec": round(time.perf_counter() - started, 3),
        "items": built,
        "active_template_root": str(_active_template_root()),
    }


@app.post("/api/score")
def api_score(request: ScoreRequest) -> Dict[str, Any]:
    if not request.frames:
        raise HTTPException(status_code=400, detail="frames is empty")
    if len(request.frames) > 90:
        raise HTTPException(status_code=400, detail="too many frames; keep one request under 90 frames")
    try:
        standard_json = _template_path(request.target_word)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown template word: {request.target_word}") from None

    request_id = f"web_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    result_dir = OUTPUT_ROOT / request_id
    holistic_dir = result_dir / "holistic"
    holistic_dir.mkdir(parents=True, exist_ok=True)
    frame_indices = request.frame_indices or list(range(len(request.frames)))
    if len(frame_indices) != len(request.frames):
        raise HTTPException(status_code=400, detail="frame_indices and frames length mismatch")
    frame_weights = request.frame_weights
    if frame_weights is not None and len(frame_weights) != len(request.frames):
        raise HTTPException(status_code=400, detail="frame_weights and frames length mismatch")
    total_frames = max(max([int(idx) for idx in frame_indices] or [0]) + 1, len(request.frames))

    worker_payload = {
        "cmd": "process_frames",
        "request_id": request_id,
        "video_stem": f"user_{request.target_word}_{request_id}",
        "fps": float(request.fps),
        "total_frames": total_frames,
        "frame_indices": [int(idx) for idx in frame_indices],
        "frame_weights": [float(value) for value in frame_weights] if frame_weights is not None else None,
        "frames": request.frames,
        "result_dir": str(holistic_dir),
    }

    started = time.perf_counter()
    try:
        worker_response = worker_service.request(worker_payload, timeout_sec=request.wait_for_ready_sec)
        result_file = worker_response.get("result_file")
        if not result_file:
            raise RuntimeError("worker response does not include result_file")
        scoring = scoring_service.get(auto_reload=True)
        standard = scoring.load_sequence(standard_json, requested_mode="landmark")
        query = scoring.load_sequence(Path(result_file), requested_mode="landmark")
        score_result = scoring.run_pair(standard, query)
        cross_word_check = _flower_jump_cross_check(scoring, request.target_word, score_result, query)
    except TimeoutError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    total_sec = round(time.perf_counter() - started, 3)
    score_payload = {
        "request_id": request_id,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "claim_policy": "prototype sanity check only; no calibrated real-user score or pass/fail threshold",
        "target_word": request.target_word,
        "standard_json": str(standard_json),
        "query_json": str(result_file),
        "duration_sec": request.duration_sec,
        "capture_fps": request.fps,
        "client_source": request.client_source,
        "client": {
            "source": request.client_source,
            "session_id": request.client_session_id,
            "capture_id": request.client_capture_id,
        },
        "frame_count": len(request.frames),
        "timeline_frame_count": total_frames,
        "frame_indices": [int(idx) for idx in frame_indices],
        "frame_weights": [float(value) for value in frame_weights] if frame_weights is not None else None,
        "worker": {
            "input_mode": worker_response.get("input_mode"),
            "ingest_sec": worker_response.get("ingest_sec"),
            "holistic_eval_sec": worker_response.get("holistic_eval_sec"),
            "request_total_sec": worker_response.get("request_total_sec"),
            "samples": worker_response.get("samples"),
        },
        "timing": {
            "api_total_sec": total_sec,
        },
        "score": {
            "prototype_score": score_result["prototype_score"],
            "dtw_distance": score_result["dtw_distance"],
            "normalized_distance": score_result["normalized_distance"],
            "path_length": score_result["path_length"],
            "path_weight_sum": score_result.get("path_weight_sum"),
            "alignment_policy": score_result.get("alignment_policy"),
            "action_window": score_result.get("action_window"),
            "temporal_resample": score_result.get("temporal_resample"),
            "score_scale": score_result.get("score_scale"),
            "sequence_penalty": score_result["sequence_penalty"],
            "group_mean_distance": score_result["group_mean_distance"],
            "semantic_dtw": score_result.get("semantic_dtw"),
            "frame_weight_summary": score_result.get("frame_weight_summary"),
            "cross_word_check": cross_word_check,
            "worst_alignment_points": score_result["worst_alignment_points"][:5],
            "semantic_profile": score_result.get("semantic_profile"),
        },
        "artifacts": {
            "result_dir": str(result_dir),
            "holistic_json": str(result_file),
            "scoring_json": str(result_dir / "scoring_result.json"),
            "worker_stderr_log": worker_service.snapshot().get("stderr_log"),
        },
    }
    (result_dir / "scoring_result.json").write_text(
        json.dumps(score_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return score_payload


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=5080, log_level="info")


if __name__ == "__main__":
    main()
