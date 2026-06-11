#!/usr/bin/env python3
"""
Holistic 特征可视化脚本。

用途：
1. 把视频帧上的 pose / hands / face 关键点直接画出来
2. 同时生成黑底骨骼图，便于观察动作结构
3. 输出多帧拼图，快速对比一个动作在时间上的关键变化

这个脚本面向“看效果”而不是训练，因此默认处理少量采样帧。
"""

from __future__ import annotations

import argparse
import json
import os
from functools import lru_cache
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

import mediapipe as mp


DEFAULT_REPO_ROOT = Path("/data/WYC/signLanguage")
DEFAULT_OUTPUT_DIR = DEFAULT_REPO_ROOT / "work" / "generated" / "holistic_viz"
DEFAULT_CJK_FONT_CANDIDATES = (
    Path("/home/wuyangcheng/.fonts/SimHei.ttf"),
    Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
    Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
)


@dataclass
class VizFrame:
    """一个用于可视化的采样帧。"""

    frame_idx: int
    timestamp_sec: float
    image_path: str
    skeleton_path: str
    triple_path: str
    pose_present: bool
    left_hand_present: bool
    right_hand_present: bool
    face_present: bool


def _configure_headless() -> None:
    """避免在服务器环境里误连 X11 / Qt。"""

    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    os.environ.setdefault("DISPLAY", "")


def _find_cjk_font_path() -> Optional[Path]:
    """查找可用的中文字体文件。"""

    for candidate in DEFAULT_CJK_FONT_CANDIDATES:
        if candidate.exists():
            return candidate
    return None


@lru_cache(maxsize=8)
def _load_font(font_size: int) -> ImageFont.FreeTypeFont:
    """加载中文字体，找不到时退回默认字体。"""

    font_path = _find_cjk_font_path()
    if font_path is not None:
        try:
            return ImageFont.truetype(str(font_path), font_size)
        except OSError:
            pass
    return ImageFont.load_default()


