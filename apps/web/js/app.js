/* =============================================
   手语小宇宙 — 核心应用逻辑
   页面导航 · 数据渲染 · 交互处理 · 挑战模式 · 星座图鉴
   ============================================= */

// ============ 全局状态 ============
const AppState = {
  currentScreen: 'splash',
  mode: 'learning',
  currentLevel: null,
  currentPlanet: null,
  currentWordIndex: 0,
  currentWords: [],
  collectedWords: new Set(),
  visitedPlanets: new Set(),
  assessmentType: null,
  questionIndex: 0,

  // 挑战模式状态
  challengeIndex: 0,
  isChallengeActive: false,
  isRecording: false,
  recordingSeconds: 0,
  recordingTimer: null,
  challengeScore: 0,

  // 星座图鉴状态
  constellationTab: 'learned',
  collectedWordsList: [],

  // 奖励弹窗
  rewardVisible: false,

  // UI 偏好
  theme: window.localStorage.getItem('signUniverseTheme') || 'night',
  soundEnabled: window.localStorage.getItem('signUniverseSound') !== 'off'
};

function playUiSound(kind = 'notice') {
  if (!AppState.soundEnabled) return;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  if (!playUiSound.ctx) playUiSound.ctx = new AudioContextCtor();
  const ctx = playUiSound.ctx;
  if (ctx.state === 'suspended') ctx.resume();

  const patterns = {
    tap: [520],
    notice: [660, 880],
    success: [523, 659, 784],
    reward: [523, 659, 784, 1046],
    error: [220, 165]
  };
  const notes = patterns[kind] || patterns.notice;
  notes.forEach((freq, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + index * 0.055;
    oscillator.type = kind === 'error' ? 'sawtooth' : 'sine';
    oscillator.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.045, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.13);
  });
}

function applyTheme(theme) {
  const nextTheme = theme === 'day' ? 'day' : 'night';
  AppState.theme = nextTheme;
  window.localStorage.setItem('signUniverseTheme', nextTheme);
  document.body.classList.toggle('theme-day', nextTheme === 'day');
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    btn.setAttribute('aria-pressed', String(nextTheme === 'day'));
    btn.innerHTML = nextTheme === 'day'
      ? '<span>☀️</span><span>日间</span>'
      : '<span>🌙</span><span>夜间</span>';
  }
  window.dispatchEvent(new CustomEvent('signUniverseThemeChanged', { detail: { theme: nextTheme } }));
}

function toggleTheme() {
  applyTheme(AppState.theme === 'day' ? 'night' : 'day');
  playUiSound('tap');
}

function applySoundPreference() {
  const btn = document.getElementById('sound-toggle-btn');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(AppState.soundEnabled));
  btn.innerHTML = AppState.soundEnabled
    ? '<span>🔊</span><span>音效</span>'
    : '<span>🔇</span><span>静音</span>';
}

function toggleSound() {
  AppState.soundEnabled = !AppState.soundEnabled;
  window.localStorage.setItem('signUniverseSound', AppState.soundEnabled ? 'on' : 'off');
  applySoundPreference();
  if (AppState.soundEnabled) playUiSound('success');
}

function initUiPreferences() {
  applyTheme(AppState.theme);
  applySoundPreference();
}

function currentChallengeWord() {
  const total = CHALLENGE_WORDS.length;
  if (!total) return null;
  const idx = Math.max(0, Math.min(AppState.challengeIndex, total - 1));
  AppState.challengeIndex = idx;
  return CHALLENGE_WORDS[idx];
}

function isChallengeScoringReady(wordData) {
  return Boolean(wordData && wordData.scoringReady !== false);
}

// ============ 页面导航 ============
function navigateTo(screen, param) {
  if (AppState.currentScreen === 'challenge' && screen !== 'challenge' && window.ScoringBridge?.stopAll) {
    window.ScoringBridge.stopAll();
  }

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

  const target = document.getElementById(`screen-${screen}`);
  if (!target) { console.warn(`Screen not found: screen-${screen}`); return; }

  target.classList.add('active');
  AppState.currentScreen = screen;
  document.getElementById('app').scrollTop = 0;

  switch (screen) {
    case 'splash':      break;
    case 'galaxy':      if (param) AppState.mode = param; renderGalaxy(); break;
    case 'learning':    renderLearning(); break;
    case 'search':      break;
    case 'assessment': renderAssessment(); break;
    case 'spacestation': renderSpacestation(); break;
    case 'challenge':    initChallenge(); break;
    case 'constellation': renderConstellation(); break;
  }
}

