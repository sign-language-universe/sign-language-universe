/* =============================================
   手语评分前端桥接
   摄像头采样 · Scoring API 调用 · 本地预览降级
   ============================================= */

(function () {
  const STORAGE_KEY = 'signUniverseScoringApiBase';
  const DEFAULT_CAPTURE_FPS = 5;
  const MAX_FRAMES = 90;

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
    captureTimer: null,
    uiTimer: null,
    recordStartedAt: 0,
    apiBase: null,
    lastHealth: null,
    scoringBusy: false
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

  function renderCameraShell() {
    const cameraInner = document.getElementById('challenge-camera-inner');
    if (!cameraInner) return null;
    cameraInner.classList.add('is-live');
    cameraInner.innerHTML = `
      <video id="scoring-camera-video" class="scoring-camera-video" autoplay muted playsinline></video>
      <div class="scoring-camera-overlay">
        <span class="recording-indicator active" id="recording-indicator">录制中</span>
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

  function stopCaptureTimers() {
    if (state.captureTimer) {
      clearInterval(state.captureTimer);
      state.captureTimer = null;
    }
    if (state.uiTimer) {
      clearInterval(state.uiTimer);
      state.uiTimer = null;
    }
  }

  function stopAll() {
    stopCaptureTimers();
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
      state.stream = null;
    }
    state.video = null;
    state.frames = [];
    state.scoringBusy = false;
  }

  function resetForChallenge() {
    stopAll();
    updateApiInput();
    checkHealth();
  }

  function updateTimerUi() {
    const elapsed = Math.max(0, Math.floor((Date.now() - state.recordStartedAt) / 1000));
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    const timerEl = document.getElementById('timer-display');
    if (timerEl) timerEl.textContent = `${mins}:${secs}`;
    AppState.recordingSeconds = elapsed;
  }

  function captureFrame() {
    const video = state.video;
    if (!video || video.readyState < 2 || state.frames.length >= MAX_FRAMES) return;
    const sourceWidth = video.videoWidth || 640;
    const sourceHeight = video.videoHeight || 480;
    const width = Math.min(480, sourceWidth);
    const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
    const canvas = state.canvas;
    const context = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    const imageBase64 = dataUrl.split(',', 2)[1] || '';
    state.frames.push({
      index: state.frames.length,
      timestamp_ms: Date.now() - state.recordStartedAt,
      image_base64: imageBase64
    });
    const countEl = document.getElementById('scoring-frame-count');
    if (countEl) countEl.textContent = `${state.frames.length} 帧`;
  }

  async function startChallengeRecording() {
    if (state.scoringBusy) return;
    stopCaptureTimers();
    state.frames = [];
    AppState.isRecording = false;
    try {
      await ensureCamera();
    } catch (error) {
      setServiceStatus('offline', '摄像头未开启');
      show(`摄像头开启失败：${error.message}`);
      return;
    }

    AppState.isRecording = true;
    AppState.recordingSeconds = 0;
    state.recordStartedAt = Date.now();
    captureFrame();
    state.captureTimer = setInterval(captureFrame, Math.round(1000 / DEFAULT_CAPTURE_FPS));
    state.uiTimer = setInterval(updateTimerUi, 250);

    const startBtn = document.getElementById('btn-start-record');
    if (startBtn) {
      startBtn.innerHTML = '<span class="ctrl-icon">🔄</span><span>重录</span>';
      startBtn.classList.add('recording');
    }
    const scoreBtn = document.getElementById('btn-score');
    if (scoreBtn) scoreBtn.disabled = false;
    updateTimerUi();
    const wordData = currentWordData();
    show(`开始录制「${wordData.word}」`);
  }

  function localPreviewScore(reason) {
    const sizes = state.frames.map(frame => frame.image_base64.length);
    const meanSize = sizes.length ? sizes.reduce((sum, value) => sum + value, 0) / sizes.length : 0;
    const variation = sizes.length >= 2 && meanSize > 0
      ? sizes.slice(1).reduce((sum, value, idx) => sum + Math.abs(value - sizes[idx]), 0) / (sizes.length - 1) / meanSize
      : 0;
    const durationMs = Date.now() - state.recordStartedAt;
    const coverage = Math.min(1, state.frames.length / 12);
    const durationScore = Math.min(1, Math.max(0, durationMs / 3500));
    const payloadScore = Math.min(1, meanSize / 24000);
    const variationScore = Math.min(1, variation * 12);
    const score = Math.round(Math.max(0, Math.min(100, 25 + 32 * coverage + 20 * durationScore + 13 * payloadScore + 10 * variationScore)));
    return {
      request_id: `local_${Date.now()}`,
      score,
      score_valid: state.frames.length >= 3,
      level: 'browser_local_fallback',
      feedback: [{ type: 'fallback', message: reason || '本地预览评分' }],
      diagnostics: { scoring_mode: 'browser_local_fallback', frame_count: state.frames.length }
    };
  }

  async function submitFrames() {
    const wordData = currentWordData();
    const durationMs = Date.now() - state.recordStartedAt;
    const payload = {
      template_id: templateIdForWord(wordData.word),
      input_type: 'frame_slices',
      fps: DEFAULT_CAPTURE_FPS,
      duration_ms: durationMs,
      frames: state.frames,
      client_meta: {
        source: 'apps/web/challenge',
        word: wordData.word,
        model: wordData.model || wordData.word,
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
    if (mode === 'holistic_template_similarity') return 'Holistic 模板评分完成';
    if (mode === 'holistic_capture_quality') return 'Holistic 捕获质量评分完成';
    if (mode.includes('fallback')) return '本地预览评分完成';
    return '评分完成';
  }

  function resultFeedback(result) {
    const feedback = Array.isArray(result.feedback) ? result.feedback : [];
    const primary = feedback.find(item => item && item.message);
    return primary ? primary.message : serviceTextFromResult(result);
  }

  async function scoreChallengeWithApi() {
    if (state.scoringBusy) return;
    if (!AppState.isRecording && state.frames.length === 0) {
      show('请先点击「开始」录制手语');
      return;
    }
    stopCaptureTimers();
    AppState.isRecording = false;
    state.scoringBusy = true;

    const startBtn = document.getElementById('btn-start-record');
    if (startBtn) {
      startBtn.innerHTML = '<span class="ctrl-icon">🎥</span><span>开始</span>';
      startBtn.classList.remove('recording');
    }
    const scoreBtn = document.getElementById('btn-score');
    if (scoreBtn) scoreBtn.disabled = true;

    const cameraInner = document.getElementById('challenge-camera-inner');
    if (cameraInner) {
      cameraInner.classList.remove('is-live');
      cameraInner.innerHTML = '<p style="color:var(--accent-cyan);">评估中...</p><small>正在分析采集帧</small>';
    }

    if (state.frames.length < 3) {
      finishChallengeScore(localPreviewScore('采集帧不足'));
      return;
    }

    const result = await submitFrames();
    finishChallengeScore(result);
  }

  function finishChallengeScore(result) {
    state.scoringBusy = false;
    const score = Number.isFinite(Number(result.score)) ? Math.round(Number(result.score)) : 0;
    AppState.challengeScore = score;
    const active = document.getElementById('challenge-active');
    if (active) active.style.display = 'none';

    if (score >= 80 && result.score_valid !== false) {
      showReward(score);
    } else {
      showResult(score);
      const resultMsg = document.getElementById('result-message');
      if (resultMsg) resultMsg.textContent = resultFeedback(result);
    }
  }

  window.ScoringBridge = {
    startChallengeRecording,
    scoreChallengeWithApi,
    resetForChallenge,
    stopAll,
    checkHealth,
    saveApiBaseFromInput
  };

  document.addEventListener('DOMContentLoaded', () => {
    updateApiInput();
    checkHealth();
  });
})();
