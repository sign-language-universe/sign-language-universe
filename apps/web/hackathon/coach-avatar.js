/*
 * coach-avatar.js 教师 agent 视觉形象与互动表现模块
 * 普通浏览器脚本，非 ES module，挂到 window.CoachAvatar
 * 用法：<script src="coach-avatar.js"></script>
 * 之后 CoachAvatar.mount(el, 'idle') 即可
 * 主题色可用 CSS 变量覆盖：--ca-accent / --ca-hair / --ca-spark / --ca-size
 */
(function (global) {
  'use strict';

  var STYLE_ID = 'ca-avatar-style';
  var STYLE_FLAG = '__CA_AVATAR_STYLE__';

  var LABELS = {
    idle: '我在，随时可以问我',
    thinking: '让我看一下，再给你答复',
    pointing: '跟着我做这一阶段',
    praise: '这一遍稳了，就按这个来',
    care: '别急，先把这一步做出来'
  };

  var STATES = ['idle', 'thinking', 'pointing', 'praise', 'care'];

  /* 形象本体：半身，圆脸短发，纯色块 */
  var SVG_LINES = [
    '<svg class="ca-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"',
    '     aria-hidden="true" focusable="false">',
    '  <rect class="ca-bg" x="0" y="0" width="120" height="120"',
    '        fill="var(--ca-bg, #121A33)"/>',
    '  <path class="ca-shirt"',
    '        d="M12 120 C12 95 33 83 60 83 C87 83 108 95 108 120 Z"',
    '        fill="var(--ca-accent, #3B6FE0)"/>',
    '  <path d="M50 84 L60 96 L70 84" fill="none" stroke="var(--ca-bg, #121A33)"',
    '        stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
    '  <rect x="51" y="70" width="18" height="18" rx="8"',
    '        fill="var(--ca-skin-dark, #E0B08A)"/>',
    '  <circle cx="34" cy="54" r="5.5" fill="var(--ca-skin, #F3C9A6)"/>',
    '  <circle cx="86" cy="54" r="5.5" fill="var(--ca-skin, #F3C9A6)"/>',
    '  <circle cx="60" cy="52" r="27" fill="var(--ca-skin, #F3C9A6)"/>',
    '  <path d="M32 51 C32 28 44 17 60 17 C76 17 88 28 88 51',
    '           C86 40 78 36 68 35 C59 34.2 48 34.6 41 37',
    '           C35 39 32.6 44 32 51 Z" fill="var(--ca-hair, #2A3352)"/>',
    '  <circle cx="49.5" cy="52" r="2.8" fill="#1A2138"/>',
    '  <circle cx="70.5" cy="52" r="2.8" fill="#1A2138"/>',
    '  <g class="ca-v ca-v-base">',
    '    <rect x="44" y="43.5" width="11" height="3" rx="1.5" fill="#3A4468"/>',
    '    <rect x="65" y="43.5" width="11" height="3" rx="1.5" fill="#3A4468"/>',
    '    <path d="M53 62 C56 66.5 64 66.5 67 62" fill="none" stroke="#2A3352"',
    '          stroke-width="3.2" stroke-linecap="round"/>',
    '  </g>',
    '  <g class="ca-v ca-v-praise">',
    '    <rect x="44" y="42" width="11" height="3" rx="1.5" fill="#3A4468"/>',
    '    <rect x="65" y="42" width="11" height="3" rx="1.5" fill="#3A4468"/>',
    '    <path d="M52 59 C55 69 65 69 68 59 Z" fill="#2A3352"/>',
    '    <path d="M56.5 63.5 C58.5 66 61.5 66 63.5 63.5" fill="none"',
    '          stroke="#E8776F" stroke-width="2" stroke-linecap="round"/>',
    '    <path d="M22 34 l2.4 -5.6 2.4 5.6 5.6 2.4 -5.6 2.4 -2.4 5.6',
    '             -2.4 -5.6 -5.6 -2.4 z" fill="var(--ca-spark, #FFC96B)"/>',
    '    <path d="M95 28 l2 -4.6 2 4.6 4.6 2 -4.6 2 -2 4.6 -2 -4.6',
    '             -4.6 -2 z" fill="var(--ca-spark, #FFC96B)"/>',
    '  </g>',
    '  <g class="ca-v ca-v-care">',
    '    <rect x="44" y="44" width="11" height="3" rx="1.5" fill="#3A4468"',
    '          transform="rotate(-8 49.5 45.5)"/>',
    '    <rect x="65" y="44" width="11" height="3" rx="1.5" fill="#3A4468"',
    '          transform="rotate(8 70.5 45.5)"/>',
    '    <path d="M54.5 64.5 C57.5 61.8 62.5 61.8 65.5 64.5" fill="none"',
    '          stroke="#2A3352" stroke-width="3" stroke-linecap="round"/>',
    '  </g>',
    '  <g class="ca-v ca-v-point">',
    '    <path d="M86 101 C92 91 96 82 97 75" fill="none"',
    '          stroke="var(--ca-accent, #3B6FE0)" stroke-width="11"',
    '          stroke-linecap="round"/>',
    '    <circle cx="97" cy="72" r="8.5" fill="var(--ca-skin, #F3C9A6)"/>',
    '    <rect x="94.6" y="52" width="6" height="19" rx="3"',
    '          fill="var(--ca-skin, #F3C9A6)" transform="rotate(9 97.6 68)"/>',
    '  </g>',
    '</svg>'
  ];

  var SVG = SVG_LINES.join('\n');

  var CSS = [
    '.ca-avatar{position:relative;display:inline-block;vertical-align:middle;',
    '  width:var(--ca-size,64px);height:var(--ca-size,64px);overflow:hidden;',
    '  border-radius:50%;border:1px solid var(--ca-border,#2c3a63);',
    '  background:var(--ca-bg,#121A33);box-sizing:border-box;flex:none}',
    '.ca-avatar.ca-square{border-radius:18%}',
    '.ca-avatar .ca-svg{display:block;width:100%;height:100%}',
    '.ca-avatar .ca-v{display:none}',
    '.ca-state-idle .ca-v-base,',
    '.ca-state-thinking .ca-v-base,',
    '.ca-state-pointing .ca-v-base{display:inline}',
    '.ca-state-praise .ca-v-praise{display:inline}',
    '.ca-state-care .ca-v-care{display:inline}',
    '.ca-state-pointing .ca-v-point{display:inline}',
    '.ca-dots{position:absolute;top:8%;right:8%;display:none;',
    '  padding:calc(var(--ca-size,64px)*0.045) calc(var(--ca-size,64px)*0.06);',
    '  border-radius:999px;background:rgba(11,16,32,0.82);',
    '  border:1px solid var(--ca-border,#2c3a63);',
    '  gap:calc(var(--ca-size,64px)*0.035);align-items:center}',
    '.ca-state-thinking .ca-dots{display:flex}',
    '.ca-dots i{display:block;width:calc(var(--ca-size,64px)*0.055);',
    '  height:calc(var(--ca-size,64px)*0.055);border-radius:50%;',
    '  background:#9FB4FF;animation:ca-dot 1.2s ease-in-out infinite}',
    '.ca-dots i:nth-child(2){animation-delay:0.18s}',
    '.ca-dots i:nth-child(3){animation-delay:0.36s}',
    '@keyframes ca-dot{0%,100%{opacity:0.25}50%{opacity:1}}',
    '@media (prefers-reduced-motion: reduce){.ca-dots i{animation:none;opacity:0.8}}',
    '.ca-bubble{position:relative;display:inline-block;max-width:260px;',
    '  padding:8px 12px;border-radius:14px;background:#182349;',
    '  border:1px solid var(--ca-border,#2c3a63);color:#e7ecff;',
    '  font-size:13px;line-height:1.45;font-family:inherit;',
    '  vertical-align:middle;white-space:normal}',
    '.ca-bubble-arrow{position:absolute;left:-6px;bottom:10px;width:10px;',
    '  height:10px;background:#182349;border-left:1px solid var(--ca-border,#2c3a63);',
    '  border-bottom:1px solid var(--ca-border,#2c3a63);',
    '  transform:rotate(45deg)}',
    '.ca-bubble-praise{border-color:#2f6b52;background:#14291d}',
    '.ca-bubble-praise .ca-bubble-arrow{border-color:#2f6b52;background:#14291d}',
    '.ca-bubble-care{border-color:#8a6330;background:#2a2115}',
    '.ca-bubble-care .ca-bubble-arrow{border-color:#8a6330;background:#2a2115}',
    '.ca-bubble-pointing{border-color:var(--ca-accent,#3B6FE0)}',
    '.ca-bubble-text{display:inline}'
  ].join('\n');

  function injectStyle() {
    if (global[STYLE_FLAG]) return;
    var doc = global.document;
    if (!doc) return;
    var head = doc.head || doc.getElementsByTagName('head')[0] || doc.documentElement;
    if (doc.getElementById(STYLE_ID)) {
      global[STYLE_FLAG] = true;
      return;
    }
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.type = 'text/css';
    style.appendChild(doc.createTextNode(CSS));
    head.appendChild(style);
    global[STYLE_FLAG] = true;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normState(state) {
    var s = String(state || 'idle').toLowerCase();
    return STATES.indexOf(s) >= 0 ? s : 'idle';
  }

  function label(state) {
    return LABELS[normState(state)];
  }

  function styleAttr(opts) {
    var o = opts || {};
    var parts = [];
    if (o.size) {
      var n = parseFloat(o.size);
      if (!isNaN(n) && n > 0) parts.push('--ca-size:' + n + 'px');
    }
    if (o.accent) parts.push('--ca-accent:' + o.accent);
    if (o.hair) parts.push('--ca-hair:' + o.hair);
    if (o.spark) parts.push('--ca-spark:' + o.spark);
    if (!parts.length) return '';
    return ' style="' + esc(parts.join(';')) + '"';
  }

  function render(state, opts) {
    injectStyle();
    var st = normState(state);
    var o = opts || {};
    var cls = 'ca-avatar ca-state-' + st;
    if (o.shape === 'square') cls += ' ca-square';
    var txt = o.text != null ? String(o.text) : label(st);
    return '<div class="' + cls + '" role="img" data-ca-state="' + st + '"' +
      ' aria-label="' + esc(txt) + '"' + styleAttr(o) + '>' +
      SVG +
      '<span class="ca-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '</div>';
  }

  function mount(el, state, opts) {
    if (!el) return null;
    el.innerHTML = render(state, opts);
    if (el.firstChild) el.setAttribute('data-ca-state', normState(state));
    return el;
  }

  /* 只更新状态：重渲染形象，并同步带 data-ca-bubble-for 的气泡台词 */
  function setState(el, state) {
    if (!el) return null;
    var st = normState(state);
    mount(el, state);
    var id = el.id;
    if (id && global.document) {
      var b = global.document.querySelector('[data-ca-bubble-for="' + id + '"]');
      if (b) {
        var t = b.querySelector('.ca-bubble-text');
        if (t) t.textContent = label(st);
        b.className = 'ca-bubble ca-bubble-' + st;
        b.setAttribute('data-ca-bubble-state', st);
      }
    }
    return el;
  }

  function bubble(state, text) {
    injectStyle();
    var st = normState(state);
    var body = text == null || text === '' ? label(st) : String(text);
    return '<div class="ca-bubble ca-bubble-' + st + '" data-ca-bubble-state="' + st + '">' +
      '<i class="ca-bubble-arrow" aria-hidden="true"></i>' +
      '<span class="ca-bubble-text">' + esc(body) + '</span>' +
      '</div>';
  }

  var api = {
    render: render,
    label: label,
    mount: mount,
    setState: setState,
    bubble: bubble,
    states: STATES.slice(),
    injectStyle: injectStyle
  };

  injectStyle();
  global.CoachAvatar = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
