/**
 * ModelScorer —— 轻量模型打分模块（onnxruntime-web + BiLSTM 语义动作模型）
 * 输入：landmarkRows（与 scoring-core 相同格式）+ 目标词
 * 输出：{ total(0-100), composite(0-1), conf, actions: [{name, score}], advice: [..] }
 * 依赖：全局 ort（vendor/onnxruntime/ort.all.min.js）、ScorerCore（scoring-core.js）
 * 特征：复用 ScorerCore.sequenceFromRows 的 7 组特征，按训练顺序组装 235d/帧
 *       训练组序: pose(27)+left_hand(63)+right_hand(63)+face(36)+left_hand_shape(19)+right_hand_shape(19)+two_hand_relation(8)
 */
const ModelScorer = (() => {
  const MODEL_BASE = new URL('assets/model/', document.baseURI).href;
  const T = 30, D = 235;
  let meta = null;
  let actionSession = null, wordSession = null;
  let initPromise = null;
  let status = 'idle'; // idle | loading | ready | error
  let statusDetail = '';
  // 模型缓存击穿：版本参数随模型更新变化，强制浏览器重新下载模型（避免 VSCode 缓存旧模型）
  const MODEL_VER = '20260810-v5';

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
      const [m, act, wrd] = await Promise.all([
        fetchJson(MODEL_BASE + 'action_meta.json?v=' + MODEL_VER),
        ort.InferenceSession.create(MODEL_BASE + 'action_model.onnx?v=' + MODEL_VER, { executionProviders: ['wasm'] }),
        ort.InferenceSession.create(MODEL_BASE + 'word_model.onnx?v=' + MODEL_VER, { executionProviders: ['wasm'] }),
      ]);
      meta = m;
      actionSession = act;
      wordSession = wrd;
      status = 'ready';
      statusDetail = `模型就绪（${m.num_actions} 语义动作，${m.word_list.length} 词）`;
    })().catch(e => {
      // 加载失败不缓存拒绝：重置 initPromise 允许下次打分重试（网络抖动/首次加载超时后自愈）
      status = 'error';
      statusDetail = String(e && e.message || e);
      initPromise = null;
      throw e;
    });
    return initPromise;
  }

  /** 训练版特征常量（对齐 build_weighted_holistic_feature_database.py） */
  const POSE_CORE_IDS = [0, 11, 12, 13, 14, 15, 16, 23, 24];
  const FACE_CORE_IDS = [33, 133, 159, 145, 362, 263, 386, 374, 61, 291, 13, 14];
  const FINGER_TIPS = [4, 8, 12, 16, 20];
  const FINGER_MCPS = [1, 5, 9, 13, 17];
  const FINGER_PIPS = [2, 6, 10, 14, 18];
  const SPREAD_PAIRS = [[4, 8], [8, 12], [12, 16], [16, 20]];

  function points3(arr) {
    return (arr || []).map(p => {
      if (!p) return [0, 0, 0];
      if (Array.isArray(p)) return [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
      return [Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0];
    });
  }
  function dist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  function straightness(a, b, c) {
    const lx = a[0] - b[0], ly = a[1] - b[1], lz = a[2] - b[2];
    const rx = c[0] - b[0], ry = c[1] - b[1], rz = c[2] - b[2];
    const denom = Math.hypot(lx, ly, lz) * Math.hypot(rx, ry, rz);
    if (denom <= 1e-8) return 0;
    const cosine = Math.max(-1, Math.min(1, (lx * rx + ly * ry + lz * rz) / denom));
    return (1 - cosine) / 2;
  }
  /** 训练版归一化：scale = max(肩宽, 躯干长) */
  function normalizeFrame(poseAll, left, right, face) {
    let center, scale;
    if (poseAll.length >= 25) {
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const sc = mid(poseAll[11], poseAll[12]);
      const sw = Math.hypot(poseAll[11][0] - poseAll[12][0], poseAll[11][1] - poseAll[12][1]);
      const hc = mid(poseAll[23], poseAll[24]);
      const torso = Math.hypot(sc[0] - hc[0], sc[1] - hc[1]);
      scale = Math.max(sw, torso, 1e-3);
      center = sc;
    } else {
      const visible = left.concat(right);
      if (!visible.length) {
        center = [0, 0, 0];
        scale = 1e-3;
      } else {
        const xs = visible.map(p => p[0]), ys = visible.map(p => p[1]);
        const sortedX = xs.slice().sort((a, b) => a - b), sortedY = ys.slice().sort((a, b) => a - b);
        const med = arr => arr[Math.floor(arr.length / 2)];
        center = [med(sortedX), med(sortedY), med(visible.map(p => p[2]).slice().sort((a, b) => a - b))];
        const dx = sortedX[sortedX.length - 1] - sortedX[0], dy = sortedY[sortedY.length - 1] - sortedY[0];
        scale = Math.max(Math.hypot(dx, dy), 1e-3);
      }
    }
    const norm = arr => arr.map(p => [(p[0] - center[0]) / scale, (p[1] - center[1]) / scale, (p[2] - center[2]) / scale]);
    const poseCore = poseAll.length >= 25 ? norm(POSE_CORE_IDS.map(i => poseAll[i])) : [];
    return { pose: poseCore, left: norm(left), right: norm(right), face: norm(face) };
  }
  /** 19d 手形（对齐训练脚本 hand_shape） */
  function handShape(hand) {
    if (hand.length !== 21) return new Array(19).fill(0);
    const refs = [5, 9, 13, 17].map(i => dist(hand[i], hand[0]));
    refs.push(dist(hand[5], hand[17]));
    const scale = Math.max(refs.reduce((a, b) => a + b, 0) / refs.length, 1e-3);
    const values = [];
    FINGER_TIPS.forEach(tip => values.push(dist(hand[0], hand[tip]) / scale));
    SPREAD_PAIRS.forEach(([f, s]) => values.push(dist(hand[f], hand[s]) / scale));
    FINGER_MCPS.forEach((mcp, i) => values.push(dist(hand[mcp], hand[FINGER_TIPS[i]]) / scale));
    FINGER_MCPS.forEach((mcp, i) => values.push(straightness(hand[mcp], hand[FINGER_PIPS[i]], hand[FINGER_TIPS[i]])));
    return values;
  }
  /** 8d 双手关系（对齐训练脚本 two_hand_relation） */
  function twoHandRelation(left, right) {
    if (left.length !== 21 || right.length !== 21) return new Array(8).fill(0);
    const mean = pts => pts.reduce((acc, i) => [acc[0] + left[i][0], acc[1] + left[i][1]], [0, 0]).map(v => v / pts.length);
    const leftGround = mean([0, 5, 9, 13, 17]);
    const rtips = [8, 12].map(i => right[i]);
    const rbases = [5, 9].map(i => right[i]);
    const tipRel = [rtips[0][0] - leftGround[0], rtips[0][1] - leftGround[1]];
    const baseRel = [rbases[0][0] - leftGround[0], rbases[0][1] - leftGround[1]];
    const axis = [rtips[0][0] - rbases[0][0], rtips[0][1] - rbases[0][1]];
    return [tipRel[0], tipRel[1], baseRel[0], baseRel[1], axis[0], axis[1],
            Math.hypot(tipRel[0], tipRel[1]), Math.hypot(baseRel[0], baseRel[1])];
  }

  /** landmarkRows（前端格式）→ 30×235 输入（训练版特征 + 线性插值重采样） */
  function buildModelInput(landmarkRows, fps) {
    const rows = landmarkRows.slice().sort((a, b) => (a.timestamp_ms || 0) - (b.timestamp_ms || 0));
    const n = rows.length;
    const out = new Float32Array(T * D);
    if (!n) return out;
    const frameVecs = rows.map(row => {
      const poseAll = points3(row.pose_landmarks);
      const left = points3(row.left_hand_landmarks);
      const right = points3(row.right_hand_landmarks);
      const faceAll = (row.face_core_landmarks && row.face_core_landmarks.length)
        ? points3(row.face_core_landmarks)
        : (row.face_landmarks && row.face_landmarks.length === 12)
          ? points3(row.face_landmarks)   // sparse_core_12：face 直接 12 点（勿按 468 索引）
          : FACE_CORE_IDS.map(i => (row.face_landmarks && row.face_landmarks[i]) || { x: 0, y: 0, z: 0 });
      const norm = normalizeFrame(poseAll, left, right, faceAll);
      const vec = [];
      const push = arr => { arr.forEach(p => vec.push(p[0], p[1], p[2])); };
      push(norm.pose.length === 9 ? norm.pose : [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
      push(norm.left.length === 21 ? norm.left : new Array(21).fill([0, 0, 0]));
      push(norm.right.length === 21 ? norm.right : new Array(21).fill([0, 0, 0]));
      push(norm.face.length === 12 ? norm.face : new Array(12).fill([0, 0, 0]));
      vec.push(...handShape(norm.left.length === 21 ? norm.left : []));
      vec.push(...handShape(norm.right.length === 21 ? norm.right : []));
      vec.push(...twoHandRelation(norm.left.length === 21 ? norm.left : [], norm.right.length === 21 ? norm.right : []));
      return vec;
    });
    for (let t = 0; t < T; t++) {
      const pos = (n - 1) * t / (T - 1);
      const i0 = Math.floor(pos), i1 = Math.min(i0 + 1, n - 1), w = pos - i0;
      const v0 = frameVecs[i0], v1 = frameVecs[i1];
      const base = t * D;
      for (let k = 0; k < D; k++) out[base + k] = (v0[k] || 0) * (1 - w) + (v1[k] || 0) * w;
    }
    return out;
  }

  function softmax(logits) {
    const m = Math.max(...logits);
    const exps = logits.map(x => Math.exp(x - m));
    const s = exps.reduce((a, b) => a + b, 0);
    return exps.map(x => x / s);
  }

  /** 界面语言检测（多源：AppState.locale / localStorage / html lang），保证建议语言与界面一致 */
  function isEnglishLocale() {
    if (typeof window === 'undefined') return false;
    try {
      if (window.AppState && window.AppState.locale === 'en') return true;
      if (window.localStorage && window.localStorage.getItem('sluInteractiveLocale') === 'en') return true;
      if (document.documentElement && document.documentElement.lang === 'en') return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  /** 综合练习建议：抓取语义打分中最差的动作重点提建议（非泛泛而谈；支持中英文） */
  function buildCompositeAdvice(word, total, actions, en) {
    if (en) {
      if (total >= 90) return [`Excellent! All core semantic actions of "${word}" are well performed — very standard!`];
      if (!actions.length) return [`"${word}": no semantic actions captured. Keep both hands fully in frame and record again.`];
      const worst = actions.slice().sort((a, b) => a.score - b.score)[0];
      const d = worst.detail ? `Key points: ${worst.detail}` : '';
      if (total >= 80) {
        if (worst.score >= 85) return [`Great job on "${word}" — keep it up!`];
        return [`Overall good! Focus on "${worst.name}" (${worst.score}). ${d} Adjust the range and hand shape against the reference.`];
      }
      if (worst.score >= 55) return [`Most needed improvement: "${worst.name}" (${worst.score}). ${d} Practice slowly in parts against the reference, focusing on the hand shape and trajectory.`];
      if (worst.score >= 30) return [`"${worst.name}" scored only ${worst.score} — significant deviation. ${d} Compare frame by frame: check the starting hand shape, middle trajectory, and ending position, then redo the whole word.`];
      return [`"${worst.name}" is barely performed (${worst.score}). ${d} Watch only that part of the reference, follow along 3-5 times, then do the full word.`];
    }
    if (total >= 90) return [`太棒了！「${word}」的核心语义动作全部到位，动作非常标准！`];
    if (!actions.length) return [`「${word}」当前未能有效采集到语义动作，请让双手完整入画后重录。`];
    // 抓取最差的 1 个动作（避免分散注意力）
    const worst = actions.slice().sort((a, b) => a.score - b.score)[0];
    const d = worst.detail ? `该动作要点：${worst.detail}` : '';
    if (total >= 80) {
      if (worst.score >= 85) return [`「${word}」整体表现优秀，继续保持！`];
      return [`整体不错！重点加强「${worst.name}」（${worst.score}分）。${d}对照示范调整幅度与手形即可。`];
    }
    if (worst.score >= 55) {
      return [`当前最需要改进的是「${worst.name}」（${worst.score}分）。${d}建议对照示范慢速分解练习，重点纠正该动作的手形与轨迹。`];
    }
    if (worst.score >= 30) {
      return [`「${worst.name}」只得了 ${worst.score} 分，偏差较大。${d}请先逐帧对照示范：确认起始手形、中间轨迹、结束位置，再完整重做。`];
    }
    return [`「${worst.name}」几乎未完成（${worst.score}分）。${d}建议先只看示范中该动作片段，跟随练习 3-5 遍，再做整个词汇。`];
  }

  /** 词族（双变体等互相视为同一词，避免 conf 门控误伤） */
  const WORD_FAMILIES = {
    '汽车（一）': ['汽车（一）', '汽车（二）'],
    '汽车（二）': ['汽车（一）', '汽车（二）'],
  };

  /**
   * 打分入口（固定词场景）
   * @param landmarkRows 浏览器 Holistic 输出的 landmark 行数组
   * @param targetWord 目标词（如 "谗（羡慕）"）
   * @param fps 采样帧率（默认 10）
   * @param opts { gate: 是否启用词判定门控（默认 false，纯语义动作程度打分） }
   */
  async function score(landmarkRows, targetWord, fps, opts = {}) {
    await init();
    const input = buildModelInput(landmarkRows, fps);
    const tensor = new ort.Tensor('float32', input, [1, T, D]);
    const feed = { landmark_sequence: tensor };
    const actOut = await actionSession.run(feed);
    const wrdOut = await wordSession.run(feed);

    const scores = Array.from(actOut.action_scores.data);
    const logits = Array.from(wrdOut.word_logits.data);
    const probs = softmax(logits);

    const widx = meta.word_list.indexOf(targetWord);
    const gids = widx >= 0 ? (meta.word_actions[targetWord] || []) : [];
    const composite = gids.length ? gids.reduce((s, g) => s + scores[g], 0) / gids.length : 0;
    // 词族门控：conf 取族内最大概率（汽车一/二互认，避免双变体误伤）
    const fam = WORD_FAMILIES[targetWord] || [targetWord];
    const conf = fam.reduce((m, w) => {
      const i = meta.word_list.indexOf(w);
      return i >= 0 ? Math.max(m, probs[i]) : m;
    }, 0);
    // 分段门控（默认开启）：conf≥0.5 时总分=composite（正常动作不打折）；
    // conf<0.5 时按比例压低（动作"不像这个词"→ 分数显著下降，拦截错位负样本）。
    // 依据：正样本 conf median 0.998（<0.5 仅 1.9%）；错位负样本 conf 0-0.1 → 分数 ×0-0.2。
    const gate = opts.gate !== false;
    let total01 = composite;
    if (gate) {
      total01 = composite * Math.min(1, conf / 0.5);
    }
    const total = Math.round(Math.max(0, Math.min(1, total01)) * 100);

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

    // 综合练习建议：总分维度 + 弱动作明细，高分表扬（中英文随界面语言）
    const advice = buildCompositeAdvice(targetWord, total, actions, en);

    // 词判定诊断提示：默认关闭（用户审核中，不干扰）；仅 gate 模式开启
    const topIdx = probs.indexOf(Math.max(...probs));
    const diagnosis = (gate && widx >= 0 && conf < 0.3)
      ? `看起来这个动作更像「${meta.word_list[topIdx]}」，请确认在做「${targetWord}」的动作`
      : '';

    return {
      total,
      composite: Math.round(composite * 1000) / 1000,
      conf: Math.round(conf * 1000) / 1000,
      actions,
      advice,
      diagnosis,
      status: 'ok',
    };
  }

  function getStatus() {
    return { status, statusDetail };
  }

  return { init, score, getStatus, buildModelInput };
})();
globalThis.ModelScorer = ModelScorer;
if (typeof window !== 'undefined') window.ModelScorer = ModelScorer;
