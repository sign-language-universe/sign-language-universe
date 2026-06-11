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

点击 `New team`，创建以下团队：

```text
maintainers
frontend
scoring
content
qa
```

每个团队建议这样填写：

```text
Team name: maintainers / frontend / scoring / content / qa
Description: 简短写明职责
Parent team: 暂不设置
Visibility: Visible
```

这里建议选择 `Visible`，不要选 `Secret`。原因是当前仓库的 `.github/CODEOWNERS` 使用了 `@sign-language-universe/<team>` 这种团队 owner 写法；GitHub 要求作为 CODEOWNERS 的 team 必须可见，并且必须对仓库有写权限。

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

建议先把你自己加入 `maintainers`，并保留 Organization owner 权限。其他成员原则上不要直接给 owner 或 admin，先通过 team 管理权限。

### 4.1 组织层级和权限模型

可以把 GitHub Organization 理解成团队协作的总容器。第一阶段推荐使用的层级是：

```text
Organization
  -> Team
    -> Member
```

对应到当前项目就是：

```text
sign-language-universe
  -> maintainers
    -> 仓库维护成员
  -> frontend
    -> 前端开发成员
  -> scoring
    -> 手语评分/算法/API 成员
  -> content
    -> 内容和课程资料成员
  -> qa
    -> 测试和验收成员
```

成员关系和仓库权限是两件事：

```text
Organization
  -> 管理人和 team 的组织关系

Repository
  -> 授权给 team
  -> team 内成员继承该 team 的仓库权限
```

也就是说，不建议给每个成员单独配置仓库权限，而是：

```text
1. 先把成员加入 Organization
2. 再把成员放入对应 Team
3. 再给 Team 配置 Repository 权限
4. 成员自动获得该 Team 对仓库的权限
```

示例：

```text
frontend team 对 sign-language-universe 仓库有 Write 权限
  -> alice 加入 frontend
  -> alice 自动获得该仓库 Write 权限

qa team 对 sign-language-universe 仓库有 Triage 权限
  -> dave 加入 qa
  -> dave 自动获得该仓库 Triage 权限
```

这样做的好处：

- 新成员只需要加入对应 team，不需要逐个仓库单独授权。
- 成员职责变化时，只需要调整 team 归属。
- 成员离开项目时，从 Organization 或 team 移除即可回收权限。
- `CODEOWNERS` 可以按 team 自动请求 review，而不是依赖单个人。

补充说明：

- GitHub 也支持嵌套 team，但本项目第一阶段不需要使用。
- Organization owner 是组织级管理员，不等同于普通项目成员。
- Repository Admin 是单个仓库的最高权限，也不应该默认给所有成员。
- 推荐长期成员使用 `Organization member + team`，临时外部协作者再考虑 `Outside collaborator`。

## 5. 邀请成员

进入：

```text
https://github.com/orgs/sign-language-universe/people
```

点击 `Invite member`。

收集每个成员的 GitHub 用户名后，按角色加入团队。建议先让每个人发给你以下信息：

```text
姓名:
GitHub username:
主要负责模块: frontend / scoring / content / qa / maintainers
是否需要直接改代码: yes / no
是否需要参与 review: yes / no
```

### 5.1 推荐加入顺序

推荐按这个顺序操作：

```text
1. 先邀请成员加入 Organization
2. 成员接受邀请
3. 把成员加入对应 team
4. 给 team 配置仓库权限
5. 用测试 PR 验证 review 和 CODEOWNERS 是否生效
```

不要一开始就把成员作为个人 collaborator 单独加到仓库。团队协作应优先使用 Organization team 管理权限，这样后续换人、转岗、移除权限都更清晰。

### 5.2 邀请成员加入 Organization

操作入口：

```text
Organization -> People -> Invite member
```

也可以直接打开：

```text
https://github.com/orgs/sign-language-universe/people
```

操作步骤：