// ============ 星系渲染 ============
function renderGalaxy() {
  const container = document.getElementById('galaxy-container');
  const badge = document.getElementById('galaxy-mode-badge');
  badge.textContent = AppState.mode === 'learning' ? '🪐 学习宇宙' : '🏠 个人空间';

  const planetColors = ['p1','p2','p3','p4','p5','p6','p7','p8'];
  let colorIdx = 0;

  let html = '';
  if (AppState.mode === 'learning') {
    const levels = [
      { key: 'level1', data: VOCABULARY_DATA.level1 },
      { key: 'level2', data: VOCABULARY_DATA.level2 },
      { key: 'level3', data: VOCABULARY_DATA.level3 }
    ];
    levels.forEach(({ key, data }) => {
      html += `<div class="galaxy-system"><div class="galaxy-label">`;
      html += `<span class="galaxy-level lv${data.level}">Lv.${data.level}</span>`;
      html += `<span style="font-weight:700;font-size:17px;">${data.name}</span>`;
      html += `<span style="font-size:13px;color:var(--text-muted);">${data.description}</span></div><div class="planet-grid">`;
      data.planets.forEach(planet => {
        const locked = (data.level > 1) && !AppState.visitedPlanets.has(planet.id) && planet.id !== data.planets[0].id;
        const pClass = planetColors[colorIdx % planetColors.length];
        colorIdx++;
        html += `<div class="planet-card ${locked ? 'locked' : ''}" ${!locked ? `onclick="enterPlanet('${key}', '${planet.id}')"` : ''}>`;
        html += `<div class="planet-icon ${pClass}">${planet.emoji}`;
        html += locked ? '<div class="locked-overlay">🔒</div>' : '';
        html += `</div><div class="planet-name">${planet.name}</div>`;
        html += `<div class="planet-word-count">${planet.words.length} 个词汇</div></div>`;
      });
      html += `</div></div>`;
    });
  } else {
    html = `
      <div class="galaxy-system">
        <div class="galaxy-label"><span style="font-weight:700;font-size:17px;">🌌 个人空间星系</span></div>
        <div class="planet-grid">
          <div class="planet-card" onclick="navigateTo('spacestation')"><div class="planet-icon p1">🏠</div><div class="planet-name">我的空间站</div></div>
          <div class="planet-card" onclick="navigateTo('challenge')"><div class="planet-icon p2">🎯</div><div class="planet-name">挑战模式</div></div>
          <div class="planet-card" onclick="navigateTo('constellation')"><div class="planet-icon p3">🌌</div><div class="planet-name">星空笔记本</div></div>
        </div>
      </div>`;
  }
  container.innerHTML = html;
}

// ============ 进入星球学习 ============
function enterPlanet(levelKey, planetId) {
  const levelData = VOCABULARY_DATA[levelKey];
  if (!levelData) return;
  const planet = levelData.planets.find(p => p.id === planetId);
  if (!planet) return;
  AppState.currentLevel = levelKey;
  AppState.currentPlanet = planetId;
  AppState.currentWordIndex = 0;
  AppState.currentWords = planet.words;
  AppState.visitedPlanets.add(planetId);
  navigateTo('learning');
}

// ============ 词汇学习卡片渲染 ============
function renderLearning() {
  const words = AppState.currentWords;
  if (!words || words.length === 0) return;
  const idx = AppState.currentWordIndex;
  const word = words[idx];

  document.getElementById('learning-progress').textContent = `${idx + 1} / ${words.length}`;
  document.getElementById('progress-fill').style.width = `${((idx + 1) / words.length) * 100}%`;

  const collectBtn = document.getElementById('btn-collect');
  if (AppState.collectedWords.has(word.word)) {
    collectBtn.style.color = 'var(--accent-yellow)';
    collectBtn.textContent = '⭐';
  } else {
    collectBtn.style.color = '';
    collectBtn.textContent = '☆';
  }

  document.getElementById('word-title').textContent = word.word;
  document.getElementById('word-pinyin').textContent = word.pinyin;
  document.getElementById('explanation-text').innerHTML =
    `<p><strong>打法：</strong>${word.definition}</p>` +
    `<p><strong>用法：</strong>${word.usage}</p>`;

  const tip = CULTURE_TIPS[Math.floor(Math.random() * CULTURE_TIPS.length)];
  document.getElementById('tip-text').textContent = tip;

  // ── 启动词汇展示动画 ──
  initLearningAnimation(word.word);

  // 更新学习页导航按键状态
  updateLearningNavButtons();
}

// ── 学习页动画控制 ──
let _learningAnimPlayer = null;
let _learningAnimLoaded = false;

function initLearningAnimation(word) {
  const canvas = document.getElementById('learning-anim-canvas');
  if (!canvas) return;

  const player = getAnimationPlayer(canvas);
  _learningAnimPlayer = player;
  _learningAnimLoaded = true;
  const hasAnimation = typeof hasSignAnimation === 'function' ? hasSignAnimation(word) : true;
  const viewer = document.getElementById('learning-anim-viewer');
  if (viewer) viewer.classList.toggle('no-animation', !hasAnimation);

  if (!hasAnimation) {
    player.stop();
    player.load(word);
    const phaseEl = document.getElementById('anim-phase-name');
    const labelEl = document.getElementById('anim-phase-label');
    const playBtn = document.getElementById('btn-anim-play');
    const replayBtn = document.getElementById('btn-anim-replay');
    if (phaseEl) phaseEl.textContent = '暂无专属动画';
    if (labelEl) labelEl.textContent = `${word} · 请阅读打法说明`;
    if (playBtn) { playBtn.textContent = '▶ 播放'; playBtn.classList.remove('playing'); playBtn.disabled = true; }
    if (replayBtn) replayBtn.disabled = true;
    return;
  }

  // 监听阶段变化更新标签
  player.onPhaseChange((phaseName) => {
    const phaseEl = document.getElementById('anim-phase-name');
    const labelEl = document.getElementById('anim-phase-label');
    if (phaseEl) phaseEl.textContent = phaseName;
    if (labelEl) labelEl.textContent = `${word} · ${phaseName}`;
  });

  player.load(word);
  player.play(word);
  player.setLoop(true);

  // 更新播放按钮状态
  const playBtn = document.getElementById('btn-anim-play');
  if (playBtn) { playBtn.textContent = '⏸ 暂停'; playBtn.classList.add('playing'); }
  const replayBtn = document.getElementById('btn-anim-replay');
  if (playBtn) playBtn.disabled = false;
  if (replayBtn) replayBtn.disabled = false;
}

