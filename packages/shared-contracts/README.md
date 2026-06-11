# shared-contracts

前后端共享契约目录。

- `openapi/scoring-api.yaml`：评分 API 契约。
- `schemas/`：后续可放 JSON Schema 或生成的类型定义。

规则：

- 改评分 API 时必须同时更新契约。
- 契约变更需要 frontend 和 scoring 两边共同 review。
