# 团队主仓库初始化记录

日期：2026-06-11

## 仓库命名

```text
GitHub Org: sign-language-universe
Main Repo:  sign-language-universe
```

## 本地路径

```text
/data/WYC/sign-language-universe
```

## 已完成

- 创建 monorepo 基础目录。
- 导入团队前端静态 Demo 到 `apps/web/`。
- 导入手语打分 Demo 到 `apps/scoring-demo/`。
- 导入评分核心算法子集到 `packages/scoring-core/`。
- 创建评分 API 轻量骨架到 `services/scoring-api/app/main.py`。
- 创建 OpenAPI 契约。
- 添加 `AGENTS.md`、CODEOWNERS、PR/Issue 模板、GitHub Actions CI。
- 添加 forbidden file 检查，防止生成物、日志、视频和密钥误入 Git。

## 尚未完成

- GitHub Organization 需要在网页上创建。
- 当前环境没有 `gh` 命令，尚未创建远端仓库和 push。
- 前端尚未正式接入评分 API。
- 旧评分后端仍需拆分和配置化。
