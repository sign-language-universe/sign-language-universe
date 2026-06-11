# 团队开发与 PR 协作操作手册

本文说明 `sign-language-universe/sign-language-universe` 团队仓库的日常开发流程，覆盖 GitHub、VS Code、GitHub Pull Requests 插件、`git` 和 `gh` 的配合方式。

适用仓库：

```text
GitHub: https://github.com/sign-language-universe/sign-language-universe
本地:   /data/WYC/sign-language-universe
```

## 1. 总体原则

当前团队仓库采用：

```text
main 分支保护
功能分支开发
Pull Request 合并
CI 检查
主管/模块负责人 review
Squash merge
合并后删除分支
```

不要直接在 `main` 上提交正式改动。

推荐主流程：

```text
1. 从最新 main 新建分支
2. 在分支上开发
3. 本地自测
4. push 分支到 GitHub
5. 创建 Pull Request
6. CI 通过
7. Reviewer 审阅
8. Squash merge 到 main
9. 删除远端分支
10. 本地同步 main
```

## 2. 角色分工

当前建议 team：

```text
maintainers: 仓库设置、分支保护、权限、合并、release
frontend:    apps/web 前端页面与交互
scoring:     packages/scoring-core 和 services/scoring-api
content:     词汇、课程、教学资料
qa:          测试、体验反馈、验收
```

权限建议：

```text
maintainers -> Maintain
frontend    -> Write
scoring     -> Write
content     -> Write
qa          -> Triage
```

谁可以 approve：

- PR 作者不能 approve 自己的 PR。
- 有 `Write`、`Maintain`、`Admin` 或 owner 权限的人可以 review。
- 如果开启 `Require review from Code Owners`，对应目录需要 CODEOWNERS 中的 team 成员 approve。

当前 CODEOWNERS 大意：

```text
*                         -> maintainers
apps/web/                 -> frontend
packages/scoring-core/    -> scoring
services/scoring-api/     -> scoring
packages/shared-contracts -> frontend + scoring
```

## 3. 分支命名规范

建议分支名：

```text
feature/<简短功能名>
fix/<简短问题名>
docs/<文档主题>
chore/<维护任务>
refactor/<重构主题>
test/<测试主题>
```

示例：

```text
feature/frontend-vocab-search
fix/scoring-health-check
docs/team-development-workflow
chore/update-codeowners
test/pr-flow
```

不要使用：

```text
main
master
temp
new
test
```

短期测试可以用 `test/<主题>`，测试完成后及时删除。

## 4. 成员开发流程：命令行版

进入仓库：

```bash
cd /data/WYC/sign-language-universe
```

同步远端：

```bash
git fetch --all --prune
git switch main
git pull --ff-only
```

新建分支：

```bash
git switch -c feature/my-change
```

开发后查看改动：

```bash
git status --short
git diff
```

只暂存相关文件：

```bash
git add <file1> <file2>
```

提交：

```bash
git commit -m "feat: describe change"
```

推送分支：

```bash
git push -u origin feature/my-change
```

创建 PR：

```bash
gh pr create --base main --head feature/my-change --fill
```

打开 PR 网页：

```bash
gh pr view --web
```

## 5. 成员开发流程：VS Code 版

### 5.1 打开正确目录

在 VS Code 中打开仓库根目录：

```text
/data/WYC/sign-language-universe
```

不要只打开旧仓库：

```text
/data/WYC/signLanguage
```

也不要只打开子目录：

```text
apps/web
services/scoring-api
```

否则 GitHub Pull Requests 插件可能识别不到团队仓库。

### 5.2 确认 VS Code 识别的是团队仓库

打开 VS Code 终端：

```bash
pwd
git remote -v
gh pr list
```

应该看到：

```text
/data/WYC/sign-language-universe
git@github.com:sign-language-universe/sign-language-universe.git
```

### 5.3 新建和切换分支

VS Code 左下角点击当前分支名，例如：

```text
main
```

然后选择：

```text
Create new branch...
```

