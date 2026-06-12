# 手语学习宇宙近期前后端更新与 ModelScope 部署报告

日期：2026-06-12  
仓库：`sign-language-universe/sign-language-universe`  
本地路径：`/data/WYC/sign-language-universe`  
线上前端：<https://sign-language-universe.github.io/sign-language-universe/>  
ModelScope full API：<https://scottwyc-sign-language-universe.ms.show>  
ModelScope lite API：<https://scottwyc-sign-language-universe-lite.ms.show>  

## 1. 报告摘要

近期工作围绕“手语学习宇宙”的打分闭环完成了三条主线：

1. **GitHub Pages 前端打分模块可用化**  
   前端挑战页已经接入摄像头采集、Web Holistic 预加载、浏览器端关键点提取、自动评分、低分建议、采样参数控制、结果诊断展示和 Web Holistic 失败重试。默认采集参数已调整为 `2.5s / 10fps / 480px`，默认约采集 `25` 帧。本次补充后，挑战模式覆盖全部 `47` 个学习词汇，但仅对模板数据库已覆盖的 `10` 个词开放录制评分，其他词明确提示“评分模板待上线”。

2. **评分后端标准化与旧算法迁移**  
   `services/scoring-api` 已提供统一 FastAPI 入口，支持 `landmark_rows` 和 `frame_slices` 两类输入。后端已接入旧仓库 `/data/WYC/signLanguage` 中已有的 Holistic 模板相似度算法，即 `score_holistic_sequence_mvp.run_pair()`，并保留 worker、模板、捕获质量和 fallback 多种评分路径。

3. **ModelScope 魔搭创空间双部署路线**  
   已保留一个完整 Docker 空间用于验证服务端 Holistic worker，同时新增一个 lite Docker 空间用于浏览器 Web Holistic 路线。当前推荐线上演示使用 lite 空间，且前端默认评分 API 已指向该 lite 空间：前端只上传关键点，后端只做模板 DTW/semantic prototype scoring，不再在服务器运行 MediaPipe Holistic。

4. **前端体验补充优化**
   新增日间/夜间模式切换、可关闭音效、无专属动画词汇的明确占位提示，并修复学习页/挑战页动画播放器共用全局实例导致的潜在 canvas 指向问题。

截至本报告生成时：

- GitHub Pages 前端已部署最新版本，页面默认参数为 `2.5s / 10fps / 480px`。
- GitHub Pages 前端默认评分 API 已设置为 `https://scottwyc-sign-language-universe-lite.ms.show`，普通用户不再需要手动填写。
- Web Holistic 加载失败时，页面会显示“重新加载 Web Holistic”按钮，允许用户在当前页面生命周期内手动重试。
- 当前挑战词表已从学习词库自动派生，覆盖 `47` 个学习词；其中 `10` 个词有模板可评分，`37` 个词等待评分数据库上线。
- 当前项目说明、部署说明和 API 契约已统一把“GitHub Pages + Web Holistic + ModelScope lite Docker 后端”作为默认模式。
- full API 健康检查在线，`version=0.3.0`，`worker_enabled=true`，`template_root_configured=true`。
- lite API 健康检查在线，`version=0.3.0`，`worker_enabled=false`，`template_root_configured=true`。
- lite API 的 `/api/scoring/templates` 显示旧模板中已有 `10` 个词条配置完成。

## 2. 近期 PR 与提交概览

