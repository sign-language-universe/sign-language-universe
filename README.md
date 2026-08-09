# 手语学习宇宙

团队主仓库，用于整合手语学习前端、手语打分服务、评分核心算法、共享 API 契约与项目协作文档。

## 当前模块

- `apps/web/`：团队前端静态 Demo，来源于已有 `sign-language-universe` 前端资料。
- `apps/scoring-demo/`：手语打分模块早期静态 Demo，来源于 `/data/WYC/signLanguage/work/web/static`。
- `packages/scoring-core/`：手语评分核心算法代码，来源于 `/data/WYC/signLanguage/work/scripts` 的可维护子集。
- `services/scoring-api/`：评分 API 服务入口，当前默认接收浏览器 Web Holistic 的 `landmark_rows`，并保留浏览器帧提交、可选 Holistic worker、服务器模板评分和降级预览评分。
- `apps/web` 互动学习实验室：提供中英双语动作指导、程序化动作示意，以及当前词汇内嵌的摄像头采集、评分、重试、下一词和成功反馈流程。
- `packages/shared-contracts/`：前后端共享 API 契约。
- `docs/`：产品、架构、评分模块、AI 上下文和运维文档。

## 默认线上方案

当前团队仓库默认采用：

```text
GitHub Pages 静态前端
  -> 浏览器 Web Holistic 提取 landmarks
  -> 前端 ModelScorer 轻量模型语义动作打分（onnxruntime-web WASM，无后端依赖）
     · BiLSTM 模型输出 47 个核心语义动作程度分（每词 1-7 个，稀疏激活）
     · 综合分 = 核心语义动作程度加权；练习建议聚焦最差语义动作
  -> 模型不可用时降级：scoring-core 本地加权 DTW 并集打分
  -> 可选：ModelScope lite Docker FastAPI 后端（服务端评分/回退路线）
```

- 前端默认打分（主）：轻量模型语义动作打分（`model-scoring.js` + `assets/model/*.onnx`），纯前端推理、无词判定干预；模型文件见 `apps/web/assets/model/`（action/word ONNX，~4.8MB each），推理库 `vendor/onnxruntime/` 本地同源。
- 前端默认采集参数：`3s / 10fps / 1280px`
- 连接评分 API 时优先上传 `landmark_rows`，不上传图片帧。
- `deploy/modelscope-space-lite/` 是可选线上演示后端，不安装 MediaPipe worker。
- `deploy/modelscope-space/` 保留为 full Docker 验证和服务端 Holistic worker 回退路线。
- 挑战模式覆盖全部 `47` 个学习词汇；互动学习 21 词已全部上线评分模板（DTW 兜底：每词 3 模板 top-2 均值 + 判别力组权重 + 包络软化），Python 校准与前端交叉验证 21/21 通过。
- 互动学习实验室当前不携带私人志愿者视频、切片、真人预览图或未授权 landmark 缓存；超市、人们（人民）、跳、汽车（一）已发布经人工审核的匿名 Avatar 自生成参考视频，评分模板由这些公开动画视频提取。

## 本地预览前端

```bash
cd apps/web
python -m http.server 5173
```

浏览器打开：

```text
http://127.0.0.1:5173
```

GitHub Pages 部署说明见：

```text
docs/operations/github_pages_frontend_deploy_manual_20260611.md
```

前端评分、Web Holistic、ModelScope lite API 与 GitHub Pages 部署说明见：

```text
docs/operations/scoring_frontend_holistic_worker_deploy_manual_20260611.md
```

ModelScope 魔搭 Docker 创空间部署评分 API 说明见：

```text
docs/operations/modelscope_holistic_deploy_manual_20260611.md
```

Public 仓库发布与 Apache-2.0 授权说明见：

```text
docs/operations/public_repository_release_manual_20260611.md
```

互动学习板块及公开数据边界见：

```text
docs/product/interactive_learning_module_20260805.md
```

GitHub CLI 本地安装与仓库管理说明见：

```text
docs/operations/github_cli_management_manual_20260611.md
```

团队开发、VS Code、PR 与 gh 日常协作流程见：

```text
docs/operations/team_development_workflow_manual_20260611.md
```

## 启动评分 API

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r services/scoring-api/requirements.txt
pip install -e packages/scoring-core
uvicorn app.main:app --app-dir services/scoring-api --host 127.0.0.1 --port 5080
```

健康检查：

```text
http://127.0.0.1:5080/api/scoring/health
```

## 协作规则

- 所有正式改动通过 Pull Request 合并。
- 主分支 `main` 受保护，不直接 push。
- 大型生成物、真实用户视频、Holistic cache、运行日志不进入 Git。
- 评分 API 变更必须同步更新 `packages/shared-contracts/openapi/scoring-api.yaml`。

## License

Unless otherwise noted, source code and project documentation are licensed under the Apache License, Version 2.0. See `LICENSE` and `NOTICE`.

Media, 3D models, generated assets, datasets, and third-party content may require separate provenance and license review before public redistribution.
