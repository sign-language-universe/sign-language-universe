# ModelScope 魔搭创空间部署评分 API / Holistic Worker 手册

日期：2026-06-11

## 目标

用 ModelScope 魔搭 Docker 创空间部署 `services/scoring-api`，让 GitHub Pages 前端可以连接国内可访问的 HTTPS 评分 API。

推荐先分两步：

1. 先部署基础 scoring API，`SLU_ENABLE_HOLISTIC_WORKER=false`，确认 GitHub Pages 能连通。
2. 再打开 `SLU_ENABLE_HOLISTIC_WORKER=true`，测试 MediaPipe Holistic worker 是否能在创空间资源下正常启动。

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

第一轮先保持 worker 关闭：

```text
SLU_ENABLE_HOLISTIC_WORKER=false
SLU_SCORING_OUTPUT_ROOT=/tmp/sign-language-universe/scoring-api
```

基础 API 连通后，再尝试：

```text
SLU_ENABLE_HOLISTIC_WORKER=true
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
