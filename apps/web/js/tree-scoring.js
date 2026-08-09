/**
 * TreeScorer —— 语义树结构打分模块（手形/运动/叶子三层检测器）
 * 输入：landmarkRows + 目标词；输出：叶子综合分 + 手形/运动层诊断 + 细粒度建议
 * 依赖：全局 ort、ModelScorer.buildModelInput（复用特征构建）
 * 模型：tree_model.onnx（shape_scores 12 + motion_scores 20 + leaf_scores 47 + leaf_exists 47）
 */
const TreeScorer = (() => {
  const MODEL_BASE = new URL('assets/model/', document.baseURI).href;
  const T = 30, D = 235;
  let meta = null, session = null, initPromise = null;
  let status = 'idle', statusDetail = '';

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      status = 'loading';
      if (typeof ort === 'undefined') throw new Error('onnxruntime 未加载');
      ort.env.wasm.wasmPaths = new URL('vendor/onnxruntime/', document.baseURI).href;
      ort.env.wasm.numThreads = 1;
      const [m, s] = await Promise.all([
        fetch(MODEL_BASE + 'tree_model.json').then(r => r.json()),
        ort.InferenceSession.create(MODEL_BASE + 'tree_model.onnx', { executionProviders: ['wasm'] }),
      ]);
      meta = m; session = s;
      status = 'ready';
      statusDetail = `语义树就绪（${m.n_shape} 手形 / ${m.n_motion} 运动 / ${m.n_leaf} 叶子）`;
    })().catch(e => { status = 'error'; statusDetail = String(e && e.message || e); throw e; });
    return initPromise;
  }

  /** 词 → 叶子 idx（含别名） */
  function leafIndicesFor(word) {
    const ALIASES = { '谗（羡慕）': '馋', '汽车（一）': '汽车' };
    const canon = ALIASES[word] || word;
    const idx = [];
    meta.leaf_word.forEach((w, i) => { if (w === word || w === canon) idx.push(i); });
    return idx;
  }
  function shapeIdx(name) { return meta.shape_names.indexOf(name); }
  function motionIdx(name) { return meta.motion_names.indexOf(name); }

  /**
   * 树模型打分（三层）
   * @returns { total, composite, leafScores, shapeDiag:[{name,activ,need,ok}], motionDiag, advice }
   */
  async function score(landmarkRows, targetWord, fps, opts = {}) {
    await init();
    const input = ModelScorer.buildModelInput(landmarkRows, fps);
    const tensor = new ort.Tensor('float32', input, [1, T, D]);
    const out = await session.run({ landmark_sequence: tensor });
    const shapeAct = Array.from(out.shape_scores.data);
    const motionAct = Array.from(out.motion_scores.data);
    const leafAct = Array.from(out.leaf_scores.data);

    const gids = leafIndicesFor(targetWord);
    const composite = gids.length ? gids.reduce((a, g) => a + leafAct[g], 0) / gids.length : 0;
    const total = Math.round(Math.max(0, Math.min(1, composite)) * 100);

    // 目标词应有的手形/运动（从叶子映射）
    const needShapes = {}, needMotions = {};
    gids.forEach(g => {
      needShapes[meta.leaf_hand_shape[g]] = true;
      needMotions[meta.leaf_motion[g]] = true;
    });
    // 手形/运动层诊断
    const shapeDiag = Object.keys(needShapes).map(name => ({
      name, activ: shapeAct[shapeIdx(name)] || 0, need: true, ok: (shapeAct[shapeIdx(name)] || 0) > 0.5,
    }));
    const motionDiag = Object.keys(needMotions).map(name => ({
      name, activ: motionAct[motionIdx(name)] || 0, need: true, ok: (motionAct[motionIdx(name)] || 0) > 0.5,
    }));

    // 细粒度建议：未充分激活的手形/运动（按激活值升序，最多 2 项）+ 叶子弱项
    const weakShapes = shapeDiag.filter(d => !d.ok).sort((a, b) => a.activ - b.activ);
    const weakMotions = motionDiag.filter(d => !d.ok).sort((a, b) => a.activ - b.activ);
    const en = typeof window !== 'undefined' && (window.AppState?.locale === 'en' ||
      (window.localStorage && window.localStorage.getItem('sluInteractiveLocale') === 'en'));
    const advice = [];
    weakShapes.slice(0, 2).forEach(d => {
      advice.push(en
        ? `Hand shape "${d.name}" is weakly activated (${Math.round(d.activ * 100)}%) — the required hand form is not clearly present.`
        : `手形「${d.name}」激活不足（${Math.round(d.activ * 100)}%）——当前手形未形成该语义动作所需形态。`);
    });
    weakMotions.slice(0, 2).forEach(d => {
      advice.push(en
        ? `Motion "${d.name}" is weakly activated (${Math.round(d.activ * 100)}%) — check the movement trajectory.`
        : `运动「${d.name}」激活不足（${Math.round(d.activ * 100)}%）——动作轨迹/幅度可能不到位。`);
    });
    // 叶子弱项（composite 低时补充）
    if (gids.length && composite < 0.7) {
      const weakLeaf = gids.map(g => ({ name: meta.leaf_names[g], s: leafAct[g] }))
        .sort((a, b) => a.s - b.s)[0];
      if (weakLeaf && weakLeaf.s < 0.6) {
        advice.push(en
          ? `Core action "${weakLeaf.name}" scored ${Math.round(weakLeaf.s * 100)} — practice this part against the reference.`
          : `核心语义「${weakLeaf.name}」仅 ${Math.round(weakLeaf.s * 100)} 分——请对照示范重点练习该动作。`);
      }
    }
    if (!advice.length) {
      advice.push(en ? 'All semantic layers matched well. Excellent!' : '各语义层均充分匹配，动作标准！');
    }

    return { total, composite: Math.round(composite * 1000) / 1000, leafScores: leafAct,
             shapeDiag, motionDiag, advice, status: 'ok' };
  }

  function getStatus() { return { status, statusDetail }; }
  return { init, score, getStatus };
})();
globalThis.TreeScorer = TreeScorer;
if (typeof window !== 'undefined') window.TreeScorer = TreeScorer;