| PR | 合并提交 | 标题 | 主要内容 |
|---:|---|---|---|
| #11 | `271e901` | deploy: add ModelScope scoring API space | 增加 ModelScope full Docker 创空间部署包 |
| #12 | `8d03fe6` | Enable ModelScope Holistic worker by default | full Docker 默认启用服务端 Holistic worker |
| #13 | `8107197` | Fix scoring capture camera lifecycle and timing | 修正摄像头生命周期、录制时长和进度条同步 |
| #14 | `60ba944` | Package legacy templates for ModelScope scoring | 将旧仓库模板打包进 ModelScope 部署 bundle |
| #15 | `e1fe825` | Close camera immediately after capture | 录制结束后自动关闭摄像头 |
| #16 | `a5cd668` | feat: browser-side Holistic landmark scoring | 前端接入 Web Holistic，上传 `landmark_rows` |
| #17 | `17688a9` | deploy: add ModelScope lite scoring space | 新增 lite Docker 创空间部署包 |
| #18 | `e2c687e` | 优化打分页 Web Holistic 预加载与自动评分 | 页面访问后预加载 Web Holistic，录制完成自动评分 |
| #19 | `3601441` | 优化打分采样帧数、低分建议和录制结束画面 | 尊重用户设置帧数、低分建议、最后一帧冻结画面 |
| #20 | `939bff3` | 调整打分默认采集参数 | 默认参数改为 `2.5s / 10fps / 480px` |
| #21 | `14c0831` | 新增近期前后端更新与 ModelScope 部署报告 | 形成 Markdown 与 Word 版阶段报告 |
| #22 | `e872472` | 默认连接 ModelScope lite 评分 API | 前端默认 API 指向 lite 空间，保留手动覆盖能力 |
| #23 | `b758340` | 增加 Web Holistic 失败重试按钮 | Web Holistic offline 时显示重试按钮，清理失败状态后重新加载 |
| #25 | `cb18fdc` | 默认 Web Holistic lite 打分流程并优化挑战前端 | 统一默认方案、挑战词表覆盖 47 个学习词、日间模式、音效、OpenAPI 和文档同步 |

截至本报告本次更新覆盖的最新 main 实现提交：

```text
cb18fdc 默认 Web Holistic lite 打分流程并优化挑战前端
```

PR #25 已将挑战词表全覆盖、模板待上线提示、日间/夜间模式、音效、OpenAPI 契约和默认方案文档更新合并进入 `main`。

## 3. 当前整体架构

当前线上打分链路如下：

```text
GitHub Pages 静态前端
  |
  | 1. 默认连接 ModelScope lite API
  | 2. 页面访问后预加载 @mediapipe/holistic
  | 3. 用户点击开始，浏览器摄像头采集
  | 4. 浏览器本机提取 Holistic landmarks
  v
landmark_rows JSON
  |
  | HTTPS POST /api/scoring/score
  v
ModelScope lite FastAPI
  |
  | 读取旧模板 JSON + semantic weights
  | 调用 score_holistic_sequence_mvp.run_pair()
  v
评分结果 + diagnostics + feedback
  |
  v
前端展示分数、低分建议、评分模式、帧数、请求 ID
```

保留的 full 后端链路如下：

```text
GitHub Pages 前端
  |
  | frame_slices 或 landmark_rows
  v
ModelScope full FastAPI
  |
  | 若输入为图片帧，可启动服务端 Holistic worker
  | 若模板存在，进入旧模板相似度评分
  | 若模板不存在，返回捕获质量分
  v
评分结果
```

设计取舍：

- **浏览器端 Holistic**：负责快速关键点提取，减少图片上传和服务端 MediaPipe 冷启动成本。
- **lite 后端**：负责模板库、旧算法、评分版本和诊断输出，避免把权威评分逻辑完全散落到前端。
- **full 后端**：保留为服务端 Holistic worker 验证和回退方案，不作为当前推荐主路径。
- **默认连接策略**：普通用户直接打开 GitHub Pages 即可连接 lite API；开发者仍可通过输入框或 `?api=` 参数切换后端。

## 4. 前端更新详情

### 4.1 Web Holistic 自动预加载

文件：

```text
apps/web/js/scoring.js
apps/web/index.html
```

已实现：

- 页面加载后自动调用 `preloadBrowserHolistic()`。
- 预加载不申请摄像头权限，只加载脚本、创建 Holistic 实例，并用小 canvas 做一次预热。
- 进入挑战页后展示 Web Holistic 状态小字：
  - 准备中
  - 正在加载并预热
  - 已就绪并常驻
  - 加载失败时提示回退上传压缩帧