1. 点击 `Invite member`。
2. 输入成员的 GitHub username 或邮箱。
3. 选择普通 `Member`，不要选择 `Owner`。
4. 如果页面允许直接选择 team，可以同时勾选对应 team。
5. 发送邀请。
6. 等成员在邮箱或 GitHub 通知中接受邀请。

角色建议：

```text
普通开发/内容/测试成员 -> Member
项目负责人/仓库治理负责人 -> Owner，人数控制在 1-2 人
```

`Owner` 拥有 Organization 级别管理权限，包括成员管理、仓库删除、权限变更等。除非确实需要共同管理整个组织，否则不要给 `Owner`。

### 5.3 成员接受邀请后加入 team

如果邀请时没有直接勾选 team，成员接受邀请后再手动加入。

操作入口：

```text
Organization -> Teams -> 选择 team -> Members -> Add a member
```

也可以直接打开：

```text
https://github.com/orgs/sign-language-universe/teams/frontend
https://github.com/orgs/sign-language-universe/teams/scoring
https://github.com/orgs/sign-language-universe/teams/content
https://github.com/orgs/sign-language-universe/teams/qa
https://github.com/orgs/sign-language-universe/teams/maintainers
```

操作步骤：

1. 打开对应 team 页面。
2. 点击 `Members`。
3. 点击 `Add a member`。
4. 搜索成员 GitHub username。
5. 选择成员并确认。
6. 如果某人跨模块工作，可以加入多个 team。

示例：

```text
做首页、学习页、练习页前端 -> frontend
做手语打分算法、评分 API -> scoring
做词汇库、课程文案、教学资料 -> content
做测试验收、问题复现 -> qa
负责仓库设置、发版、权限和 CI -> maintainers
```

### 5.4 team 内角色：Member 与 Maintainer

GitHub team 内还有两个常用角色：

```text
Team member
Team maintainer
```

建议：

```text
普通成员 -> Team member
每个方向的小负责人 -> Team maintainer
```

`Team maintainer` 可以管理该 team 的成员和部分 team 设置，但不是整个 Organization owner。比如：

```text
frontend 方向负责人 -> frontend team maintainer
scoring 方向负责人 -> scoring team maintainer
content 方向负责人 -> content team maintainer
```

这样以后前端组加新人，不一定每次都要 Organization owner 操作。

### 5.5 当前项目的推荐分组

第一阶段建议按下面方式分：

```text
你:
  Organization owner
  maintainers
  scoring

前端页面同学:
  frontend

手语评分/算法同学:
  scoring

课程内容/资料整理同学:
  content

测试/体验反馈同学:
  qa

可以帮忙统一 review 和合并的人:
  maintainers
```

如果一个成员既做前端又做内容，可以同时加入：

```text
frontend
content
```

### 5.6 不建议使用 Outside collaborator

`Outside collaborator` 适合临时访问单个仓库的人，但不适合作为长期团队协作方式。

本项目第一阶段建议：

```text
长期团队成员 -> Organization member + team
临时外部审阅者 -> 必要时再考虑 outside collaborator
```

原因：

- outside collaborator 不能加入 Organization team。
- 不能很好配合当前 `.github/CODEOWNERS` 的团队 review。
- 权限管理会分散到个人，不利于后续规模化协作。

### 5.7 按角色加入团队的具体例子

假设有以下成员：

```text
alice: 做前端页面
bob: 做课程内容
carol: 做打分 API
dave: 做测试
erin: 协助管理仓库
```

具体操作：

```text
alice -> 加入 frontend
bob -> 加入 content
carol -> 加入 scoring
dave -> 加入 qa
erin -> 加入 maintainers
```

如果 `alice` 还负责合并前端 PR，可以设置：

```text
alice -> frontend team maintainer
```

如果 `carol` 还负责评分模块 review：

```text
carol -> scoring team maintainer
```

第一阶段权限建议：

