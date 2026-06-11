# GitHub 团队组织与仓库创建操作手册

日期：2026-06-11  
目标 Organization：`sign-language-universe`  
目标主仓库：`sign-language-universe`  
本地仓库：`/data/WYC/sign-language-universe`

## 0. 当前状态

本地团队主仓库已经初始化完成：

```bash
cd /data/WYC/sign-language-universe
git status
git log --oneline -3
git remote -v
```

当前本地提交：

```text
85f80f7 chore: initialize sign-language-universe monorepo
```

当前远端地址已预设为：

```text
git@github.com:sign-language-universe/sign-language-universe.git
```

但 GitHub 网页上的 Organization 和远端仓库还没有创建，所以现在不要直接 `git push`，需要先完成下面步骤。

## 1. 创建 GitHub Organization

### 1.1 打开创建页面

浏览器访问：

```text
https://github.com/organizations/new
```

### 1.2 填写组织信息

建议填写：

```text
Organization account name: sign-language-universe
Contact email: 使用你的常用邮箱或项目邮箱
This organization belongs to: My personal account
```

计划选择：

```text
Free
```

第一阶段使用 Free plan 足够完成私有仓库、团队成员协作、Issue、PR、Actions 基础 CI。

### 1.3 创建后检查

创建成功后，浏览器应能访问：

```text
https://github.com/sign-language-universe
```

如果名称已被占用，备选名称建议：

```text
sign-language-learning-universe
sign-learning-universe
slu-lab
```

如果改用备选名称，必须同步修改本地远端地址和 CODEOWNERS 中的团队路径。

## 2. 创建主仓库

### 2.1 在 Organization 下创建仓库

进入：

```text
https://github.com/organizations/sign-language-universe/repositories/new
```

填写：

```text
Repository name: sign-language-universe
Description: Team monorepo for Sign Language Universe learning platform and scoring service.
Visibility: Private
```

重要：

- 不要勾选 `Add a README file`
- 不要添加 `.gitignore`
- 不要添加 license

原因：本地仓库已经有完整初始化内容。远端必须是空仓库，避免首次 push 产生无意义冲突。

### 2.2 创建后检查

创建成功后，页面应显示类似：

```text
Quick setup — if you've done this kind of thing before
```

远端仓库地址应为：

```text
git@github.com:sign-language-universe/sign-language-universe.git
```

或：

```text
https://github.com/sign-language-universe/sign-language-universe.git
```

## 3. 推送本地仓库

### 3.1 优先使用 SSH

在服务器运行：

```bash
cd /data/WYC/sign-language-universe
git push -u origin main
```

如果成功，说明当前服务器 SSH key 已经授权 GitHub。

### 3.2 如果 SSH 推送失败

常见报错：

```text
Permission denied (publickey)
```

此时改用 HTTPS：

```bash
cd /data/WYC/sign-language-universe
git remote set-url origin https://github.com/sign-language-universe/sign-language-universe.git
git push -u origin main
```

GitHub 现在通常需要 Personal Access Token，而不是密码。若提示输入密码，应使用 token。

### 3.3 推送后检查

浏览器打开：

```text
https://github.com/sign-language-universe/sign-language-universe
```

应该能看到：

- `README.md`
- `AGENTS.md`
- `apps/web/`
- `services/scoring-api/`
- `packages/scoring-core/`
- `packages/shared-contracts/`
- `.github/`

## 4. 创建团队

进入 Organization：

```text
https://github.com/orgs/sign-language-universe/teams
```

创建以下团队：

```text
maintainers
frontend
scoring
content
qa
```

建议职责：

- `maintainers`
  - 仓库设置、分支保护、权限、release。
- `frontend`
  - `apps/web/` 前端页面和交互。
- `scoring`
  - `packages/scoring-core/` 和 `services/scoring-api/`。
- `content`
  - 词汇内容、教学资料、课程素材。
- `qa`
  - 测试、体验反馈、验收。

## 5. 邀请成员

进入：

```text
https://github.com/orgs/sign-language-universe/people
```

点击 `Invite member`。

收集每个成员的 GitHub 用户名后，按角色加入团队。

第一阶段权限建议：

```text
maintainers: Maintain 或 Admin
frontend: Write
scoring: Write
content: Write
qa: Triage 或 Write
```

不要给所有人 Admin。

## 6. 设置仓库权限

进入仓库：

```text
https://github.com/sign-language-universe/sign-language-universe/settings/access
```

给团队授权：

```text
maintainers -> Maintain
frontend -> Write
scoring -> Write
content -> Write
qa -> Triage
```

如果 GitHub 页面要求先邀请成员进入 Organization，再给团队授权，按页面提示操作即可。

## 7. 设置 main 分支保护

进入：

```text
https://github.com/sign-language-universe/sign-language-universe/settings/branches
```