function toggleAnimPlay() {
  const player = _learningAnimPlayer;
  if (!player) return;
  const btn = document.getElementById('btn-anim-play');
  if (player.playing) {
    player.stop();
    if (btn) { btn.textContent = '▶ 播放'; btn.classList.remove('playing'); }
  } else {
    player.play();
    if (btn) { btn.textContent = '⏸ 暂停'; btn.classList.add('playing'); }
  }
}

function restartAnim() {
  const player = _learningAnimPlayer;
  if (!player) return;
  player.stop();
  player.play();
  const btn = document.getElementById('btn-anim-play');
  if (btn) { btn.textContent = '⏸ 暂停'; btn.classList.add('playing'); }
}

// 更新学习页左右导航按键状态
function updateLearningNavButtons() {
  const words = AppState.currentWords;
  if (!words) return;
  const idx = AppState.currentWordIndex;
  const prevBtn = document.getElementById('btn-learn-prev');
  const nextBtn = document.getElementById('btn-learn-next');
  if (prevBtn) prevBtn.disabled = (idx === 0);
  if (nextBtn) nextBtn.disabled = (idx >= words.length - 1);
}

// 上一词（学习页）
function prevWord() {
  const words = AppState.currentWords;
  if (!words || AppState.currentWordIndex <= 0) return;
  AppState.currentWordIndex--;
  renderLearning();
  showToast('← 上一个词汇');
}

// 下一词（学习页）
function nextWord() {
  const words = AppState.currentWords;
  if (!words) return;
  if (AppState.currentWordIndex < words.length - 1) {
    AppState.currentWordIndex++;
    renderLearning();
    showToast('继续加油！🚀');
  } else {
    showToast('🎉 恭喜完成本星球全部词汇！');
    setTimeout(() => navigateTo('galaxy'), 1500);
  }
}

function toggleCollect() {
  const words = AppState.currentWords;
  if (!words) return;
  const word = words[AppState.currentWordIndex];
  if (!word) return;
  if (AppState.collectedWords.has(word.word)) {
    AppState.collectedWords.delete(word.word);
    showToast('已取消收藏');
  } else {
    AppState.collectedWords.add(word.word);
    showToast('⭐ 已加入星空笔记本');
  }
  renderLearning();
}

// ============ 视频控制（模拟） ============
let currentSpeed = 1.0;
function changeSpeed() {
  const speeds = [0.5, 0.75, 1.0, 1.25, 1.5];
  const idx = speeds.indexOf(currentSpeed);
  currentSpeed = speeds[(idx + 1) % speeds.length];
  document.querySelector('.speed-btn').textContent = `${currentSpeed}x`;
  showToast(`播放速度：${currentSpeed}x`);
}

let currentAngle = 0;
function changeAngle() {
  const angles = ['正面', '左侧', '右侧'];
  currentAngle = (currentAngle + 1) % 3;
  document.querySelector('.angle-btn').textContent = `🔄 ${angles[currentAngle]}`;
  showToast(`视角切换：${angles[currentAngle]}`);
}

function toggleFullscreen() { showToast('全屏模式（需接入实际视频播放器）'); }

// 挑战页视频控制
let challengeSpeed = 1.0;
function changeChallengeSpeed() {
  const speeds = [0.5, 0.75, 1.0, 1.25, 1.5];
  const idx = speeds.indexOf(challengeSpeed);
  challengeSpeed = speeds[(idx + 1) % speeds.length];
  document.querySelectorAll('.cv-ctrl-btn')[0].textContent = `${challengeSpeed}x`;
  showToast(`播放速度：${challengeSpeed}x`);
}

let challengeAngle = 0;
function changeChallengeAngle() {
  const angles = ['正面', '左侧', '右侧'];
  challengeAngle = (challengeAngle + 1) % 3;
  showToast(`视角切换：${angles[challengeAngle]}`);
}

// ── 挑战页动画控制 ──
let _challengeAnimPlayer = null;

function initChallengeAnimation(word) {
  const canvas = document.getElementById('challenge-anim-canvas');
  if (!canvas) return;

  const player = getAnimationPlayer(canvas);
  _challengeAnimPlayer = player;
  const hasAnimation = typeof hasSignAnimation === 'function' ? hasSignAnimation(word) : true;
  const viewer = document.getElementById('challenge-anim-viewer');
  if (viewer) viewer.classList.toggle('no-animation', !hasAnimation);

  if (!hasAnimation) {
    player.stop();
    player.load(word);
    const phaseEl = document.getElementById('challenge-anim-phase-name');
    const labelEl = document.getElementById('challenge-anim-phase-label');
    const playBtn = document.getElementById('btn-challenge-anim-play');
    const replayBtn = document.getElementById('btn-challenge-anim-replay');
    if (phaseEl) phaseEl.textContent = '暂无专属动画';
    if (labelEl) labelEl.textContent = `${word} · 请阅读打法说明`;
    if (playBtn) { playBtn.textContent = '▶ 播放'; playBtn.classList.remove('playing'); playBtn.disabled = true; }
    if (replayBtn) replayBtn.disabled = true;
    return;
  }

  player.onPhaseChange((phaseName) => {
    const phaseEl = document.getElementById('challenge-anim-phase-name');
    const labelEl = document.getElementById('challenge-anim-phase-label');
    if (phaseEl) phaseEl.textContent = phaseName;
    if (labelEl) labelEl.textContent = `${word} · ${phaseName}`;
  });

  player.load(word);
  player.play(word);
  player.setLoop(true);

  const playBtn = document.getElementById('btn-challenge-anim-play');
  if (playBtn) { playBtn.textContent = '⏸ 暂停'; playBtn.classList.add('playing'); }
  const replayBtn = document.getElementById('btn-challenge-anim-replay');
  if (playBtn) playBtn.disabled = false;
  if (replayBtn) replayBtn.disabled = false;
}