```text
maintainers: Maintain 或 Admin
frontend: Write
scoring: Write
content: Write
qa: Triage 或 Write
```

不要给所有人 Admin。

### 5.8 成员加入后的检查

每加完一个成员，检查三件事：

1. Organization `People` 页面能看到该成员。
2. 对应 `Teams -> Members` 页面能看到该成员。
3. 仓库 `Settings -> Collaborators & teams` 能看到对应 team 有正确权限。

对于 `frontend`、`scoring` 这类写在 `.github/CODEOWNERS` 里的 team，还必须满足：

```text
team 是 Visible
team 对仓库至少有 Write 权限
CODEOWNERS 中 team 名称拼写一致
```

当前仓库使用的 CODEOWNERS team 是：

```text
@sign-language-universe/maintainers
@sign-language-universe/frontend
@sign-language-universe/scoring
```

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

操作步骤：

1. 打开仓库页面。
2. 进入 `Settings`。
3. 进入 `Collaborators & teams` 或 `Manage access`。
4. 点击 `Add teams`。
5. 搜索并选择 team。
6. 选择权限级别。
7. 保存。

### 6.1 权限级别怎么选

GitHub 仓库常见权限从低到高大致是：

```text
Read
Triage
Write
Maintain
Admin
```

建议含义：

```text
Read:
  只能看代码，适合旁观学习或只读成员。

Triage:
  可以管理 Issue 和 PR 的标签、里程碑、分配等，但不能直接 push 代码。
  适合 qa、产品、内容验收角色。

Write:
  可以 push 分支、创建 PR、参与代码开发。
  适合 frontend、scoring、content 中需要直接提交代码的人。

Maintain:
  可以管理仓库但不能访问最危险的设置。
  适合仓库维护者、发版负责人。

Admin:
  可以改仓库设置、权限、分支保护、删除仓库等。
  只给极少数负责人。
```

当前项目推荐：

```text
maintainers -> Maintain
frontend -> Write
scoring -> Write
content -> Write
qa -> Triage
```

如果开启 `Require review from Code Owners`，注意：

```text
frontend 和 scoring 必须是 Write 或更高
maintainers 必须是 Write 或更高
```

否则 CODEOWNERS 可能不会触发，或者触发后无法作为有效 review。

## 7. 设置 main 分支保护

进入：

```text
https://github.com/sign-language-universe/sign-language-universe/settings/branches
```

添加 branch protection rule：

```text
Branch name pattern: main
```

### 7.1 为什么要保护 main

`main` 是团队主线。保护它的目的不是增加流程负担，而是防止以下问题：

- 成员直接 push 导致别人代码被覆盖。
- 未经 review 的代码进入主线。
- CI 失败的代码进入主线。
- 生成物、日志、真实用户视频或密钥误入主线。
- 不同模块的负责人不知道自己负责的目录被改了。
- force push 改写历史，导致团队成员本地仓库混乱。

GitHub 官方 branch protection rule 可以对匹配分支设置合并条件，例如要求 PR、review、status checks，默认也会阻止删除分支和 force push。

### 7.2 推荐入口

对当前仓库，建议使用传统 branch protection rule：

```text
Repository -> Settings -> Branches -> Branch protection rules -> Add rule
```

如果 GitHub 页面提示你使用 `Rulesets`，也可以使用：

```text
Repository -> Settings -> Rules -> Rulesets -> New branch ruleset
```

但第一阶段建议优先用 `Branch protection rule`，原因是配置简单，适合单仓库、单主分支。

### 7.3 必填项

填写：

```text
Branch name pattern: main
```

这表示规则只保护 `main` 分支。

### 7.4 推荐开启的选项

建议启用以下选项：

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

### 7.5 每个选项的含义和建议

#### Require a pull request before merging

含义：

- 不能直接把 commit push 到 `main`。
- 所有改动必须先推到功能分支，再创建 Pull Request。

建议：

- 必开。
- 这是团队协作的基础。

