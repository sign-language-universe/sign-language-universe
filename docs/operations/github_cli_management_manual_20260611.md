# GitHub CLI 本地安装与仓库管理手册

本文说明当前服务器上的 GitHub CLI 安装状态、登录方式，以及如何用 `gh` 管理 `sign-language-universe/sign-language-universe` 仓库。

## 1. 当前安装状态

当前服务器用户：

```text
wuyangcheng
```

当前系统：

```text
Ubuntu 22.04.5 LTS
Linux x86_64
```

由于当前用户没有无密码 `sudo` 权限，本机没有使用 apt 系统安装，而是采用用户目录安装。

已安装：

```text
gh version 2.94.0
```

安装位置：

```text
/home/wuyangcheng/.local/share/gh-2.94.0/bin/gh
```

命令入口：

```text
/home/wuyangcheng/.local/bin/gh
```

`~/.local/bin` 已在当前 `PATH` 中，因此可以直接运行：

```bash
gh --version
```

安装来源：

```text
https://github.com/cli/cli/releases/tag/v2.94.0
```

安装包：

```text
gh_2.94.0_linux_amd64.tar.gz
```

已使用官方 release 中的 `gh_2.94.0_checksums.txt` 校验 SHA256。

## 2. 登录 GitHub

当前状态：

```text
尚未登录 GitHub
```

检查：

```bash
gh auth status
```

推荐登录方式：

```bash
gh auth login --hostname github.com --git-protocol ssh --web
```

执行后按提示操作：

1. 选择 `GitHub.com`。
2. 选择 `SSH` 作为 git protocol。
3. 选择 `Login with a web browser`。
4. 复制终端中显示的一次性 code。
5. 在浏览器完成授权。
6. 回到终端确认登录完成。

如果后续命令提示 scope 不足，可追加授权：

```bash
gh auth refresh --scopes repo,read:org,workflow
```

如果需要管理 Organization teams，可能还需要：

```bash
gh auth refresh --scopes admin:org
```

只在确实需要管理组织成员和团队权限时再申请 `admin:org`。

安全注意：

- 不要把 GitHub token 写入仓库文件。
- 不要把 token 放进 README、脚本、配置文件或 commit message。
- 不要在多人共用 Linux 用户下登录个人 GitHub。
- 退出登录使用：

```bash
gh auth logout
```

## 3. 基础检查命令

进入仓库：

```bash
cd /data/WYC/sign-language-universe
```

查看仓库信息：

```bash
gh repo view sign-language-universe/sign-language-universe
```

查看 JSON 信息：

```bash
gh repo view sign-language-universe/sign-language-universe \
  --json nameWithOwner,visibility,isPrivate,defaultBranchRef,url
```

打开 GitHub 网页：

```bash
gh repo view --web
```

查看当前登录用户：

```bash
gh api user --jq '.login'
```

## 4. Public 仓库管理

检查仓库是否 public：

```bash
gh repo view sign-language-universe/sign-language-universe \
  --json visibility,isPrivate
```

如果确认公开前检查已经完成，可以用 CLI 改为 public：

```bash
gh repo edit sign-language-universe/sign-language-universe \
  --visibility public \
  --accept-visibility-change-consequences
```

注意：

- 这个命令会改变仓库可见性，影响很大。
- 执行前必须确认 `docs/operations/public_repository_release_manual_20260611.md` 中的检查项已经完成。
- 如果你没有仓库 Admin 权限或 Organization 限制 visibility 变更，命令会失败。

推荐第一次改 public 仍然在 GitHub 网页上手动做，CLI 主要用于检查和后续自动化。

## 5. GitHub Pages 管理

当前仓库已添加 Pages workflow：

```text
.github/workflows/pages.yml
```

查看 Pages 状态：

```bash
gh api repos/sign-language-universe/sign-language-universe/pages
```

如果没有启用 Pages，这个 API 可能返回 `404`。

进入网页设置：

```bash
gh repo view --web
```

然后手动进入：

```text
Settings -> Pages -> Source -> GitHub Actions
```

查看 workflow：

```bash
gh workflow list
```

手动触发 Pages 部署：

```bash
gh workflow run pages.yml
```

查看最近运行：

```bash
gh run list --workflow pages.yml --limit 5
```

观察部署过程：

```bash
gh run watch
```

查看失败日志：

```bash
gh run view --log-failed
```