- Web Holistic 进入不可用状态时，显示“重新加载 Web Holistic”按钮。
- 用户点击重试按钮后，前端会清理失败状态、移除失败残留的 `<script>` 标签，并重新加载和预热 Holistic。
- `index.html` 已增加：
  - `dns-prefetch` 到 `cdn.jsdelivr.net`
  - `preconnect` 到 `https://cdn.jsdelivr.net`

重要边界：

- 浏览器刷新会销毁当前 JS 内存，Holistic 实例不能跨刷新永久常驻。
- 刷新后会自动重建实例；脚本和模型资源通常可走浏览器缓存。
- 页面不刷新、不关闭时，Holistic 实例在当前页面生命周期内复用。

### 4.2 默认连接 ModelScope lite 评分 API

文件：

```text
apps/web/js/scoring.js
apps/web/README.md
```

已实现：

- 前端默认评分 API：

```text
https://scottwyc-sign-language-universe-lite.ms.show
```

- 新用户首次访问时，评分 API 输入框会自动填入 lite API。
- 用户不需要再手动添加评分 API 地址。
- 仍保留覆盖能力，优先级如下：

```text
URL ?api=... 参数 > 浏览器 localStorage 中的自定义非空地址 > 默认 lite API
```

设计原因：

- 当前推荐路线是 Web Holistic + lite 后端。
- lite 后端启动快、依赖少，不运行服务端 MediaPipe。
- 对普通用户来说，默认接入可以减少配置门槛。
- 对开发者来说，输入框和 URL 参数仍可切换到本地 API、full API 或其他测试 API。

### 4.3 浏览器端关键点提取与上传

已实现：

- 前端优先使用 `@mediapipe/holistic` 在浏览器本机提取关键点。
- 前端向后端上传 `landmark_rows`，而不是上传图片帧。
- 上传内容包括：
  - pose landmarks
  - left hand landmarks
  - right hand landmarks
  - face core landmarks
- 不上传完整 face 478 点，只上传面部核心点，以降低 JSON 体积。
- 每个点使用紧凑数组结构，包含 `x/y/z`，以及可选 `visibility/presence`。

降级路径：

- 如果 Web Holistic 加载失败或处理失败，前端可回退为压缩 JPEG 帧路径。
- 如果评分 API 不可用，前端仍返回明确标注的本地预览分，保证演示流程不中断。

### 4.4 录制与自动评分流程

已实现：

1. 用户点击“开始”。
2. 页面进行倒计时。
3. 按当前用户参数采集帧。
4. 录制到达设定时长后立即关闭摄像头。
5. 录制完成后自动进入评分，不再要求用户手动点击“打分”。
6. 评分期间展示：
   - “正在等待评分：x.xs”
   - “等待服务器返回评分结果”
7. 评分完成后显示结果页。

这解决了早期流程中的两个问题：

- 录制完成后摄像头长时间保持开启。
- 用户必须手动点击“打分”才能进入评分。

### 4.5 采样帧数逻辑调整

最新改动：

- 不再固定 Web Holistic 采集 `24` 帧。
- 不再为了推荐帧数自动改写用户输入。
- 推荐帧数只作为提示。
- 实际采集帧数严格由用户前端设置决定：

```text
采集帧数 = 采集时长 x 上传 FPS
```

当前默认值：

```text
采集时长：2.5s
上传 FPS：10
帧宽：480px
默认采集帧数：25 帧
```

页面提示示例：

```text
采样：香蕉 建议至少 10 帧；当前按设置采集 2.5s x 10fps = 25 帧。已达到建议帧数。
```

技术下限：

- 少于 `3` 帧时通常无法提交有效评分。
- 低于建议帧数时仍允许录制，但提示评分稳定性可能下降。

