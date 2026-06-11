# AGENTS.md

## Project

本仓库是“手语学习宇宙”团队主仓库，包含学习前端、手语打分 API、评分核心算法、共享 API 契约和项目文档。

## Collaboration Rules

- 默认通过 Pull Request 合并代码，不允许直接 push 到 `main`。
- PR 必须关联 Issue，并写清测试结果和风险。
- 共享 API 契约变更必须同时通知 frontend 和 scoring owner。
- 大型生成物、日志、真实用户视频、Holistic cache 不进入 Git。
- 个人 Codex memory、tmux worker 状态、本机日志不进入 Git。

## Scoring Module Rules

- 手语打分模块来源于 `/data/WYC/signLanguage` 的核心算法和后端 demo。
- MediaPipe Holistic 初始化开销高，不要在每次请求中重复启动完整 pipeline；优先使用长驻 worker 或可复用服务。
- 评分流程按三层理解：候选/关键点生成、评分/选择策略、可视化/报告。
- 支持 `video_path` 和前端帧切片 `frame_slices` 两种输入形态时，应保持 API 参数显式。
- 回归验证优先使用轻量 smoke 和核心质量门；重型 Holistic 全量回归不要默认放到 GitHub-hosted CI。

## Frontend Rules

- 主前端位于 `apps/web/`。
- 调用评分服务必须通过共享 API 契约，不直接依赖评分模块内部文件。
- API base URL 通过环境变量或配置集中管理，不写死生产地址。

## Commands

- Python syntax check: `python -m compileall packages/scoring-core services/scoring-api scripts`
- Forbidden file check: `python scripts/ci/check_forbidden_files.py`
- Frontend static check: `test -f apps/web/index.html`

## Review Guidelines

- 优先关注 P0/P1 问题：数据泄露、破坏评分结果、API 不兼容、CI 失效、真实用户样本误入 Git。
- AI 生成代码必须由对应模块 owner 人工复核。
