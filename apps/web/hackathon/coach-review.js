/* 手语课后练习任务台 MVP —— 「复盘」环节模块
   把一次次练习的维度分数聚合成"维度级学习者模型"（跨词、跨次视角）
   普通浏览器脚本，暴露 window.CoachReview */
(function () {
  var KEY = 'slu_taskboard_v1', MAX_KEEP = 200;
  var DIM_GROUP = {
    '把手手形': '手形', '方块手形': '手形',
    '双手协同': '双手关系', '左右交替顺序': '双手关系',
    '推动轨迹': '轨迹', '晃动幅度': '轨迹',
    '转动轨迹': '轨迹', '移动中保持形状': '轨迹',
    '前后晃动次数': '重复次数', '回位收束': '重复次数'
  };
  var WORD_DIMS = {
    '超市': ['把手手形', '左右交替顺序', '推动轨迹', '回位收束'],
    '公交车': ['把手手形', '前后晃动次数', '晃动幅度'],
    '汽车（一）': ['把手手形', '双手协同', '转动轨迹']
  };
  function groupOf(dim) { return DIM_GROUP[dim] || '其他'; }
  function isNum(v) { return typeof v === 'number' && !isNaN(v); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function sortByTs(list) {
    var copy = (list || []).slice(0);
    copy.sort(function (a, b) { return ((a && isNum(a.ts) ? a.ts : 0) - (b && isNum(b.ts) ? b.ts : 0)); });
    return copy;
  }
  function loadHistory() {
    var raw = null, arr = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return []; }
    if (!raw) { return []; }
    try { arr = JSON.parse(raw); } catch (e) { return []; }
    if (!arr || Object.prototype.toString.call(arr) !== '[object Array]') { return []; }
    return arr;
  }
  function saveHistory(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }
  /* 追加一次练习记录，只保留最近 MAX_KEEP 条 */
  function pushAttempt(attempt) {
    var list = loadHistory();
    if (!attempt || typeof attempt !== 'object') { return list; }
    list.push(attempt);
    if (list.length > MAX_KEEP) { list = list.slice(list.length - MAX_KEEP); }
    saveHistory(list); return list;
  }
  /* 逐维度聚合：跳过不出分(s===null)与未识别(置信度<0.1)的样本 */
  function dimStats(history) {
    var list = sortByTs(history), map = {}, order = [], i, j, att, dims, d, rec;
    for (i = 0; i < list.length; i++) {
      att = list[i]; dims = (att && att.dims) || [];
      for (j = 0; j < dims.length; j++) {
        d = dims[j];
        if (!d || !d.n || !isNum(d.s)) { continue; }
        if (isNum(d.c) && d.c < 0.1) { continue; }
        if (!map[d.n]) {
          map[d.n] = { dim: d.n, group: groupOf(d.n), sum: 0, count: 0, best: null, seq: [] };
          order.push(d.n);
        }
        rec = map[d.n]; rec.sum += d.s; rec.count += 1; rec.seq.push(d.s);
        if (rec.best === null || d.s > rec.best) { rec.best = d.s; }
      }
    }
    var out = [];
    for (i = 0; i < order.length; i++) {
      rec = map[order[i]];
      var avg = Math.round(rec.sum / rec.count), trend = 'na';
      if (rec.seq.length >= 2) {
        var diff = rec.seq[rec.seq.length - 1] - rec.seq[rec.seq.length - 2];
        trend = diff > 5 ? 'up' : (diff < -5 ? 'down' : 'flat');
      }
      out.push({ dim: rec.dim, group: rec.group, avg: avg, best: Math.round(rec.best),
        count: rec.count, trend: trend });
    }
    out.sort(function (a, b) { return a.avg - b.avg; });
    return out;
  }
  /* 按分组加权聚合，最弱在前 */
  function groupStats(history) {
    var ds = dimStats(history), map = {}, order = [], i, g, rec;
    for (i = 0; i < ds.length; i++) {
      g = ds[i].group;
      if (!map[g]) { map[g] = { group: g, sum: 0, weight: 0, count: 0 }; order.push(g); }
      rec = map[g]; rec.sum += ds[i].avg * ds[i].count;
      rec.weight += ds[i].count; rec.count += ds[i].count;
    }
    var out = [];
    for (i = 0; i < order.length; i++) {
      rec = map[order[i]];
      out.push({ group: rec.group, avg: Math.round(rec.sum / rec.weight), count: rec.count });
    }
    out.sort(function (a, b) { return a.avg - b.avg; });
    return out;
  }
  function weakRanking(history, limit) {
    var n = isNum(limit) && limit > 0 ? Math.floor(limit) : 5;
    var ds = dimStats(history), out = [], i;
    for (i = 0; i < ds.length && i < n; i++) {
      out.push({ dim: ds[i].dim, group: ds[i].group, avg: ds[i].avg,
        best: ds[i].best, count: ds[i].count, trend: ds[i].trend });
    }
    return out;
  }
  /* 今天的练习顺序：先补最弱的维度，再挑覆盖这些维度的词 */
  function practiceOrder(history) {
    var list = history || [], weak = weakRanking(list, 3);
    var dims = [], practiced = {}, wordAvg = {}, i, j, k;
    for (i = 0; i < weak.length; i++) { dims.push(weak[i].dim); }
    for (i = 0; i < list.length; i++) {
      var att = list[i];
      if (!att || !att.word) { continue; }
      practiced[att.word] = true;
      if (!isNum(att.overall)) { continue; }
      if (!wordAvg[att.word]) { wordAvg[att.word] = { sum: 0, n: 0 }; }
      wordAvg[att.word].sum += att.overall; wordAvg[att.word].n += 1;
    }
    var fresh = [], tried = [];
    for (k in WORD_DIMS) {
      if (!WORD_DIMS.hasOwnProperty(k)) { continue; }
      var core = WORD_DIMS[k], hit = false;
      for (j = 0; j < dims.length; j++) {
        if (core.indexOf(dims[j]) >= 0) { hit = true; break; }
      }
      if (!hit) { continue; }
      if (!practiced[k]) { fresh.push(k); }
      else { tried.push({ w: k, s: wordAvg[k] ? wordAvg[k].sum / wordAvg[k].n : 0 }); }
    }
    tried.sort(function (a, b) { return a.s - b.s; });
    var words = fresh.slice(0);
    for (i = 0; i < tried.length; i++) { words.push(tried[i].w); }
    if (!words.length) {
      for (k in WORD_DIMS) { if (WORD_DIMS.hasOwnProperty(k)) { words.push(k); } }
    }
    var g1 = weak.length ? weak[0].group : '手形', g2 = '', text;
    for (i = 1; i < weak.length; i++) {
      if (weak[i].group !== g1) { g2 = weak[i].group; break; }
    }
    if (!weak.length) { text = '还没有弱项数据，先把三个词各练一次'; }
    else if (g2) { text = '先练含「' + g1 + '」的词，再练「' + g2 + '」'; }
    else { text = '先练含「' + g1 + '」的词，把这一项练稳'; }
    return { dims: dims, words: words, text: text };
  }
  function colorOf(s) { return s >= 80 ? '#3fbf7f' : (s >= 65 ? '#e0a33c' : '#d95566'); }
  function bar(r, idx) {
    var w = Math.max(0, Math.min(100, r.avg));
    return '<div class="row"><div class="rowtop"><span>' + (idx + 1) + '. '
      + esc(r.dim) + '</span><span>' + r.avg + ' 分 · 练了 ' + r.count
      + ' 次</span></div><div class="track"><div class="fill" style="width:'
      + w + '%;background:' + colorOf(r.avg) + '"></div></div></div>';
  }
  /* 复盘面板：概览 + 弱项条 + 分组均分 + 建议 */
  function renderReview(history, opts) {
    var list = history || [], o = opts || {}, parts = [], i;
    if (!list.length) {
      return '<div class="note">还没有练习记录，练一次后这里会出现'
        + '跨词弱项分布</div>';
    }
    var weak = weakRanking(list, isNum(o.limit) ? o.limit : 5);
    var gs = groupStats(list), po = practiceOrder(list), words = {}, wc = 0;
    for (i = 0; i < list.length; i++) {
      var w = list[i] && list[i].word;
      if (w && !words[w]) { words[w] = 1; wc += 1; }
    }
    parts.push('<div class="note">共 ' + list.length + ' 次练习，覆盖 ' + wc + ' 个词</div>');
    for (i = 0; i < weak.length; i++) { parts.push(bar(weak[i], i)); }
    var pills = [];
    for (i = 0; i < gs.length; i++) {
      pills.push('<span class="pill">' + esc(gs[i].group) + ' ' + gs[i].avg + '</span>');
    }
    if (pills.length) { parts.push('<div class="pills">' + pills.join('') + '</div>'); }
    var all = dimStats(list), down = null;
    for (i = 0; i < all.length; i++) {
      if (all[i].trend === 'down') { down = all[i]; break; }
    }
    if (down) { parts.push('<div class="note honest">「' + esc(down.dim) + '」连续下滑，建议优先复盘</div>'); }
    parts.push('<div class="advice"><b>建议</b> ' + esc(po.text) + '</div>');
    return parts.join('');
  }
  /* 单维度最近 5 次分：58 → 61 → 67 */
  function renderTrend(history, dim) {
    var list = sortByTs(history), seq = [], i, j, d;
    for (i = 0; i < list.length; i++) {
      var dims = (list[i] && list[i].dims) || [];
      for (j = 0; j < dims.length; j++) {
        d = dims[j];
        if (!d || d.n !== dim || !isNum(d.s)) { continue; }
        if (isNum(d.c) && d.c < 0.1) { continue; } seq.push(Math.round(d.s));
      }
    }
    return seq.length ? seq.slice(Math.max(0, seq.length - 5)).join(' \u2192 ') : '暂无数据';
  }
  window.CoachReview = {
    loadHistory: loadHistory, pushAttempt: pushAttempt,
    dimStats: dimStats, groupStats: groupStats,
    weakRanking: weakRanking, practiceOrder: practiceOrder,
    renderReview: renderReview, renderTrend: renderTrend,
    colorOf: colorOf, DIM_GROUP: DIM_GROUP, WORD_DIMS: WORD_DIMS
  };
})();