添加 branch protection rule：

```text
Branch name pattern: main
```

建议启用：

- `Require a pull request before merging`
- `Require approvals`
  - 第一阶段设为 `1`
- `Require review from Code Owners`
- `Require status checks to pass before merging`
- `Require branches to be up to date before merging`
- `Do not allow bypassing the above settings`
- `Restrict who can push to matching branches`
- 禁止 force push
- 禁止删除分支

如果 CI 第一次还没有跑通，可先不强制 status checks；等 GitHub Actions 成功跑过一次后，再回来把 `CI / baseline` 加为 required check。

## 8. 检查 GitHub Actions

推送后打开：

```text
https://github.com/sign-language-universe/sign-language-universe/actions
```

应看到 workflow：

```text
CI
```

它会运行：

```bash
python scripts/ci/check_forbidden_files.py
python -m compileall packages/scoring-core services/scoring-api scripts
test -f apps/web/index.html
```

如果 Actions 被 GitHub 默认禁用，在页面中点击启用。

## 9. 创建 Project 看板

进入 Organization Projects：

```text
https://github.com/orgs/sign-language-universe/projects
```

创建：

```text
手语学习宇宙开发看板
```

建议字段：

```text
Status: Backlog / Ready / In Progress / Review / Blocked / Done
Area: frontend / scoring / integration / content / backend / infra / docs
Priority: P0 / P1 / P2 / P3
Milestone: M0 Repo Scaffold / M1 Scoring Import / M2 Frontend Merge / M3 Integration / M4 Demo Release
```

## 10. 创建 labels

进入：

```text
https://github.com/sign-language-universe/sign-language-universe/labels
```

建议创建：

```text
area/frontend
area/scoring
area/integration
area/content
area/backend
area/infra
area/docs

type/feature
type/bug
type/refactor
type/test
type/docs
type/chore

priority/P0
priority/P1
priority/P2
priority/P3

status/blocked
status/needs-design
status/needs-review

ai-candidate
good-first-issue
```

## 11. 创建第一批 Issues

建议创建以下 Issues：

```text
M0: 配置 main 分支保护和团队权限
M1: 前端接入 /api/scoring/templates
M1: 前端接入 /api/scoring/score
M1: 拆分 legacy_backend.py 中的 Holistic worker
M1: 将 scoring-core 默认路径改为配置化
M1: 添加 mock Holistic JSON 轻量评分测试
M2: 建立第一个可演示评分闭环
```

每个 Issue 至少写：

- 目标
- 验收标准
- 负责人
- 相关目录
- 测试方式

## 12. 推荐第一次 PR 流程测试

远端仓库推送成功后，建议不要马上让所有人直接改 `main`，先做一次流程演练。

本地创建分支：

```bash
cd /data/WYC/sign-language-universe
git checkout -b docs/test-pr-flow
```

修改一个小文档，例如：

```text
docs/product/repository_setup_20260611.md
```

提交并推送：

```bash
git add docs/product/repository_setup_20260611.md
git commit -m "docs: test pull request workflow"
git push -u origin docs/test-pr-flow
```

然后在 GitHub 网页创建 PR，确认：

- CODEOWNERS 是否触发。
- CI 是否运行。
- PR 模板是否显示。
- review 和 merge 流程是否符合预期。

## 13. 常见问题

### 13.1 push 提示 repository not found

可能原因：

- Organization 没创建。
- 仓库没创建。
- 仓库名拼错。
- 你没有权限。
- SSH key 没绑定到对应 GitHub 账号。

检查：

```bash
git remote -v
```

### 13.2 push 提示 Permission denied publickey

说明 SSH key 未授权。解决方式：

- 给 GitHub 账号添加服务器公钥。
- 或改用 HTTPS remote。

### 13.3 GitHub 提示 main 已有提交，无法推送

说明创建仓库时勾选了 README 或 license。

处理方式：

- 最简单：删除远端仓库，重新创建空仓库。
- 或者本地 `git pull --rebase origin main` 后解决冲突，但第一阶段不推荐。

### 13.4 CODEOWNERS 不生效

检查：

- 文件路径必须是 `.github/CODEOWNERS`。
- 团队必须真实存在。
- 团队名必须匹配 `@sign-language-universe/<team-name>`。
- 仓库必须给团队访问权限。

## 14. 完成标准

当以下事项都完成，就可以认为团队 GitHub 协作基础建好了：

- Organization `sign-language-universe` 存在。
- 仓库 `sign-language-universe` 存在。
- 本地 `main` 已 push 到远端。
- 成员已加入 Organization。
- Teams 已创建并授权。
- `main` 分支保护已开启。
- GitHub Actions CI 至少成功运行一次。
- 第一个测试 PR 成功走完 review + merge。
