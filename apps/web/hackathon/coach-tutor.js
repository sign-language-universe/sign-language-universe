/*
 * 「手语小宇宙」后置 AI 导师（伴学 agent 后半段）
 * 输入：一次练习的 47 维打分结果（程度分 + 置信度）+ 该词教学契约
 * 输出：哪个维度弱、补哪个阶段、练哪个词、下次目标
 * 纯本地规则推理，不调用任何云模型，答案可溯源到教学契约原文。
 */
(function (global) {
  var WEAK = 80;

  var DIM_GROUP = {
    '把手手形': '手形',
    '方块手形': '手形',
    '双手协同': '双手关系',
    '左右交替顺序': '双手关系',
    '推动轨迹': '轨迹',
    '晃动幅度': '轨迹',
    '转动轨迹': '轨迹',
    '移动中保持形状': '轨迹',
    '前后晃动次数': '重复次数',
    '回位收束': '重复次数'
  };

  var WORD_DIMS = {
    '超市': ['把手手形', '左右交替顺序', '推动轨迹', '回位收束'],
    '公交车': ['把手手形', '前后晃动次数', '晃动幅度'],
    '汽车（一）': ['把手手形', '双手协同', '转动轨迹'],
    '汽车（二）': ['方块手形', '移动中保持形状']
  };

  var GATED = { '人们（人民）': 1, '汽车（二）': 1 };

  function groupOf(dim) {
    return DIM_GROUP[dim] || '其他';
  }

  function pickWeak(raw) {
    var out = [];
    var dims = (raw && raw.dims) || [];
    for (var i = 0; i < dims.length; i++) {
      var d = dims[i];
      if (d == null) continue;
      if (d.s === null || d.s === undefined) continue;
      if (d.c !== null && d.c !== undefined && d.c < 0.1) continue;
      if (d.s < WEAK) {
        out.push({ dim: d.n, score: d.s, conf: d.c, group: groupOf(d.n) });
      }
    }
    out.sort(function (a, b) { return a.score - b.score; });
    return out;
  }

  function countNotDetected(raw) {
    var n = 0;
    var dims = (raw && raw.dims) || [];
    for (var i = 0; i < dims.length; i++) {
      var d = dims[i];
      if (d == null) continue;
      if (d.c === null || d.c === undefined) continue;
      if (d.c < 0.1) n++;
    }
    return n;
  }

  function stageHint(dim, contract) {
    if (!contract || !contract.ordered_sequence) return null;
    var seq = contract.ordered_sequence;
    if (!seq.length) return null;
    var group = groupOf(dim);
    var idx = 0;
    if (group === '双手关系' || group === '重复次数') {
      idx = seq.length > 1 ? 1 : 0;
    } else if (group === '轨迹') {
      idx = seq.length > 2 ? 1 : 0;
    }
    var st = seq[idx];
    if (!st) return null;
    return { index: idx + 1, label: st.label_zh, detail: st.detail_zh };
  }

  function nonManualHint(contract) {
    if (!contract || !contract.simultaneous_features) return null;
    var f = contract.simultaneous_features;
    if (!f.length) return null;
    var items = [];
    for (var i = 0; i < f.length && i < 2; i++) {
      if (f[i] && f[i].features_zh) items.push(f[i].features_zh.join('、'));
    }
    if (!items.length) return null;
    return items.join('；');
  }

  function nextWordFor(dim, currentWord) {
    var group = groupOf(dim);
    var best = null;
    var bestScore = 1e9;
    for (var w in WORD_DIMS) {
      if (!WORD_DIMS.hasOwnProperty(w)) continue;
      if (w === currentWord) continue;
      if (GATED[w]) continue;
      var dims = WORD_DIMS[w];
      for (var i = 0; i < dims.length; i++) {
        if (dims[i] === dim) {
          if (best === null) best = w;
        }
      }
    }
    if (best) return { word: best, sameDim: true };
    return { word: '公交车', sameDim: false };
  }

  function advise(raw, contract, history) {
    var word = (raw && raw.word) || '';
    var isGated = GATED[word] ? true : false;

    if (isGated) {
      return {
        headline: '本词样本不足，本次不出分',
        gated: true,
        weakest: [],
        steps: [
          { title: '为什么不出分', detail: '该词训练样本仅 39 条，置信度对正负例没有分离度，乱做也可能虚高。' },
          { title: '现在可以做什么', detail: '对照分阶段动作分解与参考示范自查，先练样本充足的词。' }
        ],
        nextWord: '公交车',
        nextWordReason: '样本充足、门控生效，适合先把同类手形练稳',
        closing: '宁可不出分，也不给一个假分数。'
      };
    }

    var weak = pickWeak(raw);
    var steps = [];
    var headline;
    var closing;
    var notDetected = countNotDetected(raw);

    if (!weak.length && notDetected > 0) {
      return {
        headline: '没识别到核心语义动作',
        gated: false,
        undetected: true,
        weakest: [],
        steps: [
          { title: '先解决识别问题', detail: '确认双手都在画面里，把动作做完整，再来一次。' },
          { title: '常见原因', detail: '双手出画、离摄像头太远、光线太暗或背光。' }
        ],
        nextWord: '',
        nextWordReason: '',
        closing: '识别不到的时候，分数没有参考价值。'
      };
    }

    if (!weak.length) {
      headline = '本次各维度达标';
      steps.push({ title: '可以进下一个词', detail: '当前词已稳定，换一个含相同维度的词迁移练习。' });
      closing = '稳住了就往新词迁移，别在同一词上过度重复。';
    } else {
      headline = '本次最该补的是「' + weak[0].dim + '」';
      var top = weak[0];
      var st = stageHint(top.dim, contract);
      if (st) {
        steps.push({
          title: '补动作：第 ' + st.index + ' 阶段「' + st.label + '」',
          detail: st.detail
        });
      } else {
        steps.push({
          title: '补动作：' + top.dim,
          detail: '这个维度只有 ' + top.score + ' 分，先把它做出来再谈整体分。'
        });
      }
      var nm = nonManualHint(contract);
      if (nm) {
        steps.push({ title: '同时盯住常被忽略的特征', detail: nm });
      }
      if (weak.length > 1) {
        var second = weak[1];
        steps.push({
          title: '第二个弱项：' + second.dim + '（' + second.score + ' 分）',
          detail: '先解决第一个，再回来处理这个，别同时改两处。'
        });
      }
      closing = '一次只改一个维度，改对了再叠下一个。';
    }

    var nw = nextWordFor(weak.length ? weak[0].dim : '', word);
    var reason = nw.sameDim
      ? '含同一个维度，适合迁移'
      : '综合覆盖多个基础维度，适合巩固';

    return {
      headline: headline,
      gated: false,
      weakest: weak.slice(0, 3),
      steps: steps,
      nextWord: nw.word,
      nextWordReason: reason,
      closing: closing
    };
  }

  function colorOf(s) {
    if (s >= 80) return '#3fbf7f';
    if (s >= 65) return '#e0a33c';
    return '#d95566';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderAdvice(a) {
    if (!a) return '';
    var h = '<div class="tutor">';
    h += '<div class="tutor-head"><span class="tutor-badge">AI 导师</span>';
    h += '<span class="tutor-title">' + esc(a.headline) + '</span></div>';

    if (a.weakest && a.weakest.length) {
      h += '<div class="tutor-weak">';
      for (var i = 0; i < a.weakest.length; i++) {
        var w = a.weakest[i];
        h += '<div class="row"><div class="rowtop"><span>' + esc(w.dim) +
             '</span><span>' + w.score + ' 分</span></div>' +
             '<div class="track"><div class="fill" style="width:' + w.score +
             '%;background:' + colorOf(w.score) + '"></div></div></div>';
      }
      h += '</div>';
    }

    h += '<ol class="tutor-steps">';
    for (var j = 0; j < a.steps.length; j++) {
      h += '<li><b>' + esc(a.steps[j].title) + '</b><br>' + esc(a.steps[j].detail) + '</li>';
    }
    h += '</ol>';

    if (a.nextWord) {
      h += '<div class="note"><b>下一步练：' + esc(a.nextWord) + '</b>（' +
           esc(a.nextWordReason) + '）</div>';
    }
    if (a.closing) {
      h += '<div class="tutor-closing">' + esc(a.closing) + '</div>';
    }
    h += '</div>';
    return h;
  }

  function stageHints(contract) {
    var out = [];
    if (!contract || !contract.ordered_sequence) return out;
    var seq = contract.ordered_sequence;
    var nm = nonManualHint(contract);
    for (var i = 0; i < seq.length; i++) {
      var tip = seq[i].detail_zh || '';
      if (i === 0 && nm) {
        tip = tip + ' 记住：' + nm + '。';
      }
      if (i === seq.length - 1) {
        tip = tip + ' 做完停一下，别急着收手。';
      }
      out.push({
        n: i + 1,
        label: seq[i].label_zh,
        detail: seq[i].detail_zh,
        tip: tip
      });
    }
    return out;
  }

  function renderLiveHint(contract, idx, total) {
    var hints = stageHints(contract);
    if (!hints.length) return '';
    var i = Math.max(0, Math.min(idx, hints.length - 1));
    var h = hints[i];
    var html = '<div class="live-hint">';
    html += '<div class="lh-head"><span class="tutor-badge">AI 导师</span>';
    html += '<span class="lh-progress">第 ' + h.n + ' / ' + hints.length + ' 阶段</span></div>';
    html += '<div class="lh-label">' + esc(h.label) + '</div>';
    html += '<div class="lh-tip">' + esc(h.tip) + '</div>';
    html += '</div>';
    return html;
  }

  global.CoachTutor = {
    advise: advise,
    renderAdvice: renderAdvice,
    stageHints: stageHints,
    renderLiveHint: renderLiveHint,
    DIM_GROUP: DIM_GROUP,
    WORD_DIMS: WORD_DIMS,
    GATED: GATED,
    WEAK_THRESHOLD: WEAK
  };
})(typeof window !== 'undefined' ? window : this);