### 4.6 低分建议

文件：

```text
apps/web/js/scoring.js
```

已参考旧仓库方案的思想：

- 左手动作偏差
- 右手动作偏差
- 身体姿态偏差
- 动作节奏与起止不清楚

当前前端拿不到完整逐关节误差，因此根据已有诊断近似生成建议：

- 采样帧数低于推荐值：提示增加时长或 FPS。
- 左右手覆盖差异明显：提示左手或右手手势调整。
- 手部覆盖偏低：提示双手完整入画、靠近摄像头、避免遮挡。
- 姿态覆盖偏低：提示上半身、肩膀和手臂入画。
- 动作变化偏小：提示动作幅度和起止过程更清楚。
- 诊断不足时：提示对照示范检查手形、运动方向和节奏。

低分结果页会优先展示这类可执行建议，而不是只显示“模板评分完成”一类系统状态。

### 4.7 录制结束画面发白优化

问题：

- 浏览器关闭 video stream 与 DOM 替换之间可能出现空白浅色帧。
- 用户看到“录制结束”时画面短暂发白，观感不稳定。

处理：

- 录制结束前先从 video 抓取最后一帧。
- 将最后一帧作为暗化背景预览。
- 再关闭摄像头并显示“采集完成 / 正在评分”等状态。

相关样式：

```text
.scoring-capture-still
.scoring-capture-complete.has-still
```

效果：

- 从实时画面自然冻结到暗化状态画面。
- 减少摄像头停止时的白屏闪烁。

### 4.8 挑战模式词汇覆盖与评分覆盖分离

问题：

- 早期 `CHALLENGE_WORDS` 是单独写死的 10 个词。
- 学习页词库实际已有 47 个词，挑战模式没有完整覆盖学习内容。
- 如果直接把无模板词也送入评分，会让用户误以为 fallback 分就是正式评分。

本次处理：

- `CHALLENGE_WORDS` 改为从 `VOCABULARY_DATA` 自动生成。
- 挑战导航覆盖全部 47 个学习词，并将当前可评分的 10 个模板词排在前面。
- 新增 `SCORING_READY_WORDS`，只标记当前模板数据库已覆盖的 10 个可评分词：

```text
香蕉、花、汽车、虎、月亮、跳、朋友、指示、唱歌、馋
```

- 其他 37 个词在挑战页显示：

```text
评分模板待上线 · 暂不能录制评分，等待数据库上线
```

- 待上线词的“进入挑战 / 开始录制 / 自动评分”入口会被禁用或拦截，不提交到后端，也不返回本地预览分。
- 无专属 Canvas 示范动画的词显示“暂无专属动画”，不再错误 fallback 到“香蕉”动画。

设计原因：

- 学习覆盖和评分覆盖必须区分。
- 对学习产品来说，用户可以浏览全部词汇。
- 对评分产品来说，只有有标准动作模板的词才能给出可信模板评分。

### 4.9 日间模式、音效与动画播放器修复

新增前端体验：

- 右下角新增日间/夜间模式切换。
- 用户主题偏好保存到 `localStorage`。
- 星空背景会随主题变浅或变深。
- 新增可关闭音效，默认开启，用户偏好保存到 `localStorage`。
- 音效使用 Web Audio 生成，不新增音频资源文件。

动画播放器修复：

- 旧实现使用全局单个 `animationPlayer`。
- 学习页和挑战页都使用 Canvas 动画时，存在复用旧 canvas 的潜在问题。
- 现改为每个 canvas 独立 `AnimationPlayer` 实例。
- 无专属动画的词不再 fallback 到错误词汇动画。

## 5. 后端更新详情

### 5.1 FastAPI 统一评分入口

文件：

```text
services/scoring-api/app/main.py
services/scoring-api/app/holistic_worker_daemon.py
services/scoring-api/README.md
```

API：