输入：

```text
feature/my-change
```

如果远端已有分支但 VS Code 没显示，先执行：

```bash
git fetch --all --prune
```

再点击左下角分支名搜索：

```text
origin/feature/my-change
```

### 5.4 提交和 push

在左侧 `Source Control` 面板：

1. 查看 changed files。
2. 点击文件查看 diff。
3. 对需要提交的文件点 `+` stage。
4. 填写 commit message。
5. 点击 `Commit`。
6. 点击 `Sync Changes` 或 `Push`。

推荐提交信息格式：

```text
feat: add vocab search
fix: handle scoring health error
docs: update team workflow
chore: update repo settings docs
```

### 5.5 在 VS Code 创建 PR

需要安装扩展：

```text
GitHub Pull Requests
GitHub.vscode-pull-request-github
```

在 Remote SSH 场景中，扩展必须安装到远程服务器环境。

创建 PR：

```text
Source Control -> Create Pull Request
```

或打开左侧 GitHub Pull Requests 面板，选择：

```text
Create Pull Request
```

确认：

```text
base: main
compare: 当前功能分支
```

填写标题和说明后创建。

## 6. 主管 review 和 merge 流程：网页端

进入仓库：

```text
https://github.com/sign-language-universe/sign-language-universe
```

打开：

```text
Pull requests
```

逐项检查：

```text
Conversation: 有没有未解决讨论
Files changed: 改了哪些文件
Checks: CI 是否通过
Reviewers: 是否需要指定 reviewer
CODEOWNERS: 是否触发对应 team
```

审阅：

```text
Files changed -> Review changes
```

可选结果：

```text
Approve
Request changes
Comment
```

合并：

```text
Squash and merge
Confirm squash and merge
Delete branch
```

推荐使用 `Squash and merge`，让每个 PR 在 `main` 上形成一个清晰提交。

## 7. 主管 review 和 merge 流程：gh 版

查看 PR：

```bash
gh pr list
```

查看 PR 详情：

```bash
gh pr view <PR编号>
gh pr view <PR编号> --web
```

查看 diff：

```bash
gh pr diff <PR编号>
```

查看 CI：

```bash
gh pr checks <PR编号>
```

本地 checkout PR：

```bash
gh pr checkout <PR编号>
```

运行基础检查：

```bash
python scripts/ci/check_forbidden_files.py
python -m compileall packages/scoring-core services/scoring-api scripts
test -f apps/web/index.html
```

Approve：

```bash
gh pr review <PR编号> --approve -b "Reviewed and approved."
```

要求修改：

```bash
gh pr review <PR编号> --request-changes -b "请按评论修改后再提交。"
```

合并：

```bash
gh pr merge <PR编号> --squash --delete-branch
```

合并后同步本地：

```bash
git switch main
git pull --ff-only
```

## 8. 主管 review 和 merge 流程：VS Code 版

安装并登录：

```text
GitHub Pull Requests 扩展
VS Code Accounts -> Sign in to GitHub
```

左侧打开 GitHub Pull Requests 面板。

常用区域：

```text
Created By Me
Assigned To Me
Waiting For My Review
All Open Pull Requests
```

处理别人 PR：

1. 打开 PR。
2. 点击 `Checkout`。
3. 在本地运行测试或预览。
4. 查看 `Files Changed`。
5. 添加评论或 review。
6. 选择 `Approve` 或 `Request Changes`。
7. CI 通过后点击 `Merge`。

如果插件看不到团队仓库，检查：

```bash
pwd
git remote -v
gh pr list
```

并确认 VS Code 打开的是：

```text
/data/WYC/sign-language-universe
```

## 9. 常用本地验证命令

基础 CI 同款检查：

```bash
python scripts/ci/check_forbidden_files.py
python -m compileall packages/scoring-core services/scoring-api scripts
test -f apps/web/index.html
```

前端预览：

```bash
cd /data/WYC/sign-language-universe/apps/web
python -m http.server 5173 --bind 127.0.0.1
```

