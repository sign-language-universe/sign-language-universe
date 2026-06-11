# Public 仓库发布与 Apache-2.0 授权操作手册

本文说明把 `sign-language-universe/sign-language-universe` 从 private 改为 public 前后需要处理的事项，包括 GitHub visibility、GitHub Pages、Apache-2.0 许可证、素材授权、安全检查和团队权限。

## 1. 当前决策

团队决定：

```text
Repository visibility: public
Default license: Apache License 2.0
```

对应仓库：

```text
https://github.com/sign-language-universe/sign-language-universe
```

本仓库已添加：

```text
LICENSE
NOTICE
```

含义：

```text
LICENSE: Apache-2.0 完整许可证文本
NOTICE: 项目版权、归属、素材授权提示
```

## 2. Public 仓库意味着什么

改为 public 后：

- 任何互联网用户都可以看到代码、文档、提交历史、Issue、PR、Actions 部分信息。
- GitHub 用户可以 fork 仓库。
- 如果仓库中曾经提交过密钥、真实用户数据或不应公开的素材，即使后来删除，也可能通过历史记录、fork 或缓存泄露。
- public 仓库在 GitHub Free 组织下可以使用 GitHub Pages。
- public 仓库的分支保护、PR、CI、CODEOWNERS 等能力通常比 private Free 仓库限制更少。

GitHub 官方说明中也强调：公开发布源码后，其他 GitHub 用户根据 GitHub 服务条款至少可以查看和 fork；如果不再希望别人访问，需要改回 private，但已有 fork 或本地副本仍可能存在。

因此，改 public 前必须先做公开前检查。

## 3. Apache-2.0 是什么

Apache License 2.0 是宽松型开源许可证，SPDX 标识是：

```text
Apache-2.0
```

它大致允许别人：

```text
商业使用
修改
分发
私有使用
专利使用
再许可衍生作品
```

但要求别人：

```text
保留版权声明
保留许可证文本
标明修改
保留 NOTICE 中适用的归属声明
```

它也明确：

```text
不提供担保
不承担责任
不自动授权商标使用
如果发起专利诉讼，相关专利授权可能终止
```

对当前项目的实际含义：

- 代码和文档可以开源协作。
- 其他团队可以学习、复用、二次开发。
- 商业使用不是被禁止的。
- 使用方需要遵守许可证和 NOTICE。
- 项目名称、logo、品牌素材不应默认理解为可随意商标使用。

## 4. 授权范围建议

当前仓库建议采用：

```text
代码和项目文档:
  Apache-2.0

媒体、3D 模型、生成图、真实用户数据、课程素材:
  先做来源审查；必要时单独标注 license
```

原因：

- 代码适合 Apache-2.0。
- 课程内容、3D 模型、图片、视频、声音、品牌物料不一定自动适合 Apache-2.0。
- 如果素材来自第三方、同学个人作品、AI 生成资产或外部网站，必须确认能否公开和再授权。

当前重点关注：

```text
apps/web/assets/3d/*.glb
apps/web/assets/3d/*_preview.png
apps/scoring-demo/static/*
docs/product/*
```

如果素材来源不确定，建议先：

```text
1. 移出 public 仓库
2. 或替换成自有/可公开素材
3. 或在 NOTICE / docs/legal/ 中补充单独授权说明
```

## 5. 改 public 前检查清单

### 5.1 密钥和敏感配置

运行：

```bash
cd /data/WYC/sign-language-universe
rg -n --hidden --glob '!/.git/**' \
  "(API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|BEGIN (RSA |OPENSSH |DSA |EC |)PRIVATE KEY|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,})" .
```

如果有结果，先判断是否是真密钥。

如果是真密钥：

```text
1. 立即撤销或轮换密钥
2. 从仓库历史中清理
3. 再考虑改 public
```

注意：只在最新 commit 删除密钥不够，Git 历史里仍可能存在。

### 5.2 真实用户数据

确认仓库中没有：

```text
真实用户视频
真实用户照片
真实姓名/手机号/邮箱
采集到的手部/面部/身体关键点原始数据
数据库 dump
训练集缓存
实验日志中的个人信息
```

当前 `.gitignore` 已阻止常见运行数据进入 Git，但 public 前仍要复查。

### 5.3 大文件和素材来源

查看大文件：

```bash
find . -type f -not -path './.git/*' -printf '%s %p\n' | sort -nr | head -30
```

重点检查：

```text
*.glb
*.mp4
*.mov
*.zip
*.tar
*.npy
*.pkl
*.db
```

如果文件很大但确实需要公开：

```text
可继续放在 Git
或迁移到 Git LFS
或迁移到 Release assets / CDN
```

如果文件来源不明：

```text
不要公开
```

### 5.4 生成文件

确认不会提交：

```text
__pycache__/
*.pyc
.pytest_cache/
node_modules/
dist/
build/
logs/
```

当前本地可能存在 `__pycache__`，但它们被 `.gitignore` 忽略，不会被推送。

