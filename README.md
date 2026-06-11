# 手语学习宇宙

团队主仓库，用于整合手语学习前端、手语打分服务、评分核心算法、共享 API 契约与项目协作文档。

## 当前模块

- `apps/web/`：团队前端静态 Demo，来源于已有 `sign-language-universe` 前端资料。
- `apps/scoring-demo/`：手语打分模块早期静态 Demo，来源于 `/data/WYC/signLanguage/work/web/static`。
- `packages/scoring-core/`：手语评分核心算法代码，来源于 `/data/WYC/signLanguage/work/scripts` 的可维护子集。
- `services/scoring-api/`：评分 API 服务入口。当前包含新的轻量 API 骨架和旧后端 `legacy_backend.py`。
- `packages/shared-contracts/`：前后端共享 API 契约。
- `docs/`：产品、架构、评分模块、AI 上下文和运维文档。

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

Public 仓库发布与 Apache-2.0 授权说明见：

```text
docs/operations/public_repository_release_manual_20260611.md
```

GitHub CLI 本地安装与仓库管理说明见：

```text
docs/operations/github_cli_management_manual_20260611.md
```

## 启动评分 API 骨架

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