function toggleChallengeAnimPlay() {
  const player = _challengeAnimPlayer;
  if (!player) return;
  const btn = document.getElementById('btn-challenge-anim-play');
  if (player.playing) {
    player.stop();
    if (btn) { btn.textContent = '▶ 播放'; btn.classList.remove('playing'); }
  } else {
    player.play();
    if (btn) { btn.textContent = '⏸ 暂停'; btn.classList.add('playing'); }
  }
}

function restartChallengeAnim() {
  const player = _challengeAnimPlayer;
  if (!player) return;
  player.stop();
  player.play();
  const btn = document.getElementById('btn-challenge-anim-play');
  if (btn) { btn.textContent = '⏸ 暂停'; btn.classList.add('playing'); }
}

// ============ 检索 ============
function switchSearchTab(tab) {
  document.querySelectorAll('.search-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
}

function doSearch() {
  const query = document.getElementById('search-input').value.trim();
  const resultsDiv = document.getElementById('search-results');
  if (!query) { resultsDiv.innerHTML = '<p class="search-hint">输入关键词开始搜索手语词汇</p>'; return; }

  const allWords = [];
  ['level1', 'level2', 'level3'].forEach(level => {
    VOCABULARY_DATA[level].planets.forEach(planet => {
      planet.words.forEach(word => {
        if (word.word.includes(query) || word.pinyin.includes(query.toLowerCase())) {
          allWords.push({ ...word, planet: planet.name, level });
        }
      });
    });
  });

  if (allWords.length === 0) {
    resultsDiv.innerHTML = '<p class="search-hint">未找到相关词汇，请尝试其他关键词</p>';
    return;
  }
  resultsDiv.innerHTML = allWords.map(w => `
    <div class="quiz-option" onclick="showToast('查看：${w.word} (${w.planet})')">
      <strong>${w.word}</strong> <small>${w.pinyin}</small>
      <span style="float:right;color:var(--text-muted);font-size:12px;">${w.planet}</span>
    </div>`).join('');
}

// ============ 测评 ============
function renderAssessment() {
  document.getElementById('assessment-mode-select').style.display = 'block';
  document.getElementById('comprehension-quiz').style.display = 'none';
  document.getElementById('expression-quiz').style.display = 'none';
  AppState.assessmentType = null;
  AppState.questionIndex = 0;
}

function startAssessment(type) {
  AppState.assessmentType = type;
  document.getElementById('assessment-mode-select').style.display = 'none';
  document.getElementById('assessment-type').textContent =
    type === 'comprehension' ? '理解能力 · 选择题' : '表达能力 · 动作捕捉';
  if (type === 'comprehension') {
    document.getElementById('comprehension-quiz').style.display = 'block';
    AppState.questionIndex = 0;
    renderComprehensionQuestion();
  } else {
    document.getElementById('expression-quiz').style.display = 'block';
    const targetWord = EXPRESSION_WORDS[Math.floor(Math.random() * EXPRESSION_WORDS.length)];
    document.getElementById('expression-target-word').textContent = targetWord.word;
  }
}

function renderComprehensionQuestion() {
  const q = QUIZ_QUESTIONS[AppState.questionIndex % QUIZ_QUESTIONS.length];
  document.getElementById('question-progress').textContent =
    `${AppState.questionIndex + 1}/${QUIZ_QUESTIONS.length}`;
  document.getElementById('quiz-video').innerHTML = `<p>${q.videoHint}</p>`;
  document.getElementById('quiz-options').innerHTML = q.options.map((opt, i) =>
    `<button class="quiz-option" onclick="answerQuestion(${i}, ${q.correct})">${String.fromCharCode(65 + i)}. ${opt}</button>`
  ).join('');
}

function answerQuestion(selected, correct) {
  const buttons = document.querySelectorAll('.quiz-option');
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (i === correct) btn.classList.add('correct');
    if (i === selected && selected !== correct) btn.classList.add('wrong');
  });
  const isCorrect = selected === correct;
  showToast(isCorrect ? '✅ 回答正确！' : '❌ 再想想哦～');
  setTimeout(() => {
    if (AppState.questionIndex < QUIZ_QUESTIONS.length - 1) {
      AppState.questionIndex++;
      renderComprehensionQuestion();
    } else {
      showToast('🎉 测评完成！查看你的成绩吧');
      setTimeout(() => navigateTo('galaxy'), 1500);
    }
  }, 1200);
}