浏览器：

```text
http://127.0.0.1:5173/
```

评分 API 骨架：

```bash
cd /data/WYC/sign-language-universe
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

## 10. 合并后清理分支

如果 PR 页面合并后没有自动删除远端分支：

```bash
git push origin --delete <branch-name>
```

删除本地分支：

```bash
git switch main
git pull --ff-only
git branch -D <branch-name>
```

如果使用 squash merge，本地 Git 可能认为原分支没有被普通 merge，所以这里用 `-D`。前提是 GitHub PR 已经显示 merged。

清理已删除的远端分支引用：

```bash
git fetch --all --prune
```

## 11. Squash merge 后本地 main 分叉怎么办

如果出现：

```text
main...origin/main [ahead 1, behind 1]
```

常见原因是：

```text
本地 main 上有 PR 原始 commit
GitHub 上 main 是 squash merge 后的新 commit
```

正确做法：

```text
不要继续在这个本地 main 上开发
先确认本地 ahead 的提交已经通过 PR 合并
再把本地 main 对齐 origin/main
```

如果确认本地 ahead commit 已经通过 PR squash merge 进入远端，可以执行：

```bash
git switch main
git fetch origin
git reset --hard origin/main
```

注意：

- `git reset --hard` 会丢弃当前分支未提交改动。
- 执行前必须确认 `git status --short` 没有需要保留的修改。
- 如果有未提交修改，先保存到新分支或提交，不要直接 reset。

更稳妥的方式：

```bash
git switch -c backup/local-main-before-reset
git switch main
git reset --hard origin/main
```

## 12. Public 仓库和敏感内容

当前仓库是 public。

不要提交：

```text
真实用户视频
真实用户关键点数据
账号、token、密钥
数据库 dump
未授权 3D 模型或素材
大型生成物
__pycache__ / .pyc
```

提交前可运行：

```bash
python scripts/ci/check_forbidden_files.py
```

公开素材特别注意：

```text
apps/web/assets/3d/*.glb
apps/web/assets/3d/*_preview.png
```

必须确认来源和授权。

## 13. GitHub Pages 发布

当前前端通过 GitHub Actions 发布到 GitHub Pages。

Pages 地址：

```text
https://sign-language-universe.github.io/sign-language-universe/
```

查看 workflow：

```bash
gh workflow list
```

手动触发部署：

```bash
gh workflow run pages.yml
```

查看部署运行：

```bash
gh run list --workflow pages.yml --limit 5
```

查看 Pages 状态：

```bash
gh api repos/sign-language-universe/sign-language-universe/pages
```

## 14. 推荐工作节奏

每日开始：

```bash
cd /data/WYC/sign-language-universe
git fetch --all --prune
git switch main
git pull --ff-only
gh pr list
gh run list --limit 5
```

开发新任务：

```bash
git switch -c feature/task-name
```

提交 PR：

```bash
git push -u origin feature/task-name
gh pr create --base main --head feature/task-name --fill
```

主管合并：

```bash
gh pr checks <PR编号>
gh pr review <PR编号> --approve -b "Reviewed and approved."
gh pr merge <PR编号> --squash --delete-branch
git switch main
git pull --ff-only
```

清理：

```bash
git fetch --all --prune
git branch --merged main
```

## 15. 相关手册

```text
docs/operations/github_repository_creation_manual_20260611.md
docs/operations/github_cli_management_manual_20260611.md
docs/operations/github_pages_frontend_deploy_manual_20260611.md
docs/operations/frontend_access_manual_20260611.md
docs/operations/public_repository_release_manual_20260611.md
```

## 16. 参考资料

- VS Code Source Control: https://code.visualstudio.com/docs/sourcecontrol/overview
- VS Code GitHub workflow: https://code.visualstudio.com/docs/sourcecontrol/github
- GitHub Pull Requests: https://docs.github.com/articles/creating-a-pull-request
- GitHub protected branches: https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- GitHub CLI PR commands: https://cli.github.com/manual/gh_pr
