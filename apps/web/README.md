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
