"""Lightweight scoring API contract for the team repository.

This is the stable integration surface for the frontend. The historical
FastAPI backend from the research repository is kept as ``legacy_backend.py``
until its Holistic worker and path assumptions are migrated.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


APP_VERSION = "0.1.0"
SUPPORTED_TEMPLATES = [
    {"id": "flower", "label": "花", "available": True},
    {"id": "jump", "label": "跳", "available": True},
]


class FrameSlice(BaseModel):
    index: int = Field(ge=0)
    timestamp_ms: int = Field(ge=0)
    image_base64: str


class ScoreRequest(BaseModel):
    template_id: str = Field(default="flower")
    input_type: Literal["frame_slices", "video_path"] = "frame_slices"
    frames: list[FrameSlice] = Field(default_factory=list)
    video_path: str | None = None
    client_meta: dict[str, Any] = Field(default_factory=dict)


class ScoreResponse(BaseModel):
    request_id: str
    template_id: str
    score: float | None
    level: str
    score_valid: bool
    feedback: list[dict[str, str]]
    diagnostics: dict[str, Any]


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


@app.get("/api/scoring/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": APP_VERSION,
        "worker_ready": False,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


@app.get("/api/scoring/templates")
def templates() -> dict[str, Any]:
    return {"templates": SUPPORTED_TEMPLATES}


@app.post("/api/scoring/score", response_model=ScoreResponse)
def score(request: ScoreRequest) -> ScoreResponse:
    # The contract is ready for frontend integration. Full Holistic scoring will
    # be connected after the legacy worker path assumptions are migrated.
    return ScoreResponse(
        request_id=f"score_{uuid4().hex[:12]}",
        template_id=request.template_id,
        score=None,
        level="pending_worker_integration",
        score_valid=False,
        feedback=[
            {
                "type": "integration",
                "message": "评分 API 契约已建立，Holistic worker 尚未接入团队主仓库入口。",
            }
        ],
        diagnostics={
            "input_type": request.input_type,
            "frame_count": len(request.frames),
            "worker_ready": False,
        },
    )
