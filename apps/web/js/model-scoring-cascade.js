/**
 * CascadeScorer —— 级联模型统一打分模块（D6.1/D6.2/T7.1/T7.2 切换，onnxruntime-web）
 * 输入：landmarkRows + 目标词
 * 输出：{ total(0-100), composite(0-1), actions: [{name,score,detail}], advice: [..], model: 'D6.2', ... }
 *
 * 与 ModelScorer 的差异：
 *  - 加载版本化级联 ONNX（dual_cascade_vX / tree_cascade_vX），统一输出 action_head(47) + overall(1)
 *  - 综合分直接用 overall（级联 MLP 输出），去掉 conf 词判定门控
 *  - action_head 47 维直接映射 action_meta.json 的 action_names（彩条）
 *  - 模型切换：setModel / score({model})，localStorage 记忆
 */
const CascadeScorer = (() => {
  const MODEL_BASE = new URL('assets/model/', document.baseURI).href;
  const T = 30, D = 235;
  // 4 个模型：显示名 → onnx 文件名（与 assets/model/ 下版本化文件对应）
  const MODELS = {
    'D6.1': 'dual_cascade_v1.onnx',
    'D6.2': 'dual_cascade_v62.onnx',
    'T7.1': 'tree_cascade_v1.onnx',
    'T7.2': 'tree_cascade_v72.onnx',
  };
  const DEFAULT_MODEL = 'D6.2';
  const MODEL_VER = '20260815-cascade';
  const LS_KEY = 'sluCascadeModel';

  let meta = null;
  let sessions = {};      // modelName -> InferenceSession
  let initPromise = null;
  let status = 'idle';
  let statusDetail = '';
  let currentModel = (() => {
    try { return localStorage.getItem(LS_KEY) || DEFAULT_MODEL; } catch (e) { return DEFAULT_MODEL; }
  })();
  if (!MODELS[currentModel]) currentModel = DEFAULT_MODEL;

  async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
    return r.json();
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      status = 'loading';
      if (typeof ort === 'undefined') throw new Error('onnxruntime (ort) 未加载');
      ort.env.wasm.wasmPaths = new URL('vendor/onnxruntime/', document.baseURI).href;
      ort.env.wasm.numThreads = 1;
      meta = await fetchJson(MODEL_BASE + 'action_meta.json?v=' + MODEL_VER);
      // 预加载当前模型（其余按需加载）
      await loadSession(currentModel);
      status = 'ready';
      statusDetail = `级联模型就绪（${Object.keys(MODELS).length} 模型可切换，当前 ${currentModel}）`;
    })().catch(e => {
      status = 'error';
      statusDetail = String(e && e.message || e);
      initPromise = null;
      throw e;
    });
    return initPromise;
  }

  async function loadSession(modelName) {
    if (sessions[modelName]) return sessions[modelName];
    const onnx = MODELS[modelName];
    if (!onnx) throw new Error(`未知模型: ${modelName}`);
    const sess = await ort.InferenceSession.create(MODEL_BASE + onnx + '?v=' + MODEL_VER, { executionProviders: ['wasm'] });
    sessions[modelName] = sess;
    return sess;
  }

  function setModel(modelName) {
    if (!MODELS[modelName]) return;
    currentModel = modelName;
    try { localStorage.setItem(LS_KEY, modelName); } catch (e) { /* ignore */ }
  }

  function getModel() { return currentModel; }

  function isEnglishLocale() {
    if (typeof window === 'undefined') return false;
    try {
      if (window.AppState && window.AppState.locale === 'en') return true;
      if (window.localStorage && window.localStorage.getItem('sluInteractiveLocale') === 'en') return true;
      if (document.documentElement && document.documentElement.lang === 'en') return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function buildAdvice(word, total, actions, en) {
    if (en) {
      if (total >= 90) return [`Excellent! All core semantic actions of "${word}" are well performed — very standard!`];
      if (!actions.length) return [`"${word}": no semantic actions captured. Keep both hands fully in frame and record again.`];
      const worst = actions.slice().sort((a, b) => a.score - b.score)[0];
      const d = worst.detail ? `Key points: ${worst.detail}` : '';
      if (total >= 80) return [`Overall good! Focus on "${worst.name}" (${worst.score}). ${d}`];
      if (worst.score >= 55) return [`Most needed improvement: "${worst.name}" (${worst.score}). ${d} Practice slowly against the reference.`];
      if (worst.score >= 30) return [`"${worst.name}" scored only ${worst.score} — significant deviation. ${d} Compare frame by frame and redo.`];
      return [`"${worst.name}" is barely performed (${worst.score}). ${d} Follow the reference 3-5 times then redo.`];
    }
    if (total >= 90) return [`太棒了！「${word}」的核心语义动作全部到位，动作非常标准！`];
    if (!actions.length) return [`「${word}」当前未能有效采集到语义动作，请让双手完整入画后重录。`];
    const worst = actions.slice().sort((a, b) => a.score - b.score)[0];
    const d = worst.detail ? `该动作要点：${worst.detail}` : '';
    if (total >= 80) return [`整体不错！重点加强「${worst.name}」（${worst.score}分）。${d}对照示范调整幅度与手形即可。`];
    if (worst.score >= 55) return [`当前最需要改进的是「${worst.name}」（${worst.score}分）。${d}建议对照示范慢速分解练习。`];
    if (worst.score >= 30) return [`「${worst.name}」只得了 ${worst.score} 分，偏差较大。${d}请逐帧对照示范再完整重做。`];
    return [`「${worst.name}」几乎未完成（${worst.score}分）。${d}建议先只看示范该片段跟随练习 3-5 遍。`];
  }

  /**
   * 打分入口（固定词场景，级联模型）
   * @param opts { model?: 'D6.2'|'D6.1'|'T7.1'|'T7.2' }
   */
  async function score(landmarkRows, targetWord, fps, opts = {}) {
    await init();
    const modelName = opts.model && MODELS[opts.model] ? opts.model : currentModel;
    if (modelName !== currentModel) setModel(modelName);
    const session = await loadSession(modelName);

    const input = (typeof ModelScorer !== 'undefined' && ModelScorer.buildModelInput)
      ? ModelScorer.buildModelInput(landmarkRows, fps)
      : (() => { throw new Error('ModelScorer.buildModelInput 不可用'); })();
    // 调试：输入特征 + ONNX 输出检查
    const r0 = landmarkRows[0] || {};
    const rmid = landmarkRows[Math.floor(landmarkRows.length / 2)] || {};
    const lh = r0.left_hand_landmarks;
    const rh = r0.right_hand_landmarks;
    const dbg = (v, tag) => {
      if (!v || !v.length) return `${tag}: (empty)`;
      if (Array.isArray(v)) {
        const first = v[0];
        if (!first) return `${tag}: array len=${v.length} first=(empty)`;
        if (Array.isArray(first)) return `${tag}: array len=${v.length} first=内层数组${first.length}`;
        return `${tag}: array len=${v.length} first=${JSON.stringify(first).slice(0, 60)}`;
      }
      return `${tag}: ${typeof v}`;
    };
    console.log('[CascadeScorer] row0 keys:', Object.keys(r0).join(','),
      '| pose:', (r0.pose_landmarks || []).length,
      '|', dbg(lh, 'left'), '|', dbg(rh, 'right'),
      '| face_core:', (r0.face_core_landmarks || []).length);
    console.log('[CascadeScorer] rowMid pose[0]:', JSON.stringify((rmid.pose_landmarks || [])[0] || null).slice(0, 120));
    const inpArr = Array.from(input);
    console.log('[CascadeScorer]', modelName, 'input len:', input.length,
      'nonzero:', inpArr.filter(v => v !== 0).length,
      'rows:', landmarkRows.length, 'fps:', fps, 'word:', targetWord);
    const tensor = new ort.Tensor('float32', input, [1, T, D]);
    const out = await session.run({ x: tensor });

    const scores = Array.from(out.action_head.data);   // 47 维 sigmoid 0-1
    const overall = Array.from(out.overall.data);      // 1 维 sigmoid 0-1
    console.log('[CascadeScorer] overall:', overall[0].toFixed(4),
      'action max:', Math.max(...scores).toFixed(4),
      'action >0.5:', scores.filter(v => v > 0.5).length,
      'action head len:', scores.length);

    const widx = meta.word_list.indexOf(targetWord);
    const gids = widx >= 0 ? (meta.word_actions[targetWord] || []) : [];
    const composite = gids.length ? gids.reduce((s, g) => s + scores[g], 0) / gids.length : 0;
    const total01 = Math.max(0, Math.min(1, overall[0]));
    const total = Math.round(total01 * 100);

    const en = isEnglishLocale();
    const actions = gids.map(g => {
      const nameZh = meta.action_names[g];
      const nameEn = (meta.action_names_en && meta.action_names_en[g]) || nameZh;
      const detailZh = meta.action_details[g];
      const detailEn = (meta.action_details_en && meta.action_details_en[g]) || detailZh;
      return {
        name: en ? nameEn : nameZh,
        name_zh: nameZh,
        name_en: nameEn,
        detail: en ? detailEn : detailZh,
        score: Math.round(Math.max(0, Math.min(1, scores[g])) * 100),
      };
    });

    const advice = buildAdvice(targetWord, total, actions, en);

    return {
      total,
      composite: Math.round(composite * 1000) / 1000,
      conf: 1,
      actions,
      advice,
      diagnosis: '',
      status: 'ok',
      model: modelName,
    };
  }

  function getStatus() {
    return { status, statusDetail, currentModel, models: Object.keys(MODELS) };
  }

  return { init, score, getStatus, setModel, getModel, MODELS };
})();
globalThis.CascadeScorer = CascadeScorer;
if (typeof window !== 'undefined') window.CascadeScorer = CascadeScorer;
