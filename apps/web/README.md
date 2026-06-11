# apps/web

团队前端静态 Demo，来源于：

```text
/data/WYC/signLanguage/work/other/sign-language-universe/sign-language-universe
```

## 本地预览

```bash
cd apps/web
python -m http.server 5173
```

浏览器打开：

```text
http://127.0.0.1:5173
```

## 当前状态

- 原生 HTML/CSS/JS。
- 包含宇宙主题首页、星系星球选择、词汇学习卡片、检索、测评、个人空间站。
- `js/app.js` 中已有算法集成预留点。
- `assets/3d/*.glb` 当前直接进入仓库；后续如模型继续增大，应迁移到 Git LFS、Release artifacts 或 CDN。
