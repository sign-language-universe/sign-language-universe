/*
 * 手语小宇宙 · 教师 Agent 伴学（主站接入层）
 * 只读主站已渲染的 DOM，不修改 interactive-learning.js / scoring.js 的任何逻辑。
 * 两个落点：
 *   1) 课前：在动作契约面板上方插入「导师提示」条（阶段数 + 先做哪一步 + 非手控特征）
 *   2) 课后：在局部语义评分建议之后插入「导师下一步」卡（最弱维度 + 对照阶段 + 下一步）
 * 失效即静默：任何一步拿不到就跳过，不抛错、不影响主站。
 * 紧急关闭：在 URL 上加 ?coach=off
 */
(function () {
  'use strict';

  try {
    if (/[?&]coach=off\b/.test(location.search)) return;
  } catch (e) { return; }

  var NS = 'cc';
  var state = { word: '', sig: '', goalEl: null, tutorEl: null };
  var timers = {};

  function q(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function qa(sel, root) {
    try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; }
  }
  function byId(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function txt(el) { return el ? String(el.textContent || '').trim() : ''; }

  function currentWord() {
    try {
      var words = window.CHALLENGE_WORDS || [];
      if (!words.length) return null;
      var i = (window.AppState && window.AppState.challengeIndex) || 0;
      return words[i % words.length];
    } catch (e) { return null; }
  }

  function stageLabels() {
    return qa('.semantic-stage-list li').map(function (li) {
      var t = txt(li).replace(/^\s*\d+\s*/, '');
      return t;
    }).filter(Boolean);
  }

  function featureChips() {
    var cards = qa('.semantic-feature-card');
    var out = [];
    for (var i = 0; i < cards.length && out.length < 3; i++) {
      var t = txt(cards[i]);
      if (t) out.push(t.length > 28 ? t.slice(0, 28) + '…' : t);
    }
    return out;
  }

  function weakParts() {
    var host = byId('interactive-group-scores');
    if (!host) return [];
    return qa('.stage-score-row.weak', host).map(function (row) {
      var label = txt(q('.stage-score-label', row));
      var val = parseInt(txt(q('.stage-score-value', row)), 10);
      return { label: label, score: isNaN(val) ? null : val };
    }).filter(function (x) { return x.label; });
  }

  function adviceText() {
    var host = byId('interactive-group-advice');
    return host && !host.hidden ? txt(host) : '';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 阶段名在英文界面下是整句，直接放进去会把提示条排成五行；统一截断。
  function shorten(s, n) {
    var t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    t = t.replace(/^[\d\s.、)]+/, '');
    if (t.length <= n) return t;
    return t.slice(0, n - 1).replace(/[\s,，。.;；:：]+$/, '') + '…';
  }

  var AVATAR =
    '<svg class="' + NS + '-face" viewBox="0 0 48 48" aria-hidden="true">' +
    '<circle cx="24" cy="24" r="21" fill="#12233d" stroke="#3b6ef5" stroke-width="1.5"/>' +
    '<circle cx="24" cy="19" r="8" fill="#e8c39a"/>' +
    '<path d="M12 42c2-8 8-11 12-11s10 3 12 11z" fill="#3b6ef5"/>' +
    '<circle cx="21" cy="18" r="1.4" fill="#22303f"/><circle cx="27" cy="18" r="1.4" fill="#22303f"/>' +
    '<path d="M21 22.5c1.6 1.4 4.4 1.4 6 0" stroke="#22303f" stroke-width="1.3" fill="none" stroke-linecap="round"/>' +
    '</svg>';

  function injectStyle() {
    if (byId(NS + '-style')) return;
    var css =
      '.' + NS + '-strip{margin:0 0 10px;padding:8px 10px;border-radius:9px;' +
        'background:rgba(59,110,245,.10);border-left:3px solid #3b6ef5;' +
        'font-size:12.5px;line-height:1.55;color:inherit;display:flex;gap:8px;align-items:flex-start}' +
      '.' + NS + '-face{width:26px;height:26px;flex:0 0 26px;margin-top:1px}' +
      '.' + NS + '-body{flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;' +
        '-webkit-box-orient:vertical;overflow:hidden}' +
      '.' + NS + '-tag{display:inline-block;font-size:11px;padding:1px 7px;border-radius:999px;' +
        'background:#3b6ef5;color:#fff;margin-right:6px;vertical-align:1px}' +
      '.' + NS + '-kw{color:#3b6ef5;font-weight:600}' +
      '.' + NS + '-card{margin:12px 0 0;padding:12px 14px;border-radius:12px;' +
        'border:1px solid #3b6ef5;background:rgba(59,110,245,.07);font-size:13px;line-height:1.65;color:inherit}' +
      '.' + NS + '-card h5{margin:0 0 8px;font-size:13px;display:flex;align-items:center;gap:8px}' +
      '.' + NS + '-card ul{margin:6px 0;padding-left:18px}' +
      '.' + NS + '-card li{margin:4px 0}' +
      '.' + NS + '-muted{opacity:.72;font-size:12px}' +
      '.' + NS + '-weak{color:#d95566;font-weight:600}' +
      '@media (prefers-color-scheme: light){' +
        '.' + NS + '-strip{background:#eef4ff}' +
        '.' + NS + '-card{background:#eef4ff}' +
      '}';
    var st = document.createElement('style');
    st.id = NS + '-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------------- 课前：导师提示条 ---------------- */
  function removeGoal() {
    if (state.goalEl && state.goalEl.parentNode) {
      state.goalEl.parentNode.removeChild(state.goalEl);
    }
    state.goalEl = null;
  }

  function ensureGoal() {
    var panel = q('.semantic-contract-panel');
    if (!panel || !panel.parentNode) { removeGoal(); return; }

    // 提示条插在契约面板内部的最顶端：它只推动契约栏自身的内容，
    // 不会改变三列栅格的子项数，也不会把练习栏的录制按钮推出首屏。
    var anchor = panel;

    var stages = stageLabels();
    if (!stages.length) { removeGoal(); return; }

    var w = currentWord();
    var name = w && w.word ? w.word : '';

    var lead = name ? ('练「' + esc(name) + '」共 ') : '这个词共 ';
    var firstStage = shorten(stages[0], 16);

    var html =
      '<div class="' + NS + '-face-wrap">' + AVATAR + '</div>' +
      '<div class="' + NS + '-body">' +
        '<span class="' + NS + '-tag">AI 导师</span>' +
        lead + '<b>' + stages.length + '</b> 个阶段，先做第 1 步' +
        '<span class="' + NS + '-kw">「' + esc(firstStage) + '」</span>' +
      '</div>';

    if (state.goalEl && state.goalEl.parentNode === anchor
        && anchor.firstElementChild === state.goalEl) {
      if (state.goalEl.getAttribute('data-sig') !== html) {
        state.goalEl.innerHTML = html;
        state.goalEl.setAttribute('data-sig', html);
      }
      return;
    }

    removeGoal();
    var el = document.createElement('div');
    el.className = NS + '-strip';
    el.setAttribute('data-cc', 'goal');
    el.setAttribute('data-sig', html);
    el.innerHTML = html;
    anchor.insertBefore(el, anchor.firstChild);
    state.goalEl = el;
  }

  /* ---------------- 课后：导师下一步 ---------------- */
  function removeTutor() {
    if (state.tutorEl && state.tutorEl.parentNode) {
      state.tutorEl.parentNode.removeChild(state.tutorEl);
    }
    state.tutorEl = null;
  }

  function ensureTutor() {
    var advice = byId('interactive-group-advice');
    if (!advice || advice.hidden) { removeTutor(); return; }
    var bodyText = txt(advice);
    if (!bodyText) { removeTutor(); return; }

    var weak = weakParts();
    var stages = stageLabels();
    var parts = [];

    if (weak.length) {
      var top = weak[0];
      parts.push('<li>最该补的是 <span class="' + NS + '-weak">「' + esc(top.label) + '」</span>' +
        (top.score !== null ? '（' + top.score + ' 分）' : '') +
        (weak.length > 1 ? '，其次「' + esc(weak[1].label) + '」' : '') + '。</li>');
      if (stages.length) {
        parts.push('<li>对照第 1 阶段「' + esc(stages[0]) + '」再对一遍，' +
          '这一维大概率出在这个动作上。</li>');
      }
      parts.push('<li>下一步：<b>只盯这一项重打一遍</b>，其他先不要一起改。</li>');
    } else {
      parts.push('<li>这一遍各核心维度都在合理范围。</li>');
      parts.push('<li>下一步：换一个含同类动作的词迁移练，别在同一词上过度重复。</li>');
    }

    var html =
      '<h5>' + AVATAR + '<span class="' + NS + '-tag">AI 导师</span>我看完了，给你下一步</h5>' +
      '<ul>' + parts.join('') + '</ul>' +
      '<div class="' + NS + '-muted">分数只来自浏览器内的关键点推理，视频没有离开这台设备。</div>';

    if (state.tutorEl && state.tutorEl.parentNode) {
      if (state.tutorEl.getAttribute('data-sig') !== html) {
        state.tutorEl.innerHTML = html;
        state.tutorEl.setAttribute('data-sig', html);
      }
      return;
    }

    removeTutor();
    var el = document.createElement('div');
    el.className = NS + '-card';
    el.setAttribute('data-cc', 'tutor');
    el.setAttribute('data-sig', html);
    el.innerHTML = html;
    if (advice.parentNode) {
      advice.parentNode.insertBefore(el, advice.nextSibling);
    }
    state.tutorEl = el;
  }

  /* ---------------- 调度 ---------------- */
  function signature() {
    var w = currentWord();
    var stages = stageLabels();
    return (w && w.word ? w.word : '?') + '|' + stages.length + '|' + stages[0] +
      '|' + weakParts().length + '|' + (adviceText().length > 0 ? 1 : 0);
  }

  function sync() {
    var sig = signature();
    if (sig === state.sig) return;
    state.sig = sig;
    try { ensureGoal(); } catch (e) {}
    try { ensureTutor(); } catch (e) {}
  }

  function schedule() {
    if (timers.t) clearTimeout(timers.t);
    timers.t = setTimeout(function () {
      try { sync(); } catch (e) {}
    }, 140);
  }

  function start() {
    injectStyle();
    var host = byId('interactive-learning-content') || document.body;
    if (!host) return;
    try {
      var mo = new MutationObserver(schedule);
      mo.observe(host, { childList: true, subtree: true, characterData: true });
    } catch (e) {}
    schedule();
    setTimeout(function () { try { sync(); } catch (e) {} }, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { try { start(); } catch (e) {} });
  } else {
    try { start(); } catch (e) {}
  }

  window.CoachCompanion = { sync: sync, version: '20261024' };
})();