默认 Pages 地址：

```text
https://sign-language-universe.github.io/sign-language-universe/
```

## 6. Pull Request 流程

查看 PR：

```bash
gh pr list
```

查看当前分支相关 PR：

```bash
gh pr status
```

创建工作分支：

```bash
git switch -c docs/example-change
```

提交后推送：

```bash
git push -u origin docs/example-change
```

创建 PR：

```bash
gh pr create --base main --head docs/example-change --fill
```

在浏览器打开 PR：

```bash
gh pr view --web
```

查看 PR diff：

```bash
gh pr diff
```

查看 PR CI：

```bash
gh pr checks
```

更新分支到最新 main：

```bash
gh pr update-branch
```

合并 PR：

```bash
gh pr merge --squash --delete-branch
```

如果团队要求必须网页 review 后合并，则不要直接用 CLI merge。

## 7. Issue 管理

查看 issue：

```bash
gh issue list
```

创建 issue：

```bash
gh issue create --title "标题" --body "内容"
```

查看 issue：

```bash
gh issue view <编号> --web
```

给 issue 加标签：

```bash
gh issue edit <编号> --add-label bug
```

## 8. Actions 与 CI

查看所有 workflow：

```bash
gh workflow list
```

查看最近运行：

```bash
gh run list --limit 10
```

查看某次运行：

```bash
gh run view <run-id>
```

查看失败日志：

```bash
gh run view <run-id> --log-failed
```

重新运行失败任务：

```bash
gh run rerun <run-id> --failed
```

## 9. 分支保护与仓库设置

查看默认分支：

```bash
gh repo view sign-language-universe/sign-language-universe \
  --json defaultBranchRef --jq '.defaultBranchRef.name'
```

查看 `main` 分支保护信息：

```bash
gh api repos/sign-language-universe/sign-language-universe/branches/main/protection
```

如果返回 `404`，通常表示：

```text
没有配置保护
或当前 token 权限不足
或仓库计划/可见性限制导致规则未生效
```

分支保护建议仍优先在网页配置：

```text
Settings -> Branches -> Branch protection rules
```

原因是网页更直观，适合初期团队管理；CLI/API 更适合后续自动化审计。

## 10. Team 与权限检查

列出 Organization teams：

```bash
gh api orgs/sign-language-universe/teams --jq '.[].slug'
```

查看某个 team：

```bash
gh api orgs/sign-language-universe/teams/frontend
```

查看 team 仓库权限：

```bash
gh api orgs/sign-language-universe/teams/frontend/repos/sign-language-universe/sign-language-universe
```

这些命令通常需要：

```text
read:org
```

如果要修改 team 成员或权限，通常需要：

```text
admin:org
```

第一阶段建议：

```text
网页管理 team 和成员
CLI 用于检查和审计
```

## 11. 常见问题

### 11.1 gh 提示未登录

运行：

```bash
gh auth login --hostname github.com --git-protocol ssh --web
```

### 11.2 gh 命令提示权限不足

查看当前认证：

```bash
gh auth status
```

刷新 scope：

```bash
gh auth refresh --scopes repo,read:org,workflow
```

如果是管理 team：

```bash
gh auth refresh --scopes admin:org
```

### 11.3 gh repo view 可以，但 gh api 失败

通常是 token scope 不足，或仓库/组织设置限制了 API 权限。

先检查：

```bash
gh auth status
```

再根据需要刷新 scope。

### 11.4 命令找不到 gh

确认：

```bash
echo "$PATH" | tr ':' '\n' | grep "$HOME/.local/bin"
ls -l ~/.local/bin/gh
```

当前安装位置：

```text
~/.local/bin/gh
```

如果新 shell 没有 `~/.local/bin`，在 `~/.bashrc` 中补：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## 12. 升级和卸载

升级时下载新版 release，然后更新 symlink。

当前版本目录：

```text
~/.local/share/gh-2.94.0
```

卸载：

```bash
rm -f ~/.local/bin/gh
rm -rf ~/.local/share/gh-2.94.0
rm -rf ~/.cache/codex-tools/gh-2.94.0
```

退出 GitHub 登录：

```bash
gh auth logout
```

## 13. 参考

- GitHub CLI manual: https://cli.github.com/manual/
- gh auth login: https://cli.github.com/manual/gh_auth_login
- GitHub CLI releases: https://github.com/cli/cli/releases
