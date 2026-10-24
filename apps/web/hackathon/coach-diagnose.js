/*
 * 手语课后练习任务台 MVP —— 「错因」环节模块
 * 四态归因 + 置信度门控：把"分低"拆成
 * 未识别 / 识别不足 / 样本不足不出分 / 正常出分。
 * 普通浏览器脚本，无依赖，挂到 window.CoachDiagnose。
 */
(function (global) {
  'use strict';

  var CONF_MIN = 0.1;   // 低于此值：未识别到核心语义动作
  var CONF_OK = 0.5;    // 低于此值：识别不足，按 c/0.5 折减
  var WEAK_SCORE = 80;  // 正常出分时低于此分算弱维度

  // 官方门控豁免词：样本少、置信度对正负例无分离度，
  // 不设门控的代价是乱作负例可能虚高 —— 我们直接不出分。
  var GATED_WORDS = ['人们（人民）', '汽车（二）'];

  function isGated(word) {
    var w = String(word === null || typeof word === 'undefined' ? '' : word);
    var i;
    for (i = 0; i < GATED_WORDS.length; i++) {
      if (w.indexOf(GATED_WORDS[i]) !== -1) return true;
    }
    return false;
  }

  function num(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : null;
  }

  function dimState(d, gated) {
    var c = num(d ? d.c : null);
    var s = num(d ? d.s : null);
    if (c === null) c = 0;
    var state;
    if (gated) {
      state = 'gated_no_score';
    } else if (c < CONF_MIN) {
      state = 'not_detected';
    } else if (c < CONF_OK) {
      state = 'low_conf';
    } else {
      state = 'normal';
    }
    var adjusted = null;
    if (state === 'normal') {
      adjusted = s;
    } else if (state === 'low_conf' && s !== null) {
      adjusted = Math.round(s * Math.min(1, c / CONF_OK));
    }
    return { n: (d && d.n) ? d.n : '未命名维度', s: s, c: c,
      state: state, adjusted: adjusted };
  }

  function classify(raw) {
    raw = raw || {};
    var dims = (raw.dims && raw.dims.length) ? raw.dims : [];
    var dimStates = [];
    var gated = isGated(raw.word);
    var i, c, lowCount = 0, undetected = 0;
    for (i = 0; i < dims.length; i++) {
      dimStates.push(dimState(dims[i], gated));
      c = num(dims[i] ? dims[i].c : null);
      if (c === null) c = 0;
      if (c < CONF_MIN) undetected++;
      if (c < CONF_OK) lowCount++;
    }
    var n = dimStates.length;
    var gateState;
    if (gated) {
      gateState = 'gated_no_score';
    } else if (n === 0 || undetected === n) {
      gateState = 'not_detected';
    } else if (lowCount * 2 > n) {
      gateState = 'low_conf';
    } else {
      gateState = 'normal';
    }
    var shouldScore = (gateState !== 'gated_no_score'
      && gateState !== 'not_detected');
    var sum = 0, used = 0, v;
    for (i = 0; i < n; i++) {
      v = dimStates[i].adjusted;
      if (v !== null && typeof v !== 'undefined') {
        sum += v;
        used++;
      }
    }
    var overallAdj = (shouldScore && used > 0) ? Math.round(sum / used) : null;
    return { gateState: gateState, dimStates: dimStates,
      overallAdj: overallAdj, shouldScore: shouldScore };
  }

  function weakCount(r) {
    var i, k = 0, a;
    for (i = 0; i < r.dimStates.length; i++) {
      a = r.dimStates[i].adjusted;
      if (a !== null && a < WEAK_SCORE) k++;
    }
    return k;
  }

  function diagnoseText(result) {
    var gs = (result && result.gateState) ? result.gateState : 'not_detected';
    if (gs === 'gated_no_score') {
      return '这个词样本太少，先不给分，对照示范自查';
    }
    if (gs === 'not_detected') {
      return '没识别到动作，确认双手都在画面里再打一次';
    }
    if (gs === 'low_conf') {
      return '有识别但不够清楚，把动作做完整再来一次';
    }
    if (weakCount(result) > 0) {
      return '有 1-2 个动作偏弱，看下面的维度条';
    }
    return '各维度达标，可以进下一个词';
  }

  function scoreColor(v) {
    if (v >= 80) return '#3fbf7f';
    if (v >= 65) return '#e0a33c';
    return '#d95566';
  }

  function gateNoteClass(state) {
    if (state === 'not_detected') return 'note bad';
    if (state === 'gated_no_score' || state === 'low_conf') return 'note honest';
    return 'note';
  }

  function rightLabel(d) {
    if (d.adjusted === null) return '不出分';
    return d.adjusted + ' 分 · conf ' + d.c.toFixed(2);
  }

  function renderDiagnose(raw, opts) {
    opts = opts || {};
    var r = classify(raw);
    var h = ['<div class="diagnose">'];
    var i, d;
    // 整词诊断框
    h.push('<div class="' + gateNoteClass(r.gateState) + '">'
      + diagnoseText(r) + '</div>');
    // 综合分：不该出分时明确写"不出分"，不给虚高分
    var scorable = r.shouldScore && r.overallAdj !== null;
    h.push('<div class="overall"><span class="num" style="color:'
      + (scorable ? scoreColor(r.overallAdj) : '#8ea0c8') + '">'
      + (scorable ? r.overallAdj + ' 分' : '不出分') + '</span></div>');
    // 逐维度条
    for (i = 0; i < r.dimStates.length; i++) {
      d = r.dimStates[i];
      h.push('<div class="row">');
      h.push('<div class="rowtop"><span>' + d.n + '</span><span>'
        + rightLabel(d) + '</span></div>');
      if (d.adjusted !== null) {
        h.push('<div class="track"><div class="fill" style="width:'
          + Math.max(0, Math.min(100, d.adjusted)) + '%;background:'
          + scoreColor(d.adjusted) + '"></div></div>');
      }
      if (d.state === 'low_conf') {
        h.push('<div class="note">置信度 ' + d.c.toFixed(2)
          + '，低于阈值 0.5，分数已折减</div>');
      }
      h.push('</div>');
    }
    // 方法论脚注（路演时可开）
    if (opts.showWhy) {
      h.push('<div class="note">'
        + '分不清「做错词」和「做得不标准」是这类系统的常见弱点；'
        + '置信度低时我们折减而不是照给分，样本不足时直接不出分。'
        + '</div>');
    }
    h.push('</div>');
    return h.join('');
  }

  function gateEvidence() {
    return '官方门控实证：正例置信度区间 0.51–0.82，乱作负例 0.003–0.034，'
      + '间距大于 10 倍，阈值 0.5 正好落在无人区。';
  }

  global.CoachDiagnose = {
    classify: classify, diagnoseText: diagnoseText,
    renderDiagnose: renderDiagnose, gateEvidence: gateEvidence,
    isGated: isGated, GATED_WORDS: GATED_WORDS,
    CONF_MIN: CONF_MIN, CONF_OK: CONF_OK
  };
})(window);
