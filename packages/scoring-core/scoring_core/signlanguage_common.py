#!/usr/bin/env python3
"""
手语项目通用工具。

提供三类基础能力：
1. 从 DOCX 中提取纯文本
2. 将 demo 词汇说明按“关键语义信息”切分为结构化片段
3. 使用 ffprobe 读取视频元数据

这些函数只依赖标准库和系统的 ffprobe，因此即使当前 Python 环境
没有安装 python-docx / opencv / mediapipe，也可以先生成结构化清单。
"""

from __future__ import annotations

import json
import os
import subprocess
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


DOCX_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


@dataclass
class SemanticSection:
    """一个手语词汇说明片段。"""

    index: int
    marker: str
    lines: List[str]

    @property
    def summary(self) -> str:
        """将片段压成便于检索的一行摘要。"""

        return "；".join(self.lines[:3]).strip()


def read_docx_text(docx_path: str | Path) -> List[str]:
    """
    从 DOCX 中提取按顺序排列的文本。

    这里不依赖 python-docx，而是直接解析 Office Open XML 的 document.xml。
    """

    docx_path = Path(docx_path)
    with zipfile.ZipFile(docx_path) as zf:
        xml_bytes = zf.read("word/document.xml")

    root = ET.fromstring(xml_bytes)
    texts: List[str] = []
    for text_node in root.findall(".//w:t", DOCX_NS):
        if text_node.text:
            texts.append(text_node.text)
    return texts


def split_semantic_sections(texts: Iterable[str]) -> List[SemanticSection]:
    """
    将 DOCX 里的说明文字切分为若干语义片段。

    规则：
    - 以“关键语义信息：”作为一个片段起点
    - 紧随其后的若干行作为该片段的描述内容
    - 直到下一个 marker 或文本结束
    """

    sections: List[SemanticSection] = []
    current: List[str] = []
    index = -1
    marker = ""

    for raw in texts:
        text = raw.strip()
        if not text:
            continue
        if text == "关键语义信息：":
            if current:
                sections.append(SemanticSection(index=index, marker=marker, lines=current))
                current = []
            index += 1
            marker = text
            continue
        current.append(text)

    if current:
        sections.append(SemanticSection(index=index if index >= 0 else 0, marker=marker, lines=current))

    return sections


def find_demo_videos(data_root: str | Path, suffixes: Iterable[str] = (".mp4", ".mov", ".avi", ".mkv")) -> List[Path]:
    """递归查找 demo 视频文件。"""

    data_root = Path(data_root)
    suffix_set = {s.lower() for s in suffixes}
    videos = [
        path
        for path in data_root.rglob("*")
        if path.is_file() and path.suffix.lower() in suffix_set
    ]
    return sorted(videos)


def _run_ffprobe_json(path: Path) -> Optional[Dict[str, Any]]:
    """调用 ffprobe 并解析 JSON 输出。"""

    ffprobe = os.environ.get("FFPROBE", "ffprobe")
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        str(path),
    ]
    try:
        proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None

    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None


def probe_video_metadata(video_path: str | Path) -> Dict[str, Any]:
    """
    读取视频元数据。

    如果 ffprobe 可用，会返回 duration / fps / width / height / frame_count 等字段；
    如果不可用，则只返回基础文件信息。
    """

    video_path = Path(video_path)
    stat = video_path.stat()
    meta: Dict[str, Any] = {
        "path": str(video_path),
        "name": video_path.name,
        "stem": video_path.stem,
        "suffix": video_path.suffix.lower(),
        "size_bytes": stat.st_size,
        "mtime": stat.st_mtime,
    }

    payload = _run_ffprobe_json(video_path)
    if not payload:
        meta["probe_backend"] = "file_stat_only"
        return meta

    streams = payload.get("streams", [])
    fmt = payload.get("format", {})
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), {})

    def _to_int(value: Any) -> Optional[int]:
        try:
            if value is None:
                return None
            return int(float(value))
        except (TypeError, ValueError):
            return None

    def _to_float(value: Any) -> Optional[float]:
        try:
            if value is None:
                return None
            return float(value)
        except (TypeError, ValueError):
            return None

    fps = None
    avg_rate = video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate")
    if isinstance(avg_rate, str) and "/" in avg_rate:
        num, den = avg_rate.split("/", 1)
        try:
            num_f = float(num)
            den_f = float(den)
            fps = num_f / den_f if den_f else None
        except ValueError:
            fps = None

    duration = _to_float(fmt.get("duration")) or _to_float(video_stream.get("duration"))
    frame_count = _to_int(video_stream.get("nb_frames"))
    width = _to_int(video_stream.get("width"))
    height = _to_int(video_stream.get("height"))

    meta.update(
        {
            "probe_backend": "ffprobe",
            "duration_sec": duration,
            "fps": fps,
            "frame_count": frame_count,
            "width": width,
            "height": height,
            "codec_name": video_stream.get("codec_name"),
            "pix_fmt": video_stream.get("pix_fmt"),
        }
    )
    return meta

