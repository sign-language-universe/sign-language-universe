/**
 * TreeScorer —— 语义树结构打分模块（手形/运动/叶子三层检测器）
 * 输入：landmarkRows + 目标词；输出：叶子综合分 + 手形/运动层诊断 + 细粒度建议
 * 依赖：全局 ort、ModelScorer.buildModelInput（复用特征构建）
 * 模型：tree_model_v63.onnx（shape_scores 12 + motion_scores 20 + leaf_scores 47 + leaf_exists 47）
 * 缓存：加载版本化文件名（tree_model_v63.*），路径级击穿 VSCode Webview 顽固缓存（见下方注释）
 */
const TreeScorer = (() => {
  const MODEL_BASE = new URL('assets/model/', document.baseURI).href;
  const T = 30, D = 235;
  let meta = null, session = null, initPromise = null;
  let status = 'idle', statusDetail = '';
  // 模型缓存击穿（v3 加固 20260810）：改用「版本化文件名」而非 ?v= 查询参数。
  // VSCode Simple Browser/Webview 的缓存存在客户端 Code/Service Worker/CacheStorage，
  // 有已知的「不按 Cache-Control/no-store 失效、不清理」问题（microsoft/vscode#132376/#320928）。
  // 查询参数击穿对按路径做键的缓存无效；版本化文件名（tree_model_v63.*）路径唯一，
  // 旧页面引用旧文件名、新页面引用新文件名，路径级缓存不可能跨版本串模型。
  // 注意：后续更新模型时必须同步改这两个文件名（tree_model_v62 → 新版本号）。
  const MODEL_ONNX = 'tree_model_v63.onnx';
  const MODEL_JSON = 'tree_model_v63.json';

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      status = 'loading';
      if (typeof ort === 'undefined') throw new Error('onnxruntime 未加载');
      ort.env.wasm.wasmPaths = new URL('vendor/onnxruntime/', document.baseURI).href;
      ort.env.wasm.numThreads = 1;
      const [m, s] = await Promise.all([
        fetch(MODEL_BASE + MODEL_JSON).then(r => r.json()),
        ort.InferenceSession.create(MODEL_BASE + MODEL_ONNX, { executionProviders: ['wasm'] }),
      ]);
      meta = m; session = s;
      status = 'ready';
      statusDetail = `语义树就绪（${m.n_shape} 手形 / ${m.n_motion} 运动 / ${m.n_leaf} 叶子）`;
    })().catch(e => {
      // 加载失败不缓存拒绝：重置 initPromise 允许下次打分重试（网络抖动/首次加载超时后自愈）
      status = 'error';
      statusDetail = String(e && e.message || e);
      initPromise = null;
      throw e;
    });
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
  /** 模型版本（tree_model.json 的 version 字段；换模型只需更新 json） */
  function getVersion() {
    return (meta && meta.version) || '';
  }
  return { init, score, getStatus, getVersion };
})();
globalThis.TreeScorer = TreeScorer;
if (typeof window !== 'undefined') window.TreeScorer = TreeScorer;
