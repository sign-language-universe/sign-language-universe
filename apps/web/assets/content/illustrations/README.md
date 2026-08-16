# A–Z 教学示意图

这 21 张图片来自项目提供的《标准 A–Z 顺序 21 词语义资料》中的教学示意页，按标准词序保存为 `word-01.jpeg` 至 `word-21.jpeg`。

这里只提取教学示意图，不包含私人志愿者视频、真人 landmark preview、用户编号或私有文件路径。图片与互动学习页的公开动作指导配套使用；正式公开发布前仍应确认资料图片的授权/再发布范围。

## schematic-crops/（仅示意图裁剪版）

`word-XX.jpeg` 原始资料卡包含顶部标题栏、图解/视频标签、中央黑白简笔画示意图和底部中文动作描述文字。其中文字部分在前端互动学习页已由语义合约（ordered/simultaneous 文本）完整呈现，无需重复展示，因此：

- `schematic-crops/word-XX.jpeg`：通过本地视觉模型（vLLM qwen3-vl-8b，服务地址由环境变量 `SIGNLANG_VLLM_URL` 注入）逐张定位示意图矩形区域后裁剪生成，只保留中央简笔画示意图（含运动虚线箭头），排除标题栏、标签与文字说明，前端展示更聚焦清晰。
- 前端 `interactive-learning.js` 默认加载裁剪版；若裁剪图缺失会回退到原始整页图。
- 裁剪 bbox（归一化坐标）记录于 `work/schematic_crop_manifest.json`（相对仓库根路径），可用 `scripts/crop_schematic_bbox.py` 复现/重跑。