// ============ 动作捕捉（模拟） ============
let captureInterval = null;
function startCapture() {
  showToast('🎥 开始动作捕捉...');
  captureInterval = setInterval(() => {
    document.getElementById('score-hand').style.width = `${40 + Math.random() * 50}%`;
    document.getElementById('score-face').style.width = `${30 + Math.random() * 60}%`;
    document.getElementById('score-pose').style.width = `${45 + Math.random() * 45}%`;
  }, 800);
}

function stopCapture() {
  if (captureInterval) { clearInterval(captureInterval); captureInterval = null; }
  showToast('⏹ 捕捉已停止');
}

// ============ 个人空间站 ============
function renderSpacestation() {
  const collectedCount = AppState.collectedWords.size;
  const visitedCount = AppState.visitedPlanets.size;
  document.getElementById('username-display').textContent = '探索者';
  document.getElementById('stat-words').textContent = collectedCount;
  document.getElementById('stat-stars').textContent = collectedCount * 50 + visitedCount * 100;
  document.getElementById('stat-rank').textContent = `#${Math.floor(Math.random() * 20) + 1}`;
}

// ============================================================
//  ⭐ 挑战模式
//     左侧显示手语示范视频（与学习页一致）
//     3D模型只在评分≥80时的奖励弹窗中显示
//     左右导航键
// ============================================================

function initChallenge() {
  AppState.isChallengeActive = false;
  AppState.challengeScore = 0;
  stopRecording();

  const total = CHALLENGE_WORDS.length;
  const idx = Math.max(0, Math.min(AppState.challengeIndex, total - 1));
  AppState.challengeIndex = idx;

  document.getElementById('challenge-progress-text').textContent = `${idx + 1} / ${total}`;

  const intro = document.getElementById('challenge-intro');
  const active = document.getElementById('challenge-active');
  const result = document.getElementById('challenge-result');
  if (intro) intro.style.display = 'flex';
  if (active) active.style.display = 'none';
  if (result) { result.style.display = 'none'; result.classList.remove('show'); }

  const wordData = CHALLENGE_WORDS[idx];
  const scoringReady = isChallengeScoringReady(wordData);
  document.getElementById('challenge-word-display').textContent = `挑战：${wordData.word}`;
  document.getElementById('challenge-word-zh').textContent = wordData.word;
  document.getElementById('challenge-word-py').textContent = wordData.pinyin;
  document.getElementById('model-word-label').textContent = wordData.word;
  document.getElementById('challenge-word-definition').textContent = wordData.definition;

  const statusNote = document.getElementById('challenge-status-note');
  if (statusNote) {
    statusNote.className = `challenge-status-note ${scoringReady ? 'ready' : 'pending'}`;
    statusNote.textContent = scoringReady
      ? `${wordData.statusLabel} · 当前可录制评分`
      : `${wordData.statusLabel} · 暂不能录制评分，等待数据库上线`;
  }
  const introText = document.getElementById('challenge-intro-main-text');
  if (introText) {
    introText.innerHTML = scoringReady
      ? '观看左侧手语示范<br>记住词汇的打法！'
      : '该词汇已纳入挑战词表<br>评分模板上线后即可录制';
  }
  const enterBtn = document.getElementById('btn-enter-challenge');
  if (enterBtn) {
    enterBtn.disabled = !scoringReady;
    enterBtn.querySelector('.start-btn-icon').textContent = scoringReady ? '🚀' : '⏳';
    enterBtn.querySelector('.start-btn-text').textContent = scoringReady ? '进入挑战' : '等待上线';
  }

  // 更新左侧视频提示文字
  const videoHintText = document.getElementById('challenge-video-hint-text');
  if (videoHintText) videoHintText.textContent = `手语示范：${wordData.word}`;

  // ── 启动挑战页动画 ──
  initChallengeAnimation(wordData.word);

  updateNavButtons();

  // 重置控制按钮
  const startBtn = document.getElementById('btn-start-record');
  const scoreBtn = document.getElementById('btn-score');
  if (startBtn) {
    startBtn.innerHTML = '<span class="ctrl-icon">🎥</span><span>开始</span>';
    startBtn.classList.remove('recording');
    startBtn.disabled = !scoringReady;
  }
  if (scoreBtn) scoreBtn.disabled = true;

  const recIndicator = document.getElementById('recording-indicator');
  if (recIndicator) recIndicator.classList.remove('active');
  const timerEl = document.getElementById('timer-display');
  if (timerEl) timerEl.textContent = '00:00';

  resetCameraInner();
  if (window.ScoringBridge?.resetForChallenge) window.ScoringBridge.resetForChallenge();
}

function resetCameraInner() {
  const el = document.getElementById('challenge-camera-inner');
  if (el) {
    el.classList.remove('is-live');
    el.innerHTML =
      '<p>📷 摄像头画面区域</p><small>点击「开始」后对着摄像头比划手语</small>' +
      '<div class="recording-indicator" id="recording-indicator">⏺ 录制中...</div>';
  }
}

function updateNavButtons() {
  const total = CHALLENGE_WORDS.length;
  const idx = AppState.challengeIndex % total;
  const prevBtn = document.getElementById('btn-prev-word');
  const nextBtn = document.getElementById('btn-next-word');

  if (idx === 0) {
    prevBtn.style.opacity = '0.3';
    prevBtn.style.pointerEvents = 'none';
  } else {
    prevBtn.style.opacity = '1';
    prevBtn.style.pointerEvents = 'auto';
  }

  if (idx >= total - 1) {
    nextBtn.style.opacity = '0.3';
    nextBtn.style.pointerEvents = 'none';
  } else {
    nextBtn.style.opacity = '1';
    nextBtn.style.pointerEvents = 'auto';
  }
}