检查：

```bash
git status --ignored --short
git ls-files | rg "__pycache__|\\.pyc$"
```

第二条命令应该没有输出。

### 5.5 历史记录

查看最近历史：

```bash
git log --oneline --decorate -20
```

如果怀疑历史里曾经提交过密钥、大数据或不应公开素材，需要先做历史清理。不要直接 public。

## 6. GitHub 页面改成 public

需要 Organization owner 或有权限的仓库管理员操作。

进入仓库：

```text
https://github.com/sign-language-universe/sign-language-universe
```

操作路径：

```text
Repository -> Settings -> General -> Danger Zone -> Change visibility
```

选择：

```text
Make public
```

GitHub 会要求确认仓库名或组织/仓库路径，按页面提示确认。

如果看不到这个选项，可能原因：

- 你不是 Organization owner。
- 你没有仓库 Admin 权限。
- Organization 限制了仓库 visibility 变更。

Organization 级别设置入口通常是：

```text
Organization -> Settings -> Member privileges -> Repository visibility changes
```

建议：

```text
只允许 Organization owners 修改仓库 visibility
```

## 7. 改成 public 后立即检查

### 7.1 检查仓库可见性

退出登录或使用隐身窗口打开：

```text
https://github.com/sign-language-universe/sign-language-universe
```

应该可以看到仓库主页。

### 7.2 检查 License 显示

GitHub 仓库首页右侧或文件列表附近应能识别：

```text
Apache-2.0 license
```

如果没有立即显示，等待一段时间或确认根目录有：

```text
LICENSE
```

### 7.3 检查 GitHub Pages

进入：

```text
Settings -> Pages
```

设置：

```text
Source: GitHub Actions
```

然后进入：

```text
Actions -> Deploy frontend to GitHub Pages
```

手动运行或等待 push 自动触发。

默认访问地址通常是：

```text
https://sign-language-universe.github.io/sign-language-universe/
```

### 7.4 检查 Actions 权限

进入：

```text
Settings -> Actions -> General
```

建议：

```text
Actions permissions:
  Allow GitHub Actions and reusable workflows

Workflow permissions:
  Read repository contents and packages permissions
  Allow GitHub Actions to create and approve pull requests: off
```

Pages workflow 已在 `.github/workflows/pages.yml` 中单独声明：

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

因此不需要给所有 workflow 默认写权限。

## 8. Public 后的团队权限建议

public 不等于所有人都能写代码。

外部用户可以：

```text
查看
fork
提 Issue
从 fork 发 Pull Request
```

但不能直接 push 到主仓库，除非你给了权限。

团队内部仍建议：

```text
maintainers -> Maintain
frontend -> Write
scoring -> Write
content -> Write
qa -> Triage
```

不要因为仓库 public 就给所有成员 Admin。

## 9. Public 后的分支保护

仓库 public 后，建议重新检查 `main` 分支保护：

```text
Settings -> Branches -> Branch protection rules -> main
```

建议开启：

```text
Require a pull request before merging
Require approvals: 1
Require review from Code Owners
Require status checks to pass before merging
Require branches to be up to date before merging
Do not allow bypassing the above settings
Do not allow force pushes
Do not allow deletions
```

public 仓库下，这些规则应能真正生效。

## 10. Public 后的协作说明

建议在 README 中对外说明：

```text
项目用途
当前开发状态
如何运行前端
如何运行评分 API
License
贡献方式
```

后续可补：

```text
CONTRIBUTING.md
SECURITY.md
CODE_OF_CONDUCT.md
docs/legal/THIRD_PARTY_NOTICES.md
```

第一阶段至少保证：

```text
LICENSE
NOTICE
README.md
.github/PULL_REQUEST_TEMPLATE.md
.github/CODEOWNERS
```

## 11. 当前仓库已完成的准备

已完成：

```text
LICENSE: Apache-2.0
NOTICE: 项目归属和素材授权提示
.github/workflows/pages.yml: 从 apps/web 部署 GitHub Pages
docs/operations/github_pages_frontend_deploy_manual_20260611.md
```

仍需人工确认：

```text
1. 所有团队成员同意以 Apache-2.0 公开代码和文档
2. apps/web/assets/3d/*.glb 来源和授权清楚
3. preview 图片来源和授权清楚
4. docs/product/ 中没有不应公开的内部信息
5. GitHub 页面手动改为 public
6. Settings -> Pages 设置为 GitHub Actions
```

## 12. 不建议公开的内容

以下内容不应进入 public 仓库：

```text
真实用户视频
真实用户关键点数据
未脱敏实验数据
账号、token、密钥
未获授权的课程素材
未获授权的 3D 模型
内部服务器地址、密码、部署凭据
```

如需团队内部共享这些内容，应使用：

```text
私有对象存储
受控网盘
服务器内部目录
Release 私有附件
数据库或数据管理平台
```

不要直接提交到 public Git 仓库。
