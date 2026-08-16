# Sign Language Universe

[中文版](./README.md) | **English**

Team repository for the sign-language learning frontend, scoring service, scoring core algorithms, shared API contracts, and project collaboration docs.

## 🚀 Live App (click to open)

**Sign Language Learning App (deployed on GitHub Pages, no login):**

[Try the live app (no login)](https://sign-language-universe.github.io/sign-language-universe/)

- Features: 21-word interactive learning (EN/ZH), real-time camera capture, **semantic-action cascade scoring model** (pure front-end ONNX inference, no backend needed)
- **Semantic-action cascade scoring model with semantic-head gate (D6.1 default)**: BiLSTM → 47 semantic-action heads → overall (switchable D6.1/D6.2/D6.3/T7.1/T7.2); word-level gate exemption for fine hand-shape words (人们（人民）/汽车（二）)
- **Semantic overlay reference videos**: 7 words (supermarket/bus/car-one/car-two/people/forest/jump) scene-overlay style (scene elements + semantic-driven animation + top-right label), VL-approved
- Scoring: AI scoring is performed by the **semantic-action cascade scoring model with a semantic-head gate** — a 47-dim semantic action head and an overall score head in cascade; the model outputs both an **overall score** and per-action **semantic head scores**; semantic-head activation forms the **gate** (filters random/off-target movements) with improvement advice derived from semantic-head activation; **scored entirely locally — no data is uploaded**; **mirror max** (score both original and left-right mirrored sequences, take the higher) keeps single-hand / dominant-hand scoring symmetric
- Browser: latest Chrome / Edge / Safari (onnxruntime WASM)

## Modules

- `apps/web/`: Team front-end static demo (interactive learning lab with bilingual guidance, camera capture, scoring, retry, next-word, and success feedback).
- `apps/scoring-demo/`: Early static demo of the scoring module.
- `packages/scoring-core/`: **Legacy DTW union scoring core (degraded fallback when the model is unavailable)**, ported from private work scripts; the primary scorer is the front-end cascade model (see below).
- **Scoring models** (cascade ONNX) are hosted in `apps/web/assets/model/` (`dual_cascade_v*.onnx` 4.7MB + `action_meta.json`), deployed with GitHub Pages and inferred locally in the browser (onnxruntime WASM); training scripts/weights stay in the internal private repo and internal training servers, and are not distributed with this public repository.
- `services/scoring-api/`: Scoring API entry; receives browser `landmark_rows` by default, keeps frame submission, optional Holistic worker, server-side template scoring, and degraded preview scoring.
- `packages/shared-contracts/`: Shared API contracts between front-end and back-end.
- `docs/`: Product, architecture, scoring-module, AI-context, and operations docs.

## Default Online Architecture

```text
GitHub Pages static front-end
  -> Browser Web Holistic extracts landmarks (entirely local, never uploaded)
  -> Front-end semantic-action cascade scoring model (onnxruntime-web WASM, no backend)
     · BiLSTM backbone outputs 47 semantic action heads (1-7 sparse per word)
     · Composite score = overall × semantic-head gate (semantic-head activation discount) + mirror max
  -> Fallback when model unavailable: scoring-core local weighted DTW union scoring
  -> Optional: ModelScope lite Docker FastAPI backend (server-side scoring / fallback route)
```

- Primary front-end scoring: **semantic-action cascade scoring model with a semantic-head gate** (`model-scoring-cascade.js`, CascadeScorer, D6.1 default, switchable D6.2/D6.3/T7.1/T7.2), pure front-end ONNX inference, **scored entirely locally — no data uploaded**; **semantic-head gate**: total = overall × min(1, target-word leaf activation / 0.5), random/off-target input is auto-discounted with a hint; **word-level exemption**: fine hand-shape / low-sample words (人们（人民）/汽车（二）) bypass the gate (threshold 0) to avoid penalizing real positives; **mirror max**: both the original sequence and the left-right mirrored sequence are scored and the higher is taken, keeping single-hand / dominant-hand scoring symmetric; models in `apps/web/assets/model/` (cascade ONNX 4.7MB); inference runtime `vendor/onnxruntime/` served same-origin.
- Default capture settings: `3s / 10fps / 720p`
- When connected to the scoring API, `landmark_rows` are uploaded first; image frames are not uploaded.
- `deploy/modelscope-space-lite/`: optional online demo backend (no MediaPipe worker).
- `deploy/modelscope-space/`: full Docker validation / server-side Holistic worker fallback route.
- Challenge mode covers all `47` learning words; interactive learning ships scoring templates for all 21 words (DTW fallback: top-2 mean of 3 templates per word + discriminative group weights + envelope softening; 21/21 cross-validation passed in Python and front-end).
- The interactive lab carries no private volunteer videos, slices, real-person previews, or unauthorized landmark caches; 超市 / 人们（人民）/ 跳 / 汽车（一） publish human-reviewed anonymous avatar reference videos generated by the pipeline.

## Local Development: Preview the Frontend (local machine only)

```bash
cd apps/web
python -m http.server 5173
```

Open:

```text
http://127.0.0.1:5173
```

GitHub Pages deployment:

```text
docs/operations/github_pages_frontend_deploy_manual_20260611.md
```

Front-end scoring, Web Holistic, ModelScope lite API, and GitHub Pages deployment:

```text
docs/operations/scoring_frontend_holistic_worker_deploy_manual_20260611.md
```

Lightweight model semantic-action scoring module (data / architecture / training / results / deployment):

```text
docs/scoring/sign_language_lightweight_model_scoring_20260809.md
```

**Cascade model (D6.x) scoring module tech doc** (conf gating + word-level exemption + mirror max):

```text
docs/scoring/sign_language_cascade_model_scoring_20260816.md
```

ModelScope Docker Space scoring API deployment:

```text
docs/operations/modelscope_holistic_deploy_manual_20260611.md
```

Public repository release & Apache-2.0 licensing:

```text
docs/operations/public_repository_release_manual_20260611.md
```

Interactive learning module & public data boundaries:

```text
docs/product/interactive_learning_module_20260805.md
```

GitHub CLI local install & repository management:

```text
docs/operations/github_cli_management_manual_20260611.md
```

Team development, VS Code, PR, and gh collaboration workflow:

```text
docs/operations/team_development_workflow_manual_20260611.md
```

## Local Development: Run the Scoring API

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r services/scoring-api/requirements.txt
pip install -e packages/scoring-core
uvicorn app.main:app --app-dir services/scoring-api --host 127.0.0.1 --port 5080
```

Health check:

```text
http://127.0.0.1:5080/api/scoring/health
```

## Collaboration Rules

- All official changes are merged via Pull Requests.
- The `main` branch is protected; no direct pushes.
- Large generated artifacts, real-user videos, Holistic caches, and runtime logs never enter Git.
- Scoring API changes must update `packages/shared-contracts/openapi/scoring-api.yaml`.

## License

Unless otherwise noted, source code and project documentation are licensed under the Apache License, Version 2.0. See `LICENSE` and `NOTICE`.

Media, 3D models, generated assets, datasets, and third-party content may require separate provenance and license review before public redistribution.
