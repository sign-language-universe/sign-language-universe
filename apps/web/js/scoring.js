/* =============================================
   手语评分前端桥接
   摄像头采样 · Scoring API 调用 · 本地预览降级
   ============================================= */

(function () {
  const STORAGE_KEY = 'signUniverseScoringApiBase';
  const MAX_FRAMES = 90;
  const COUNTDOWN_SECONDS = 3;
  const UPLOAD_JPEG_QUALITY = 0.7;
  const MOTION_SIG_WIDTH = 32;
  const MOTION_SIG_HEIGHT = 24;
  const DEFAULT_CAPTURE_DURATION_SEC = 2.5;
  const DEFAULT_CAPTURE_FPS = 10;
  const DEFAULT_FRAME_WIDTH = 480;
  const HOLISTIC_CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/holistic';
  const HOLISTIC_SCRIPT_URL = `${HOLISTIC_CDN_BASE}/holistic.js`;
  const BROWSER_HOLISTIC_TIMEOUT_MS = 12000;
  const BROWSER_HOLISTIC_FRAME_TIMEOUT_MS = 3500;
  const FACE_CORE_INDICES = [33, 133, 159, 145, 362, 263, 386, 374, 61, 291, 13, 14];

  const CAPTURE_RECOMMENDATIONS = {
    '花': { minFrames: 10, minDurationSec: 2.5, minFps: 4 },
    '跳': { minFrames: 8, minDurationSec: 2.0, minFps: 4 },
    '香蕉': { minFrames: 10, minDurationSec: 2.5, minFps: 4 },
    '汽车': { minFrames: 10, minDurationSec: 2.5, minFps: 4 },
    default: { minFrames: 10, minDurationSec: 2.5, minFps: 4 }
  };

  const WORD_TEMPLATE_IDS = {
    '香蕉': 'xiangjiao',
    '花': 'flower',
    '汽车': 'car',
    '虎': 'tiger',
    '月亮': 'moon',
    '跳': 'jump',
    '朋友': 'friend',
    '指示': 'point',
    '唱歌': 'sing',
    '馋': 'chan',
    '你好': 'nihao',
    '谢谢': 'xiexie',
    '爸爸': 'baba',
    '学习': 'xuexi',
    '文化': 'wenhua'
  };

  const state = {
    stream: null,
    video: null,
    canvas: document.createElement('canvas'),
    frames: [],
    landmarkRows: [],
    captureStillUrl: '',
    uiTimer: null,
    recordStartedAt: 0,
    capturePlan: null,
    captureDurationMs: 0,
    captureRunId: 0,
    apiBase: null,
    lastHealth: null,
    scoringBusy: false,
    browserHolistic: null,
    browserHolisticLoading: null,
    browserHolisticPending: null,
    browserHolisticPreloadPromise: null,
    browserHolisticWarmupPromise: null,
    browserHolisticUnavailable: false,
    browserHolisticActive: false,
    browserHolisticReady: false,
    browserHolisticPreloadMs: null,
    browserHolisticWarmupMs: null,
    browserHolisticStats: null,
    scoringWaitTimer: null,
    scoringStartedAt: 0
  };

  function show(message) {
    if (typeof showToast === 'function') showToast(message);
  }

  function normalizeApiBase(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === 'same-origin') return '';
    return raw.replace(/\/+$/, '');
  }

  function readApiBase() {
    const params = new URLSearchParams(window.location.search);
    const queryValue = params.get('api');
    if (queryValue !== null) {
      const normalized = normalizeApiBase(queryValue);
      window.localStorage.setItem(STORAGE_KEY, normalized);
      state.apiBase = normalized;
      return normalized;
    }
    if (state.apiBase !== null) return state.apiBase;
    state.apiBase = normalizeApiBase(window.localStorage.getItem(STORAGE_KEY) || '');
    return state.apiBase;
  }

  function apiUrl(path) {
    const base = readApiBase();
    return `${base}${path}`;
  }

  function updateApiInput() {
    const input = document.getElementById('scoring-api-base-input');
    if (input) input.value = readApiBase();
  }

  function setServiceStatus(kind, text) {
    const dot = document.getElementById('scoring-service-dot');
    const label = document.getElementById('scoring-service-status');
    const note = document.getElementById('scoring-worker-note');
    if (dot) dot.className = `service-dot ${kind}`;
    if (label) label.textContent = text;
    if (note) note.textContent = text;
  }

  async function checkHealth() {
    updateApiInput();
    setServiceStatus('checking', '评分服务检测中');
    try {
      const response = await fetch(apiUrl('/api/scoring/health'), {
        method: 'GET',
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      state.lastHealth = payload;
      let workerText = '评分服务在线，worker 未启用';
      if (payload.worker_enabled && payload.worker_ready) {
        workerText = 'Holistic worker 已就绪';
      } else if (payload.worker_enabled) {
        workerText = '评分服务在线，worker 将在首次评分时启动';
      }
      const templateText = payload.template_root_configured ? '已配置模板' : '未配置模板';
      setServiceStatus(payload.worker_ready ? 'ready' : 'online', `${workerText} · ${templateText}`);
      return payload;
    } catch (error) {
      state.lastHealth = null;
      setServiceStatus('offline', '评分服务未连接，将使用本地预览评分');
      return null;
    }
  }

  function saveApiBaseFromInput() {
    const input = document.getElementById('scoring-api-base-input');
    const normalized = normalizeApiBase(input ? input.value : '');
    window.localStorage.setItem(STORAGE_KEY, normalized);
    state.apiBase = normalized;
    updateApiInput();
    checkHealth();
  }

  function currentWordData() {
    const words = typeof CHALLENGE_WORDS !== 'undefined' ? CHALLENGE_WORDS : [];
    if (!words.length) return { word: '花', pinyin: '', model: '花' };
    return words[AppState.challengeIndex % words.length];
  }

  function templateIdForWord(word) {
    return WORD_TEMPLATE_IDS[word] || word;
  }

  function clampNumber(value, minValue, maxValue, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minValue, Math.min(maxValue, number));
  }

  function formatNumber(value, digits = 2) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
    return Number(value).toFixed(digits);
  }

  function formatSeconds(ms) {
    return `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1)}s`;
  }

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function setWebHolisticStatus(kind, text) {
    const note = document.getElementById('scoring-web-holistic-note');
    if (!note) return;
    note.className = `scoring-web-holistic-note ${kind}`;
    note.textContent = text;
  }

  function webHolisticReadyText(extraText = '') {
    const preloadText = state.browserHolisticPreloadMs !== null
      ? `加载 ${formatSeconds(state.browserHolisticPreloadMs)}`
      : '已加载';
    const warmupText = state.browserHolisticWarmupMs !== null
      ? `预热 ${formatSeconds(state.browserHolisticWarmupMs)}`
      : '已预热';
    return `Web Holistic 已就绪并常驻 · ${preloadText} · ${warmupText}${extraText}`;
  }

  function syncWebHolisticStatus() {
    if (state.browserHolisticReady && state.browserHolistic) {
      setWebHolisticStatus('ready', webHolisticReadyText());
    } else if (state.browserHolisticPreloadPromise || state.browserHolisticLoading || state.browserHolisticWarmupPromise) {
      setWebHolisticStatus('checking', 'Web Holistic 正在加载并预热');
    } else if (state.browserHolisticUnavailable) {
      setWebHolisticStatus('offline', 'Web Holistic 不可用，将回退上传压缩帧');
    } else {
      setWebHolisticStatus('checking', 'Web Holistic 准备中');
    }
  }

  function setAutoScoreStatus(text, visible = true) {
    const note = document.getElementById('scoring-auto-note');
    if (!note) return;
    note.hidden = !visible;
    if (text) note.textContent = text;
  }

  function updateScoringWaitStatus() {
    const elapsedMs = state.scoringStartedAt ? performance.now() - state.scoringStartedAt : 0;
    setAutoScoreStatus(`正在等待评分：${formatSeconds(elapsedMs)}`, true);
  }

  function stopScoringWaitStatus(text = '', { hide = false } = {}) {
    if (state.scoringWaitTimer) {
      window.clearInterval(state.scoringWaitTimer);
      state.scoringWaitTimer = null;
    }
    if (hide) {
      setAutoScoreStatus('', false);
    } else if (text) {
      setAutoScoreStatus(text, true);
    }
  }

  function startScoringWaitStatus() {
    stopScoringWaitStatus();
    state.scoringStartedAt = performance.now();
    updateScoringWaitStatus();
    state.scoringWaitTimer = window.setInterval(updateScoringWaitStatus, 100);
  }

  function withTimeout(promise, timeoutMs, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) window.clearTimeout(timer);
    });
  }

  function loadScriptOnce(src, timeoutMs = BROWSER_HOLISTIC_TIMEOUT_MS) {
    if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
    return withTimeout(new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`脚本加载失败：${src}`));
      document.head.appendChild(script);
    }), timeoutMs, '浏览器 Holistic 脚本加载超时');
  }

  async function ensureBrowserHolistic() {
    if (state.browserHolistic) return state.browserHolistic;
    if (state.browserHolisticUnavailable) return null;
    if (!state.browserHolisticLoading) {
      state.browserHolisticLoading = (async () => {
        const startedAt = performance.now();
        await loadScriptOnce(HOLISTIC_SCRIPT_URL);
        if (!window.Holistic) throw new Error('浏览器 Holistic SDK 未正确加载');
        const holistic = new window.Holistic({
          locateFile: file => `${HOLISTIC_CDN_BASE}/${file}`
        });
        holistic.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          enableSegmentation: false,
          refineFaceLandmarks: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        holistic.onResults(results => {
          const pending = state.browserHolisticPending;
          if (!pending) return;
          state.browserHolisticPending = null;
          pending.resolve(results);
        });
        state.browserHolistic = holistic;
        state.browserHolisticStats = {
          ...(state.browserHolisticStats || {}),
          sdk_load_ms: Math.round(performance.now() - startedAt)
        };
        state.browserHolisticPreloadMs = state.browserHolisticStats.sdk_load_ms;
        return holistic;
      })().catch(error => {
        state.browserHolisticUnavailable = true;
        state.browserHolistic = null;
        throw error;
      }).finally(() => {
        state.browserHolisticLoading = null;
      });
    }
    return state.browserHolisticLoading;
  }

  async function sendBrowserHolisticImage(image) {
    const holistic = await ensureBrowserHolistic();
    if (!holistic) return null;
    if (state.browserHolisticPending) {
      throw new Error('浏览器 Holistic 仍在处理上一帧');
    }
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (state.browserHolisticPending) state.browserHolisticPending = null;
        reject(new Error('浏览器 Holistic 单帧处理超时'));
      }, BROWSER_HOLISTIC_FRAME_TIMEOUT_MS);
      state.browserHolisticPending = {
        resolve: results => {
          window.clearTimeout(timer);
          resolve(results);
        },
        reject: error => {
          window.clearTimeout(timer);
          reject(error);
        }
      };
      Promise.resolve(holistic.send({ image })).catch(error => {
        if (state.browserHolisticPending) {
          window.clearTimeout(timer);
          state.browserHolisticPending = null;
          reject(error);
        }
      });
    });
  }

  async function warmupBrowserHolistic() {
    if (state.browserHolisticReady && state.browserHolistic) return state.browserHolistic;
    if (state.browserHolisticWarmupPromise) return state.browserHolisticWarmupPromise;
    state.browserHolisticWarmupPromise = (async () => {
      const holistic = await ensureBrowserHolistic();
      if (!holistic) return null;
      const startedAt = performance.now();
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 96;
      const context = canvas.getContext('2d');
      context.fillStyle = '#111';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await sendBrowserHolisticImage(canvas);
      canvas.width = 0;
      canvas.height = 0;
      state.browserHolisticReady = true;
      state.browserHolisticWarmupMs = Math.round(performance.now() - startedAt);
      state.browserHolisticStats = {
        ...(state.browserHolisticStats || {}),
        enabled: true,
        route: 'preloaded_web_holistic',
        warmup_ms: state.browserHolisticWarmupMs
      };
      setWebHolisticStatus('ready', webHolisticReadyText());
      return holistic;
    })().catch(error => {
      state.browserHolisticReady = false;
      state.browserHolisticUnavailable = true;
      state.browserHolisticStats = {
        ...(state.browserHolisticStats || {}),
        enabled: false,
        route: 'frame_slices',
        preload_error: error.message
      };
      setWebHolisticStatus('offline', `Web Holistic 加载失败：${error.message}`);
      return null;
    }).finally(() => {
      state.browserHolisticWarmupPromise = null;
    });
    return state.browserHolisticWarmupPromise;
  }

  async function preloadBrowserHolistic() {
    if (state.browserHolisticReady && state.browserHolistic) {
      setWebHolisticStatus('ready', webHolisticReadyText());
      return state.browserHolistic;
    }
    if (state.browserHolisticUnavailable) {
      setWebHolisticStatus('offline', 'Web Holistic 不可用，将回退上传压缩帧');
      return null;
    }
    if (state.browserHolisticPreloadPromise) return state.browserHolisticPreloadPromise;
    state.browserHolisticPreloadPromise = (async () => {
      setWebHolisticStatus('checking', 'Web Holistic 正在加载并预热');
      const startedAt = performance.now();
      const holistic = await withTimeout(warmupBrowserHolistic(), BROWSER_HOLISTIC_TIMEOUT_MS, '浏览器 Holistic 预加载超时');
      if (holistic) {
        if (state.browserHolisticPreloadMs === null) {
          state.browserHolisticPreloadMs = Math.round(performance.now() - startedAt);
        }
        setWebHolisticStatus('ready', webHolisticReadyText());
      }
      return holistic;
    })().catch(error => {
      state.browserHolisticReady = false;
      state.browserHolisticUnavailable = true;
      state.browserHolisticStats = {
        ...(state.browserHolisticStats || {}),
        enabled: false,
        route: 'frame_slices',
        preload_error: error.message
      };
      setWebHolisticStatus('offline', `Web Holistic 加载失败：${error.message}`);
      return null;
    }).finally(() => {
      state.browserHolisticPreloadPromise = null;
    });
    return state.browserHolisticPreloadPromise;
  }

  function serializeLandmarkPoint(point) {
    const values = [
      finiteNumber(point.x),
      finiteNumber(point.y),
      finiteNumber(point.z)
    ];
    if (Number.isFinite(Number(point.visibility)) || Number.isFinite(Number(point.presence))) {
      values.push(finiteNumber(point.visibility));
      values.push(finiteNumber(point.presence));
    }
    return values;
  }

  function serializeLandmarkList(landmarks, indices = null) {
    if (!landmarks || typeof landmarks[Symbol.iterator] !== 'function') return [];
    const points = Array.from(landmarks);
    const selected = Array.isArray(indices)
      ? indices.map(index => points[index]).filter(Boolean)
      : points;
    return selected.map(serializeLandmarkPoint);
  }

  function landmarkCount(row) {
    if (!row) return 0;
    return ['pose_landmarks', 'left_hand_landmarks', 'right_hand_landmarks', 'face_landmarks', 'face_core_landmarks']
      .reduce((sum, key) => sum + (Array.isArray(row[key]) ? row[key].length : 0), 0);
  }

  function landmarkPresenceRatio(rows, keys) {
    if (!rows.length) return 0;
    const present = rows.filter(row => keys.some(key => Array.isArray(row[key]) && row[key].length > 0)).length;
    return present / rows.length;
  }

  async function landmarkRowFromCanvas(canvas, item, plan) {
    const startedAt = performance.now();
    const results = await sendBrowserHolisticImage(canvas);
    if (!results) return null;
    return {
      index: item.candidateIndex,
      timestamp_ms: Math.round(item.timestampMs),
      frame_weight: finiteNumber(item.frameWeight, 1),
      image_width: canvas.width,
      image_height: canvas.height,
      processing_ms: Math.round(performance.now() - startedAt),
      pose_landmarks: serializeLandmarkList(results.poseLandmarks),
      left_hand_landmarks: serializeLandmarkList(results.leftHandLandmarks),
      right_hand_landmarks: serializeLandmarkList(results.rightHandLandmarks),
      face_landmarks: [],
      face_core_landmarks: serializeLandmarkList(results.faceLandmarks, FACE_CORE_INDICES),
      capture_fps: plan.candidateFps || plan.uploadFps
    };
  }

  async function prepareBrowserHolisticForCapture(video, plan) {
    state.browserHolisticActive = false;
    state.browserHolisticStats = {
      enabled: false,
      route: 'frame_slices',
      sdk: '@mediapipe/holistic',
      cdn: HOLISTIC_CDN_BASE
    };
    if (!video || video.readyState < 2) return;
    try {
      const startedAt = performance.now();
      setWebHolisticStatus('checking', 'Web Holistic 已加载，正在用摄像头画面预热');
      setServiceStatus('checking', '正在准备浏览器 Holistic');
      const holistic = await preloadBrowserHolistic();
      if (!holistic) throw new Error('浏览器 Holistic 未就绪');

      const warmCanvas = document.createElement('canvas');
      const sourceWidth = video.videoWidth || 640;
      const sourceHeight = video.videoHeight || 480;
      warmCanvas.width = 192;
      warmCanvas.height = Math.max(1, Math.round(warmCanvas.width * sourceHeight / sourceWidth));
      const context = warmCanvas.getContext('2d');
      context.drawImage(video, 0, 0, warmCanvas.width, warmCanvas.height);
      const warmStartedAt = performance.now();
      await sendBrowserHolisticImage(warmCanvas);
      warmCanvas.width = 0;
      warmCanvas.height = 0;

      state.browserHolisticActive = true;
      state.browserHolisticStats = {
        ...(state.browserHolisticStats || {}),
        enabled: true,
        route: 'web_holistic_landmarks',
        prepare_ms: Math.round(performance.now() - startedAt),
        preload_ms: state.browserHolisticPreloadMs,
        blank_warmup_ms: state.browserHolisticWarmupMs,
        camera_warmup_ms: Math.round(performance.now() - warmStartedAt)
      };
      plan.targetFrames = Math.max(1, Math.min(MAX_FRAMES, plan.targetFrames));
      plan.candidateFps = plan.targetFrames / plan.durationSec;
      plan.candidateFrames = plan.targetFrames;
      plan.captureTransport = 'web_holistic_landmarks';
      setWebHolisticStatus('ready', webHolisticReadyText(` · 采集 ${plan.targetFrames} 帧`));
      setServiceStatus('ready', `浏览器 Holistic 已就绪 · 将上传 ${plan.targetFrames} 帧关键点`);
    } catch (error) {
      state.browserHolisticActive = false;
      state.browserHolisticStats = {
        ...(state.browserHolisticStats || {}),
        enabled: false,
        route: 'frame_slices',
        error: error.message
      };
      setWebHolisticStatus('offline', 'Web Holistic 不可用，将上传压缩帧');
      setServiceStatus('online', '浏览器 Holistic 不可用，将上传压缩帧');
    }
  }

  function inputValue(id, fallback) {
    const el = document.getElementById(id);
    return el ? el.value : fallback;
  }

  function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = String(value);
  }

  function getCaptureRecommendation(word) {
    return CAPTURE_RECOMMENDATIONS[word] || CAPTURE_RECOMMENDATIONS.default;
  }

  function buildCapturePlan({ write = false } = {}) {
    const word = currentWordData().word;
    const rec = getCaptureRecommendation(word);
    const durationSec = clampNumber(inputValue('scoring-duration-sec', DEFAULT_CAPTURE_DURATION_SEC), 1, 8, DEFAULT_CAPTURE_DURATION_SEC);
    const uploadFps = Math.round(clampNumber(inputValue('scoring-capture-fps', DEFAULT_CAPTURE_FPS), 1, 12, DEFAULT_CAPTURE_FPS));
    const frameWidth = Math.round(clampNumber(inputValue('scoring-frame-width', DEFAULT_FRAME_WIDTH), 240, 960, DEFAULT_FRAME_WIDTH));
    const requestedDurationSec = durationSec;
    const requestedUploadFps = uploadFps;
    const targetFrames = Math.max(1, Math.min(MAX_FRAMES, Math.round(durationSec * uploadFps)));
    const candidateFps = uploadFps;
    const candidateFrames = targetFrames;
    if (write) {
      setInputValue('scoring-duration-sec', Number.isInteger(durationSec) ? durationSec : durationSec.toFixed(1));
      setInputValue('scoring-capture-fps', uploadFps);
      setInputValue('scoring-frame-width', frameWidth);
    }
    return {
      word,
      requestedDurationSec,
      requestedUploadFps,
      durationSec,
      uploadFps,
      frameWidth,
      targetFrames,
      candidateFps,
      candidateFrames,
      minFrames: rec.minFrames,
      recommendedDurationSec: rec.minDurationSec,
      recommendedFps: rec.minFps,
      originalFrames: targetFrames,
      belowRecommendation: targetFrames < rec.minFrames,
      belowTechnicalMinimum: targetFrames < 3
    };
  }

  function captureHintSuffix(plan) {
    if (plan.belowTechnicalMinimum) {
      return '少于 3 帧时通常无法提交正式评分，请适当增加时长或 FPS。';
    }
    if (plan.belowRecommendation) {
      return '低于建议帧数，仍会按当前设置采集，但评分稳定性可能下降。';
    }
    return '已达到建议帧数。';
  }

  function updateCaptureHint(plan = buildCapturePlan()) {
    const hint = document.getElementById('scoring-capture-hint');
    if (!hint) return;
    const currentText = `${plan.durationSec}s x ${plan.uploadFps}fps = ${plan.targetFrames} 帧`;
    const recommendationText = `建议至少 ${plan.minFrames} 帧`;
    const suffix = captureHintSuffix(plan);
    if (plan.captureTransport === 'web_holistic_landmarks') {
      hint.textContent = `采样：浏览器本机提取 Holistic 关键点；${recommendationText}；当前按设置采集 ${currentText}，只上传姿态、双手和面部核心点。${suffix}`;
      return;
    }
    hint.textContent = `采样：${plan.word} ${recommendationText}；当前按设置采集 ${currentText}。${suffix}`;
  }

  function setProgress(percent) {
    const bar = document.getElementById('scoring-progress-bar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  function formatTimerMs(ms) {
    const safeMs = Math.max(0, Math.round(Number(ms) || 0));
    const totalTenths = Math.round(safeMs / 100);
    const mins = String(Math.floor(totalTenths / 600)).padStart(2, '0');
    const secs = String(Math.floor((totalTenths % 600) / 10)).padStart(2, '0');
    const tenths = totalTenths % 10;
    return tenths ? `${mins}:${secs}.${tenths}` : `${mins}:${secs}`;
  }

  function setTimerMs(ms) {
    const timerEl = document.getElementById('timer-display');
    if (timerEl) timerEl.textContent = formatTimerMs(ms);
    AppState.recordingSeconds = Math.max(0, (Number(ms) || 0) / 1000);
  }

  function renderCameraShell() {
    const cameraInner = document.getElementById('challenge-camera-inner');
    if (!cameraInner) return null;
    cameraInner.classList.add('is-live');
    cameraInner.innerHTML = `
      <video id="scoring-camera-video" class="scoring-camera-video" autoplay muted playsinline></video>
      <div class="scoring-countdown-overlay hidden" id="scoring-countdown-overlay" aria-live="polite">
        <span id="scoring-countdown-value">${COUNTDOWN_SECONDS}</span>
      </div>
      <div class="scoring-camera-overlay">
        <span class="recording-indicator" id="recording-indicator">录制中</span>
        <span id="scoring-frame-count">0 帧</span>
      </div>
    `;
    state.video = document.getElementById('scoring-camera-video');
    return state.video;
  }

  async function ensureCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('当前浏览器不支持摄像头采集');
    }
    const video = renderCameraShell();
    if (!video) throw new Error('摄像头区域未找到');
    if (!state.stream) {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 960 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: false
      });
    }
    video.srcObject = state.stream;
    await video.play();
    return video;
  }

  function stopCameraStream() {
    if (state.video) {
      try {
        state.video.pause();
        state.video.srcObject = null;
      } catch (error) {
        // Ignore browser-specific teardown errors; track.stop() below is authoritative.
      }
    }
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
      state.stream = null;
    }
    state.video = null;
  }

  function escapeAttribute(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function captureLastVideoStill() {
    const video = state.video;
    if (!video || video.readyState < 2) return '';
    try {
      const sourceWidth = video.videoWidth || 640;
      const sourceHeight = video.videoHeight || 480;
      const width = Math.max(240, Math.min(480, sourceWidth));
      const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return '';
      context.translate(width, 0);
      context.scale(-1, 1);
      context.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      canvas.width = 0;
      canvas.height = 0;
      return dataUrl;
    } catch (error) {
      return '';
    }
  }

  function renderCameraStatus(title, line, detail, stillUrl = '', accent = 'var(--accent-green)') {
    const cameraInner = document.getElementById('challenge-camera-inner');
    if (!cameraInner) return;
    cameraInner.classList.remove('is-live');
    const stillHtml = stillUrl
      ? `<img class="scoring-capture-still" src="${escapeAttribute(stillUrl)}" alt="">`
      : '';
    cameraInner.innerHTML = `
      <div class="scoring-capture-complete${stillUrl ? ' has-still' : ''}">
        ${stillHtml}
        <strong style="color:${accent};">${title}</strong>
        <span>${line}</span>
        <small>${detail}</small>
      </div>
    `;
  }

  function renderCaptureComplete(selectedCount, plan, stillUrl = '') {
    renderCameraStatus(
      '采集完成',
      `采集 ${selectedCount} 帧 · ${formatTimerMs(Math.round(plan.durationSec * 1000))}`,
      '摄像头已关闭',
      stillUrl
    );
  }

  function renderCaptureClosing(stillUrl = '') {
    renderCameraStatus('采集结束', '摄像头已关闭', '正在整理上传帧', stillUrl);
  }

  function stopUiTimer() {
    if (state.uiTimer) {
      clearInterval(state.uiTimer);
      state.uiTimer = null;
    }
  }

  function stopAll() {
    state.captureRunId++;
    stopUiTimer();
    stopScoringWaitStatus('', { hide: true });
    stopCameraStream();
    state.frames = [];
    state.landmarkRows = [];
    state.captureStillUrl = '';
    state.capturePlan = null;
    state.captureDurationMs = 0;
    state.scoringBusy = false;
    state.browserHolisticActive = false;
    AppState.isRecording = false;
    setProgress(0);
  }

  function resetForChallenge() {
    stopAll();
    updateApiInput();
    updateCaptureHint();
    syncWebHolisticStatus();
    setAutoScoreStatus('', false);
    renderScoreDetails(null);
    checkHealth();
    preloadBrowserHolistic();
  }

  function updateTimerUi() {
    const elapsedMs = Math.max(0, Date.now() - state.recordStartedAt);
    const cappedMs = state.captureDurationMs ? Math.min(elapsedMs, state.captureDurationMs) : elapsedMs;
    setTimerMs(cappedMs);
    if (AppState.isRecording && state.captureDurationMs) {
      setProgress((cappedMs / state.captureDurationMs) * 100);
    }
  }

  function buildMotionSignature(context, width, height) {
    const image = context.getImageData(0, 0, width, height).data;
    const bins = new Float32Array(MOTION_SIG_WIDTH * MOTION_SIG_HEIGHT);
    const counts = new Uint16Array(MOTION_SIG_WIDTH * MOTION_SIG_HEIGHT);
    for (let y = 0; y < height; y += 2) {
      const by = Math.min(MOTION_SIG_HEIGHT - 1, Math.floor((y / height) * MOTION_SIG_HEIGHT));
      for (let x = 0; x < width; x += 2) {
        const bx = Math.min(MOTION_SIG_WIDTH - 1, Math.floor((x / width) * MOTION_SIG_WIDTH));
        const src = (y * width + x) * 4;
        const gray = 0.299 * image[src] + 0.587 * image[src + 1] + 0.114 * image[src + 2];
        const dst = by * MOTION_SIG_WIDTH + bx;
        bins[dst] += gray / 255;
        counts[dst] += 1;
      }
    }
    for (let i = 0; i < bins.length; i += 1) {
      bins[i] = counts[i] ? bins[i] / counts[i] : 0;
    }
    return bins;
  }

  function signatureMotion(prev, curr) {
    if (!prev || !curr || prev.length !== curr.length) return 0;
    let total = 0;
    for (let i = 0; i < curr.length; i += 1) total += Math.abs(curr[i] - prev[i]);
    return total / curr.length;
  }

  function normalizeFrameWeights(values) {
    if (!values.length) return [];
    const positive = values.filter(value => Number.isFinite(value) && value > 0);
    const baseline = positive.length ? positive.reduce((sum, value) => sum + value, 0) / positive.length : 1;
    const withFloor = values.map(value => Math.max(0, Number(value) || 0) + baseline * 0.2);
    const mean = withFloor.reduce((sum, value) => sum + value, 0) / withFloor.length || 1;
    return withFloor.map(value => Math.max(0.45, Math.min(2.75, value / mean)));
  }

  function selectEnergyCoverageFrames(candidates, targetFrames) {
    const count = candidates.length;
    const target = Math.max(1, Math.min(targetFrames, count));
    if (target >= count) return candidates.map((item, idx) => ({ ...item, uploadRank: idx }));

    const selected = new Set();
    const coverageCount = Math.max(2, Math.min(target, Math.ceil(target * 0.55)));
    for (let i = 0; i < coverageCount; i++) {
      selected.add(Math.round((i * (count - 1)) / Math.max(coverageCount - 1, 1)));
    }
    candidates
      .map((item, idx) => ({ idx, score: item.energySmooth }))
      .sort((a, b) => b.score - a.score)
      .forEach(item => {
        if (selected.size < target) selected.add(item.idx);
      });
    return Array.from(selected)
      .sort((a, b) => a - b)
      .map((idx, rank) => ({ ...candidates[idx], uploadRank: rank }));
  }

  function captureFrame(frameWidth, candidateIndex, options = {}) {
    const includeImage = options.includeImage !== false;
    const keepCanvas = options.keepCanvas === true;
    const video = state.video;
    if (!video || video.readyState < 2) return null;
    const sourceWidth = video.videoWidth || 640;
    const sourceHeight = video.videoHeight || 480;
    const width = Math.max(240, Math.min(frameWidth, sourceWidth, 960));
    const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
    const canvas = keepCanvas ? document.createElement('canvas') : state.canvas;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);
    let frame = null;
    if (includeImage) {
      const dataUrl = canvas.toDataURL('image/jpeg', UPLOAD_JPEG_QUALITY);
      frame = { image_base64: dataUrl.split(',', 2)[1] || '' };
    }
    return {
      candidateIndex,
      timestampMs: Date.now() - state.recordStartedAt,
      frame,
      canvas: keepCanvas ? canvas : null,
      width,
      height,
      signature: buildMotionSignature(context, width, height)
    };
  }

  async function runCountdown(seconds, runId) {
    const overlay = document.getElementById('scoring-countdown-overlay');
    const value = document.getElementById('scoring-countdown-value');
    if (overlay) overlay.classList.remove('hidden');
    for (let remaining = seconds; remaining >= 1; remaining--) {
      if (runId !== state.captureRunId) return false;
      if (value) value.textContent = String(remaining);
      setServiceStatus('checking', `${remaining}s 后开始采集，请准备动作`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (value) value.textContent = '开始';
    await new Promise(resolve => setTimeout(resolve, 260));
    if (overlay) overlay.classList.add('hidden');
    return runId === state.captureRunId;
  }

  async function collectFrames(plan, runId) {
    const candidates = [];
    let prevSignature = null;
    const useBrowserHolistic = state.browserHolisticActive === true;
    state.frames = [];
    state.landmarkRows = [];
    state.recordStartedAt = Date.now();
    state.captureDurationMs = Math.round(plan.durationSec * 1000);
    AppState.isRecording = true;
    setProgress(0);

    const recIndicator = document.getElementById('recording-indicator');
    if (recIndicator) recIndicator.classList.add('active');
    const countEl = document.getElementById('scoring-frame-count');
    if (countEl) countEl.textContent = '0 帧';

    state.uiTimer = setInterval(updateTimerUi, 100);
    updateTimerUi();
    for (let i = 0; i < plan.candidateFrames; i++) {
      if (runId !== state.captureRunId) return [];
      const targetElapsedMs = plan.candidateFrames > 1
        ? Math.round((i * state.captureDurationMs) / (plan.candidateFrames - 1))
        : 0;
      const waitMs = state.recordStartedAt + targetElapsedMs - Date.now();
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      if (runId !== state.captureRunId) return [];
      updateTimerUi();
      const captured = captureFrame(plan.frameWidth, i, {
        includeImage: !useBrowserHolistic,
        keepCanvas: useBrowserHolistic
      });
      if (captured) {
        const motion = signatureMotion(prevSignature, captured.signature);
        prevSignature = captured.signature;
        candidates.push({
          candidateIndex: i,
          timestampMs: captured.timestampMs,
          frame: captured.frame,
          canvas: captured.canvas,
          width: captured.width,
          height: captured.height,
          energy: motion,
          energySmooth: motion,
          frameWeight: 1.0
        });
      }
      if (countEl) countEl.textContent = `${candidates.length} 采集帧`;
    }
    const remainingMs = state.recordStartedAt + state.captureDurationMs - Date.now();
    if (remainingMs > 0) await new Promise(resolve => setTimeout(resolve, remainingMs));
    if (runId !== state.captureRunId) return [];
    setTimerMs(state.captureDurationMs);
    setProgress(100);
    state.captureStillUrl = captureLastVideoStill();
    stopUiTimer();
    AppState.isRecording = false;
    stopCameraStream();
    renderCaptureClosing(state.captureStillUrl);

    const energies = candidates.map((item, idx) => {
      const left = candidates[Math.max(0, idx - 1)]?.energy || 0;
      const right = candidates[Math.min(candidates.length - 1, idx + 1)]?.energy || 0;
      return 0.25 * left + 0.5 * item.energy + 0.25 * right;
    });
    const weights = normalizeFrameWeights(energies);
    candidates.forEach((item, idx) => {
      item.energySmooth = energies[idx] || 0;
      item.frameWeight = weights[idx] || 1.0;
    });
    const selected = selectEnergyCoverageFrames(candidates, plan.targetFrames);
    if (useBrowserHolistic) {
      const extractionStartedAt = performance.now();
      const rows = [];
      for (let idx = 0; idx < selected.length; idx += 1) {
        if (runId !== state.captureRunId) return [];
        const item = selected[idx];
        if (!item.canvas) continue;
        setServiceStatus('checking', `正在本机提取关键点：${idx + 1}/${selected.length}`);
        try {
          const row = await landmarkRowFromCanvas(item.canvas, item, plan);
          if (row) rows.push(row);
        } catch (error) {
          state.browserHolisticStats = {
            ...(state.browserHolisticStats || {}),
            extraction_error: error.message
          };
        } finally {
          item.canvas.width = 0;
          item.canvas.height = 0;
          item.canvas = null;
        }
      }
      state.landmarkRows = rows;
      state.frames = [];
      state.browserHolisticStats = {
        ...(state.browserHolisticStats || {}),
        selected_frames: selected.length,
        landmark_rows: rows.length,
        landmark_points: rows.reduce((sum, row) => sum + landmarkCount(row), 0),
        extraction_ms: Math.round(performance.now() - extractionStartedAt),
        hand_presence_ratio: Number(landmarkPresenceRatio(rows, ['left_hand_landmarks', 'right_hand_landmarks']).toFixed(3)),
        pose_presence_ratio: Number(landmarkPresenceRatio(rows, ['pose_landmarks']).toFixed(3))
      };
      if (countEl) countEl.textContent = `${state.landmarkRows.length} 关键点帧`;
    } else {
      selected.forEach(item => {
        if (item.canvas) {
          item.canvas.width = 0;
          item.canvas.height = 0;
        }
      });
      state.frames = selected
        .filter(item => item.frame && item.frame.image_base64)
        .map(item => ({
          index: item.candidateIndex,
          timestamp_ms: Math.round(item.timestampMs),
          image_base64: item.frame.image_base64
        }));
      state.landmarkRows = [];
      if (countEl) countEl.textContent = `${state.frames.length} 上传帧`;
    }
    return selected;
  }

  async function startChallengeRecording() {
    if (state.scoringBusy) return;
    state.captureRunId++;
    const runId = state.captureRunId;
    stopUiTimer();
    stopCameraStream();
    state.frames = [];
    state.landmarkRows = [];
    state.browserHolisticActive = false;
    stopScoringWaitStatus('', { hide: true });
    renderScoreDetails(null);
    AppState.isRecording = false;
    state.capturePlan = buildCapturePlan({ write: true });
    updateCaptureHint(state.capturePlan);
    setProgress(0);
    try {
      await ensureCamera();
    } catch (error) {
      setServiceStatus('offline', '摄像头未开启');
      show(`摄像头开启失败：${error.message}`);
      return;
    }
    await prepareBrowserHolisticForCapture(state.video, state.capturePlan);
    updateCaptureHint(state.capturePlan);

    const startBtn = document.getElementById('btn-start-record');
    if (startBtn) {
      startBtn.innerHTML = '<span class="ctrl-icon">🔄</span><span>重采</span>';
      startBtn.classList.add('recording');
    }
    const scoreBtn = document.getElementById('btn-score');
    if (scoreBtn) scoreBtn.disabled = true;
    updateTimerUi();
    const wordData = currentWordData();
    show(`准备采集「${wordData.word}」`);

    const ok = await runCountdown(COUNTDOWN_SECONDS, runId);
    if (!ok) {
      stopCameraStream();
      return;
    }
    setServiceStatus('checking', `正在采集评分帧：${state.capturePlan.candidateFrames} 帧`);
    const selected = await collectFrames(state.capturePlan, runId);
    if (runId !== state.captureRunId) return;
    stopUiTimer();
    AppState.isRecording = false;
    stopCameraStream();
    const recIndicator = document.getElementById('recording-indicator');
    if (recIndicator) recIndicator.classList.remove('active');
    if (startBtn) startBtn.classList.remove('recording');
    if (scoreBtn) scoreBtn.disabled = true;
    renderCaptureComplete(selected.length, state.capturePlan, state.captureStillUrl);
    const readyCount = Math.max(state.landmarkRows.length, state.frames.length);
    const routeText = state.landmarkRows.length >= 3 ? '关键点帧' : '上传帧';
    if (readyCount < 3) {
      setServiceStatus('offline', '采集帧不足，请重采');
      show('采集帧不足，请重采');
      return;
    }
    setServiceStatus('checking', `采集完成：按设置采集 ${state.capturePlan.candidateFrames} 帧，${routeText} ${readyCount} 帧，正在自动评分`);
    setAutoScoreStatus('采集完成，正在自动评分：0.0s', true);
    show('采集完成，正在自动评分');
    await new Promise(resolve => setTimeout(resolve, 160));
    if (runId === state.captureRunId) await scoreChallengeWithApi();
  }

  function availableSampleCount() {
    return Math.max(state.frames.length, state.landmarkRows.length);
  }

  function localPreviewScore(reason) {
    const sizes = state.frames.map(frame => frame.image_base64.length);
    const meanSize = sizes.length ? sizes.reduce((sum, value) => sum + value, 0) / sizes.length : 0;
    const variation = sizes.length >= 2 && meanSize > 0
      ? sizes.slice(1).reduce((sum, value, idx) => sum + Math.abs(value - sizes[idx]), 0) / (sizes.length - 1) / meanSize
      : 0;
    const sampleCount = availableSampleCount();
    const handRatio = landmarkPresenceRatio(state.landmarkRows, ['left_hand_landmarks', 'right_hand_landmarks']);
    const poseRatio = landmarkPresenceRatio(state.landmarkRows, ['pose_landmarks']);
    const durationMs = state.captureDurationMs || Math.max(0, Date.now() - state.recordStartedAt);
    const coverage = Math.min(1, sampleCount / 12);
    const durationScore = Math.min(1, Math.max(0, durationMs / 3500));
    const payloadScore = Math.min(1, meanSize / 24000);
    const variationScore = Math.min(1, variation * 12);
    const landmarkScore = state.landmarkRows.length
      ? (28 * Math.max(handRatio, (handRatio + poseRatio) / 2) + 14 * poseRatio)
      : 0;
    const score = Math.round(Math.max(0, Math.min(100, 25 + 32 * coverage + 20 * durationScore + 13 * payloadScore + 10 * variationScore + landmarkScore)));
    return {
      request_id: `local_${Date.now()}`,
      score,
      score_valid: sampleCount >= 3,
      level: 'browser_local_fallback',
      feedback: [{ type: 'fallback', message: reason || '本地预览评分' }],
      diagnostics: {
        scoring_mode: 'browser_local_fallback',
        frame_count: sampleCount,
        landmark_rows: state.landmarkRows.length,
        duration_ms: durationMs,
        browser_holistic: state.browserHolisticStats
      }
    };
  }

  async function submitFrames() {
    const wordData = currentWordData();
    const plan = state.capturePlan || buildCapturePlan();
    const durationMs = state.captureDurationMs || Math.round(plan.durationSec * 1000);
    const useLandmarks = state.landmarkRows.length >= 3;
    const payload = {
      template_id: templateIdForWord(wordData.word),
      input_type: useLandmarks ? 'landmark_rows' : 'frame_slices',
      fps: plan.candidateFps || plan.uploadFps,
      duration_ms: durationMs,
      frames: useLandmarks ? [] : state.frames,
      landmark_rows: useLandmarks ? state.landmarkRows : [],
      client_meta: {
        source: 'apps/web/challenge',
        word: wordData.word,
        model: wordData.model || wordData.word,
        capture_plan: plan,
        capture_transport: useLandmarks ? 'web_holistic_landmarks' : 'jpeg_frame_slices',
        browser_holistic: state.browserHolisticStats,
        page: window.location.href
      }
    };

    try {
      const response = await fetch(apiUrl('/api/scoring/score'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      setServiceStatus(result.diagnostics?.scoring_mode?.includes('holistic') ? 'ready' : 'online', serviceTextFromResult(result));
      return result;
    } catch (error) {
      setServiceStatus('offline', '评分服务未连接，已使用本地预览评分');
      return localPreviewScore(`评分服务未连接：${error.message}`);
    }
  }

  function serviceTextFromResult(result) {
    const mode = result.diagnostics?.scoring_mode || result.level || '';
    if (mode === 'web_holistic_template_similarity') return '浏览器 Holistic 模板评分完成';
    if (mode === 'web_holistic_capture_quality') return '浏览器 Holistic 捕获质量评分完成';
    if (mode === 'holistic_template_similarity') return 'Holistic 模板评分完成';
    if (mode === 'holistic_capture_quality') return 'Holistic 捕获质量评分完成';
    if (mode.includes('fallback')) return '本地预览评分完成';
    return '评分完成';
  }

  function primaryResultFeedback(result) {
    const feedback = Array.isArray(result.feedback) ? result.feedback : [];
    const primary = feedback.find(item => item && item.message);
    return primary ? primary.message : serviceTextFromResult(result);
  }

  function resultScoreValue(result) {
    const score = Number(result?.score);
    return Number.isFinite(score) ? score : 0;
  }

  function resultMetrics(result) {
    return result?.diagnostics?.holistic_metrics
      || result?.diagnostics?.browser_holistic
      || {};
  }

  function resultCapturePlan(result) {
    return result?.diagnostics?.client_meta?.capture_plan
      || result?.diagnostics?.browser_holistic?.capture_plan
      || state.capturePlan
      || {};
  }

  function needsPracticeAdvice(result) {
    return result?.score_valid === false || resultScoreValue(result) < 80;
  }

  function buildPracticeAdvice(result) {
    if (!result || !needsPracticeAdvice(result)) return '';
    const metrics = resultMetrics(result);
    const plan = resultCapturePlan(result);
    const frameCount = Number(resultFrameCount(result));
    const minFrames = Number(plan.minFrames || 0);
    const left = Number(metrics.left_hand_presence_ratio);
    const right = Number(metrics.right_hand_presence_ratio);
    const hand = Number(metrics.hand_presence_ratio);
    const pose = Number(metrics.pose_presence_ratio);
    const motion = Number(metrics.motion_energy_mean);
    const suggestions = [];

    if (Number.isFinite(frameCount) && minFrames && frameCount < minFrames) {
      suggestions.push(`采样帧数偏少，建议至少 ${minFrames} 帧后再评分`);
    }
    if (result.score_valid === false) {
      suggestions.push('请重采一次，确保动作从开始到结束都被完整录到');
    }
    if (Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) >= 0.25) {
      if (left < right) {
        suggestions.push('注意左手手势，手指弯曲和手腕角度尽量贴近示范');
      } else {
        suggestions.push('注意右手手势，参考示范调整手形和手腕角度');
      }
    }
    if (Number.isFinite(hand) && hand < 0.45) {
      suggestions.push('双手尽量完整入画，靠近摄像头并避免互相遮挡');
    }
    if (Number.isFinite(pose) && pose < 0.35) {
      suggestions.push('注意身体姿势，保持上半身、肩膀和手臂都在画面中');
    }
    if (Number.isFinite(motion) && motion < 1.5) {
      suggestions.push('动作幅度略小，起止过程可以更清楚一些');
    }
    if (!suggestions.length) {
      suggestions.push('对照左侧示范，重点检查手形、运动方向和动作起止节奏');
    }
    return `建议：${suggestions.slice(0, 2).join('；')}。`;
  }

  function resultFeedback(result) {
    const practiceAdvice = buildPracticeAdvice(result);
    return practiceAdvice || primaryResultFeedback(result);
  }

  function scoringModeLabel(mode) {
    const labels = {
      web_holistic_template_similarity: '浏览器 Holistic 模板相似度',
      web_holistic_capture_quality: '浏览器 Holistic 捕获质量',
      holistic_template_similarity: 'Holistic 模板相似度',
      holistic_capture_quality: 'Holistic 捕获质量',
      browser_frame_fallback: '浏览器帧预览',
      browser_local_fallback: '本地预览'
    };
    return labels[mode] || mode || '--';
  }

  function resultFrameCount(result) {
    return result?.diagnostics?.frame_count
      ?? result?.diagnostics?.holistic_metrics?.samples
      ?? state.landmarkRows.length
      ?? state.frames.length
      ?? '--';
  }

  function resultWorkerTime(result) {
    const seconds = result?.diagnostics?.worker_response?.holistic_eval_sec
      ?? result?.diagnostics?.worker_response?.request_total_sec;
    return seconds === undefined || seconds === null ? '--' : `${formatNumber(seconds, 3)}s`;
  }

  function buildResultAdvice(result) {
    if (!result) return '--';
    const mode = result.diagnostics?.scoring_mode || result.level || '';
    const metrics = resultMetrics(result);
    const practiceAdvice = buildPracticeAdvice(result);
    if (practiceAdvice) return practiceAdvice;
    if (mode === 'web_holistic_template_similarity') {
      return '已在浏览器本机提取 Holistic 关键点，只上传关键点到服务器模板评分；该分数仍需结合真实用户标注继续校准。';
    }
    if (mode === 'web_holistic_capture_quality') {
      const hand = Number(metrics.hand_presence_ratio || 0);
      const pose = Number(metrics.pose_presence_ratio || 0);
      if (hand < 0.35) return `手部覆盖偏低（${formatNumber(hand, 2)}），请让关键手部靠近摄像头并完整入画后重采。`;
      if (pose < 0.35) return `人体姿态覆盖偏低（${formatNumber(pose, 2)}），请保持上半身和双手都在画面中。`;
      return '浏览器已识别到可用关键点；继续关注手形、方向、动作起止和节奏。';
    }
    if (mode === 'holistic_template_similarity') {
      return '已使用服务器模板做原型相似度评分；该分数仍需结合真实用户标注继续校准。';
    }
    if (mode === 'holistic_capture_quality') {
      const hand = Number(metrics.hand_presence_ratio || 0);
      const pose = Number(metrics.pose_presence_ratio || 0);
      if (hand < 0.35) return `手部覆盖偏低（${formatNumber(hand, 2)}），请让关键手部靠近摄像头并完整入画后重采。`;
      if (pose < 0.35) return `人体姿态覆盖偏低（${formatNumber(pose, 2)}），请保持上半身和双手都在画面中。`;
      return 'Holistic 已识别到可用关键点；继续关注手形、方向、动作起止和节奏。';
    }
    if (mode.includes('fallback')) {
      return '当前未使用 Holistic worker，仅按帧数、时长和画面变化给出流程预览分；正式评分需连接 HTTPS 评分 API 并启用 worker。';
    }
    return primaryResultFeedback(result);
  }

  function renderScoreDetails(result) {
    const box = document.getElementById('scoring-result-details');
    if (!box) return;
    if (!result) {
      box.hidden = true;
      return;
    }
    const mode = result.diagnostics?.scoring_mode || result.level || '';
    document.getElementById('scoring-result-mode').textContent = scoringModeLabel(mode);
    document.getElementById('scoring-result-frames').textContent = String(resultFrameCount(result));
    document.getElementById('scoring-result-worker').textContent = resultWorkerTime(result);
    document.getElementById('scoring-result-request').textContent = result.request_id || '--';
    document.getElementById('scoring-result-advice').textContent = buildResultAdvice(result);
    box.hidden = false;
  }

  async function scoreChallengeWithApi() {
    if (state.scoringBusy) return;
    if (!AppState.isRecording && availableSampleCount() === 0) {
      show('请先点击「开始」录制手语');
      return;
    }
    stopUiTimer();
    AppState.isRecording = false;
    state.scoringBusy = true;
    stopCameraStream();

    const startBtn = document.getElementById('btn-start-record');
    if (startBtn) {
      startBtn.innerHTML = '<span class="ctrl-icon">🎥</span><span>开始</span>';
      startBtn.classList.remove('recording');
    }
    const scoreBtn = document.getElementById('btn-score');
    if (scoreBtn) scoreBtn.disabled = true;
    startScoringWaitStatus();

    renderCameraStatus('正在评分...', '等待服务器返回评分结果', '请稍候，正在分析采集帧', state.captureStillUrl, 'var(--accent-cyan)');

    if (availableSampleCount() < 3) {
      finishChallengeScore(localPreviewScore('采集帧不足，请重新采集更完整动作。'));
      return;
    }

    const result = await submitFrames();
    finishChallengeScore(result);
  }

  function finishChallengeScore(result) {
    const elapsedMs = state.scoringStartedAt ? performance.now() - state.scoringStartedAt : 0;
    stopScoringWaitStatus(`评分完成：${formatSeconds(elapsedMs)}`);
    state.scoringBusy = false;
    const score = Number.isFinite(Number(result.score)) ? Math.round(Number(result.score)) : 0;
    AppState.challengeScore = score;
    const active = document.getElementById('challenge-active');
    if (active) active.style.display = 'none';

    if (score >= 80 && result.score_valid !== false) {
      showReward(score);
      renderScoreDetails(result);
    } else {
      showResult(score);
      const resultMsg = document.getElementById('result-message');
      if (resultMsg) resultMsg.textContent = resultFeedback(result);
      renderScoreDetails(result);
    }
  }

  window.ScoringBridge = {
    startChallengeRecording,
    scoreChallengeWithApi,
    resetForChallenge,
    stopAll,
    checkHealth,
    saveApiBaseFromInput,
    preloadBrowserHolistic,
    updateCaptureHint
  };

  document.addEventListener('DOMContentLoaded', () => {
    updateApiInput();
    ['scoring-duration-sec', 'scoring-capture-fps', 'scoring-frame-width'].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.addEventListener('input', () => updateCaptureHint());
    });
    updateCaptureHint();
    syncWebHolisticStatus();
    preloadBrowserHolistic();
    checkHealth();
  });

  window.addEventListener('pageshow', () => {
    syncWebHolisticStatus();
    preloadBrowserHolistic();
  });
})();
