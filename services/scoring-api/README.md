# scoring-api

手语评分 API 服务。

当前 `app/main.py` 是团队主仓库的轻量 API 骨架，提供：

- `GET /api/scoring/health`
- `GET /api/scoring/templates`
- `POST /api/scoring/score`

`app/legacy_backend.py` 是从 `/data/WYC/signLanguage/work/web/backend.py` 迁入的旧后端入口，仅用于追溯和后续拆解，不建议直接作为团队生产入口。

## 本地启动

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r services/scoring-api/requirements.txt
pip install -e packages/scoring-core
uvicorn app.main:app --app-dir services/scoring-api --host 127.0.0.1 --port 5080
```

## 下一步

- 将 `legacy_backend.py` 中的 Holistic worker 生命周期管理迁移到独立 service。
- 将评分模板路径、输出路径、语义 profile 路径改成环境变量或配置文件。
- 用 `packages/shared-contracts/openapi/scoring-api.yaml` 固化前后端契约。
