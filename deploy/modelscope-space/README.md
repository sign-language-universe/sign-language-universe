# Sign Language Universe Scoring API on ModelScope Space

这是用于 ModelScope 魔搭 Docker 创空间的最小后端部署包，服务内容是：

- FastAPI scoring API
- `/api/scoring/health`
- `/api/scoring/templates`
- `/api/scoring/score`
- 可选 Holistic worker warm-up：`/api/scoring/worker/warmup`

默认先关闭 Holistic worker，确保容器和 GitHub Pages 前端连接能快速跑通。确认容器资源足够后，再在创空间环境变量里启用 worker。

## 端口

Docker 创空间要求应用监听：

```text
0.0.0.0:7860
```

本镜像默认使用 `PORT=7860`。

## 环境变量

先用默认值跑通：

```text
SLU_ENABLE_HOLISTIC_WORKER=false
SLU_SCORING_OUTPUT_ROOT=/tmp/sign-language-universe/scoring-api
```

确认基础 API 正常后，再尝试：

```text
SLU_ENABLE_HOLISTIC_WORKER=true
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
