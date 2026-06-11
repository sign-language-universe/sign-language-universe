---
# 详细文档见https://modelscope.cn/docs/%E5%88%9B%E7%A9%BA%E9%97%B4%E5%8D%A1%E7%89%87
domain:
- cv
tags:
- sign-language
- scoring
- fastapi
- mediapipe
datasets:
  evaluation:
  test:
  train:
models:
license: Apache License 2.0
---

# Sign Language Universe Scoring API on ModelScope Space

这是用于 ModelScope 魔搭 Docker 创空间的最小后端部署包，服务内容是：

- FastAPI scoring API
- `/api/scoring/health`
- `/api/scoring/templates`
- `/api/scoring/score`
- 可选 Holistic worker warm-up：`/api/scoring/worker/warmup`

默认启动 Holistic worker，用于直接验证 ModelScope CPU 创空间是否能承载 MediaPipe Holistic。若资源不足或启动失败，可在创空间环境变量里显式关闭 worker。

Dockerfile 固定使用 `mediapipe==0.10.18`，因为新版 MediaPipe 已不再暴露当前 worker 使用的 legacy `mp.solutions.holistic` 接口。

生成创空间 bundle 时，如果本机存在旧仓库模板目录，`create_bundle.py` 会默认复制：

```text
/data/WYC/signLanguage/work/generated/scoring_mvp_run3/all_demo_step2_worker_cache_semantic_v1/results
/data/WYC/signLanguage/work/generated/scoring_semantic_profiles/sign_semantic_weights.json
```

容器内默认路径为：

```text
SLU_TEMPLATE_ROOT=/app/templates/holistic
SLU_SEMANTIC_PROFILE_JSON=/app/templates/sign_semantic_weights.json
```

模板存在时，评分模式会从 `holistic_capture_quality` 切换为 `holistic_template_similarity`，调用 `score_holistic_sequence_mvp.run_pair()` 的 DTW/semantic prototype scoring 路径。模板不存在时仍会返回捕获质量分。

## 端口

Docker 创空间要求应用监听：

```text
0.0.0.0:7860
```

本镜像默认使用 `PORT=7860`。

## 环境变量

默认值会启动 worker：

```text
SLU_ENABLE_HOLISTIC_WORKER=true
SLU_SCORING_OUTPUT_ROOT=/tmp/sign-language-universe/scoring-api
```

如需先只验证基础 API，可显式关闭：

```text
SLU_ENABLE_HOLISTIC_WORKER=false
```

如果你有服务器侧模板 JSON，可额外设置：

```text
SLU_TEMPLATE_ROOT=/path/to/templates/holistic
SLU_SEMANTIC_PROFILE_JSON=/path/to/sign_semantic_weights.json
```

公开创空间不建议放真实用户视频、生成缓存、大型模板或隐私数据。

## 测试

部署后访问：

```text
<your-modelscope-space-url>/
<your-modelscope-space-url>/api/scoring/health
<your-modelscope-space-url>/docs
```

启用 worker 后可预热：

```bash
curl -X POST '<your-modelscope-space-url>/api/scoring/worker/warmup?wait_for_ready_sec=180'
```

返回 `status=ok` 表示 worker 启动并响应 ping。返回 `status=error` 时，先看创空间日志；通常是 CPU/内存不足、MediaPipe 初始化过慢或系统依赖问题。

## 连接 GitHub Pages 前端

在 GitHub Pages 页面挑战模式中，将“评分 API 地址”填为：

```text
<your-modelscope-space-url>
```

也可以使用 URL 参数：

```text
https://sign-language-universe.github.io/sign-language-universe/?api=<your-modelscope-space-url>
```

注意不要在末尾加 `/api/scoring`，前端会自动拼接接口路径。