// ── 进入挑战 ──
function startChallenge() {
  const wordData = currentChallengeWord();
  if (!isChallengeScoringReady(wordData)) {
    showToast(`「${wordData.word}」评分模板待上线，暂不能录制打分`, 'error');
    return;
  }

  document.getElementById('challenge-intro').style.display = 'none';
  AppState.isChallengeActive = true;

  const active = document.getElementById('challenge-active');
  if (active) active.style.display = 'flex';

  stopRecording();
  const timerEl = document.getElementById('timer-display');
  if (timerEl) timerEl.textContent = '00:00';

  const startBtn = document.getElementById('btn-start-record');
  if (startBtn) {
    startBtn.innerHTML = '<span class="ctrl-icon">🎥</span><span>开始</span>';
    startBtn.classList.remove('recording');
    startBtn.disabled = false;
  }
  const scoreBtn = document.getElementById('btn-score');
  if (scoreBtn) scoreBtn.disabled = true;

  resetCameraInner();
  if (window.ScoringBridge?.resetForChallenge) window.ScoringBridge.resetForChallenge();
  showToast('🎥 准备好后点击「开始」录制手语');
}

// ── 开始录制 ──
function startRecording() {
  const wordData = currentChallengeWord();
  if (!isChallengeScoringReady(wordData)) {
    showToast(`「${wordData.word}」评分模板待上线，暂不能录制打分`, 'error');
    return;
  }

  if (window.ScoringBridge?.startChallengeRecording) {
    window.ScoringBridge.startChallengeRecording();
    return;
  }

  if (AppState.isRecording) {
    stopRecording();
  }

  AppState.isRecording = true;
  AppState.recordingSeconds = 0;

  const startBtn = document.getElementById('btn-start-record');
  if (startBtn) {
    startBtn.innerHTML = '<span class="ctrl-icon">🔄</span><span>重录</span>';
    startBtn.classList.add('recording');
  }
  const scoreBtn = document.getElementById('btn-score');
  if (scoreBtn) scoreBtn.disabled = false;

  // 更新摄像头区域
  const cameraInner = document.getElementById('challenge-camera-inner');
  if (cameraInner) {
    cameraInner.innerHTML =
      '<p style="color:var(--accent-green);font-weight:600;">📷 录制中...</p>' +
      '<small>请对着摄像头比划手语</small>' +
      '<div class="recording-indicator active" id="recording-indicator">⏺ 录制中...</div>';
  }

  const timerEl = document.getElementById('timer-display');
  if (timerEl) timerEl.textContent = '00:00';

  AppState.recordingTimer = setInterval(() => {
    AppState.recordingSeconds++;
    const mins = String(Math.floor(AppState.recordingSeconds / 60)).padStart(2, '0');
    const secs = String(AppState.recordingSeconds % 60).padStart(2, '0');
    const td = document.getElementById('timer-display');
    if (td) td.textContent = `${mins}:${secs}`;
    if (AppState.recordingSeconds === 10) {
      showToast('💡 可以点「打分」结束录制了！');
    }
  }, 1000);

  showToast('🎥 开始录制，比划「' + wordData.word + '」');
}

function stopRecording() {
  AppState.isRecording = false;
  if (AppState.recordingTimer) {
    clearInterval(AppState.recordingTimer);
    AppState.recordingTimer = null;
  }
  const recIndicator = document.getElementById('recording-indicator');
  if (recIndicator) recIndicator.classList.remove('active');
}

// ── 打分 ──
function scoreChallenge() {
  const wordData = currentChallengeWord();
  if (!isChallengeScoringReady(wordData)) {
    showToast(`「${wordData.word}」评分模板待上线，暂不能评分`, 'error');
    return;
  }

  if (window.ScoringBridge?.scoreChallengeWithApi) {
    window.ScoringBridge.scoreChallengeWithApi();
    return;
  }

  if (!AppState.isRecording) {
    showToast('⚠️ 请先点击「开始」录制手语');
    return;
  }

  stopRecording();

  // 模拟评分
  const baseScore = 30 + AppState.recordingSeconds * 3 + Math.random() * 30;
  AppState.challengeScore = Math.round(Math.min(baseScore, 100));
  const score = AppState.challengeScore;

  const startBtn = document.getElementById('btn-start-record');
  if (startBtn) {
    startBtn.innerHTML = '<span class="ctrl-icon">🎥</span><span>开始</span>';
    startBtn.classList.remove('recording');
  }
  const scoreBtn = document.getElementById('btn-score');
  if (scoreBtn) scoreBtn.disabled = true;

  const cameraInner = document.getElementById('challenge-camera-inner');
  if (cameraInner) {
    cameraInner.innerHTML = '<p style="color:var(--accent-cyan);">⏳ 评估中...</p><small>分析手形 · 动作轨迹 · 面部表情</small>';
  }

  setTimeout(() => {
    const active = document.getElementById('challenge-active');
    if (active) active.style.display = 'none';

    if (score >= 80) {
      // 评分≥80：直接弹出奖励弹窗（含 3D 模型）
      showReward(score);
    } else {
      showResult(score);
    }
  }, 1500);
}

