/* coach-goal.js —— 「手语课后练习任务台」MVP 的「目标」环节模块。
   把平台上「只在打分后才露面」的教学契约前移到练习之前：
   先给出今天练哪个词、阶段分解、并行非手控特征，并按历史弱项推荐今日词。
   普通浏览器脚本：无依赖、无网络请求，可在 file:// 下直接 script 引入。 */
(function () {
  var WORDS = {
    chaoshi: {
      zh: '超市', minFrames: 7,
      stages: ['虚握购物车把手', '向前推动购物车', '左侧抓取第1次', '右侧抓取第1次',
               '左侧抓取第2次', '右侧抓取第2次', '回到虚握购物车把手'],
      nonmanual: [{ l: '购物车把手手形', f: ['双手虚握', '虎口相对', '手背向上'] },
                  { l: '双手交替抓取关系', f: ['左—右交替', '左右两侧各2次'] }]
    },
    gongjiao: {
      zh: '公交车', minFrames: 3,
      stages: ['虚握公交车把手', '前后晃动第1次', '前后晃动第2次'],
      nonmanual: [{ l: '公交车把手手形', f: ['一手虚握', '虎口朝内'] }]
    },
    qiche1: {
      zh: '汽车（一）', minFrames: 2,
      stages: ['双手虚握方向盘', '双手协同左右转动方向盘'],
      nonmanual: [{ l: '方向盘双手关系',
                    f: ['双手同时虚握', '保持方向盘相对结构', '转动时双手协同'] }]
    },
    qiche2: {
      zh: '汽车（二）', gated: true, minFrames: 2,
      stages: ['单手形成汽车侧面', '汽车向前移动'],
      nonmanual: [{ l: '汽车车身手形', f: ['一手五指成方块形', '移动中保持车身形状'] }]
    }
  };

  // 每个词参与弱项匹配的核心维度
  var WORD_DIMS = {
    chaoshi: ['把手手形', '左右交替顺序', '推动轨迹', '回位收束'],
    gongjiao: ['把手手形', '前后晃动次数', '晃动幅度'],
    qiche1: ['把手手形', '双手协同', '转动轨迹'],
    qiche2: ['方块手形', '移动中保持形状']
  };

  var ORDER = ['chaoshi', 'gongjiao', 'qiche1', 'qiche2'];
  var STORE_KEY = 'slu_taskboard_v1';
  var SEEN_KEY = 'slu_goal_seen';

  function readHistory(history) {
    var list = history;
    if (!list) {                                 // 未传参时回落到平台任务台历史
      try { list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
      catch (e) { list = []; }
    }
    return (list && typeof list.length === 'number') ? list : [];
  }

  function readSeen() {
    try {
      var obj = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) { return {}; }
  }

  // 某个词在某维度上的历史均分与是否练过
  function wordStat(hist, key, dim) {
    var zh = WORDS[key].zh, sum = 0, n = 0, done = false, i, j, d, e;
    for (i = 0; i < hist.length; i++) {
      e = hist[i];
      if (!e || e.word !== zh) { continue; }
      done = true;
      if (!e.dims) { continue; }
      for (j = 0; j < e.dims.length; j++) {
        d = e.dims[j];
        if (!d || d.n !== dim) { continue; }
        if (d.s === null || d.s === undefined) { continue; }
        sum += Number(d.s) || 0; n += 1;
      }
    }
    return { done: done, avg: n ? sum / n : 999 };
  }

  function dimAverages(hist) {
    var acc = {}, order = [], out = [], i, j, d, e;
    for (i = 0; i < hist.length; i++) {
      e = hist[i];
      for (j = 0; e && e.dims && j < e.dims.length; j++) {
        d = e.dims[j];
        if (!d || d.s === null || d.s === undefined) { continue; }
        if (!acc[d.n]) { acc[d.n] = { sum: 0, n: 0 }; order.push(d.n); }
        acc[d.n].sum += Number(d.s) || 0; acc[d.n].n += 1;
      }
    }
    for (i = 0; i < order.length; i++) {
      out.push({ n: order[i], avg: acc[order[i]].sum / acc[order[i]].n });
    }
    return out;
  }

  function pickTodayWord(history) {
    var hist = readHistory(history);
    if (!hist.length) {
      return { key: 'chaoshi', reason: '首次练习，从样本最充足的词开始' };
    }
    var list = dimAverages(hist), weak = null, i, st;
    for (i = 0; i < list.length; i++) {
      if (!weak || list[i].avg < weak.avg - 1e-9) { weak = list[i]; }
    }
    if (!weak) {
      return { key: 'chaoshi', reason: '还没有维度评分，先练样本最充足的超市' };
    }
    var dim = weak.n, fresh = null, used = null, k;
    for (i = 0; i < ORDER.length; i++) {
      k = ORDER[i];
      if (WORDS[k].gated) { continue; }          // 门控豁免词不出分，不参与推荐
      if (WORD_DIMS[k].indexOf(dim) < 0) { continue; }
      st = wordStat(hist, k, dim);
      if (!st.done) {                            // 未练词优先，且优先样本更充足的
        if (!fresh || WORDS[k].minFrames > WORDS[fresh].minFrames) { fresh = k; }
      } else if (!used || st.avg < used.avg) {
        used = { key: k, avg: st.avg };
      }
    }
    var pick = fresh || (used ? used.key : 'chaoshi');
    var reason = '「' + dim + '」偏弱，' + (fresh ? '先练未练过的' : '今天补练')
      + WORDS[pick].zh + '；汽车二样本不足已排除';
    return { key: pick, reason: reason };
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderGoalCard(wordKey, opts) {
    var w = WORDS[wordKey] || WORDS.chaoshi, o = opts || {}, p = [], i, j, g;
    var head = '<h3 class="goal-title">今天练：' + esc(w.zh) + '</h3>';
    if (o.done) { head += '<span class="goal-seen">✓ 已看过</span>'; }
    p.push('<div class="goal-card"><div class="goal-head">' + head + '</div>');
    p.push('<p class="goal-meta">' + w.stages.length + ' 个阶段，最少可辨帧数 '
      + w.minFrames + '</p>');
    p.push('<ol class="goal-stages">');
    for (i = 0; i < w.stages.length; i++) {
      p.push('<li>' + esc(w.stages[i]) + '</li>');
    }
    p.push('</ol>');
    if (w.nonmanual && w.nonmanual.length) {
      p.push('<div class="goal-nm"><div class="goal-nm-head">并行非手控特征</div>');
      for (i = 0; i < w.nonmanual.length; i++) {
        g = w.nonmanual[i];
        p.push('<div class="nm-group"><div class="nm-label">' + esc(g.l) + '</div>');
        for (j = 0; j < g.f.length; j++) {
          p.push('<span class="pill">' + esc(g.f[j]) + '</span>');
        }
        p.push('</div>');
      }
      p.push('</div>');
    }
    if (w.gated) {                               // 诚实标注：门控词不出置信度评分
      p.push('<div class="note honest">该词训练样本仅 39 条，属门控豁免词，');
      p.push('本次不出置信度评分，请对照阶段分解自查</div>');
    }
    p.push('</div>');
    return p.join('\n');
  }

  // history 保留在签名里，便于后续与当日练习记录联表核对
  function goalComplete(history, wordKey) {
    return readSeen()[wordKey] === true;
  }

  function markGoalSeen(wordKey) {
    var seen = readSeen();
    seen[wordKey] = true;
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
    return seen;
  }

  window.CoachGoal = {
    WORDS: WORDS, WORD_DIMS: WORD_DIMS, pickTodayWord: pickTodayWord,
    renderGoalCard: renderGoalCard, goalComplete: goalComplete,
    markGoalSeen: markGoalSeen
  };
})();
