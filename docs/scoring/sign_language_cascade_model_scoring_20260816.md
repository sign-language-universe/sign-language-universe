# 手语打分 · 级联模型（D6.x）技术方案文档

> 更新：2026-08-16 ｜ 关联前端：`apps/web/js/model-scoring-cascade.js`（CascadeScorer）

## 1. 背景与版本谱系

| 版本 | 训练数据 | 结论 |
|---|---|---|
| D6.1（默认） | 930 纯正例（21 词 × 9 志愿者 × 3 视角 × 2 重复） | 现场 holdout MAE 4.92；conf 门控有效 |
| D6.2（弃） | 全量 auto_score 增强 | overall 虚高（乱作 86-87 分）回退 |
| D6.3 | 930 + 12486 增强混合（含 neg_samples_v2 3720 + 坐姿 2520） | conf 分离更强但整体打分偏保守 |
| D6.4.1（实验） | 930 + 48 现场 neg（A/Ov 全 0） | 门控分离好但 overall 崩（Ov=0 标签过强） |

## 2. 模型架构（DualCascadeModel）

```
输入 X (30帧 × 235维 landmark 特征)
  → BiLSTM（冻结骨干，3 层双向）→ LayerNorm → mean pool
  → action_head: Linear → sigmoid → 47 维（核心语义动作程度，独立二分类非 softmax）
  → cascade MLP(47→128→1) → overall: sigmoid → 1 维（整体质量）
```

- 47 个动作头 = 47 个语义叶子（21 词，每词 1-7 个，见 `action_meta.json`）
- **关键机制**：目标词叶子激活度（conf）= 该词"被检测到"的置信度；训练标签只有目标叶子有值、其余 0，模型自然学到"conf ≈ 词判定"

## 3. conf 门控（拦截乱作/非目标词）

```text
conf        = mean(action_head[word_actions[word]])   # 目标词叶子平均激活度（0-1）
gate_factor = min(1, conf / 0.5)                      # 软门控：连续缩放，非硬开关
total       = overall × gate_factor × 100
```

- 依据：正例 conf 0.51-0.82 vs 乱作负例 0.003-0.034（间距 >10 倍，阈值 0.5 落在无人区）
- conf 不足提示词（中英双语）：<0.1 强提示"未识别到核心语义动作"；0.1-0.5 提示"识别不足已折减"

### 词级豁免（人们（人民）/汽车（二））

精细手形/少样本词（汽车二训练仅 39 条）的 conf 对正负无分离度（pos 0.006-0.16 vs neg 0.004-0.007 几乎重叠），全局门控误伤正例（1-28 分）→ 这两词 conf 阈值=0（不设门控，无折减无提示），正例恢复 82-87 分；取舍：乱作负例可能虚高。

```js
const WORD_GATE_OVERRIDE = { '人们（人民）': 0, '汽车（二）': 0 };
```

## 4. 镜像取 max（单手/惯用手左右对称）

```text
mirror = 所有 landmark x 翻转（1-x）+ 左右手互换（严格互换，空侧保持空）
score_orig = score(原序列)
score_mir  = score(镜像序列)
total      = max(score_orig, score_mir)
```

- 验证（新录"跳"正手/反手样本）：正手（右手主）原序列 84 分；反手（左手主）原序列 0 → 镜像 84 分；三样本 max 全 84 分对称 ✓
- 已知限制：模型对单手/左手 conf 低是训练数据问题（930 以双手/右手为主），需后续补样本训练

## 5. 部署

- 模型文件 `apps/web/assets/model/`（dual_cascade_v*.onnx，4.7MB）+ `action_meta.json`
- 打分模块 `apps/web/js/model-scoring-cascade.js`（CascadeScorer，模型切换下拉 localStorage 记忆）
- 推理库 `vendor/onnxruntime/` 本地同源（WASM，无后端依赖）
- 前端 `apps/web/js/scoring.js`：主路径启用门控（gate:true）+ 镜像取 max

## 6. 负例补充方向（D6.4.2）

- 负例标签 VL 精细标注：渲染 8 帧骨架网格 → qwen3-vl-8b 判定 47 动作头激活度 + 21 词匹配度 + overall（每样本 3 次取均值）
- 规则：47 动作头全未激活（max<15）→ overall 强制 0；否则 VL 均值
- 训练配方：纯乱作 → A 全 0 + Ov=0；部分包含动作头 → A 用 VL 激活度 + Ov 用 VL 分
