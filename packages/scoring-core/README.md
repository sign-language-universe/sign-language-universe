# scoring-core

手语打分核心算法包。

当前内容从 `/data/WYC/signLanguage/work/scripts` 的可维护子集中迁入：

- `score_holistic_sequence_mvp.py`
- `keyframe_sampling_common.py`
- `signlanguage_common.py`
- `visualize_holistic_features.py`

注意：

- 当前代码仍保留部分历史默认路径，例如 `/data/WYC/signLanguage` 下的模板数据路径。
- 第一阶段只保证包结构和基础语法检查，后续需要把模板根目录、输出目录、语义权重路径改成显式配置。
- 大型 Holistic cache、真实视频、web replay 结果不进入本仓库。
