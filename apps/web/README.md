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
- 挑战模式已经接入 `js/scoring.js`：浏览器 Web Holistic 提取关键点，默认调用 ModelScope lite API 的 `/api/scoring/score`。
- 挑战模式包含旧打分 demo 的关键交互：3 秒倒计时、采集时长、上传 FPS、帧宽设置、采样帧数提示、进度条、评分模式/帧数/worker 耗时/样本 ID/建议提示。
- 挑战模式覆盖全部 `47` 个学习词汇；当前模板数据库覆盖 `10` 个可评分词，这 10 个词会排在挑战列表前面；其他词会显示“评分模板待上线”并禁用录制评分。
- 页面提供日间/夜间模式切换和可关闭的交互音效。
- 没有内置 demo 视频；目标词汇示范使用现有 Canvas 动画。
- 可评分词在评分 API 未连接时会返回明确标注的本地预览评分，避免挑战流程中断；未上线模板词不会进入录制评分。
- `assets/3d/*.glb` 当前直接进入仓库；后续如模型继续增大，应迁移到 Git LFS、Release artifacts 或 CDN。

## 连接评分 API

GitHub Pages 只托管 `apps/web` 静态文件，不能运行 Python/FastAPI/MediaPipe worker。当前默认方案是在浏览器运行 Web Holistic，向 ModelScope lite Docker 后端上传 `landmark_rows`。挑战页默认连接：

```text
https://scottwyc-sign-language-universe-lite.ms.show
```

因此普通用户不需要手动填写评分 API 地址。如需临时切换到其他后端，可以在挑战页的“评分 API 地址”输入独立 HTTPS API 地址，例如：

```text
https://api.example.com
```

也可以通过 URL 参数指定，URL 参数优先级高于默认值和浏览器本地缓存：

```text
https://sign-language-universe.github.io/sign-language-universe/?api=https://api.example.com
```

浏览器摄像头需要 HTTPS 或 `localhost` 环境。GitHub Pages 默认是 HTTPS，本地开发可使用 `http://127.0.0.1:5173`。
