#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通过本地视觉模型（vLLM qwen3-vl-8b）批量定位 A-Z 教学资料卡中的
“示意图矩形区域”，并按归一化 bbox 裁剪生成只含示意图的图片。

用法示例：
  # 1) 仅分析：调用视觉模型逐张输出 bbox，结果写入 manifest JSON
  python3 scripts/crop_schematic_bbox.py --analyze --out work/schematic_crop_manifest.json
  # 2) 按已有 manifest 裁剪
  python3 scripts/crop_schematic_bbox.py --crop --manifest work/schematic_crop_manifest.json
  # 3) 一步完成：分析 + 裁剪 + 视觉抽检
  python3 scripts/crop_schematic_bbox.py --analyze --crop --verify --sample 5

说明：
- 坐标约定与 Qwen-VL grounding 一致：图像左上角 (0,0)，右下角 (1000,1000)，归一化。
- 裁剪输出默认写到 assets/content/illustrations/schematic-crops/，保留原始整图文件。
- 视觉请求直连本地 vLLM，不经过任何云端服务（隐私合规）。
"""
import argparse
import base64
import io
import json
import os
import re
import sys
import time

import requests

# 默认配置：视觉模型服务地址不硬编码内网地址，统一通过环境变量注入；
# 未设置时默认本机回环（--url / --api-base 可覆盖，供 CI/外部环境传入）。
DEFAULT_VLLM_URL = os.environ.get("SIGNLANG_VLLM_URL", "http://127.0.0.1:8000/v1")
DEFAULT_MODEL = os.environ.get("SIGNLANG_VLLM_MODEL", "qwen3-vl-8b")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ILLUST_DIR = os.path.join(PROJECT_ROOT, "apps", "web", "assets", "content", "illustrations")
DEFAULT_OUT_DIR = os.path.join(DEFAULT_ILLUST_DIR, "schematic-crops")

PROMPT_TEMPLATE = (
    "这是一张手语教学资料卡片的截图。卡片通常包含：顶部标题栏（大字词+拼音/释义）、"
    "'图解/视频'标签、中央的黑白线条简笔画教学示意图（可能带虚线运动箭头，可能带有矩形边框），"
    "以及示意图下方的中文动作描述文字。\n"
    "请找出中央“教学示意图”（黑白简笔画区域本身）的矩形边界框，要求："
    "只包含简笔画示意图，尽量排除顶部标题栏、标签和下方的文字说明；"
    "如果示意图外有矩形边框线，边框线可包含在内，但不要包含边框外的文字。\n"
    "使用归一化坐标输出（图像左上角为 (0,0)，右下角为 (1000,1000)），"
    "严格输出 JSON：{{\"schematic_bbox\": [x1, y1, x2, y2]}}，只输出 JSON，不要输出其他内容。"
)


def encode_image(path):
    """读取图片并编码为 base64 data URL。"""
    with open(path, "rb") as f:
        raw = f.read()
    mime = "image/jpeg" if path.lower().endswith((".jpeg", ".jpg")) else "image/png"
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"


def extract_json(text):
    """从模型输出中容错提取第一个 JSON 对象。"""
    if not text:
        return None
    # 去掉可能的 markdown 代码块围栏
    text = re.sub(r"```(?:json)?", "", text).strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def call_vision(url, model, image_path, retries=2, timeout=180):
    """调用 vLLM OpenAI 兼容接口，返回模型文本输出。"""
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": encode_image(image_path)}},
                    {"type": "text", "text": PROMPT_TEMPLATE},
                ],
            }
        ],
        "temperature": 0.0,
        "max_tokens": 512,
    }
    headers = {"Authorization": "Bearer not-needed"}
    last_err = None
    for attempt in range(1 + retries):
        try:
            resp = requests.post(
                f"{url}/chat/completions",
                json=payload,
                headers=headers,
                timeout=timeout,
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except Exception as e:  # noqa: BLE001 - 网络/服务异常统一重试
            last_err = e
            time.sleep(3 * attempt)
    raise RuntimeError(f"vision request failed for {image_path}: {last_err}")


def analyze(illust_dir, out_manifest, url, model, force=False):
    """逐张调用视觉模型，输出 bbox manifest。"""
    files = sorted(f for f in os.listdir(illust_dir) if f.endswith(".jpeg"))
    os.makedirs(os.path.dirname(os.path.abspath(out_manifest)), exist_ok=True)

    # 已有 manifest 且不强制重跑时，跳过已完成的条目
    existing = {}
    if not force and os.path.exists(out_manifest):
        with open(out_manifest, "r", encoding="utf-8") as f:
            existing = {e["file"]: e for e in json.load(f).get("entries", [])}

    entries = []
    for idx, fname in enumerate(files, 1):
        path = os.path.join(illust_dir, fname)
        if fname in existing and existing[fname].get("schematic_bbox"):
            print(f"[{idx}/{len(files)}] {fname}: 复用已有 bbox")
            entries.append(existing[fname])
            continue
        text = call_vision(url, model, path)
        parsed = extract_json(text)
        bbox = parsed.get("schematic_bbox") if parsed else None
        if not (isinstance(bbox, list) and len(bbox) == 4):
            print(f"[{idx}/{len(files)}] {fname}: 无法解析 bbox -> {text[:200]!r}")
            bbox = None
        entry = {"file": fname, "schematic_bbox": bbox, "raw_output": text[:500]}
        entries.append(entry)
        print(f"[{idx}/{len(files)}] {fname}: bbox={bbox}")
        time.sleep(0.5)  # 轻微限速，避免打满服务

    manifest = {
        "schema_version": "slu-schematic-crop-manifest-v1",
        "coordinate_system": "normalized_0_1000_top_left_origin",
        # source_dir 记录相对仓库根的路径，避免把本机绝对路径写进 manifest（跨机器可移植）
        "source_dir": os.path.relpath(illust_dir, PROJECT_ROOT),
        "entries": entries,
    }
    with open(out_manifest, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"manifest 已写入: {out_manifest}")
    return manifest


def crop(illust_dir, out_dir, manifest_path):
    """按 manifest 中的 bbox 批量裁剪。"""
    from PIL import Image

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    os.makedirs(out_dir, exist_ok=True)
    ok, skipped = 0, 0
    for entry in manifest["entries"]:
        fname = entry["file"]
        bbox = entry.get("schematic_bbox")
        src = os.path.join(illust_dir, fname)
        if not bbox:
            print(f"skip {fname}: 无 bbox")
            skipped += 1
            continue
        im = Image.open(src)
        w, h = im.size
        x1, y1, x2, y2 = [max(0.0, min(1000.0, float(v))) for v in bbox]
        # 归一化(0-1000) -> 像素坐标，并做 2% 内边距收缩容错（防止边框线误裁）
        pad = 0.0
        box = (
            int(w * x1 / 1000.0 - pad),
            int(h * y1 / 1000.0 - pad),
            int(w * x2 / 1000.0 + pad),
            int(h * y2 / 1000.0 + pad),
        )
        box = (
            max(0, box[0]), max(0, box[1]),
            min(w, box[2]), min(h, box[3]),
        )
        if box[2] - box[0] < 10 or box[3] - box[1] < 10:
            print(f"skip {fname}: bbox 过小 {box}")
            skipped += 1
            continue
        crop_im = im.crop(box)
        crop_im.save(os.path.join(out_dir, fname))
        print(f"crop {fname}: {im.size} -> {crop_im.size} box={box}")
        ok += 1
    print(f"裁剪完成: ok={ok} skipped={skipped} -> {out_dir}")
    return ok, skipped


def verify(out_dir, url, model, sample=3, seed=42):
    """视觉抽检裁剪结果是否只含示意图。"""
    import random

    from PIL import Image

    files = sorted(f for f in os.listdir(out_dir) if f.endswith(".jpeg"))
    if not files:
        print("无裁剪结果可抽检")
        return
    random.seed(seed)
    picked = random.sample(files, min(sample, len(files)))
    for fname in picked:
        path = os.path.join(out_dir, fname)
        im = Image.open(path)
        prompt = (
            "这张图片是从一张手语教学卡片中裁剪出来的‘教学示意图’区域。"
            "请检查：1) 是否只包含黑白简笔画示意图（人物/手势线条图），"
            "2) 是否混入了文字说明、标题栏或标签等其他内容，"
            "3) 示意图是否被截断（人物或关键动作线条被切掉）。"
            "用一句话结论回答，格式：{fname}: 结论"
        )
        text = call_vision(url, model, path)
        print(f"[verify] {fname} ({im.size[0]}x{im.size[1]}): {text[:300]}")
        time.sleep(0.5)


def main():
    ap = argparse.ArgumentParser(description="视觉定位并裁剪 A-Z 教学示意图")
    ap.add_argument("--illust-dir", default=DEFAULT_ILLUST_DIR)
    ap.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    ap.add_argument("--manifest", default=os.path.join(PROJECT_ROOT, "work", "schematic_crop_manifest.json"))
    ap.add_argument("--analyze", action="store_true", help="调用视觉模型定位 bbox")
    ap.add_argument("--crop", action="store_true", help="按 manifest 裁剪")
    ap.add_argument("--verify", action="store_true", help="裁剪后视觉抽检")
    ap.add_argument("--sample", type=int, default=3, help="抽检数量")
    ap.add_argument("--url", default=DEFAULT_VLLM_URL, help="vLLM OpenAI 兼容 API 地址")
    ap.add_argument("--api-base", dest="url", default=DEFAULT_VLLM_URL, help="--url 的别名（API base）")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--force", action="store_true", help="强制重跑分析")
    args = ap.parse_args()

    if not (args.analyze or args.crop):
        ap.error("请至少指定 --analyze 或 --crop 之一")

    if args.analyze:
        analyze(args.illust_dir, args.manifest, args.url, args.model, force=args.force)
    if args.crop:
        crop(args.illust_dir, args.out_dir, args.manifest)
    if args.verify:
        verify(args.out_dir, args.url, args.model, sample=args.sample)


if __name__ == "__main__":
    sys.exit(main())
