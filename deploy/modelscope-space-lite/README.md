---
# 详细文档见https://modelscope.cn/docs/%E5%88%9B%E7%A9%BA%E9%97%B4%E5%8D%A1%E7%89%87
domain:
- cv
tags:
- sign-language
- scoring
- fastapi
- web-holistic
datasets:
  evaluation:
  test:
  train:
models:
license: Apache License 2.0
---

# Sign Language Universe Lite Scoring API

这是当前推荐线上演示使用的 ModelScope 魔搭 Docker 创空间轻量后端部署包。

它面向 GitHub Pages 前端的浏览器 Holistic 路线：

- 浏览器本机提取 MediaPipe Holistic landmarks。
- 前端只向后端上传 `landmark_rows`，不上传图片帧。
- 后端只负责读取旧模板 JSON，并调用 `score_holistic_sequence_mvp.run_pair()` 做 DTW/semantic prototype scoring。

## 与原版 Docker 创空间的区别

保留原来的 `deploy/modelscope-space` 不变；原版仍可安装并启用服务端 Holistic worker。

本 lite 版本默认：

- 不安装 `mediapipe`
- 不安装 `opencv-python-headless`
- 不安装 `Pillow`
- 不安装 `libgl1` / `libglib2.0-0` 等图像处理系统依赖
- `SLU_ENABLE_HOLISTIC_WORKER=false`

因此它应该更适合快速构建、快速启动和低资源运行。代价是：如果前端回退到 `frame_slices` 图片帧路径，lite 后端不会做服务端 Holistic 识别，只会返回浏览器预览 fallback 分。

## 端口

Docker 创空间要求应用监听：

```text
0.0.0.0:7860
```

本镜像默认使用 `PORT=7860`。

## 环境变量

默认值：

```text
SLU_ENABLE_HOLISTIC_WORKER=false
SLU_TEMPLATE_ROOT=/app/templates/holistic
SLU_SEMANTIC_PROFILE_JSON=/app/templates/sign_semantic_weights.json
SLU_SCORING_OUTPUT_ROOT=/tmp/sign-language-universe/scoring-api
```

生成创空间 bundle 时，如果本机存在旧仓库模板目录，`create_bundle.py` 会默认复制：

```text
/data/WYC/signLanguage/work/generated/scoring_mvp_run3/all_demo_step2_worker_cache_semantic_v1/results
/data/WYC/signLanguage/work/generated/scoring_semantic_profiles/sign_semantic_weights.json
```

## 测试

部署后访问：

```text
<your-modelscope-space-url>/
<your-modelscope-space-url>/api/scoring/health
<your-modelscope-space-url>/api/scoring/templates
<your-modelscope-space-url>/docs
```

期望 health 至少包含：

```json
{
  "version": "0.3.0",
  "worker_enabled": false,
  "template_root_configured": true
}
```

## 连接 GitHub Pages 前端

当前 `apps/web` 已默认连接正式 lite 创空间：

```text
https://scottwyc-sign-language-universe-lite.ms.show
```

如果新建了另一个 lite 创空间，才需要在 GitHub Pages 页面挑战模式中手动覆盖“评分 API 地址”：

```text
<your-lite-modelscope-space-url>
```

也可以使用 URL 参数：

```text
https://sign-language-universe.github.io/sign-language-universe/?api=<your-lite-modelscope-space-url>
```

注意不要在末尾加 `/api/scoring`，前端会自动拼接接口路径。