def _draw_text_overlay(
    image: np.ndarray,
    text: str,
    *,
    position: Tuple[int, int],
    font_size: int = 24,
    text_color: Tuple[int, int, int] = (255, 255, 255),
    background_color: Tuple[int, int, int] = (0, 0, 0),
    padding: int = 8,
) -> np.ndarray:
    """用 PIL 绘制文本，避免 OpenCV 默认字体不支持中文。"""

    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(rgb)
    draw = ImageDraw.Draw(pil_image)
    font = _load_font(font_size)
    bbox = draw.textbbox(position, text, font=font)
    x0 = max(0, bbox[0] - padding)
    y0 = max(0, bbox[1] - padding // 2)
    x1 = min(pil_image.width, bbox[2] + padding)
    y1 = min(pil_image.height, bbox[3] + padding // 2)
    draw.rectangle([x0, y0, x1, y1], fill=background_color)
    draw.text(position, text, font=font, fill=text_color)
    return cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)


def _import_drawing_helpers():
    """集中导入 drawing 工具，保持脚本主体清晰。"""

    drawing = mp.solutions.drawing_utils
    face_connections = mp.solutions.face_mesh_connections
    pose_connections = mp.solutions.pose_connections
    hand_connections = mp.solutions.hands_connections
    holistic = mp.solutions.holistic
    return drawing, face_connections, pose_connections, hand_connections, holistic


def _draw_landmarks(image: np.ndarray, results: Any) -> np.ndarray:
    """在图像上绘制 pose / hand / face 关键点。"""

    drawing, face_connections, pose_connections, hand_connections, _ = _import_drawing_helpers()

    out = image.copy()
    pose_style = drawing.DrawingSpec(color=(80, 220, 255), thickness=2, circle_radius=2)
    pose_conn_style = drawing.DrawingSpec(color=(255, 255, 255), thickness=2, circle_radius=1)
    hand_style = drawing.DrawingSpec(color=(255, 120, 80), thickness=2, circle_radius=2)
    hand_conn_style = drawing.DrawingSpec(color=(255, 255, 255), thickness=2, circle_radius=1)
    face_style = drawing.DrawingSpec(color=(120, 255, 120), thickness=1, circle_radius=1)
    face_conn_style = drawing.DrawingSpec(color=(220, 220, 220), thickness=1, circle_radius=1)

    if results.pose_landmarks:
        drawing.draw_landmarks(
            out,
            results.pose_landmarks,
            pose_connections.POSE_CONNECTIONS,
            landmark_drawing_spec=pose_style,
            connection_drawing_spec=pose_conn_style,
        )
    if results.left_hand_landmarks:
        drawing.draw_landmarks(
            out,
            results.left_hand_landmarks,
            hand_connections.HAND_CONNECTIONS,
            landmark_drawing_spec=hand_style,
            connection_drawing_spec=hand_conn_style,
        )
    if results.right_hand_landmarks:
        drawing.draw_landmarks(
            out,
            results.right_hand_landmarks,
            hand_connections.HAND_CONNECTIONS,
            landmark_drawing_spec=hand_style,
            connection_drawing_spec=hand_conn_style,
        )
    if results.face_landmarks:
        drawing.draw_landmarks(
            out,
            results.face_landmarks,
            face_connections.FACEMESH_CONTOURS,
            landmark_drawing_spec=face_style,
            connection_drawing_spec=face_conn_style,
        )
    return out


def _draw_skeleton_canvas(shape: Tuple[int, int], results: Any) -> np.ndarray:
    """生成黑底骨骼图。"""

    canvas = np.zeros((shape[0], shape[1], 3), dtype=np.uint8)
    canvas[:] = (18, 18, 18)
    return _draw_landmarks(canvas, results)


def _label_frame(image: np.ndarray, text: str, y: int = 30) -> np.ndarray:
    """给图像加标题。"""

    out = image.copy()
    label_y = max(12, out.shape[0] - 42)
    return _draw_text_overlay(out, text, position=(12, label_y), font_size=26)


def _concat_triptych(left: np.ndarray, mid: np.ndarray, right: np.ndarray) -> np.ndarray:
    """把三张图横向拼成一个三联图。"""

    target_h = min(left.shape[0], mid.shape[0], right.shape[0])

    def _resize(img: np.ndarray) -> np.ndarray:
        if img.shape[0] == target_h:
            return img
        scale = target_h / img.shape[0]
        width = int(img.shape[1] * scale)
        return cv2.resize(img, (width, target_h), interpolation=cv2.INTER_AREA)

    left = _resize(left)
    mid = _resize(mid)
    right = _resize(right)
    return np.hstack([left, mid, right])


def _make_contact_sheet(images: List[np.ndarray], cols: int = 2) -> Optional[np.ndarray]:
    """把多张图拼成联系表。"""

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


def visualize_video(
    video_path: Path,
    output_dir: Path,
    sample_every_n_frames: int,
    max_frames: int,
) -> Dict[str, Any]:
    """对一个视频生成可视化产物。"""

    drawing, _, _, _, holistic = _import_drawing_helpers()
    video_name = video_path.stem
    video_out = output_dir / video_name
    video_out.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频：{video_path}")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    frames: List[VizFrame] = []
    contact_images: List[np.ndarray] = []
    processed = 0
    frame_idx = 0

    with holistic.Holistic(
        static_image_mode=False,
        model_complexity=1,
        smooth_landmarks=True,
        enable_segmentation=False,
        refine_face_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as model:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_idx % sample_every_n_frames != 0:
                frame_idx += 1
                continue
            if processed >= max_frames:
                break

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = model.process(rgb)
            annotated = _draw_landmarks(frame, results)
            skeleton = _draw_skeleton_canvas(frame.shape[:2], results)

            text = (
                f"视频={video_name} | 帧={frame_idx} | 时间={frame_idx / fps:.2f}s | "
                f"姿态={bool(results.pose_landmarks)} | 左手={bool(results.left_hand_landmarks)} | "
                f"右手={bool(results.right_hand_landmarks)} | 面部={bool(results.face_landmarks)}"
            )
            original_l = _label_frame(frame, "原图")
            annotated_l = _label_frame(annotated, "关键点图")
            skeleton_l = _label_frame(skeleton, "骨骼图")
            triptych = _concat_triptych(original_l, annotated_l, skeleton_l)
            triptych = _label_frame(triptych, text)

            img_path = video_out / f"{video_name}_f{frame_idx:04d}_annotated.png"
            skel_path = video_out / f"{video_name}_f{frame_idx:04d}_skeleton.png"
            tri_path = video_out / f"{video_name}_f{frame_idx:04d}_triptych.png"
            cv2.imwrite(str(img_path), annotated)
            cv2.imwrite(str(skel_path), skeleton)
            cv2.imwrite(str(tri_path), triptych)

            contact_images.append(triptych)
            frames.append(
                VizFrame(
                    frame_idx=frame_idx,
                    timestamp_sec=frame_idx / fps,
                    image_path=str(img_path),
                    skeleton_path=str(skel_path),
                    triple_path=str(tri_path),
                    pose_present=bool(results.pose_landmarks),
                    left_hand_present=bool(results.left_hand_landmarks),
                    right_hand_present=bool(results.right_hand_landmarks),
                    face_present=bool(results.face_landmarks),
                )
            )
            processed += 1
            frame_idx += 1

    cap.release()

    sheet = _make_contact_sheet(contact_images, cols=2)
    sheet_path = video_out / f"{video_name}_contact_sheet.png"
    if sheet is not None:
        cv2.imwrite(str(sheet_path), sheet)

    result = {
        "video": str(video_path),
        "fps": fps,
        "sample_every_n_frames": sample_every_n_frames,
        "max_frames": max_frames,
        "frames": [frame.__dict__ for frame in frames],
        "contact_sheet": str(sheet_path) if sheet is not None else None,
    }
    (video_out / f"{video_name}_viz_summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    md_lines = [
        f"# {video_name} 特征可视化",
        "",
        f"- 视频路径：{video_path}",
        f"- 采样间隔：{sample_every_n_frames} 帧",
        f"- 最大采样帧数：{max_frames}",
        f"- 联系表：{sheet_path if sheet is not None else '(无)'}",
        "",
        "## 采样帧",
        "",
    ]
    for frame in frames:
        md_lines.append(f"### frame {frame.frame_idx}")
        md_lines.append(f"- 时间戳：{frame.timestamp_sec:.3f}s")
        md_lines.append(f"- 原图：{frame.image_path}")
        md_lines.append(f"- 骨骼图：{frame.skeleton_path}")
        md_lines.append(f"- 三联图：{frame.triple_path}")
        md_lines.append(f"- pose/left/right/face：{frame.pose_present}/{frame.left_hand_present}/{frame.right_hand_present}/{frame.face_present}")
        md_lines.append("")
    (video_out / f"{video_name}_viz_summary.md").write_text("\n".join(md_lines), encoding="utf-8")

    return result


def main(argv: Optional[Sequence[str]] = None) -> int:
    _configure_headless()

    parser = argparse.ArgumentParser(description="可视化 Holistic 特征检测结果")
    parser.add_argument("--video", action="append", required=True, help="输入视频，可重复传入多个")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="输出目录")
    parser.add_argument("--sample-every-n-frames", type=int, default=4, help="每隔多少帧取样一次")
    parser.add_argument("--max-frames", type=int, default=8, help="每个视频最多输出多少个采样帧")
    args = parser.parse_args(argv)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    results: List[Dict[str, Any]] = []
    for video in args.video:
        results.append(
            visualize_video(
                video_path=Path(video),
                output_dir=output_dir,
                sample_every_n_frames=args.sample_every_n_frames,
                max_frames=args.max_frames,
            )
        )

    summary = {
        "generated_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "output_dir": str(output_dir),
        "videos": results,
    }
    (output_dir / "visualization_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已生成可视化汇总：{output_dir / 'visualization_summary.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
