# GitHub Pages 前端部署操作手册

本文说明如何把 `apps/web` 前端直接部署到 GitHub Pages，让网页运行在 GitHub 仓库对应的 Pages 站点上，而不是运行在本地服务器上。

## 1. 结论

可以把当前前端部署到 GitHub Pages，因为当前前端是：

```text
原生 HTML/CSS/JavaScript 静态页面
```

GitHub Pages 正适合托管这类静态站点。

但当前项目有两个重要限制：

```text
1. 如果 Organization 是 GitHub Free，private repository 不能使用 GitHub Pages。
2. GitHub Pages 的分支发布方式只能选择仓库根目录 / 或 /docs，不能直接选择 apps/web。
```

因此当前项目推荐：

```text
发布方式: GitHub Actions
发布目录: apps/web
```

本仓库已经添加 workflow：

```text
.github/workflows/pages.yml
```

它会把 `apps/web` 上传并部署到 GitHub Pages。

## 2. 是否需要升级 GitHub 计划

GitHub 官方规则是：

```text
GitHub Free / GitHub Free for organizations:
  只支持 public repositories 使用 GitHub Pages

GitHub Pro / GitHub Team / GitHub Enterprise:
  支持 public 和 private repositories 使用 GitHub Pages
```

所以如果当前仓库仍是：

```text
Organization: sign-language-universe
Repository: private
Plan: GitHub Free
```

则 GitHub Pages 可能无法真正发布。GitHub 页面可能会提示需要升级。

如果当前仓库已经改为：

```text
Repository: public
Plan: GitHub Free
```

则可以继续使用 GitHub Pages，不需要为了 Pages 单独升级 GitHub Team。

可选方案：

```text
方案 A：升级 Organization 到 GitHub Team
  推荐。仓库继续 private，GitHub Pages 可用。

方案 B：把仓库改成 public
  可用。前提是确认代码、素材、算法和资料都可以公开。

方案 C：继续使用服务器或 SSH 端口转发本地预览
  适合还没有升级 GitHub Team 的阶段。
```

注意：

```text
GitHub Pages 站点默认是公开网页。
```

即使源仓库是 private，只要你的计划允许 private repo 发布 Pages，发布出来的 Pages 站点通常仍会公开到互联网。真正的私有 Pages 访问控制通常需要 GitHub Enterprise Cloud。

## 3. 为什么不直接选 main 分支 root

你提供的说法适用于网页文件在仓库根目录或 `/docs` 目录的情况：

```text
Settings -> Pages -> Branch -> main -> /(root)
```

但当前仓库结构是：

```text
sign-language-universe/
  apps/
    web/
      index.html
      css/
      js/
      assets/
```

GitHub Pages 的 `Deploy from a branch` 模式只支持选择：

```text
/(root)
/docs
```

不能直接选择：

```text
apps/web
```

因此如果使用 `Deploy from a branch`，需要移动或复制前端文件到根目录或 `/docs`。这会破坏当前 monorepo 结构，不推荐。

更好的方式是：

```text
Settings -> Pages -> Source -> GitHub Actions
```

然后由 workflow 指定：

```yaml
path: apps/web
```

## 4. 已添加的 GitHub Actions workflow

本仓库已经添加：

```text
.github/workflows/pages.yml
```

核心逻辑：

```yaml
on:
  push:
    branches: [main]
    paths:
      - apps/web/**
      - .github/workflows/pages.yml
  workflow_dispatch:
```

含义：

- 当 `main` 分支上的 `apps/web/**` 变化时，自动部署前端。
- 当 workflow 文件自身变化时，也自动部署。
- 也可以在 GitHub Actions 页面手动点击运行。

发布目录：

```yaml
path: apps/web
```

也就是说，GitHub Pages 网站根目录对应仓库里的：

```text
apps/web
```

## 5. GitHub 页面启用步骤

进入仓库：

```text
https://github.com/sign-language-universe/sign-language-universe
```

进入：

```text
Settings -> Pages
```

在 `Build and deployment` 中设置：

```text
Source: GitHub Actions
```