#### Require approvals

含义：

- PR 至少需要指定数量的 approval 才能 merge。

建议：

```text
Required approvals: 1
```

第一阶段团队人少，设为 `1` 即可。后续如果评分算法、用户数据、部署脚本变重要，可以升到 `2`。

#### Dismiss stale pull request approvals when new commits are pushed

含义：

- PR 已经被批准后，如果作者又 push 新 commit，旧 approval 会失效，需要重新 review。

建议：

- 第一阶段建议开启。

原因：

- 防止“先让别人 approve 一个安全版本，之后再追加未经审核的改动”。

#### Require review from Code Owners

含义：

- 如果 PR 修改了 `CODEOWNERS` 中声明的目录，必须由对应 owner 或 team approve。

建议：

- 必开。

对当前仓库的作用：

- 改 `apps/web/` 需要 `frontend` review。
- 改 `packages/scoring-core/` 或 `services/scoring-api/` 需要 `scoring` review。
- 改 API 契约 `packages/shared-contracts/` 需要 frontend + scoring 共同关注。

前提：

- Organization 下必须已经创建对应 teams：
  - `maintainers`
  - `frontend`
  - `scoring`
  - `content`
  - `qa`
- 仓库中已经有 `.github/CODEOWNERS`。

#### Require approval of the most recent reviewable push

含义：

- 最后一次 push 之后，必须有人 approve。

建议：

- 如果页面有这个选项，建议开启。

它和 stale approval 类似，能进一步保证最新代码被看过。

#### Require status checks to pass before merging

含义：

- 指定的 CI 检查必须通过，PR 才能 merge。

建议：

- 第一次设置时，如果下拉框里还没有可选 check，可以先不勾选 required check。
- 先推送一次，让 GitHub Actions 跑完。
- 然后回来选择：

```text
baseline
```

或页面显示的完整名称，例如：

```text
CI / baseline
```

当前仓库的 CI 文件是：

```text
.github/workflows/ci.yml
```

里面的 job 名称是：

```text
baseline
```

这个 job 会检查：

```bash
python scripts/ci/check_forbidden_files.py
python -m compileall packages/scoring-core services/scoring-api scripts
test -f apps/web/index.html
```

#### Require branches to be up to date before merging

含义：

- PR 分支必须基于最新 `main` 重新检查后才能 merge。

建议：

- 第一阶段建议开启。

原因：

- 前端和评分 API 后续会频繁改同一契约，要求分支更新能减少合并后主线才爆炸的问题。

代价：

- 如果多人频繁合并，PR 可能需要多次 update branch。

#### Require conversation resolution before merging

含义：

- PR 中未解决的 review comments 必须 resolve 后才能 merge。

建议：

- 建议开启。

原因：

- 防止 reviewer 提的问题被跳过。

#### Require signed commits

含义：

- commit 必须 GPG/SSH 签名。

建议：

- 第一阶段不建议开启。

原因：

- 团队刚起步，会增加成员配置成本。
- 等协作稳定或有安全合规要求后再开。

#### Require linear history

含义：

- 禁止 merge commit，只允许 squash/rebase 等线性历史。

建议：

- 第一阶段可暂不开。
- 如果团队希望历史更干净，可以后续开启，并统一使用 squash merge。

推荐当前更务实的设置：

```text
Allow squash merging: on
Allow merge commits: optional
Allow rebase merging: optional
```

在团队熟悉后再统一策略。

#### Include administrators / Do not allow bypassing

含义：

- 管理员也必须遵守保护规则。

建议：

- 建议开启。

原因：

- 你作为 maintainer 也走 PR 流程，可以给团队树立规范。
- 真有紧急情况再临时修改规则，不要平时绕过。

#### Restrict who can push to matching branches

含义：

- 只有指定人或 team 能 push 到 `main`。

建议：

- 建议开启。
- 只允许：

```text
@sign-language-universe/maintainers
```

