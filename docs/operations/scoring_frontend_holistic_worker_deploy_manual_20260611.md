# 手语评分前端 + Holistic Worker 部署手册

日期：2026-06-11

## 结论

GitHub 可以直接部署完整静态网页，但不能直接运行 Holistic worker。

- GitHub Pages：部署 `apps/web` 的 HTML/CSS/JS/3D 模型等静态资源。
- GitHub Actions：自动检查代码并把 `apps/web` 发布到 Pages。
- Holistic worker：属于 Python/FastAPI/MediaPipe 后端长进程，需要部署在服务器、Coder 工作区、云主机或容器平台。
- 前端和后端通过 HTTPS API 地址连接。

GitHub 官方文档对 Pages 的定位是静态站点托管，处理的是仓库里的 HTML、CSS、JavaScript 等静态文件；Actions runner 是执行 workflow job 的机器，不是长期在线的业务服务。因此 worker 不应部署在 Pages 或 GitHub-hosted runner 上。

参考：

- https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- https://docs.github.com/actions/using-github-hosted-runners/about-github-hosted-runners
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## 已接入的仓库能力

前端：

- `apps/web/js/scoring.js`
- 挑战模式调用浏览器摄像头，按 5fps 抽取 JPEG 帧。
- 调用 `POST /api/scoring/score`。
- 页面上可填写评分 API 地址，例如 `https://api.example.com`。
- API 不可用时返回“本地预览评分”，保证演示流程不中断。
- 不依赖 demo 视频，目标示范继续使用现有 Canvas 动画。

后端：

- `services/scoring-api/app/main.py`
- `GET /api/scoring/health`
- `GET /api/scoring/templates`
- `POST /api/scoring/score`
- 可选启动 `services/scoring-api/app/holistic_worker_daemon.py` 常驻 worker。
- 可选读取服务器本地模板目录 `SLU_TEMPLATE_ROOT`。
- 无模板时返回 Holistic 捕获质量分。
- worker 不可用时返回浏览器帧预览分，并在 `diagnostics.scoring_mode` 标明原因。

GitHub Pages：

- `.github/workflows/pages.yml` 已配置。
- push 到 `main` 且 `apps/web/**` 变化时自动部署完整前端。

## 本地联调

在仓库根目录启动评分 API：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r services/scoring-api/requirements.txt
pip install -e packages/scoring-core
uvicorn app.main:app --app-dir services/scoring-api --host 127.0.0.1 --port 5080
```

启动前端：

```bash
cd apps/web
python -m http.server 5173
```

浏览器打开：

```text
http://127.0.0.1:5173
```

在挑战页的“评分 API 地址”填入：

```text
http://127.0.0.1:5080
```

注意：GitHub Pages 是 HTTPS。正式从 Pages 调用评分 API 时，API 也应使用 HTTPS；不要让 HTTPS 页面调用普通 HTTP 远程 API。

## 服务器部署评分 API

推荐目录示例：

```text
/srv/sign-language-universe/
  repo/                       # Git 仓库
  venv/                       # Python 环境
  work/generated/scoring-api/ # worker 输出，不进 Git
  templates/holistic/         # Holistic 模板 JSON，不进 Git
```

初始化：

```bash
cd /srv/sign-language-universe
git clone git@github.com:sign-language-universe/sign-language-universe.git repo
python -m venv venv
source venv/bin/activate
cd repo
pip install -r services/scoring-api/requirements.txt
pip install -e packages/scoring-core
```

环境变量：

```bash
export SLU_ENABLE_HOLISTIC_WORKER=true
export SLU_SCORING_OUTPUT_ROOT=/srv/sign-language-universe/work/generated/scoring-api
export SLU_TEMPLATE_ROOT=/srv/sign-language-universe/templates/holistic
export SLU_SEMANTIC_PROFILE_JSON=/srv/sign-language-universe/templates/sign_semantic_weights.json
```

启动：

```bash
uvicorn app.main:app \
  --app-dir services/scoring-api \
  --host 127.0.0.1 \
  --port 5080
```

健康检查：

```bash
curl http://127.0.0.1:5080/api/scoring/health
```

启用 worker 前，建议先做 warm-up 探针：

```bash
PYTHONPATH=packages/scoring-core timeout 180 \
  /srv/sign-language-universe/venv/bin/python \
  services/scoring-api/app/holistic_worker_daemon.py
```

正常情况下会输出一行 `{"type":"ready", ...}`。如果 180 秒内没有 ready，应先修复服务器上的 MediaPipe/OpenCV/系统图形依赖，再把 `SLU_ENABLE_HOLISTIC_WORKER=true` 加入生产服务。

## systemd 服务示例

```ini
[Unit]
Description=Sign Language Universe Scoring API
After=network.target

[Service]
WorkingDirectory=/srv/sign-language-universe/repo
Environment=SLU_ENABLE_HOLISTIC_WORKER=true
Environment=SLU_SCORING_OUTPUT_ROOT=/srv/sign-language-universe/work/generated/scoring-api
Environment=SLU_TEMPLATE_ROOT=/srv/sign-language-universe/templates/holistic
Environment=SLU_SEMANTIC_PROFILE_JSON=/srv/sign-language-universe/templates/sign_semantic_weights.json
ExecStart=/srv/sign-language-universe/venv/bin/uvicorn app.main:app --app-dir services/scoring-api --host 127.0.0.1 --port 5080
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

## Nginx HTTPS 反向代理示例

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

前端填写：

```text
https://api.example.com
```

也可以用 URL 参数临时指定：

```text
https://sign-language-universe.github.io/sign-language-universe/?api=https://api.example.com
```

## GitHub Pages 发布完整网页

仓库已有 workflow：

```text
.github/workflows/pages.yml
```

触发方式：

- PR 合并到 `main`。
- 改动路径包含 `apps/web/**` 或 `.github/workflows/pages.yml`。
- 也可以在 GitHub Actions 页面手动运行 `workflow_dispatch`。

部署结果：

```text
https://sign-language-universe.github.io/sign-language-universe/
```

## 模板数据策略

当前公开仓库不放 demo 视频，也不放大型 Holistic cache。

如果后续要做“标准动作相似度评分”，在服务器私有目录准备模板 JSON：

```text
/srv/sign-language-universe/templates/holistic/
  flower/flower_holistic_results.json
  jump/jump_holistic_results.json
  ...
```

API 会自动寻找：

- `<root>/<alias>/<alias>_holistic_results.json`
- `<root>/<alias>/<alias>_results.json`
- `<root>/<alias>_holistic_results.json`
- `<root>/<alias>.json`

别名包括中文词、英文 id 和部分拼音 id，例如 `花 / flower / hua`。

## 管理建议

- Pages 只承担前端，不承担评分计算。
- 评分 API 使用独立域名，配置 HTTPS。
- worker 输出、模板、用户采集帧、日志不进入 Git。
- 公共仓库 PR 不要触发生产服务器上的 self-hosted runner 自动执行不受信任代码。
- 等真实用户样本和人工评分标签足够后，再把当前 `prototype_score` 校准为正式评分。
