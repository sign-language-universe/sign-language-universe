# scoring-api

手语评分 API 服务。

当前 `app/main.py` 是团队主仓库的评分 API 入口，提供：

- `GET /api/scoring/health`
- `GET /api/scoring/templates`
- `POST /api/scoring/score`

当前推荐线上方案是：GitHub Pages 前端在浏览器中运行 Web Holistic，向本服务提交 `landmark_rows`；ModelScope lite Docker 后端读取模板库并运行旧评分算法。`app/main.py` 也保留 `app/holistic_worker_daemon.py` 常驻 Holistic worker，用于 full Docker 或自托管服务器回退验证。

服务按以下顺序评分：

1. 已配置 `SLU_TEMPLATE_ROOT` 且请求包含 `landmark_rows`：直接和服务器模板 JSON 做原型相似度评分，返回 `web_holistic_template_similarity`。
2. 已配置 `SLU_TEMPLATE_ROOT` 且请求为 `frame_slices`：在 full 后端中可由 worker 抽取用户帧 Holistic，再做模板相似度评分。
3. 未配置模板但存在浏览器或 worker 关键点：返回 Holistic 捕获质量分。
4. worker 不可用、模板缺失或依赖未安装：返回明确标注的 fallback 分，并在 `diagnostics.scoring_mode` 标明原因。

`app/legacy_backend.py` 是旧后端入口，仅用于追溯和后续拆解，不建议直接作为团队生产入口。

## 本地启动

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r services/scoring-api/requirements.txt
pip install -e packages/scoring-core
uvicorn app.main:app --app-dir services/scoring-api --host 127.0.0.1 --port 5080
```

## 环境变量

```bash
# 显式启用服务端 Holistic worker；ModelScope lite 默认 false
export SLU_ENABLE_HOLISTIC_WORKER=true

# worker 输出目录，默认是 work/generated/scoring-api
export SLU_SCORING_OUTPUT_ROOT=/srv/sign-language-universe/work/generated/scoring-api

# 可选：服务器上的 Holistic 模板 JSON 目录，不进入 Git
export SLU_TEMPLATE_ROOT=/srv/sign-language-universe/templates/holistic

# 可选：语义权重配置，不进入 Git
export SLU_SEMANTIC_PROFILE_JSON=/srv/sign-language-universe/templates/sign_semantic_weights.json
```

如果使用 GitHub Pages 前端，后端需要单独部署到支持 HTTPS 的服务器或容器平台。当前默认使用 ModelScope lite API：`https://scottwyc-sign-language-universe-lite.ms.show`。Pages 不能运行 FastAPI、MediaPipe 或常驻 worker。

## 下一步

- 在服务器侧准备 `SLU_TEMPLATE_ROOT` 模板目录，模板数据不进入公开 Git 仓库。
- 为评分 API 配置 HTTPS 反向代理，供 GitHub Pages 前端调用。
- 用真实用户样本和人工标注继续校准 `prototype_score`。