```text
GET  /
GET  /api/scoring/health
GET  /api/scoring/templates
POST /api/scoring/score
POST /api/scoring/worker/warmup
```

当前服务版本：

```text
version=0.3.0
```

核心能力：

- 支持 `frame_slices` 图片帧输入。
- 支持 `landmark_rows` 浏览器关键点输入。
- 支持可选 Holistic worker。
- 支持模板目录 `SLU_TEMPLATE_ROOT`。
- 支持语义权重配置 `SLU_SEMANTIC_PROFILE_JSON`。
- 返回 `score`、`score_valid`、`feedback`、`diagnostics`。

### 5.2 旧算法接入

后端已接入旧仓库中已有的核心评分算法：

```text
score_holistic_sequence_mvp.run_pair()
```

所在包：

```text
packages/scoring-core
```

评分模式：

- 浏览器 landmarks + 模板：

```text
web_holistic_template_similarity
```

- 服务端 Holistic worker + 模板：

```text
holistic_template_similarity
```

- 有 Holistic 关键点但无模板：

```text
web_holistic_capture_quality
holistic_capture_quality
```

- 后端不可用或 worker 不可用：

```text
browser_frame_fallback
browser_local_fallback
```

### 5.3 模板与语义权重

模板来自旧仓库本地生成结果：

```text
/data/WYC/signLanguage/work/generated/scoring_mvp_run3/all_demo_step2_worker_cache_semantic_v1/results
```

语义权重来自：

```text
/data/WYC/signLanguage/work/generated/scoring_semantic_profiles/sign_semantic_weights.json
```

在 ModelScope Docker 容器内默认路径：

```text
SLU_TEMPLATE_ROOT=/app/templates/holistic
SLU_SEMANTIC_PROFILE_JSON=/app/templates/sign_semantic_weights.json
```

注意：

- 公开 GitHub 主仓库不放 demo 视频。
- 旧模板 JSON 是部署 bundle 阶段从服务器本地旧仓库复制进 ModelScope 创空间部署包。
- 真实用户视频、隐私数据和大型生成缓存不应进入公开仓库。

## 6. ModelScope 部署详情

### 6.1 full Docker 创空间

访问地址：

```text
https://scottwyc-sign-language-universe.ms.show
```

仓库目录：

```text
deploy/modelscope-space
```

用途：

- 验证完整 Python/FastAPI/MediaPipe/OpenCV/Pillow 环境。
- 支持服务端 Holistic worker。
- 可处理前端上传图片帧的回退路径。
- 可用于比较服务端 Holistic 与 Web Holistic 的速度和稳定性。

Docker 特点：

- 基础镜像：`python:3.10-slim`
- 监听端口：`7860`
- 默认：

```text
SLU_ENABLE_HOLISTIC_WORKER=true
SLU_TEMPLATE_ROOT=/app/templates/holistic
SLU_SEMANTIC_PROFILE_JSON=/app/templates/sign_semantic_weights.json
```

安装依赖：

```text
fastapi
uvicorn[standard]
pydantic
numpy
Pillow
opencv-python-headless
mediapipe==0.10.18
```

当前健康检查结果摘要：

```json
{
  "status": "ok",
  "version": "0.3.0",
  "worker_enabled": true,
  "worker_ready": false,
  "template_root_configured": true
}
```

解释：

- API 服务在线。
- worker 配置为开启。
- 当前 worker 处于 idle/not ready，通常说明没有持续常驻或未完成启动。
- full 路线仍受 ModelScope 免费 CPU 容器、MediaPipe 初始化和冷启动影响，实际评分可能较慢。

### 6.2 lite Docker 创空间

访问地址：

```text
https://scottwyc-sign-language-universe-lite.ms.show
```

仓库目录：

```text
deploy/modelscope-space-lite
```

用途：

- 专门服务 GitHub Pages + Web Holistic 路线。
- 前端提取 landmarks。
- 后端只做模板读取和旧算法评分。
- 避免服务端安装和启动 MediaPipe。

