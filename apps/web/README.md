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

## 无缓存本地服务（推荐，避开 VSCode 内置浏览器缓存）

```bash
python3 /data/WYC/sign-language-universe/scripts/serve_nocache.py --port 8147 --dir /data/WYC/sign-language-universe/apps/web
```

浏览器打开：

```text
http://127.0.0.1:8147
```

- 服务只绑 `127.0.0.1`；所有响应带 `Cache-Control: no-store`（含 onnx/json）。
- 树模型/元数据按**版本化文件名**加载（`assets/model/tree_model_v62.onnx` / `tree_model_v62.json`，见 `js/tree-scoring.js`），路径级击穿缓存——更新模型时必须同步改这两个文件名。
- 8145 端口是旧版服务（保留未动）；若页面仍显示旧模型/0 分，改用 **8147 新端口**：浏览器对该 origin 无任何缓存，必然全量重载。

### VSCode 内置浏览器（Simple Browser）顽固缓存说明（20260810 排查结论）

- 根因：本仓库运行在 VSCode Remote-SSH 的 server 端，Simple Browser/Webview 跑在**用户客户端**的 VSCode Electron 里，其 HTTP 缓存存于客户端 `Code/Service Worker/CacheStorage`（Windows 为 `%APPDATA%\Code\Service Worker\CacheStorage`），存在已知的不按 `Cache-Control: no-store` 失效、不自动清理的问题（microsoft/vscode#132376 / #320928）。
- 彻底避开缓存的做法（按优先级）：
  1. **改用 8147 新端口**（`http://127.0.0.1:8147`）——全新 origin，无任何历史缓存，最可靠。
  2. 用**系统浏览器**（Chrome/Edge）打开 `http://127.0.0.1:8145` 或 8147——系统浏览器严格遵守 no-store，不共享 VSCode webview 缓存。
  3. 清理客户端 VSCode 缓存：完全退出 VSCode → 删除客户端 `Code/Service Worker/CacheStorage` 与 `Code/Cache/Cache_Data` 内容（Windows: `%APPDATA%\Code\...`；Linux/macOS: `~/.config/Code/...`）→ 重启 VSCode。⚠️ 会同时清掉 VSCode 自身的界面缓存，首次启动略慢，不影响用户数据。

## 当前状态

- 原生 HTML/CSS/JS。
- 包含宇宙主题首页、星系星球选择、词汇学习卡片、检索、测评、个人空间站。
- 挑战模式已经接入 `js/scoring.js`：浏览器 Web Holistic 提取关键点，由前端 `scoring-core.js` 本地完成加权 DTW 打分；可选连接 ModelScope lite API 服务端评分。
- Web Holistic 静态运行资源已随 `apps/web/vendor/mediapipe/holistic/` 同源部署，手机端优先从 GitHub Pages 本站加载；外部 CDN 仅作为备用。
- 挑战模式包含旧打分 demo 的关键交互：3 秒倒计时、采集时长、上传 FPS、帧宽设置、采样帧数提示、进度条、评分模式/帧数/worker 耗时/样本 ID/建议提示。
- 挑战模式覆盖全部 `47` 个学习词汇；互动学习 21 词已全部接入评分模板（并集加权 DTW，前端本地打分），Python 校准与前端交叉验证 21/21 通过。
- 页面提供日间/夜间模式切换和可关闭的交互音效。
- 页面已补充移动端响应式布局，手机端会自动切换为单列学习/挑战布局并适配安全区。
- 已人工通过的匿名 Avatar 参考视频由 `assets/content/reference_media_manifest.json` 统一管理，并可被互动学习、挑战页和评分参考接口复用；未通过视频继续使用 Canvas 示意。
- 评分由浏览器本地完成（`scoring-core.js` 加权 DTW 并集打分），不依赖评分 API；未上线模板词不会进入录制评分。
- `assets/3d/*.glb` 当前直接进入仓库；后续如模型继续增大，应迁移到 Git LFS、Release artifacts 或 CDN。
- 首页新增“互动学习实验室”：支持中英双语动作指导、次序事件/同时状态区分、A–Z 教学示意图、程序化 Canvas 示意动画和当前词汇内嵌的摄像头评分面板；参考示意与动作指导合并为左侧连续内容面板，右侧摄像头区默认收起，点击开始后才展开精简采集与评分控件。采集、评分、重试、下一词和成功反馈均在该板块内完成，不再跳转挑战页。页面跟随全局白天/夜晚模式切换。已通过审核的匿名 Avatar 参考视频统一由公开媒体清单提供，不包含私人志愿者视频或真人预览图。A–Z 教学示意图默认展示仅含示意图的裁剪版（`assets/content/illustrations/schematic-crops/`），由本地视觉模型按示意图矩形区域裁剪生成，去除原资料卡中的标题栏与文字说明；裁剪图缺失时自动回退到原始整页图。
- 互动学习页的公开指导数据位于 `assets/content/interactive_learning_contracts.json`；只发布脱敏语义文本和公开数据边界，不发布未授权 landmark 模板缓存。

## 本地打分与可选评分 API

浏览器运行 Web Holistic 提取匿名运动关键点后，由前端 `scoring-core.js` 在本地完成加权 DTW 并集打分，无需后端。评分 API 连接行默认隐藏；如需切换服务端评分，可通过 URL 参数指定（优先级高于本地缓存）：

```text
https://sign-language-universe.github.io/sign-language-universe/?api=https://api.example.com
```

GitHub Pages 只托管 `apps/web` 静态文件，不能运行 Python/FastAPI/MediaPipe worker；服务端评分仍可部署 ModelScope lite Docker 后端（`deploy/modelscope-space-lite/`）作为回退路线。Web Holistic 优先加载仓库内同源静态资源，避免手机网络访问单一 CDN 失败。

浏览器摄像头需要 HTTPS 或 `localhost` 环境。GitHub Pages 默认是 HTTPS，本地开发可使用 `http://127.0.0.1:5173`。
