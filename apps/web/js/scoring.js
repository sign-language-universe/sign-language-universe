/* =============================================
   手语评分前端桥接
   摄像头采样 · Scoring API 调用 · 本地预览降级
   ============================================= */

(function () {
  const STORAGE_KEY = 'signUniverseScoringApiBase';
  const MAX_FRAMES = 90;
  const COUNTDOWN_SECONDS = 3;
  const MOTION_SIG_WIDTH = 32;
  const MOTION_SIG_HEIGHT = 24;

  const CAPTURE_RECOMMENDATIONS = {
    '花': { minFrames: 12, minDurationSec: 2.5, minFps: 5 },
    '跳': { minFrames: 8, minDurationSec: 2.0, minFps: 5 },
    '香蕉': { minFrames: 10, minDurationSec: 2.5, minFps: 5 },
    '汽车': { minFrames: 10, minDurationSec: 2.5, minFps: 5 },
    default: { minFrames: 10, minDurationSec: 2.5, minFps: 5 }
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
    uiTimer: null,
    recordStartedAt: 0,
    capturePlan: null,
    captureDurationMs: 0,
    captureRunId: 0,
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

  function clampNumber(value, minValue, maxValue, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minValue, Math.min(maxValue, number));
  }

  function formatNumber(value, digits = 2) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
    return Number(value).toFixed(digits);
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
    let durationSec = clampNumber(inputValue('scoring-duration-sec', 3), 1, 8, 3);
    let uploadFps = Math.round(clampNumber(inputValue('scoring-capture-fps', 5), 1, 12, 5));
    const frameWidth = Math.round(clampNumber(inputValue('scoring-frame-width', 480), 240, 960, 480));
    const requestedDurationSec = durationSec;
    const requestedUploadFps = uploadFps;
    const originalFrames = Math.max(1, Math.round(durationSec * uploadFps));
    let adjusted = false;

    if (durationSec < rec.minDurationSec) {
      durationSec = rec.minDurationSec;
      adjusted = true;
    }
    if (uploadFps < rec.minFps) {
      uploadFps = rec.minFps;
      adjusted = true;
    }
    if (Math.round(durationSec * uploadFps) < rec.minFrames) {
      uploadFps = Math.max(uploadFps, Math.ceil(rec.minFrames / durationSec));
      if (uploadFps > 12) {
        uploadFps = 12;
        durationSec = Math.min(8, Math.ceil((rec.minFrames / uploadFps) * 2) / 2);
      }
      adjusted = true;
    }

    const targetFrames = Math.max(rec.minFrames, Math.min(MAX_FRAMES, Math.round(durationSec * uploadFps)));
    const candidateFps = Math.max(uploadFps, Math.min(18, uploadFps * 2));
    const candidateFrames = Math.max(targetFrames, Math.round(durationSec * candidateFps));
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
      originalFrames,
      adjusted
    };
  }

  function updateCaptureHint(plan = buildCapturePlan()) {
    const hint = document.getElementById('scoring-capture-hint');
    if (!hint) return;
    if (plan.adjusted) {
      hint.textContent = `采样：${plan.word} 推荐 >=${plan.minFrames} 上传帧；当前 ${plan.requestedDurationSec}s x ${plan.requestedUploadFps}fps = ${plan.originalFrames} 帧，采集时自动调整为 ${plan.durationSec}s x ${plan.uploadFps}fps = ${plan.targetFrames} 帧。`;
    } else {
      hint.textContent = `采样：${plan.word} 推荐 >=${plan.minFrames} 上传帧；当前 ${plan.durationSec}s x ${plan.uploadFps}fps = ${plan.targetFrames} 帧。`;
    }
  }

  function setProgress(percent) {
    const bar = document.getElementById('scoring-progress-bar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
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

  function stopUiTimer() {
    if (state.uiTimer) {
      clearInterval(state.uiTimer);
      state.uiTimer = null;
    }
  }

  function stopAll() {
    state.captureRunId++;
    stopUiTimer();
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
      state.stream = null;
    }
    state.video = null;
    state.frames = [];
    state.capturePlan = null;
    state.captureDurationMs = 0;
    state.scoringBusy = false;
    AppState.isRecording = false;
    setProgress(0);
  }

  function resetForChallenge() {
    stopAll();
    updateApiInput();
    updateCaptureHint();
    renderScoreDetails(null);
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

  function captureFrame(frameWidth, candidateIndex) {
    const video = state.video;
    if (!video || video.readyState < 2) return null;
    const sourceWidth = video.videoWidth || 640;
    const sourceHeight = video.videoHeight || 480;
    const width = Math.max(240, Math.min(frameWidth, sourceWidth, 960));
    const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
    const canvas = state.canvas;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    const imageBase64 = dataUrl.split(',', 2)[1] || '';
    return {
      candidateIndex,
      timestampMs: Date.now() - state.recordStartedAt,
      frame: { image_base64: imageBase64 },
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
    const intervalMs = 1000 / plan.candidateFps;
    const candidates = [];
    let prevSignature = null;
    state.recordStartedAt = Date.now();
    state.captureDurationMs = Math.round(plan.durationSec * 1000);
    AppState.isRecording = true;
    setProgress(0);

    const recIndicator = document.getElementById('recording-indicator');
    if (recIndicator) recIndicator.classList.add('active');
    const countEl = document.getElementById('scoring-frame-count');
    if (countEl) countEl.textContent = '0 帧';

    state.uiTimer = setInterval(updateTimerUi, 250);
    for (let i = 0; i < plan.candidateFrames; i++) {
      if (runId !== state.captureRunId) return [];
      const captured = captureFrame(plan.frameWidth, i);
      if (captured) {
        const motion = signatureMotion(prevSignature, captured.signature);
        prevSignature = captured.signature;
        candidates.push({
          candidateIndex: i,
          timestampMs: captured.timestampMs,
          frame: captured.frame,
          energy: motion,
          energySmooth: motion,
          frameWeight: 1.0
        });
      }
      setProgress(((i + 1) / plan.candidateFrames) * 100);
      if (countEl) countEl.textContent = `${candidates.length} 候选帧`;
      if (i + 1 < plan.candidateFrames) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }

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
    state.frames = selected.map(item => ({
      index: item.candidateIndex,
      timestamp_ms: Math.round(item.timestampMs),
      image_base64: item.frame.image_base64
    }));
    if (countEl) countEl.textContent = `${state.frames.length} 上传帧`;
    return selected;
  }

  async function startChallengeRecording() {
    if (state.scoringBusy) return;
    state.captureRunId++;
    const runId = state.captureRunId;
    stopUiTimer();
    state.frames = [];
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
    if (!ok) return;
    setServiceStatus('checking', `正在采集候选帧：${state.capturePlan.candidateFrames} 帧`);
    const selected = await collectFrames(state.capturePlan, runId);
    if (runId !== state.captureRunId) return;
    stopUiTimer();
    AppState.isRecording = false;
    const recIndicator = document.getElementById('recording-indicator');
    if (recIndicator) recIndicator.classList.remove('active');
    if (startBtn) startBtn.classList.remove('recording');
    if (scoreBtn) scoreBtn.disabled = selected.length < 3;
    setServiceStatus(selected.length >= 3 ? 'online' : 'offline', selected.length >= 3 ? `采集完成：候选 ${state.capturePlan.candidateFrames} 帧，上传 ${selected.length} 帧` : '采集帧不足，请重采');
    show(selected.length >= 3 ? '采集完成，可以点击「打分」' : '采集帧不足，请重采');
  }

  function localPreviewScore(reason) {
    const sizes = state.frames.map(frame => frame.image_base64.length);
    const meanSize = sizes.length ? sizes.reduce((sum, value) => sum + value, 0) / sizes.length : 0;
    const variation = sizes.length >= 2 && meanSize > 0
      ? sizes.slice(1).reduce((sum, value, idx) => sum + Math.abs(value - sizes[idx]), 0) / (sizes.length - 1) / meanSize
      : 0;
    const durationMs = state.captureDurationMs || Math.max(0, Date.now() - state.recordStartedAt);
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
      diagnostics: { scoring_mode: 'browser_local_fallback', frame_count: state.frames.length, duration_ms: durationMs }
    };
  }

  async function submitFrames() {
    const wordData = currentWordData();
    const plan = state.capturePlan || buildCapturePlan();
    const durationMs = state.captureDurationMs || Math.round(plan.durationSec * 1000);
    const payload = {
      template_id: templateIdForWord(wordData.word),
      input_type: 'frame_slices',
      fps: plan.candidateFps || plan.uploadFps,
      duration_ms: durationMs,
      frames: state.frames,
      client_meta: {
        source: 'apps/web/challenge',
        word: wordData.word,
        model: wordData.model || wordData.word,
        capture_plan: plan,
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

  function scoringModeLabel(mode) {
    const labels = {
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
    const metrics = result.diagnostics?.holistic_metrics || {};
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
    return resultFeedback(result);
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
    if (!AppState.isRecording && state.frames.length === 0) {
      show('请先点击「开始」录制手语');
      return;
    }
    stopUiTimer();
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
      finishChallengeScore(localPreviewScore('采集帧不足，请重新采集更完整动作。'));
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
    updateCaptureHint
  };

  document.addEventListener('DOMContentLoaded', () => {
    updateApiInput();
    ['scoring-duration-sec', 'scoring-capture-fps', 'scoring-frame-width'].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.addEventListener('input', () => updateCaptureHint());
    });
    updateCaptureHint();
    checkHealth();
  });
})();