Docker 特点：

- 基础镜像：`python:3.10-slim`
- 监听端口：`7860`
- 默认：

```text
SLU_ENABLE_HOLISTIC_WORKER=false
SLU_TEMPLATE_ROOT=/app/templates/holistic
SLU_SEMANTIC_PROFILE_JSON=/app/templates/sign_semantic_weights.json
```

安装依赖：

```text
fastapi
uvicorn
pydantic
numpy
```

不安装：

```text
mediapipe
opencv-python-headless
Pillow
libgl1
libglib2.0-0
```

当前健康检查结果摘要：

```json
{
  "status": "ok",
  "version": "0.3.0",
  "worker_enabled": false,
  "worker_ready": false,
  "template_root_configured": true
}
```

当前 `/api/scoring/templates` 显示已配置模板的词条：

```text
香蕉、花、汽车、虎、月亮、跳、朋友、指示、唱歌、馋
```

尚未配置模板但接口中保留词条：

```text
你好、谢谢、爸爸、学习、文化
```

### 6.3 full 与 lite 对比

| 维度 | full 空间 | lite 空间 |
|---|---|---|
| 目录 | `deploy/modelscope-space` | `deploy/modelscope-space-lite` |
| 是否安装 MediaPipe | 是 | 否 |
| 是否安装 OpenCV/Pillow | 是 | 否 |
| worker 默认 | 开启 | 关闭 |
| 输入主路径 | 图片帧或关键点 | 浏览器关键点 |
| 启动速度 | 慢，受 MediaPipe 冷启动影响 | 快 |
| 适用场景 | 服务端 Holistic 验证、回退 | 当前推荐线上演示 |
| 资源压力 | 高 | 低 |
| 对 GitHub Pages 的适配 | 可用但慢 | 更适配 |

当前推荐：

```text
GitHub Pages 前端 + Web Holistic + ModelScope lite API
```

## 7. GitHub Pages 与 CI/CD

### 7.1 前端部署 workflow

文件：

```text
.github/workflows/pages.yml
```

触发条件：

- push 到 `main`
- 改动包含：

```text
apps/web/**
.github/workflows/pages.yml
```

部署源：

```text
apps/web
```

部署目标：

```text
https://sign-language-universe.github.io/sign-language-universe/
```

### 7.2 CI workflow

文件：

```text
.github/workflows/ci.yml
```

检查内容：

- 禁止提交敏感/不应入库文件。
- Python 语法检查：

```text
packages/scoring-core
services/scoring-api
scripts
```

- 前端入口存在性检查：

```text
apps/web/index.html
```

### 7.3 最近部署验证

PR #23 合并后：

- CI 成功。
- GitHub Pages 部署成功。
- 线上 `index.html` 已确认包含：

```text
scoring-capture-fps value="10"
scoring-frame-width value="480"
```

- 线上 `scoring.js` 已确认包含：

```text
DEFAULT_CAPTURE_DURATION_SEC = 2.5
DEFAULT_CAPTURE_FPS = 10
DEFAULT_FRAME_WIDTH = 480
DEFAULT_SCORING_API_BASE = https://scottwyc-sign-language-universe-lite.ms.show
retryBrowserHolistic
```

- 线上 `index.html` 已确认包含：

```text
scoring-holistic-retry-btn
重新加载 Web Holistic
```

本次仓库补充更新后，前端源码还新增：

```text
SCORING_READY_WORDS
buildChallengeWords()
theme-toggle-btn
sound-toggle-btn
hasSignAnimation()
```

对应含义：

- 挑战词表从学习词库自动生成。
- 只有模板库覆盖词允许录制评分。
- 用户可切换日间/夜间模式和音效开关。
- 无专属动画词不再错误播放其他词动画。

## 8. 当前推荐使用方式

### 8.1 普通用户演示

打开：

```text
https://sign-language-universe.github.io/sign-language-universe/
```

进入挑战模式：