如果页面提示需要升级，并且仓库是 private，说明当前 Organization 计划不支持 private repository 使用 GitHub Pages。

如果没有计划限制，保存后进入：

```text
Actions -> Deploy frontend to GitHub Pages
```

可以等待 workflow 自动运行，或者点击：

```text
Run workflow
```

## 6. 发布后的访问地址

当前仓库是 organization project site，默认地址通常是：

```text
https://sign-language-universe.github.io/sign-language-universe/
```

发布成功后，GitHub 也会在：

```text
Settings -> Pages
```

顶部显示实际站点地址。

如果设置了自定义域名，则以 GitHub 页面显示的地址为准。

## 7. 发布后如何更新网页

修改前端：

```bash
cd /data/WYC/sign-language-universe
```

编辑：

```text
apps/web/index.html
apps/web/css/style.css
apps/web/js/*.js
apps/web/assets/**
```

提交并推送到 `main` 后，Pages workflow 会自动部署：

```bash
git add apps/web
git commit -m "feat: update frontend"
git push
```

如果团队已经开始执行 PR 流程，则应改为：

```text
feature branch -> Pull Request -> review -> merge main -> 自动部署
```

## 8. 验证部署状态

进入：

```text
Actions -> Deploy frontend to GitHub Pages
```

检查最近一次运行是否为绿色。

成功时通常能看到：

```text
Deploy to GitHub Pages
```

以及环境：

```text
github-pages
```

也可以进入：

```text
Settings -> Pages
```

查看发布地址和最近部署状态。

## 9. 常见问题

### 9.1 Settings -> Pages 提示需要升级

原因通常是：

```text
private repository + GitHub Free organization
```

解决：

```text
升级 GitHub Team
```

或暂时继续使用：

```text
服务器静态预览
SSH 端口转发
```

### 9.2 选择 Branch 时找不到 apps/web

这是正常的。

GitHub Pages 的 `Deploy from a branch` 只能选择：

```text
/(root)
/docs
```

当前项目应选择：

```text
Source: GitHub Actions
```

而不是：

```text
Deploy from a branch
```

### 9.3 页面打开是 404

可能原因：

- Pages 还没发布完成。
- workflow 运行失败。
- Organization 计划不支持当前 private repo 发布 Pages。
- GitHub Pages 地址输错。

排查顺序：

```text
1. 看 Actions 是否绿色
2. 看 Settings -> Pages 是否显示发布地址
3. 等待 1-10 分钟
4. 确认访问的是项目站点地址 /sign-language-universe/
```

### 9.4 页面能打开但资源丢失

当前前端使用相对路径：

```html
css/style.css
js/app.js
assets/...
```

这适合部署在：

```text
https://sign-language-universe.github.io/sign-language-universe/
```

如果后续引入绝对路径，例如：

```text
/css/style.css
```

在项目站点中可能会出错，因为 `/` 会指向：

```text
https://sign-language-universe.github.io/
```

而不是：

```text
https://sign-language-universe.github.io/sign-language-universe/
```

因此前端资源建议继续使用相对路径，或统一配置 base path。

### 9.5 评分 API 不能部署到 GitHub Pages

GitHub Pages 只能托管静态文件，不能运行 Python/FastAPI 后端。

因此：

```text
apps/web:
  可以部署到 GitHub Pages

services/scoring-api:
  不能部署到 GitHub Pages
  需要单独部署到服务器、云服务、容器平台或 Coder 工作区
```

当前阶段可以先把静态前端发布到 GitHub Pages，评分 API 继续在服务器运行。后续前后端联调时，再决定 API 的正式部署方式。

## 10. 推荐执行路径

当前建议：

```text
1. 保持 apps/web 在 monorepo 中
2. 使用 .github/workflows/pages.yml 从 apps/web 发布 Pages
3. 如果仓库继续 private，升级 Organization 到 GitHub Team
4. 在 Settings -> Pages 里选择 Source: GitHub Actions
5. 等 Actions 部署成功后，用 Pages 地址访问前端
```

如果暂时不升级：

```text
继续使用 docs/operations/frontend_access_manual_20260611.md 中的服务器预览方式
```
