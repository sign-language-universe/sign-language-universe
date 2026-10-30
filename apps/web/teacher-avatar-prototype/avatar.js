/* ==========================================================================
   2D 伴学老师角色原型 · 角色正本 + 动效控制器（v1）
   --------------------------------------------------------------------------
   - 零依赖、零网络、零远程 API、零摄像头：只做本地 SVG/CSS 微动效与口型循环。
   - 与主线 apps/web/js/teacher-agent.js 相互独立；主线只负责对话内容，
     本文件只负责「角色看起来活着」，两者可并存也可单独预览。
   - 角色 SVG 正本来历：唯一份在本文件 figureMarkup()。演示台与看板两处容器
     都从这里注入，避免「改了一处、另一处还是旧脸」。
   ========================================================================== */
(function (global) {
  'use strict';

  var uidSeed = 0;

  /* 口型：一律用「填充式」闭合路径，40px 小尺寸下也认得出是张嘴还是微笑 */
  var MOUTH = {
    rest: 'M107 147 Q120 160 133 147 Q120 153 107 147 Z',
    open: 'M108 146 Q120 166 132 146 Q120 154 108 146 Z',
    half: 'M109 147 Q120 157 131 147 Q120 152 109 147 Z',
    small: 'M113 149 Q120 154 127 149 Q120 151 113 149 Z',
    flat: 'M110 150 Q120 152 130 150 Q120 153 110 150 Z',
    grin: 'M105 146 Q120 163 135 146 Q120 154 105 146 Z'
  };

  /* 说话时的口型轮换顺序（避免每帧大幅张开导致的抽动感） */
  var TALK_CYCLE = ['open', 'half', 'small', 'half'];

  /* 情绪默认口型与表情类名 */
  var STATE_MOUTH = { idle: 'rest', happy: 'grin', thinking: 'small', listening: 'rest' };
  var STATE_CLASS = { idle: '', happy: 'is-happy', thinking: 'is-thinking', listening: 'is-listening' };

  /**
   * 角色 SVG。uid 用来给 defs（渐变/图案/裁剪）与无障碍标签加命名空间，
   * 同一页面挂载两个实例时不会出现重复 id。
   */
  function figureMarkup(uid) {
    var halo = 'tapHalo' + uid, knit = 'tapKnit' + uid, sweater = 'tapSweater' + uid,
      clip = 'tapFaceClip' + uid, titleId = 'tapTitle' + uid, descId = 'tapDesc' + uid;
    return '' +
      '<svg class="tap-figure" viewBox="0 0 240 260" role="img"' +
      ' aria-labelledby="' + titleId + ' ' + descId + '">' +
      '<title id="' + titleId + '">小语老师</title>' +
      '<desc id="' + descId + '">友好的 2D 手语伴学老师：会呼吸、眨眼、挥手，说话时口型会动。</desc>' +

      '<defs>' +
        '<linearGradient id="' + halo + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop class="tap-halo-a" offset="0"/><stop class="tap-halo-b" offset="1"/>' +
        '</linearGradient>' +
        '<linearGradient id="' + sweater + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop class="tap-knit-a" offset="0" stop-opacity="0.22"/>' +
          '<stop class="tap-knit-a" offset="1" stop-opacity="0"/>' +
        '</linearGradient>' +
        '<pattern id="' + knit + '" width="9" height="9" patternUnits="userSpaceOnUse">' +
          '<circle class="tap-knit-dot" cx="4.5" cy="4.5" r="1.15"/>' +
        '</pattern>' +
        '<clipPath id="' + clip + '"><ellipse cx="120" cy="121" rx="49" ry="53"/></clipPath>' +
      '</defs>' +

      /* 背景光晕 + 三颗点缀星光（星光只做透明度呼吸，不参与变换，避免与旋转基准打架） */
      '<circle class="tap-halo" fill="url(#' + halo + ')" cx="120" cy="126" r="106"/>' +
      '<g class="tap-sparks" aria-hidden="true">' +
        '<path class="tap-spark" transform="translate(44 62)" d="M0 -7 L1.7 -1.7 L7 0 L1.7 1.7 L0 7 L-1.7 1.7 L-7 0 L-1.7 -1.7 Z"/>' +
        '<path class="tap-spark tap-spark--b" transform="translate(200 92)" d="M0 -5.4 L1.3 -1.3 L5.4 0 L1.3 1.3 L0 5.4 L-1.3 1.3 L-5.4 0 L-1.3 -1.3 Z"/>' +
        '<path class="tap-spark tap-spark--c" transform="translate(56 198)" d="M0 -4.4 L1.1 -1.1 L4.4 0 L1.1 1.1 L0 4.4 L-1.1 1.1 L-4.4 0 L-1.1 -1.1 Z"/>' +
      '</g>' +

      /* 呼吸层：肩胸整体微起伏 */
      '<g class="tap-breath">' +

        /* 躯干：先画基础毛衣色，再叠加柔和高光与针织纹理 */
        '<path class="tap-body-solid" d="M46 258 C50 214 78 191 120 191 C162 191 190 214 194 258 Z"/>' +
        '<path class="tap-body" fill="url(#' + sweater + ')"' +
          ' d="M46 258 C50 214 78 191 120 191 C162 191 190 214 194 258 Z"/>' +
        '<path class="tap-knit" fill="url(#' + knit + ')"' +
          ' d="M46 258 C50 214 78 191 120 191 C162 191 190 214 194 258 Z"/>' +
        '<path class="tap-collar" d="M103 192 Q120 206 137 192 Q120 200 103 192 Z"/>' +

        /* 左臂（画面左侧）：静态袖管，收在画面下缘 */
        '<path class="tap-sleeve" stroke-width="21" d="M64 252 C58 228 63 209 78 199"/>' +

        /* 右臂（画面右侧）：挥手的臂，旋转基准在肩点 */
        '<g class="tap-arm">' +
          '<path class="tap-arm-limb" stroke-width="19" d="M168 202 C184 196 196 178 196 158"/>' +
          '<circle class="tap-hand" cx="197" cy="150" r="12.5"/>' +
          '<path class="tap-fingers" stroke-width="3.2" d="M191 141 L190 134 M197 139 L197 132 M203 141 L204 134"/>' +
        '</g>' +

        '<rect class="tap-neck" x="108" y="163" width="24" height="30" rx="11"/>' +

        /* 头部：缓慢左右微摆，基准在颈部 */
        '<g class="tap-head">' +
          '<ellipse class="tap-hair-back" cx="120" cy="113" rx="57" ry="59"/>' +
          '<ellipse class="tap-ear" cx="69" cy="124" rx="7" ry="9.5"/>' +
          '<ellipse class="tap-ear" cx="171" cy="124" rx="7" ry="9.5"/>' +
          '<ellipse class="tap-face" cx="120" cy="121" rx="49" ry="53"/>' +
          '<g clip-path="url(#' + clip + ')">' +
            '<path class="tap-bangs" d="M71 114 C74 76 166 76 169 114 C156 96 142 91 120 91 C98 91 84 96 71 114 Z"/>' +
          '</g>' +
          '<path class="tap-side-hair" d="M66 112 C60 140 62 166 70 182 C64 162 63 136 66 112 Z"/>' +
          '<path class="tap-side-hair" d="M174 112 C180 140 178 166 170 182 C176 162 177 136 174 112 Z"/>' +

          '<g class="tap-brows">' +
            '<path class="tap-brow" stroke-width="3" d="M89 101 Q100 96 111 101"/>' +
            '<path class="tap-brow" stroke-width="3" d="M129 101 Q140 96 151 101"/>' +
          '</g>' +

          /* 眼睛：眨眼由 .is-blink 把整只眼压成一条线（transform-origin 在各自眼心） */
          '<g class="tap-eyes">' +
            '<g class="tap-eye tap-eye--l">' +
              '<ellipse class="tap-eye-white" cx="100" cy="122" rx="7.6" ry="8.6"/>' +
              '<circle class="tap-pupil" cx="100.8" cy="123" r="4.3"/>' +
              '<circle class="tap-glint" cx="99.2" cy="120.4" r="1.7"/>' +
            '</g>' +
            '<g class="tap-eye tap-eye--r">' +
              '<ellipse class="tap-eye-white" cx="140" cy="122" rx="7.6" ry="8.6"/>' +
              '<circle class="tap-pupil" cx="140.8" cy="123" r="4.3"/>' +
              '<circle class="tap-glint" cx="139.2" cy="120.4" r="1.7"/>' +
            '</g>' +
          '</g>' +

          '<g class="tap-glasses" stroke-width="2.6">' +
            '<circle cx="100" cy="122" r="16.5" fill="none"/>' +
            '<circle cx="140" cy="122" r="16.5" fill="none"/>' +
            '<path d="M116.5 121 Q120 118 123.5 121" fill="none"/>' +
            '<path d="M83.5 119 L70 115" fill="none"/>' +
            '<path d="M156.5 119 L170 115" fill="none"/>' +
          '</g>' +

          '<ellipse class="tap-blush" cx="85" cy="141" rx="9" ry="5"/>' +
          '<ellipse class="tap-blush" cx="155" cy="141" rx="9" ry="5"/>' +
          '<path class="tap-nose" stroke-width="2.2" d="M120 131 Q124 136 119 138"/>' +

          '<g class="tap-mouth-group">' +
            '<path class="tap-mouth" d="' + MOUTH.rest + '"/>' +
          '</g>' +
        '</g>' + /* /tap-head */
      '</g>' + /* /tap-breath */
      '</svg>';
  }

  function prefersReduced() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /**
   * 挂载一个角色实例。
   * @param {HTMLElement} host 容器（内部会被写入一段 SVG）
   * @param {Object} [options] {motion:boolean 覆盖默认动效开关, label:string 覆盖无障碍标题}
   * @return {Object} 控制器
   */
  function mount(host, options) {
    var opts = options || {};
    if (!host) { throw new Error('TeacherAvatar.mount 需要一个容器元素'); }

    var uid = 'i' + (++uidSeed);
    host.innerHTML = figureMarkup(uid);

    var figure = host.querySelector('.tap-figure');
    if (opts.label) {
      var t = figure.querySelector('title');
      if (t) { t.textContent = String(opts.label); }
    }

    var mouth = figure.querySelector('.tap-mouth');
    var timers = [];
    var talkTimer = null;
    var waveTimer = null;
    var blinkTimer = null;
    var idleWaveTimer = null;
    var state = 'idle';
    /* 默认跟随系统偏好：系统要求减弱动效就默认静止，用户仍可用开关手动打开 */
    var motionOn = (opts.motion === undefined) ? !prefersReduced() : !!opts.motion;

    function later(fn, ms) {
      var id = global.setTimeout(function () {
        timers.splice(timers.indexOf(id), 1);
        fn();
      }, ms);
      timers.push(id);
      return id;
    }

    function clearAll() {
      timers.forEach(function (id) { global.clearTimeout(id); });
      timers.length = 0;
      if (talkTimer) { global.clearInterval(talkTimer); talkTimer = null; }
      if (waveTimer) { global.clearTimeout(waveTimer); waveTimer = null; }
      if (blinkTimer) { global.clearTimeout(blinkTimer); blinkTimer = null; }
      if (idleWaveTimer) { global.clearTimeout(idleWaveTimer); idleWaveTimer = null; }
    }

    function setMouth(key) {
      if (mouth) { mouth.setAttribute('d', MOUTH[key] || MOUTH.rest); }
    }

    function setState(next) {
      var key = (STATE_MOUTH[next]) ? next : 'idle';
      Object.keys(STATE_CLASS).forEach(function (name) {
        if (STATE_CLASS[name]) { figure.classList.toggle(STATE_CLASS[name], name === key); }
      });
      state = key;
      host.setAttribute('data-state', key);
      if (!talkTimer) { setMouth(STATE_MOUTH[key]); }
      return key;
    }

    function blink() {
      if (!motionOn) { return; }
      figure.classList.add('is-blink');
      if (blinkTimer) { global.clearTimeout(blinkTimer); }
      blinkTimer = global.setTimeout(function () {
        figure.classList.remove('is-blink');
        blinkTimer = null;
      }, 110);
    }

    /* 挥手：动画时长 = 次数 × 单次周期，结束后摘类，方便反复触发 */
    function wave(times) {
      var count = Math.max(1, Math.min(6, times || 2));
      if (!motionOn) { return; }
      figure.classList.remove('is-waving');
      /* 先写变量再挂类，确保 animation 读到新的迭代次数 */
      figure.style.setProperty('--tap-wave-count', String(count));
      void figure.getBoundingClientRect();
      figure.classList.add('is-waving');
      if (waveTimer) { global.clearTimeout(waveTimer); }
      waveTimer = global.setTimeout(function () {
        figure.classList.remove('is-waving');
        waveTimer = null;
      }, count * 1050 + 60);
    }

    /**
     * 说话：口型按 TALK_CYCLE 轮换，时长随文本长度增长（上限 9 秒）。
     * 减弱动效时不动嘴，只把状态切到 idle，避免对前庭敏感用户持续抖动。
     */
    function speak(text, speakOptions) {
      var so = speakOptions || {};
      var chars = String(text == null ? '' : text).replace(/\s+/g, '').length;
      var ms = Math.min(9000, 700 + chars * 90);
      if (!motionOn) { return ms; }
      if (talkTimer) { global.clearInterval(talkTimer); }
      var step = 0;
      figure.classList.add('is-talking');
      talkTimer = global.setInterval(function () {
        setMouth(TALK_CYCLE[step % TALK_CYCLE.length]);
        step += 1;
      }, so.interval || 95);
      later(function () {
        if (talkTimer) { global.clearInterval(talkTimer); talkTimer = null; }
        figure.classList.remove('is-talking');
        setMouth(STATE_MOUTH[state]);
        blink();
      }, ms);
      return ms;
    }

    /* 空闲微动效循环：随机眨眼 + 偶尔自己挥一下手，幅度与频率都刻意压低 */
    function scheduleBlink() {
      var wait = 2200 + Math.random() * 4000;
      blinkTimer = global.setTimeout(function () {
        if (motionOn) { blink(); }
        scheduleBlink();
      }, wait);
    }
    function scheduleIdleWave() {
      idleWaveTimer = global.setTimeout(function () {
        if (motionOn && !talkTimer) { wave(2); }
        scheduleIdleWave();
      }, 16000 + Math.random() * 14000);
    }

    function startIdle() {
      if (!motionOn) { return; }
      if (!blinkTimer) { scheduleBlink(); }
      if (!idleWaveTimer) { scheduleIdleWave(); }
    }

    function applyMotion() {
      figure.classList.toggle('tap-no-motion', !motionOn);
      if (!motionOn) {
        /* 关掉动效时要把「正在动」的中间态一并归零，否则会停在半张嘴上 */
        clearAll();
        figure.classList.remove('is-talking', 'is-waving', 'is-blink');
        setMouth(STATE_MOUTH[state]);
      } else {
        startIdle();
      }
    }

    function setMotion(on) {
      motionOn = !!on;
      applyMotion();
      return motionOn;
    }

    /* 系统偏好中途变化（例如用户在系统设置里打开「减弱动态效果」）要即时跟上 */
    var mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var onPrefChange = function (e) { setMotion(!e.matches); };
    if (mq) {
      if (typeof mq.addEventListener === 'function') { mq.addEventListener('change', onPrefChange); }
      else if (typeof mq.addListener === 'function') { mq.addListener(onPrefChange); }
    }

    setState('idle');
    applyMotion();

    return {
      host: host,
      figure: figure,
      speak: speak,
      wave: wave,
      blink: blink,
      setState: setState,
      state: function () { return state; },
      setMotion: setMotion,
      motionEnabled: function () { return motionOn; },
      prefersReducedMotion: prefersReduced,
      destroy: function () {
        clearAll();
        if (mq) {
          if (typeof mq.removeEventListener === 'function') { mq.removeEventListener('change', onPrefChange); }
          else if (typeof mq.removeListener === 'function') { mq.removeListener(onPrefChange); }
        }
        host.innerHTML = '';
      }
    };
  }

  global.TeacherAvatar = {
    mount: mount,
    markup: function () { return figureMarkup('static'); },
    MOUTH: MOUTH,
    prefersReducedMotion: prefersReduced
  };
})(typeof window !== 'undefined' ? window : this);