1. 页面会自动加载 Web Holistic。
2. 页面默认连接 ModelScope lite API，不需要手动填写评分 API 地址。
3. 切换到想练习的词汇。
4. 如果词汇显示“评分模板已上线”，点击“开始”并按示范完成手语动作，录制结束后自动评分。
5. 如果词汇显示“评分模板待上线”，当前只能查看学习说明，暂不能录制评分。

如果需要切换到其他 API，可以手动填写“评分 API 地址”，也可以使用 URL 参数：

```text
https://sign-language-universe.github.io/sign-language-universe/?api=https://api.example.com
```

### 8.2 开发者本地联调

前端静态服务：

```bash
cd /data/WYC/sign-language-universe
/home/wuyangcheng/myenv/bin/python -m http.server 5173 --directory apps/web
```

本地后端：

```bash
cd /data/WYC/sign-language-universe
pip install -r services/scoring-api/requirements.txt
pip install -e packages/scoring-core
uvicorn app.main:app --app-dir services/scoring-api --host 127.0.0.1 --port 5080
```

挑战页填写：

```text
http://127.0.0.1:5080
```

注意：

- GitHub Pages 是 HTTPS，正式线上 API 也必须是 HTTPS。
- 本地 HTTP API 只适合本机联调。

## 9. 关键问题解释

### 9.1 为什么 Web Holistic 比服务端 Holistic 快很多

Web Holistic 快的主要原因：

- 浏览器加载的是预编译的 JS/WASM/模型资源。
- 资源可以被 CDN 和浏览器缓存。
- 页面打开后即可后台预加载，不等用户点击开始。
- 不需要启动 Python、OpenCV、MediaPipe Python 包和 worker 子进程。
- 不需要经历 ModelScope 容器冷启动、存储挂载和服务端进程初始化。

服务端 Holistic 慢的主要原因：

- ModelScope 创空间可能有容器冷启动和资源调度。
- Python import `mediapipe/cv2/numpy` 成本较高。
- MediaPipe graph/model 初始化较慢。
- worker 启动、健康检查和首次请求都可能触发额外等待。

因此当前路线把“关键点提取”移到浏览器是合理的。

### 9.2 是否应该把完整打分算法也移入前端

短期可以做轻量本地评分 fallback，但不建议立即完全替代后端。

适合放前端：

- Web Holistic 关键点提取。
- 快速本地预览分。
- 少量模板的教学 demo。
- 离线/弱网演示。

建议留后端：

- 权威模板版本管理。
- 算法版本和校准参数。
- 排行榜、防篡改和正式测评。
- 用户样本记录和后续人工标注。
- 更完整的诊断报告。

推荐演进：

```text
阶段 1：浏览器提关键点 + 后端权威模板评分
阶段 2：前端增加轻量模板评分 fallback
阶段 3：后端保留权威评分、日志和数据闭环
```

### 9.3 Web Holistic 不可用与重试策略

当前 Web Holistic 可能不可用的主要情况：

- `cdn.jsdelivr.net` 脚本加载失败或超过 `12s`。
- 脚本加载后没有正确暴露 `window.Holistic`。
- 首次预热或摄像头画面预热失败。
- 单帧处理超过 `3.5s`。
- 浏览器不支持或限制 WebAssembly/WebGL/MediaPipe 相关能力。
- 页面后台运行或低性能设备导致执行被明显限速。

已实现的重试策略：

- 当 Web Holistic 状态进入 offline 时，显示“重新加载 Web Holistic”按钮。
- 用户点击后，前端会清理 `browserHolisticUnavailable`、loading promise、pending frame 等状态。
- 如果失败的 `<script>` 标签残留在页面中，重试前会移除该标签，避免“假重试”。
- 重试成功后恢复 Web Holistic landmark 上传路线。
- 重试仍失败时，前端继续保留压缩帧或本地 fallback 评分路径。

## 10. 当前限制