// ── 显示结果 ──
function showResult(score) {
  const resultEl = document.getElementById('challenge-result');
  const resultIcon = document.getElementById('result-icon');
  const resultScore = document.getElementById('result-score');
  const resultMsg = document.getElementById('result-message');

  resultScore.textContent = `${score} 分`;
  resultScore.className = 'result-score';

  if (score < 60) {
    resultIcon.textContent = '😅';
    resultMsg.textContent = '还差一点，再看看左侧的手语示范，重新挑战一次吧！';
    resultScore.classList.add('low');
  } else {
    resultIcon.textContent = '😊';
    resultMsg.textContent = '不错！就差一点点，检查一下哪个手势部分还可以改进～';
    resultScore.classList.add('mid');
  }

  resultEl.style.display = 'flex';
  resultEl.classList.add('show');
  playUiSound(score >= 60 ? 'success' : 'error');

  const wordData = currentChallengeWord();
  AppState.collectedWords.add(wordData.word);
}

// ── 词汇导航 ──
function prevChallengeWord() {
  if (AppState.challengeIndex > 0) {
    AppState.challengeIndex--;
    initChallenge();
  }
}

function nextChallengeWord() {
  if (AppState.challengeIndex < CHALLENGE_WORDS.length - 1) {
    AppState.challengeIndex++;
    initChallenge();
  }
}

function retryChallenge() {
  document.getElementById('challenge-result').style.display = 'none';
  document.getElementById('challenge-result').classList.remove('show');
  startChallenge();
}

// ============ 🎉 奖励弹窗（含 3D 模型）============
function showReward(score) {
  const wordData = currentChallengeWord();
  const overlay = document.getElementById('reward-overlay');

  document.getElementById('reward-title').textContent = '太棒了！';
  document.getElementById('reward-subtitle').textContent = `你已掌握「${wordData.word}」的手语！`;
  document.getElementById('reward-score-show').textContent = `得分：${score} 分`;

  const medals = ['新手学员', '手语新星', '银河使者', '宇宙大师'];
  const medal = medals[Math.min(Math.floor(score / 25), medals.length - 1)];
  document.getElementById('reward-medal').textContent = `🏅 获得「${medal}」勋章 +10 积分`;

  AppState.collectedWords.add(wordData.word);

  // ── 3D 模型只在奖励弹窗中显示 ──
  const rewardModelArea = document.getElementById('reward-model-area');
  if (rewardModelArea) {
    const path = getModelPath(wordData.model);
    const modelInfo = MODEL_MAP[wordData.model];
    if (path) {
      rewardModelArea.innerHTML = `
        <model-viewer id="reward-model-viewer"
          src="${path}"
          auto-rotate
          camera-controls
          exposure="1.2"
          style="width:200px;height:200px;border-radius:50%;"
          alt="奖励模型：${wordData.word}">
        </model-viewer>
      `;
    } else {
      // 没有模型时显示大 emoji + 旋转动画
      const emoji = modelInfo?.emoji || '🏆';
      rewardModelArea.innerHTML = `
        <div style="
          font-size:80px;
          animation:cubeRotate 2.5s ease-in-out infinite;
          filter:drop-shadow(0 0 20px rgba(255,217,61,0.5));
        ">${emoji}</div>
      `;
    }
  }

  // 显示弹窗
  overlay.classList.add('active');
  playUiSound('reward');

  // 粒子效果
  createParticles();
}

function closeReward() {
  document.getElementById('reward-overlay').classList.remove('active');

  // 清理 model-viewer（避免资源泄漏）
  const rewardModelArea = document.getElementById('reward-model-area');
  if (rewardModelArea) rewardModelArea.innerHTML = '';

  // 显示结果面板
  const resultEl = document.getElementById('challenge-result');
  resultEl.style.display = 'flex';
  resultEl.classList.add('show');

  const resultIcon = document.getElementById('result-icon');
  const resultScore = document.getElementById('result-score');
  const resultMsg = document.getElementById('result-message');

  resultIcon.textContent = '🌟';
  resultScore.textContent = `${AppState.challengeScore} 分`;
  resultScore.className = 'result-score high';
  const wordData = currentChallengeWord();
  resultMsg.textContent = wordData.hasRewardModel
    ? `你成功解锁了「${wordData.word}」的 3D 奖励！继续加油～`
    : `你成功点亮了「${wordData.word}」的星光奖励！继续加油～`;
}

function createParticles() {
  const container = document.getElementById('reward-particles');
  container.innerHTML = '';
  const colors = ['#ffd93d', '#ff6b9d', '#4da6ff', '#4de8a0', '#9b59ff', '#ffffff'];

  for (let i = 0; i < 36; i++) {
    const particle = document.createElement('div');
    particle.classList.add('particle');
    const angle = (Math.PI * 2 / 36) * i + (Math.random() - 0.5) * 0.5;
    const distance = 80 + Math.random() * 120;
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance;
    particle.style.cssText = `
      width: ${3 + Math.random() * 5}px;
      height: ${3 + Math.random() * 5}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      --tx: ${tx}px;
      --ty: ${ty}px;
      left: 50%; top: 50%;
      position: absolute;
    `;
    container.appendChild(particle);
  }
  setTimeout(() => { container.innerHTML = ''; }, 2000);
}

// ============ model-viewer 工具 ============
function getModelPath(modelKey) {
  return (MODEL_MAP[modelKey] && MODEL_MAP[modelKey].glbPath) || '';
}