注意：

- 即使 maintainers 有 push 权限，在开启 PR requirement 和 required checks 后，仍然不能随便绕过合并要求，除非你允许 bypass。

#### Allow force pushes

含义：

- 允许改写 `main` 历史。

建议：

- 不要开启。

#### Allow deletions

含义：

- 允许删除 `main`。

建议：

- 不要开启。

### 7.6 当前项目的推荐最终配置

第一阶段推荐配置如下：

```text
Branch name pattern: main

[x] Require a pull request before merging
    [x] Require approvals
        Required approvals: 1
    [x] Dismiss stale pull request approvals when new commits are pushed
    [x] Require review from Code Owners
    [x] Require approval of the most recent reviewable push（如果页面有）

[x] Require status checks to pass before merging
    [x] Require branches to be up to date before merging
    Required checks:
      - CI / baseline

[x] Require conversation resolution before merging

[ ] Require signed commits
[ ] Require linear history

[x] Do not allow bypassing the above settings（如果页面有）

[x] Restrict who can push to matching branches
    Allowed actors:
      - @sign-language-universe/maintainers

[ ] Allow force pushes
[ ] Allow deletions
```

如果 `CI / baseline` 还不能选择，先保存不带 required check 的规则。等 Actions 跑过一次后，再回来补。

### 7.7 验证是否设置成功

设置完成后做一次测试：

1. 本地创建测试分支：

```bash
cd /data/WYC/sign-language-universe
git checkout -b docs/test-branch-protection
```

2. 修改一行文档并提交：

```bash
git add docs/operations/github_repository_creation_manual_20260611.md
git commit -m "docs: test branch protection flow"
git push -u origin docs/test-branch-protection
```

3. 在 GitHub 页面创建 PR。

4. 检查 PR 页面是否出现：

- `Review required`
- `Code owner review required`
- `CI / baseline` 检查
- 如果有未解决评论，不能 merge

5. 不建议直接测试向 `main` push。若要确认，可在非重要改动上尝试，预期会被拒绝。

### 7.8 常见问题

#### 看不到 required status check

原因：

- GitHub 通常要先看到该 check 至少运行过，才会在 required checks 下拉列表里出现。

处理：

- 先 push 当前仓库。
- 打开 Actions，确认 `CI` workflow 跑过。
- 回到 branch protection 设置，选择 `CI / baseline`。

#### CODEOWNERS review 没触发

检查：

- `.github/CODEOWNERS` 是否在默认分支 `main`。
- team 是否真实存在。
- team 是否有仓库访问权限。
- team 名是否和文件中一致，例如 `@sign-language-universe/frontend`。
- 该 PR 是否真的修改了对应目录。

#### 自己是 admin 还能直接 merge

检查：

- 是否开启了 `Do not allow bypassing the above settings` 或同等选项。
- 是否某个规则允许 admin bypass。

#### 设置后所有 PR 都卡住

常见原因：

- required check 名称选错。
- CI workflow 失败。
- CODEOWNERS team 没有仓库权限。
- required approval 数设太高。

处理：

- 先把 required approval 降到 `1`。
- 确认 `CI / baseline` 在 PR 上可通过。
- 确认 team 权限。

### 7.9 Branch protection rules 和 Rulesets 的区别

你当前优先使用 Branch protection rules。

简单区别：

- **Branch protection rule**
  - 老牌功能。
  - 适合单仓库、保护 `main`。
  - 配置简单。

- **Rulesets**
  - 更新的规则系统。
  - 可同时控制 branch、tag、push rules。
  - 适合组织级、多个仓库、复杂 bypass 规则。
  - GitHub 官方也提示，当多个 branch protection rule 同时命中时可能难判断最终应用哪条规则，Rulesets 是更可控的替代方案。

当前阶段：

```text
先用 Branch protection rule 保护 main。
等组织仓库增多或规则复杂后，再迁移到 Rulesets。
```

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
