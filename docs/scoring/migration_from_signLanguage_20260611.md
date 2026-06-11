# 手语打分模块迁移记录

日期：2026-06-11

## 来源仓库

```text
/data/WYC/signLanguage
```

## 已迁入内容

- `work/scripts/score_holistic_sequence_mvp.py` -> `packages/scoring-core/scoring_core/score_holistic_sequence_mvp.py`
- `work/scripts/keyframe_sampling_common.py` -> `packages/scoring-core/scoring_core/keyframe_sampling_common.py`
- `work/scripts/signlanguage_common.py` -> `packages/scoring-core/scoring_core/signlanguage_common.py`
- `work/scripts/visualize_holistic_features.py` -> `packages/scoring-core/scoring_core/visualize_holistic_features.py`
- `work/scripts/holistic_worker_daemon.py` -> `services/scoring-api/app/holistic_worker_daemon.py`
- `work/web/backend.py` -> `services/scoring-api/app/legacy_backend.py`
- `work/web/static/` -> `apps/scoring-demo/static/`

## 暂不迁入内容

- `work/generated/`
- `work/logs/`
- `.codex/tmux-workers/`
- 真实用户视频、Holistic cache、web replay 结果。
- 大量 DOCX/PDF/PPTX 历史资料。

## 当前状态

- `services/scoring-api/app/main.py` 是新的轻量 API 骨架。
- `legacy_backend.py` 保留旧实现，后续拆分其中的 worker 生命周期管理、模板路径、输出路径和 scoring 调用。
- `packages/scoring-core` 中仍有部分旧默认路径，后续需要改为配置化。

## 下一步

1. 确认正式后端入口应基于 `backend.py` 还是 `backend_v4.py`。
2. 将模板根目录、语义 profile 和输出目录配置化。
3. 用 mock Holistic JSON 增加轻量评分测试。
4. 将前端 `apps/web` 的算法预留点改为调用 `/api/scoring/score`。