1. **模板覆盖有限**  
   挑战模式现在覆盖全部 47 个学习词，但当前已配置旧模板的词条仍为 10 个。其他 37 个词会显示“评分模板待上线”，暂不允许录制评分。

2. **前端低分建议仍是启发式**  
   目前前端根据帧数、手部覆盖、姿态覆盖和动作变化生成建议。若要达到旧方案中“逐关节偏差”的精度，需要后端返回更细粒度的 joint-level diagnostics。

3. **Web Holistic 依赖浏览器和网络环境**  
   首次加载依赖 CDN。国内网络环境下可能偶发慢或失败，但浏览器缓存会改善二次加载；当前页面已提供手动重试按钮。

4. **刷新页面不能保留 JS 实例**  
   刷新会销毁 Holistic 实例，但资源可缓存，刷新后会自动重建。

5. **lite 后端不支持服务端 Holistic 图片帧路径**  
   lite 空间不安装 MediaPipe。如果前端 Web Holistic 失败并回退到图片帧，lite 后端只能返回 fallback 预览分。

6. **full 后端 worker 仍有冷启动和稳定性问题**  
   full 空间保留用于验证，不是当前推荐主路径。

## 11. 下一步建议

### 11.1 短期

- 给挑战页增加“当前评分模式”更显眼的展示，区分：
  - 浏览器 Holistic 模板评分
  - 捕获质量分
  - 本地预览分
- 在 Web Holistic 重试失败后，进一步提示可能原因，例如 CDN 网络、浏览器兼容或设备性能。
- 扩展模板数据库，让更多学习词从“待上线”转为可评分。
- 给暂无专属动画的词逐步补充 Canvas 示范动画或视频示范素材。

### 11.2 中期

- 将后端 `prototype` 诊断中更多旧算法指标返回给前端：
  - `worst_alignment_points`
  - 分组误差
  - 左手/右手/身体分项
  - action window
  - semantic guard 结果
- 前端根据这些指标生成更接近旧仓库方案的纠错建议。
- 增加轻量前端模板评分 fallback，用于后端不可用时的离线演示。
- 建立标准动作模板版本号，报告中显示当前模板版本。

### 11.3 长期

- 建立真实用户样本与人工标注流程。
- 将原型相似度分数校准成更可靠的学习评分。
- 支持团队成员上传新词条模板，经过审核后进入模板库。
- 如果后续有正式测评/排行榜需求，保留后端权威评分与日志审计。

## 12. 附录：常用验证命令

### GitHub Pages

```bash
curl -fsSL https://sign-language-universe.github.io/sign-language-universe/ \
  | rg 'scoring-capture-fps|scoring-frame-width'
```

### full API health

```bash
curl -fsSL https://scottwyc-sign-language-universe.ms.show/api/scoring/health
```

### lite API health

```bash
curl -fsSL https://scottwyc-sign-language-universe-lite.ms.show/api/scoring/health
```

### lite API templates

```bash
curl -fsSL https://scottwyc-sign-language-universe-lite.ms.show/api/scoring/templates
```

### GitHub Actions

```bash
gh run list --limit 5
```

### ModelScope 日志

本机已安装 ModelScope CLI 时，可用如下形式查看日志。注意不要在命令行或文档中打印 token 值。

```bash
set -a
. /home/wuyangcheng/.codex/secrets/modelscope.env
set +a

MODELSCOPE_API_TOKEN="$MODELSCOPE_TOKEN" \
  /data/WYC/.venvs/modelscope-hub/bin/ms logs scottwyc/sign-language-universe \
  --repo-type studio --log-type run --page-size 200

MODELSCOPE_API_TOKEN="$MODELSCOPE_TOKEN" \
  /data/WYC/.venvs/modelscope-hub/bin/ms logs scottwyc/sign-language-universe-lite \
  --repo-type studio --log-type run --page-size 200
```

不要使用 `--tail`，当前 CLI 路径下该参数不可用。
