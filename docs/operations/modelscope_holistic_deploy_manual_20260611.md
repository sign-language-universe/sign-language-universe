# ModelScope 魔搭创空间部署评分 API / Holistic Worker 手册

日期：2026-06-11

## 目标

用 ModelScope 魔搭 Docker 创空间部署 `services/scoring-api`，让 GitHub Pages 前端可以连接国内可访问的 HTTPS 评分 API。

当前项目默认推荐使用 `deploy/modelscope-space-lite/`：浏览器 Web Holistic 提取 `landmark_rows`，ModelScope lite 后端只做模板评分。本文档描述的是保留的 full Docker / 服务端 Holistic worker 路线，主要用于验证、对比和回退，不是当前线上演示主路径。

当前 Dockerfile 已默认开启 Holistic worker，以绕开部分平台环境变量未注入运行容器的问题。建议按下面顺序验证：

1. 直接部署默认镜像，确认 `worker_enabled=true`，并测试 MediaPipe Holistic worker 是否能在创空间资源下正常启动。
2. 如果资源不足或启动失败，再显式设置 `SLU_ENABLE_HOLISTIC_WORKER=false`，先保留基础 scoring API。

Dockerfile 固定使用 `mediapipe==0.10.18`。不要直接升级到未验证的新版本；新版 MediaPipe 可能不再暴露当前 worker 依赖的 legacy `mp.solutions.holistic` 接口。

旧仓库模板接入后，Docker 镜像默认读取：

```text
SLU_TEMPLATE_ROOT=/app/templates/holistic
SLU_SEMANTIC_PROFILE_JSON=/app/templates/sign_semantic_weights.json
```

`deploy/modelscope-space/create_bundle.py` 在本机默认会尝试复制旧仓库已有模板：

```text
/data/WYC/signLanguage/work/generated/scoring_mvp_run3/all_demo_step2_worker_cache_semantic_v1/results
/data/WYC/signLanguage/work/generated/scoring_semantic_profiles/sign_semantic_weights.json
```

如果模板复制成功，线上 `/api/scoring/templates` 中对应词的 `template_configured` 会变为 `true`，打分返回 `diagnostics.scoring_mode=holistic_template_similarity`。如果仍为 `holistic_capture_quality`，说明该词没有模板或模板目录未生效。

## 关键限制

ModelScope Docker 创空间需要应用监听：

```text
0.0.0.0:7860
```

不要把服务只绑定在 `127.0.0.1`，也不要使用平台保留/占用端口。当前仓库提供的 Dockerfile 已默认监听 `0.0.0.0:7860`。

## 仓库内新增文件

```text
deploy/modelscope-space/Dockerfile
deploy/modelscope-space/.dockerignore
deploy/modelscope-space/README.md
deploy/modelscope-space/create_bundle.py
```

API 新增：

```text
GET  /
POST /api/scoring/worker/warmup
```

## 生成创空间部署包

在主仓库执行：

```bash
cd /data/WYC/sign-language-universe
python deploy/modelscope-space/create_bundle.py --force
```

默认输出：

```text
work/generated/modelscope-space-bundle/
```

这个目录是一个最小创空间仓库，包含：

- `Dockerfile`
- `.dockerignore`
- `README.md`
- `packages/scoring-core/`
- `packages/shared-contracts/`
- `services/scoring-api/`
- `templates/`，如果本机旧仓库模板存在
- `LICENSE` / `NOTICE`

## 创建 ModelScope Docker 创空间

在 ModelScope 网页端：

1. 新建创空间。
2. 选择 Docker / 自定义镜像构建方式。
3. 将 `work/generated/modelscope-space-bundle/` 目录内容推送到该创空间 Git 仓库。
4. 等待平台构建镜像并启动。

示例 Git 操作：

```bash
cd /data/WYC/sign-language-universe/work/generated/modelscope-space-bundle
git init
git add .
git commit -m "deploy scoring api to modelscope space"
git remote add origin <your-modelscope-space-git-url>
git push -u origin main
```

## 环境变量

默认会启动 worker：

```text
SLU_ENABLE_HOLISTIC_WORKER=true
SLU_SCORING_OUTPUT_ROOT=/tmp/sign-language-universe/scoring-api
```

如果只想验证基础 API 或 worker 启动失败，可显式关闭：

```text
SLU_ENABLE_HOLISTIC_WORKER=false
```

如果后续准备了服务器侧模板 JSON，再配置：

```text
SLU_TEMPLATE_ROOT=/path/to/templates/holistic
SLU_SEMANTIC_PROFILE_JSON=/path/to/sign_semantic_weights.json
```

公开创空间不建议放真实用户视频、隐私数据、大型生成缓存或未确认授权的模板数据。

## 部署后测试

假设创空间访问地址为：

```text
https://<your-modelscope-space-url>
```

基础检查：

```bash
curl https://<your-modelscope-space-url>/
curl https://<your-modelscope-space-url>/api/scoring/health
```

预热 worker：

```bash
curl -X POST 'https://<your-modelscope-space-url>/api/scoring/worker/warmup?wait_for_ready_sec=180'
```

判断：

- `status=disabled`：环境变量未开启 worker，基础 API 正常。
- `status=ok`：worker 已启动并响应。
- `status=error`：查看创空间构建/运行日志，常见原因是 CPU/内存不足、MediaPipe 初始化过慢、系统依赖不满足。

## 连接 GitHub Pages 前端

GitHub Pages 地址：

```text
https://sign-language-universe.github.io/sign-language-universe/
```

进入挑战模式，在“评分 API 地址”填写：

```text
https://<your-modelscope-space-url>
```

或直接使用 URL 参数：

```text
https://sign-language-universe.github.io/sign-language-universe/?api=https://<your-modelscope-space-url>
```

不要填写：

```text
https://<your-modelscope-space-url>/api/scoring
```

前端会自动拼接 `/api/scoring/health` 和 `/api/scoring/score`。

## 预期表现

worker 关闭时：

- 页面显示评分服务在线，但 worker 未启用。
- 点击打分会得到 `browser_frame_fallback` 或本地预览评分。
- 这一步用于验证 Pages -> ModelScope API 连接。

worker 开启但无模板时：

- 页面可能显示 worker 启动中或已就绪。
- 打分结果为 `holistic_capture_quality`。
- 分数表示捕获质量，不是标准动作相似度。

worker 开启且配置模板时：

- 打分结果为 `holistic_template_similarity`。
- 分数来自 Holistic 模板原型相似度，仍需后续真实用户标注校准。

## 官方参考

- ModelScope 创空间文档：https://modelscope.cn/docs/studios/intro
- ModelScope Docker 创空间文档：https://modelscope.cn/docs/studios/docker