// ============ 🌌 星座图鉴 ============
function renderConstellation() {
  AppState.collectedWordsList = CHALLENGE_WORDS
    .filter(word => AppState.collectedWords.has(word.word))
    .map(word => word.word);
  updateConstellationProgress();
  renderConstellationSVG();
  switchConstellationTab(AppState.constellationTab);
}

function updateConstellationProgress() {
  const total = CHALLENGE_WORDS.length;
  const learned = AppState.collectedWordsList.length;
  document.getElementById('constellation-progress').textContent = `已点亮 ${learned}/${total}`;
}

function renderConstellationSVG() {
  const svgArea = document.getElementById('constellation-svg-area');
  const learnedSet = new Set(AppState.collectedWordsList);
  const visibleWords = CHALLENGE_WORDS.filter(word =>
    AppState.constellationTab === 'learned' ? learnedSet.has(word.word) : !learnedSet.has(word.word)
  );
  const total = visibleWords.length;

  if (!total) {
    const emptyText = AppState.constellationTab === 'learned'
      ? '完成挑战后，词汇会在这里点亮'
      : '全部挑战词汇都已点亮';
    svgArea.innerHTML = `<div class="constellation-empty">${emptyText}</div>`;
    return;
  }

  let svg = `<svg viewBox="0 0 400 400" width="100%" height="100%" style="max-height:400px;">`;

  // 背景星星
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 400;
    const y = Math.random() * 400;
    const r = 0.5 + Math.random() * 1.5;
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(255,255,255,${0.1 + Math.random()*0.3})" />`;
  }

  const cx = 200, cy = 200, rBase = 80;
  visibleWords.forEach((w, i) => {
    const angle = (Math.PI * 2 / total) * i - Math.PI / 2;
    const r = rBase + (i % 3) * 35;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    const isLit = learnedSet.has(w.word);
    const modelInfo = MODEL_MAP[w.model];
    const color = isLit ? (modelInfo?.color || '#ffd93d') : '#333355';

    if (i < total - 1) {
      const angle2 = (Math.PI * 2 / total) * (i + 1) - Math.PI / 2;
      const r2 = rBase + ((i + 1) % 3) * 35;
      const x2 = cx + Math.cos(angle2) * r2;
      const y2 = cy + Math.sin(angle2) * r2;
      svg += `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" class="constellation-line ${isLit ? 'lit' : ''}" />`;
    }

    svg += `<circle cx="${x}" cy="${y}" r="${isLit ? 7 : 4}" fill="${color}" 
      class="constellation-star ${isLit ? 'lit' : ''}" 
      data-word="${w.word}"
      onclick="showConstellationDetail('${w.word}', '${w.model || ''}')" 
      style="cursor:pointer;" />`;
    svg += `<text x="${x}" y="${y + 16}" class="star-label ${isLit ? 'lit' : ''}" 
      style="text-anchor:middle;font-size:9px;fill:${isLit ? '#ffd93d' : '#555577'};pointer-events:none;">${w.word}</text>`;
  });

  svg += `<defs><filter id="glow"><feGaussianBlur stdDeviation="3" result="blur" />
    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>`;
  svg += `</svg>`;
  svgArea.innerHTML = svg;
}

function switchConstellationTab(tab) {
  AppState.constellationTab = tab;
  document.querySelectorAll('.constellation-tab').forEach(t => t.classList.remove('active'));
  const tabButtons = Array.from(document.querySelectorAll('.constellation-tab'));
  const activeIndex = tab === 'locked' ? 1 : 0;
  if (tabButtons[activeIndex]) tabButtons[activeIndex].classList.add('active');
  renderConstellationSVG();
}

function showConstellationDetail(word, modelKey) {
  const detail = document.getElementById('constellation-detail');
  const wordData = CHALLENGE_WORDS.find(w => w.word === word);
  if (!wordData) return;

  document.getElementById('detail-word').textContent = wordData.word;
  document.getElementById('detail-pinyin').textContent = wordData.pinyin;
  document.getElementById('detail-definition').textContent = wordData.definition;

  detail.style.display = 'flex';

  const detailModelArea = document.getElementById('detail-model-area');
  if (detailModelArea && modelKey) {
    const path = getModelPath(modelKey);
    if (path) {
      detailModelArea.innerHTML = `
        <model-viewer
          src="${path}"
          auto-rotate
          camera-controls
          exposure="0.9"
          style="width:100%;height:100%;"
          alt="${wordData.word} 3D模型">
        </model-viewer>
      `;
    } else {
      const emoji = MODEL_MAP[modelKey]?.emoji || '📦';
      detailModelArea.innerHTML = `<div style="font-size:64px;">${emoji}</div>`;
    }
  }
}

function closeConstellationDetail() {
  document.getElementById('constellation-detail').style.display = 'none';
}

// ============ Toast 通知 ============
function showToast(message, sound = 'notice') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  playUiSound(sound);
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.classList.remove('show'); }, 2000);
}

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', () => {
  initUiPreferences();
  navigateTo('splash');
  console.log('🪐 手语小宇宙 Demo v4 已就绪');
  console.log('✨ 本次更新：');
  console.log('  1. 挑战模式覆盖全部学习词汇，未上线模板词显示待上线');
  console.log('  2. 默认采用 Web Holistic + ModelScope lite 后端评分路线');
  console.log('  3. 新增日间/夜间模式与可关闭音效');
});
