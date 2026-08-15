/**
 * CascadeScorer —— 级联模型统一打分模块（D6.1/D6.2/T7.1/T7.2 切换，onnxruntime-web）
 * 输入：landmarkRows + 目标词
 * 输出：{ total(0-100), composite(0-1), actions: [{name,score,detail}], advice: [..], model: 'D6.2', ... }
 *
 * 与 ModelScorer 的差异：
 *  - 加载版本化级联 ONNX（dual_cascade_vX / tree_cascade_vX），统一输出 action_head(47) + overall(1)
 *  - 综合分 = overall × conf 门控（conf = 目标词叶子平均激活度，不足阈值按比例折减，拦截乱作/非目标词）
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
  const DEFAULT_MODEL = 'D6.1';   // 默认 D6.1（现场 MAE 4.92 有区分能力）；D6.2 overall 虚高不上线
  const MODEL_VER = '20260815-cascade';
  const LS_KEY = 'sluCascadeModel';
  // conf 门控：目标词叶子平均激活度（0-1）低于此阈值时，综合分按 conf/阈值 比例折减
  // 阈值依据：正例 conf 0.51-0.82 vs 乱作负例 0.003-0.034（间距 >10 倍，0.5 落在无人区）
  const CONF_GATE_THRESHOLD = 0.5;
  const CONF_GATE_WEAK = 0.1;     // 低于此值视为"几乎未识别到目标词语义动作"（强提示）
  // 词级门控豁免：部分词（训练样本少 / 精细手形）D6.1 的 conf 对 pos/neg 无分离度，
  // 用全局阈值会误伤正例（汽车二 pos conf 0.006-0.16 vs neg 0.004-0.007 几乎重叠）。
  // 值 0 = 该词不设 conf 门控（无折减、无提示）；后续可改为词级标定阈值。
  const WORD_GATE_OVERRIDE = { '人们（人民）': 0, '汽车（二）': 0 };

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
    // conf 门控：conf = 目标词叶子平均激活度（该维 sigmoid 输出即"该词被检测到"的置信度）
    // 总分 = overall × min(1, conf/阈值)；conf 不足时按比例折减，拦截乱作/非目标词输入
    const conf = Math.round(composite * 1000) / 1000;
    const gateEnabled = opts.gate !== false;   // 默认启用；显式 gate:false 关闭（调试/兜底路径）
    // 词级阈值：WORD_GATE_OVERRIDE 覆盖全局阈值（0 = 该词不设门控，无折减无提示）
    const wordTh = (WORD_GATE_OVERRIDE[targetWord] !== undefined)
      ? WORD_GATE_OVERRIDE[targetWord] : CONF_GATE_THRESHOLD;
    const gateActive = gateEnabled && wordTh > 0;
    const gateFactor = gateActive ? Math.min(1, conf / wordTh) : 1;
    const total01 = Math.max(0, Math.min(1, overall[0])) * gateFactor;
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
        detail_zh: detailZh,
        detail_en: detailEn,
        score: Math.round(Math.max(0, Math.min(1, scores[g])) * 100),
      };
    });

    const advice = buildAdvice(targetWord, total, actions, en);
    // conf 不足提示词：放 advice 首位，进入主反馈消息（仅门控启用时）
    if (gateActive && conf < wordTh) {
      const pct = Math.round(conf * 100);
      const lowHint = conf < CONF_GATE_WEAK
        ? (en
          ? [`⚠️ No core semantic action for "${targetWord}" detected (conf ${pct}%). You may not have performed the sign, or your hands were not fully in frame — follow the reference and record again.`]
          : [`⚠️ 未识别到「${targetWord}」的核心语义动作（conf ${pct}%），可能未做该词动作或双手未完整入画，请对照示范重录。`])
        : (en
          ? [`⚠️ Semantic action for "${targetWord}" was only weakly detected (conf ${pct}%). Score discounted — perform the full sign and record again.`]
          : [`⚠️ 「${targetWord}」的语义动作识别不足（conf ${pct}%），综合分已按置信度折减，请完整示范该词后重录。`]);
      advice.unshift(...lowHint);
    }

    return {
      total,
      composite: Math.round(composite * 1000) / 1000,
      conf,
      gate: gateActive ? gateFactor : 1,
      gate_th: wordTh,
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
