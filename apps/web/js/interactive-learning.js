/*
 * Public bilingual interactive-learning module.
 *
 * Privacy boundary: this module reads only the public action-guidance JSON
 * and the existing procedural Canvas animation. It never fetches private
 * volunteer videos, private preview images, or unapproved landmark caches.
 */
(function (global) {
  'use strict';

  const CONTRACT_URL = 'assets/content/interactive_learning_contracts.json';
  const REFERENCE_MEDIA_URL = 'assets/content/reference_media_manifest.json';
  // The previous Canvas pseudo-3D avatar failed visual review.  Keep it out of
  // the public reference panel until a reviewed, rigged replacement exists.
  const AVATAR3D_PUBLIC_READY = false;
  const state = {
    contracts: [],
    referenceMedia: {},
    index: 0,
    locale: window.localStorage.getItem('sluInteractiveLocale') || 'en',
    loaded: false,
    loadPromise: null,
    player: null,
    avatar3d: null,
    referenceMode: '2d',
    scoringMounted: false,
    lastScore: null
  };

  const TEXT = {
    zh: {
      title: '互动学习实验室',
      subtitle: '语义过程 · 示意参考 · 摄像头练习',
      back: '← 返回',
      language: 'English',
      previous: '上一个词',
      next: '下一个词',
      guidance: '动作指导',
      guidanceSubtitle: '把有先后顺序的动作，与同一时刻需要同时出现的局部特征分开看。',
      ordered: '次序过程（需要不同时间状态）',
      simultaneous: '同时状态（同一关联帧内检查）',
      minFrames: '最少独立证据帧',
      reference: '参考内容',
      schematic: '前端生成的动作示意动画',
      play: '▶ 播放',
      replay: '↻ 重播',
      noVideo: '暂无已授权或自行生成的参考视频',
      videoLabel: '已审核匿名 Avatar 演示视频',
      originalVideo: '原始演示',
      semanticVideo: '语义叠加',
      videoMode: '视频模式',
      videoPause: '暂停视频',
      videoPlay: '继续播放',
      practice: '打开摄像头练习与评分',
      available: '评分模板已接入',
      pending: '评分模板待上线',
      experimental: '候选校准 Demo',
      availableDetail: '浏览器提取匿名运动关键点后在本地完成打分。',
      loading: '正在加载公开动作指导…',
      error: '公开动作指导加载失败，请通过 HTTP(S) 服务打开网页。',
      openChallenge: '开始摄像头评分',
      retry: '重新评分',
      nextAfterScore: '下一个',
      success: '完成得很好！',
      retryHint: '再看一遍动作指导后重新采集。',
      stage: '阶段',
      features: '局部特征',
      current: '当前词汇'
    },
    en: {
      title: 'Interactive Learning Lab',
      subtitle: 'Semantic process · schematic reference · camera practice',
      back: '← Back',
      language: '中文',
      previous: 'Previous',
      next: 'Next',
      guidance: 'Action guidance',
      guidanceSubtitle: 'Keep ordered actions separate from local features that should appear at the same time.',
      ordered: 'Ordered process (distinct time states required)',
      simultaneous: 'Simultaneous state (checked within the same associated frame)',
      minFrames: 'Minimum distinct evidence frames',
      reference: 'Reference material',
      schematic: 'Procedural motion schematic generated in the browser',
      play: '▶ Play',
      replay: '↻ Replay',
      noVideo: 'No licensed or self-generated reference video yet',
      videoLabel: 'Reviewed anonymous Avatar demonstration',
      originalVideo: 'Original demo',
      semanticVideo: 'Semantic overlay',
      videoMode: 'Video mode',
      videoPause: 'Pause video',
      videoPlay: 'Resume video',
      practice: 'Open camera practice and scoring',
      available: 'Scoring template connected',
      pending: 'Scoring template pending',
      experimental: 'Validated candidate demo',
      availableDetail: 'The browser extracts anonymous motion landmarks and scores locally.',
      loading: 'Loading public action guidance…',
      error: 'Could not load the public action guidance. Open the page through an HTTP(S) server.',
      openChallenge: 'Start camera scoring',
      retry: 'Try again',
      nextAfterScore: 'Next',
      success: 'Great job!',
      retryHint: 'Review the action guidance and capture the motion again.',
      stage: 'Stage',
      features: 'Local features',
      current: 'Current word'
    }
  };

  function t(key) { return TEXT[state.locale === 'en' ? 'en' : 'zh'][key] || key; }
  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }
  function contract() { return state.contracts[state.index] || null; }
  function display(value) { return state.locale === 'en' ? (value?.en || value?.zh || '') : (value?.zh || value?.en || ''); }
  function wordLabel(item) { return state.locale === 'en' ? `${item.en} · ${item.zh}` : `${item.zh} · ${item.en}`; }

  function syncChallengeWord(item) {
    if (typeof CHALLENGE_WORDS === 'undefined' || typeof AppState === 'undefined') return -1;
    // practice_word 是老词名（馋/汽车），归一到 21 词模板词名（谗（羡慕）/汽车（一））
    const rawTarget = item.practice_word || item.zh;
    const target = (typeof CANONICAL_WORD_ALIASES !== 'undefined' && CANONICAL_WORD_ALIASES[rawTarget])
      ? CANONICAL_WORD_ALIASES[rawTarget]
      : rawTarget;
    let index = CHALLENGE_WORDS.findIndex(entry => entry.word === target);
    if (index < 0) {
      CHALLENGE_WORDS.push({
        word: target,
        pinyin: item.pinyin,
        definition: state.locale === 'en' ? item.summary_en : item.summary_zh,
        usage: state.locale === 'en' ? 'Interactive-learning scoring.' : '互动学习评分。',
        category: '互动学习实验室',
        model: target,
        scoringReady: true,
        statusLabel: t('available'),
        statusText: state.locale === 'en' ? item.summary_en : item.summary_zh,
        hasRewardModel: false
      });
      index = CHALLENGE_WORDS.length - 1;
    }
    AppState.challengeIndex = index;
    return index;
  }

  function stopInteractiveScoring() {
    if (state.scoringMounted && window.ScoringBridge?.unmountInteractive) {
      window.ScoringBridge.unmountInteractive();
    }
    state.scoringMounted = false;
    state.lastScore = null;
  }

  function scoringResultMessage(result, passed) {
    if (state.locale === 'en') {
      const mode = result?.diagnostics?.scoring_mode || result?.level || '';
      if (mode === 'web_holistic_template_similarity' || mode === 'holistic_template_similarity') {
        return passed
          ? 'The motion was compared with the server template.'
          : 'The motion differs from the server template; review the guidance and try again.';
      }
      if (mode.includes('fallback')) return 'This is a local preview score; connect the scoring service for template similarity.';
      if (mode.includes('capture_quality')) return 'Browser Holistic landmarks were received; this is a capture-quality score.';
      return passed ? 'Scoring completed.' : 'The motion did not meet the current threshold; review the guidance and try again.';
    }
    const feedback = Array.isArray(result?.feedback)
      ? result.feedback.find(item => item && item.message)?.message
      : '';
    if (feedback) return feedback;
    return passed ? t('success') : t('retryHint');
  }

  function handleInteractiveScore(item, result) {
    const score = Number.isFinite(Number(result?.score)) ? Math.round(Number(result.score)) : 0;
    const passed = score >= 80 && result?.score_valid !== false;
    state.lastScore = result;
    const root = document.getElementById('interactive-score-host');
    if (!root) return;
    const active = root.querySelector('#challenge-active');
    const resultPanel = root.querySelector('#challenge-result');
    const icon = root.querySelector('#result-icon');
    const scoreEl = root.querySelector('#result-score');
    if (active) active.style.display = 'none';
    if (resultPanel) {
      resultPanel.style.display = 'flex';
      resultPanel.classList.toggle('show', true);
      resultPanel.classList.toggle('success', passed);
      resultPanel.classList.toggle('retry', !passed);
    }
    if (icon) icon.textContent = passed ? '🎉' : '🔄';
    if (scoreEl) scoreEl.textContent = `${score} ${state.locale === 'en' ? 'points' : '分'}`;
    const status = document.getElementById('interactive-score-state');
    if (status) status.textContent = passed ? t('success') : t('retryHint');
    // 展示顺序：针对性建议 → 局部语义评分（分数下方直接是建议，不重复小字提示）
    renderGroupAdvice(result);
    renderGroupScores(result);
    if (passed && typeof AppState !== 'undefined') {
      AppState.collectedWords.add(item.zh);
      if (typeof playUiSound === 'function') playUiSound('reward');
      if (typeof showToast === 'function') showToast(`${display({ zh: item.zh, en: item.en })} · ${t('success')}`);
    }
  }

  function renderStageScores(result) {
    const host = document.getElementById('interactive-stage-scores');
    if (!host) return;
    const scores = result?.diagnostics?.stage_scores;
    const labels = result?.diagnostics?.stage_advice && result.diagnostics.stage_advice.length
      ? null
      : null;
    const stageLabels = result?.diagnostics?.stage_labels;
    const weak = result?.diagnostics?.stage_weak;
    if (!Array.isArray(scores) || !scores.length) { host.hidden = true; return; }
    const en = state.locale === 'en';
    const rows = scores.map((score, k) => {
      const label = Array.isArray(stageLabels) && stageLabels[k]
        ? (en ? stageLabels[k].label_en : stageLabels[k].label_zh)
        : `${k + 1}`;
      const isWeak = Array.isArray(weak) && weak[k];
      const displayScore = Number.isFinite(score) ? Math.round(score) : '--';
      return `<div class="stage-score-row ${isWeak ? 'weak' : 'ok'}">
        <span class="stage-score-label">${esc(String(k + 1))}. ${esc(label)}</span>
        <span class="stage-score-bar"><i style="width:${Number.isFinite(score) ? Math.max(4, Math.min(100, score)) : 4}%"></i></span>
        <strong class="stage-score-value">${displayScore}</strong>
      </div>`;
    }).join('');
    host.innerHTML = `<h4>🧩 ${esc(en ? 'Stage scores' : '核心语义阶段评分')}</h4>${rows}`;
    host.hidden = false;
  }

  function renderStageAdvice(result) {
    const host = document.getElementById('interactive-stage-advice');
    if (!host) return;
    const advice = result?.diagnostics?.stage_advice;
    if (!Array.isArray(advice) || !advice.length) { host.hidden = true; return; }
    const en = state.locale === 'en';
    const items = advice.map(item => `
      <li class="stage-advice-item">
        <strong>⚠️ ${esc(item.stage_label || `${item.stage_index + 1}`)}</strong>
        <p>${esc(item.suggestion || '')}</p>
      </li>`).join('');
    host.innerHTML = `<h4>💡 ${esc(en ? 'Targeted guidance' : '针对性指导建议')}</h4><ul>${items}</ul>`;
    host.hidden = false;
  }

  function renderGroupScores(result) {
    const host = document.getElementById('interactive-group-scores');
    if (!host) return;
    const scores = result?.diagnostics?.group_scores;
    const weak = result?.diagnostics?.group_weak;
    if (!scores || typeof scores !== 'object') { host.hidden = true; return; }
    const en = state.locale === 'en';
    const labels = {
      pose: en ? 'Body pose' : '身体姿态',
      left_hand: en ? 'Left hand' : '左手动作',
      right_hand: en ? 'Right hand' : '右手动作',
      left_hand_shape: en ? 'Left shape' : '左手手形',
      right_hand_shape: en ? 'Right shape' : '右手手形',
      face: en ? 'Face' : '面部',
      two_hand_relation: en ? 'Two-hand relation' : '双手配合',
      left_hand_motion: en ? 'Left hand process' : '左手过程',
      right_hand_motion: en ? 'Right hand process' : '右手过程',
      left_hand_shape_motion: en ? 'Left shape change' : '左手形变化',
      right_hand_shape_motion: en ? 'Right shape change' : '右手形变化',
      two_hand_relation_motion: en ? 'Relation change' : '双手配合过程'
    };
    const rows = Object.entries(scores).map(([group, score]) => {
      if (score == null) return '';
      const isWeak = weak && weak[group];
      const displayScore = Math.round(score);
      return `<div class="stage-score-row ${isWeak ? 'weak' : 'ok'}">
        <span class="stage-score-label">${esc(labels[group] || group)}</span>
        <span class="stage-score-bar"><i style="width:${Math.max(4, Math.min(100, displayScore))}%"></i></span>
        <strong class="stage-score-value">${displayScore}</strong>
      </div>`;
    }).join('');
    if (!rows) { host.hidden = true; return; }
    host.innerHTML = `<h4>🧩 ${esc(en ? 'Semantic part scores (weighted)' : '局部语义评分（加权）')}</h4>${rows}`;
    host.hidden = false;
  }

  function renderGroupAdvice(result) {
    const host = document.getElementById('interactive-group-advice');
    if (!host) return;
    const advice = result?.diagnostics?.group_advice;
    const en = state.locale === 'en';
    if (!Array.isArray(advice) || !advice.length) {
      // 评分完成但无低分局部：显示达标反馈，避免"评分后无提示"的困惑
      host.innerHTML = `<h4>💡 ${esc(en ? 'Targeted part guidance' : '针对性局部指导')}</h4>
        <p class="stage-advice-all-ok">✅ ${esc(en ? 'All semantic parts passed (≥80). Great job!' : '各核心语义局部均达标（≥80），动作标准！')}</p>`;
      host.hidden = false;
      return;
    }
    // 布局：多个小标题 chips（弱组 + 分数）→ 一段去重的合并建议
    const heads = advice.map(item => `<span class="advice-head">${esc(item.group_label || item.group)} ${item.group_score != null ? item.group_score : '--'}</span>`).join('');
    const seenDetails = new Set();
    const bodyParts = [];
    for (const item of advice) {
      const detail = item.related_stage_detail;
      const label = item.related_stage_label;
      if (detail && !seenDetails.has(detail)) {
        seenDetails.add(detail);
        bodyParts.push(
          en ? `Focus on the semantic stage "${label}": ${detail}.` : `重点练习核心语义【${label}】：${detail}。`
        );
      }
    }
    const tail = en
      ? 'Compare with the reference video and practice these parts.'
      : '请对照示范视频，重点练习上述局部动作。';
    const body = bodyParts.length ? bodyParts.join(' ') + ' ' + tail : tail;
    host.innerHTML = `<h4>💡 ${esc(en ? 'Targeted part guidance' : '针对性局部指导')}</h4>
      <div class="advice-heads">${heads}</div>
      <p class="advice-body">${esc(body)}</p>`;
    host.hidden = false;
  }

  function mountScoring(item) {
    const host = document.getElementById('interactive-score-host');
    if (!host || !window.ScoringBridge?.mountInteractive) return false;
    syncChallengeWord(item);
    state.scoringMounted = window.ScoringBridge.mountInteractive(host, {
      onResult: result => handleInteractiveScore(item, result)
    });
    return state.scoringMounted;
  }

  function renderInteractiveScoringPanel(item, canPractice, statusText, statusDetail) {
    const slot = document.getElementById('interactive-scoring-slot');
    if (!slot) return;
    if (!canPractice) {
      slot.innerHTML = '<div class="interactive-score-unavailable">🔒 ' + esc(statusText) + '</div>';
      return;
    }
    const en = state.locale === 'en';
    slot.innerHTML = [
      '<div class="interactive-score-host" id="interactive-score-host" style="display:none;" aria-hidden="true">',
      (statusText ? '<div class="interactive-score-state" id="interactive-score-state">' + esc(statusText) + '</div>' : '<div class="interactive-score-state" id="interactive-score-state" style="display:none;"></div>'),
      '<div class="challenge-active interactive-score-active" id="challenge-active" style="display:flex;">',
      '<div class="challenge-camera-frame interactive-score-camera" id="challenge-camera-frame"><div class="challenge-camera-inner" id="challenge-camera-inner">',
      '<p>📷 ' + (en ? 'Camera preview' : '摄像头画面区域') + '</p>',
      '<small>' + (en ? 'Click Start to capture the motion' : '点击“开始”后对着摄像头比划手语') + '</small>',
      '<div class="recording-indicator" id="recording-indicator">⏺ ' + (en ? 'Recording' : '录制中') + '</div>',
      '</div></div>',
      '<div class="scoring-capture-settings" id="scoring-capture-settings">',
      '<label><span>' + (en ? 'Duration' : '采集时长') + '</span><input id="scoring-duration-sec" type="number" min="1" max="8" step="0.5" value="3"></label>',
      '<label><span>' + (en ? 'Upload FPS' : '上传 FPS') + '</span><input id="scoring-capture-fps" type="number" min="1" max="12" step="1" value="10"></label>',
      '<label><span>' + (en ? 'Frame width' : '帧宽') + '</span><input id="scoring-frame-width" type="number" min="240" max="1920" step="40" value="1280"></label>',
      '</div>',
      '<div class="scoring-capture-hint" id="scoring-capture-hint">' + (en ? 'Capture settings loading' : '采样参数待确认') + '</div>',
      '<div class="scoring-web-holistic-note" id="scoring-web-holistic-note">Web Holistic ' + (en ? 'loading' : '准备中') + '</div>',
      '<button class="scoring-holistic-retry-btn" id="scoring-holistic-retry-btn" type="button" onclick="ScoringBridge.retryBrowserHolistic()" hidden>' + (en ? 'Reload Web Holistic' : '重新加载 Web Holistic') + '</button>',
      '<div class="scoring-progress-wrap" aria-hidden="true"><div class="scoring-progress-bar" id="scoring-progress-bar"></div></div>',
      '<div class="challenge-controls" id="challenge-controls">',
      '<button class="challenge-ctrl-btn start-btn" id="btn-start-record" onclick="InteractiveLearning.beginRecording()"><span class="ctrl-icon">🎥</span><span>' + (en ? 'Start camera' : '开启摄像头') + '</span></button>',
      '<button class="challenge-ctrl-btn score-btn" id="btn-score" onclick="ScoringBridge.scoreChallengeWithApi()" disabled><span class="ctrl-icon">⭐</span><span>' + (en ? 'Score' : '自动评分') + '</span></button>',
      '</div>',
      '<div class="scoring-service-row" id="scoring-service-row" style="display:none;"><span class="service-dot idle" id="scoring-service-dot"></span>',
      '<input id="scoring-api-base-input" class="scoring-api-input" type="url" inputmode="url" placeholder="' + (en ? 'Scoring API URL' : '评分 API 地址') + '" aria-label="' + (en ? 'Scoring API URL' : '评分 API 地址') + '">',
      '<button class="scoring-api-btn" type="button" onclick="ScoringBridge.saveApiBaseFromInput()">' + (en ? 'Connect' : '连接') + '</button></div>',
      '<div class="scoring-worker-note" id="scoring-worker-note">' + (en ? 'Scoring service pending' : '评分服务待连接') + '</div>',
      '<div class="scoring-auto-note" id="scoring-auto-note" hidden></div>',
      '<div class="challenge-timer" id="challenge-timer">' + (en ? 'Duration: ' : '录制时长：') + '<span id="timer-display">00:00</span></div>',
      '</div>',
      '<div class="challenge-result interactive-score-result" id="challenge-result" style="display:none;">',
      '<div class="result-icon" id="result-icon">🎯</div><div class="result-score" id="result-score">--</div>',
      '<div class="scoring-result-details" id="scoring-result-details" hidden>',
      '<div><span>' + (en ? 'Scoring mode' : '评分模式') + '</span><strong id="scoring-result-mode">--</strong></div>',
      '<div><span>' + (en ? 'Frames' : '上传帧数') + '</span><strong id="scoring-result-frames">--</strong></div>',
      '<div><span>Worker</span><strong id="scoring-result-worker">--</strong></div>',
      '<div><span>Request</span><strong id="scoring-result-request">--</strong></div><p id="scoring-result-advice">--</p></div>',
      '<div class="interactive-group-advice" id="interactive-group-advice" hidden></div>',
      '<div class="interactive-group-scores" id="interactive-group-scores" hidden></div>',
      '<div class="result-actions"><button class="action-btn secondary" type="button" onclick="InteractiveLearning.retryScore()">↻ ' + esc(t('retry')) + '</button>',
      '<button class="action-btn primary" type="button" onclick="InteractiveLearning.next()">→ ' + esc(t('nextAfterScore')) + '</button></div>',
      '</div></div>'
    ].join('');
  }

  function setLocale(locale) {
    const wasScoringMounted = state.scoringMounted;
    state.locale = locale === 'en' ? 'en' : 'zh';
    window.localStorage.setItem('sluInteractiveLocale', state.locale);
    render();
    // 语言切换后保持摄像头区域：若之前评分区已挂载，重新打开摄像头预览（不缩回）
    if (wasScoringMounted && typeof window.ScoringBridge?.ensureCamera === 'function') {
      if (window.AppState) window.AppState.isRecording = false;
      window.ScoringBridge.ensureCamera().catch(() => {});
    }
  }
  function toggleLocale() { setLocale(state.locale === 'en' ? 'zh' : 'en'); }

  async function load() {
    if (state.loaded) return state.contracts;
    if (state.loadPromise) return state.loadPromise;
    renderHeader(null);
    const loadingNode = document.querySelector('#interactive-learning-content .interactive-loading');
    if (loadingNode) loadingNode.textContent = t('loading');
    state.loadPromise = Promise.all([CONTRACT_URL, REFERENCE_MEDIA_URL].map(url => fetch(url, { cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status} (${url})`);
      return response.json();
    })))
      .then(([payload, mediaPayload]) => {
        state.contracts = Array.isArray(payload.contracts) ? payload.contracts : [];
        state.referenceMedia = {};
        (Array.isArray(mediaPayload.entries) ? mediaPayload.entries : []).forEach(entry => {
          if (entry && entry.word_index && entry.path) state.referenceMedia[String(entry.word_index)] = entry;
        });
        state.loaded = state.contracts.length > 0;
        render();
        return state.contracts;
      })
      .catch(error => {
        state.loaded = false;
        const host = document.getElementById('interactive-learning-content');
        if (host) host.innerHTML = `<div class="interactive-error">⚠️ ${esc(t('error'))}<small>${esc(error.message)}</small></div>`;
        throw error;
      });
    return state.loadPromise;
  }

  function renderHeader(item) {
    const title = document.getElementById('interactive-learning-title');
    const subtitle = document.getElementById('interactive-learning-subtitle');
    const localeBtn = document.getElementById('interactive-locale-toggle');
    const indexLabel = document.getElementById('interactive-index-label');
    const backBtn = document.getElementById('interactive-back-btn');
    if (title) title.textContent = t('title');
    if (subtitle) subtitle.textContent = t('subtitle');
    if (localeBtn) localeBtn.textContent = t('language');
    if (indexLabel) indexLabel.textContent = item ? `${state.index + 1} / ${state.contracts.length}` : '--';
    if (backBtn) backBtn.textContent = t('back');
  }

  function render() {
    const host = document.getElementById('interactive-learning-content');
    const item = contract();
    stopInteractiveScoring();
    if (state.player) state.player.stop();
    if (state.avatar3d) {
      if (typeof state.avatar3d.destroy === 'function') state.avatar3d.destroy();
      else state.avatar3d.stop();
      state.avatar3d = null;
    }
    renderHeader(item);
    if (!host) return;
    if (!item) {
      host.innerHTML = `<div class="interactive-loading">${esc(t('loading'))}</div>`;
      return;
    }

    const ordered = (item.ordered_sequence || []).map((event, idx) => `
      <li class="semantic-stage">
        <span class="semantic-stage-number">${idx + 1}</span>
        <div><strong>${esc(display({ zh: event.label_zh, en: event.label_en }))}</strong><p>${esc(display({ zh: event.detail_zh, en: event.detail_en }))}</p></div>
      </li>`).join('');
    const simultaneous = (item.simultaneous_features || []).map(feature => `
      <article class="semantic-feature-card">
        <h4>${esc(display({ zh: feature.label_zh, en: feature.label_en }))}</h4>
        <ul>${(state.locale === 'en' ? feature.features_en : feature.features_zh).map(value => `<li>${esc(value)}</li>`).join('')}</ul>
      </article>`).join('');
    const isAvailable = item.scoring_template_status === 'available';
    const isExperimental = item.scoring_template_status === 'experimental';
    const canPractice = isAvailable || isExperimental;
    // 不再显示"评分模板已接入"状态小字，面板直接进入摄像头评分
    const statusText = '';
    const statusDetail = '';
    const illustrationIndex = String(item.index).padStart(2, '0');
    // 优先使用仅含示意图的裁剪图；若缺失则回退到原始整页资料图
    const illustrationPath = `assets/content/illustrations/schematic-crops/word-${illustrationIndex}.jpeg`;
    const illustrationFallbackPath = `assets/content/illustrations/word-${illustrationIndex}.jpeg`;
    const media = state.referenceMedia[String(item.index)];
    const hasSemanticVideo = Boolean(media?.semantic_overlay_path);
    const mediaBlock = media
      ? `<div class="interactive-reference-video">${hasSemanticVideo ? `<div class="interactive-video-mode-label">${esc(t('videoMode'))}</div><div class="interactive-video-mode-controls"><button type="button" class="reference-video-mode-btn active" data-reference-video-mode="original" onclick="InteractiveLearning.setReferenceVideoMode('original')">${esc(t('originalVideo'))}</button><button type="button" class="reference-video-mode-btn" data-reference-video-mode="semantic" onclick="InteractiveLearning.setReferenceVideoMode('semantic')">${esc(t('semanticVideo'))}</button></div>` : ''}<video id="interactive-reference-video" data-reference-video-role="original" controls preload="metadata" autoplay loop muted playsinline src="${esc(media.path)}" aria-label="${esc(t('videoLabel'))}"></video>${hasSemanticVideo ? `<video id="interactive-semantic-reference-video" data-reference-video-role="semantic" controls preload="metadata" loop muted playsinline hidden src="${esc(media.semantic_overlay_path)}" aria-label="${esc(t('semanticVideo'))}"></video>` : ''}<div class="interactive-video-controls"><button type="button" id="interactive-reference-video-toggle" onclick="InteractiveLearning.toggleReferenceVideo()">Ⅱ ${esc(t('videoPause'))}</button></div></div>`
      : `<div class="interactive-video-empty"><strong>📹 ${esc(t('noVideo'))}</strong></div>`;
    const referenceHeading = media ? t('videoLabel') : t('schematic');
    const referenceBadge = media
      ? ''
      : (state.locale === 'en' ? 'Schematic placeholder' : '示意动画占位');
    const referenceVisual = media
      ? mediaBlock
      : `<div class="interactive-schematic-viewer"><canvas id="interactive-reference-canvas" aria-label="${esc(item.en)} schematic animation"></canvas><canvas id="interactive-avatar3d-canvas" class="interactive-avatar3d-canvas" aria-label="${esc(item.en)} 3D teaching avatar animation" hidden></canvas><div id="interactive-phase-label" class="interactive-phase-label">${state.locale === 'en' ? '2D motion schematic' : '2D动作示意'}</div></div><div class="interactive-media-controls"><button class="reference-mode-btn" data-reference-mode="2d" type="button" onclick="InteractiveLearning.setReferenceMode('2d')">2D ${esc(t('schematic'))}</button><button class="reference-mode-btn" data-reference-mode="3d" type="button" disabled aria-disabled="true" title="${state.locale === 'en' ? 'A reviewed rigged avatar is being rebuilt' : '正在依据三视角人工帧重制可审核的人物模型'}">3D ${state.locale === 'en' ? 'rebuilding' : '重制中'}</button><button type="button" onclick="InteractiveLearning.togglePlay()">${esc(t('play'))}</button><button type="button" onclick="InteractiveLearning.replay()">${esc(t('replay'))}</button></div>${mediaBlock}`;

    host.innerHTML = `
      <button type="button" class="interactive-side-nav interactive-side-nav-prev" onclick="InteractiveLearning.previous()" aria-label="${esc(t('previous'))}" title="${esc(t('previous'))}">‹</button>
      <button type="button" class="interactive-side-nav interactive-side-nav-next" onclick="InteractiveLearning.next()" aria-label="${esc(t('next'))}" title="${esc(t('next'))}">›</button>
      <div class="interactive-word-toolbar">
        <button type="button" class="interactive-nav-btn" onclick="InteractiveLearning.previous()">◀ ${esc(t('previous'))}</button>
        <label class="interactive-word-select-label" for="interactive-word-select">${esc(t('current'))}
          <select id="interactive-word-select" onchange="InteractiveLearning.select(Number(this.value))">
            ${state.contracts.map((entry, idx) => `<option value="${idx}" ${idx === state.index ? 'selected' : ''}>${idx + 1}. ${esc(wordLabel(entry))}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="interactive-nav-btn" onclick="InteractiveLearning.next()">${esc(t('next'))} ▶</button>
      </div>
      <section class="interactive-hero-card">
        <div class="interactive-word-heading">
          <span class="interactive-index-badge">#${item.index}</span>
          <div><h2>${esc(item.zh)}</h2><p>${esc(item.en)} · ${esc(item.pinyin)}</p></div>
        </div>
      </section>
      <div class="interactive-reference-grid">
        <section class="interactive-panel interactive-schematic-panel">
          <div class="interactive-panel-heading"><div><h3>🎞️ ${esc(t('reference'))}</h3><p>${esc(referenceHeading)}</p></div></div>
          ${referenceVisual}
        </section>
        <section class="interactive-panel semantic-contract-panel">
        <div class="interactive-panel-heading"><div><h3>🧭 ${esc(t('guidance'))}</h3><p>${esc(t('guidanceSubtitle'))}</p></div></div>
        <div class="semantic-guidance-intro">
          <figure class="semantic-illustration"><img src="${illustrationPath}" loading="lazy" alt="${esc(item.en)} instructional illustration" onerror="this.onerror=null;this.src='${illustrationFallbackPath}'"></figure>
          <div class="semantic-guidance-summary"><p>${esc(state.locale === 'en' ? item.summary_en : item.summary_zh)}</p></div>
        </div>
        <div class="semantic-contract-columns"><div><h4>${esc(t('ordered'))}</h4><ol class="semantic-stage-list">${ordered}</ol></div><div><h4>${esc(t('simultaneous'))}</h4><div class="semantic-feature-grid">${simultaneous}</div></div></div>
        </section>
        <section class="interactive-panel interactive-practice-panel">
          <div class="interactive-panel-heading"><div><h3>📷 ${esc(t('practice'))}</h3>${statusDetail ? `<p>${esc(statusDetail)}</p>` : ''}</div></div>
          <button type="button" class="interactive-practice-btn" id="interactive-score-launcher" aria-controls="interactive-score-host" aria-expanded="false" onclick="InteractiveLearning.startScore(${canPractice ? 'true' : 'false'})">${canPractice ? '🚀' : '🔒'} ${esc(t('openChallenge'))}</button>
          <div id="interactive-scoring-slot"></div>
        </section>
      </div>`;

    initAnimation(item);
    setReferenceMode(state.referenceMode, true);
    renderInteractiveScoringPanel(item, canPractice, statusText, statusDetail);
    if (canPractice) mountScoring(item);
  }

  function initAnimation(item) {
    const canvas = document.getElementById('interactive-reference-canvas');
    const avatarCanvas = document.getElementById('interactive-avatar3d-canvas');
    if (canvas && typeof getAnimationPlayer === 'function') state.player = getAnimationPlayer(canvas);
    if (AVATAR3D_PUBLIC_READY && avatarCanvas && window.Avatar3D) {
      if (!state.avatar3d) state.avatar3d = window.Avatar3D.create(avatarCanvas);
      state.avatar3d.load(item.practice_word || item.zh);
    }
    if (!state.player) return;
    const hasAnimation = typeof hasSignAnimation === 'function' && hasSignAnimation(item.practice_word || item.zh);
    const label = document.getElementById('interactive-phase-label');
    state.player.onPhaseChange(phase => { if (label) label.textContent = phase; });
    state.player.load(item.practice_word || item.zh);
    state.player.setLoop(true);
    if (hasAnimation) state.player.play();
    else if (label) label.textContent = state.locale === 'en' ? 'No word-specific schematic yet' : '暂无该词专属示意动画';
  }

  function setReferenceMode(mode, silent = false) {
    const previousMode = state.referenceMode;
    state.referenceMode = mode === '3d' && AVATAR3D_PUBLIC_READY && state.avatar3d ? '3d' : '2d';
    const canvas2d = document.getElementById('interactive-reference-canvas');
    const canvas3d = document.getElementById('interactive-avatar3d-canvas');
    if (canvas2d) canvas2d.hidden = state.referenceMode !== '2d';
    if (canvas3d) canvas3d.hidden = state.referenceMode !== '3d';
    document.querySelectorAll('[data-reference-mode]').forEach(button => {
      button.classList.toggle('active', button.dataset.referenceMode === state.referenceMode);
    });
    if (state.referenceMode === '3d') {
      state.avatar3d?.resize();
      if (!silent && previousMode === '3d') state.avatar3d?.stop();
      state.avatar3d?.play();
      state.player?.stop();
    } else {
      state.avatar3d?.stop();
      state.player?.resize();
      if (!silent && previousMode === '2d') state.player?.stop();
      if (!silent && state.player) state.player.play();
    }
  }

  function select(index) {
    if (!state.contracts.length) return;
    state.index = Math.max(0, Math.min(Number(index) || 0, state.contracts.length - 1));
    render();
  }
  function previous() { select(state.index - 1); }
  function next() { select(state.index + 1); }
  function togglePlay() {
    const player = state.referenceMode === '3d' ? state.avatar3d : state.player;
    if (!player) return;
    if (player.playing) player.stop(); else player.play();
  }
  function replay() {
    const player = state.referenceMode === '3d' ? state.avatar3d : state.player;
    if (player) { player.stop(); player.play(); }
  }
  function toggleReferenceVideo() {
    const video = document.querySelector('.interactive-reference-video video:not([hidden])');
    const button = document.getElementById('interactive-reference-video-toggle');
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      if (button) button.textContent = `Ⅱ ${t('videoPause')}`;
    } else {
      video.pause();
      if (button) button.textContent = `▶ ${t('videoPlay')}`;
    }
  }

  function setReferenceVideoMode(mode) {
    const original = document.getElementById('interactive-reference-video');
    const semantic = document.getElementById('interactive-semantic-reference-video');
    if (!original || !semantic) return;
    const target = mode === 'semantic' ? semantic : original;
    const source = mode === 'semantic' ? original : semantic;
    const time = Number.isFinite(source.currentTime) ? source.currentTime : 0;
    source.pause();
    original.hidden = target !== original;
    semantic.hidden = target !== semantic;
    original.style.display = target === original ? 'block' : 'none';
    semantic.style.display = target === semantic ? 'block' : 'none';
    document.querySelectorAll('[data-reference-video-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.referenceVideoMode === mode);
    });
    const syncAndPlay = () => {
      target.currentTime = Math.min(time, Number.isFinite(target.duration) ? target.duration : time);
      target.play().catch(() => {});
    };
    if (target.readyState >= 1) syncAndPlay();
    else target.addEventListener('loadedmetadata', syncAndPlay, { once: true });
  }

  function startScore(canPractice) {
    const item = contract();
    if (!canPractice) {
      if (typeof showToast === 'function') showToast(state.locale === 'en' ? 'This word has no public scoring template yet.' : '该词汇的公开评分模板尚未上线。', 'error');
      return;
    }
    syncChallengeWord(item);
    const host = document.getElementById('interactive-score-host');
    const launcher = document.getElementById('interactive-score-launcher');
    if (host) {
      host.style.display = 'grid';
      host.setAttribute('aria-hidden', 'false');
    }
    if (launcher) {
      launcher.hidden = true;
      launcher.setAttribute('aria-expanded', 'true');
    }
    if (!state.scoringMounted) mountScoring(item);
    const active = document.querySelector('#interactive-score-host #challenge-active');
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function beginRecording() {
    if (!state.scoringMounted) {
      startScore(true);
    }
    if (window.ScoringBridge?.startChallengeRecording) {
      window.ScoringBridge.startChallengeRecording();
    }
  }

  function retryScore() {
    const item = contract();
    if (!item || !state.scoringMounted) return;
    const root = document.getElementById('interactive-score-host');
    const active = root?.querySelector('#challenge-active');
    const result = root?.querySelector('#challenge-result');
    if (active) active.style.display = 'flex';
    if (result) {
      result.style.display = 'none';
      result.classList.remove('show', 'success', 'retry');
    }
    state.lastScore = null;
    window.ScoringBridge?.resetForChallenge();
  }

  function openPractice(canPractice) {
    return startScore(canPractice);
  }

  function init() {
    if (document.getElementById('interactive-learning-content')) load();
  }

  function stop() {
    stopInteractiveScoring();
    if (state.player) state.player.stop();
    if (state.avatar3d) state.avatar3d.stop();
  }

  global.InteractiveLearning = {
    init, load, render, select, previous, next, setLocale, toggleLocale,
    togglePlay, replay, toggleReferenceVideo, setReferenceVideoMode, setReferenceMode, openPractice, startScore, beginRecording, retryScore, stop
  };
  document.addEventListener('DOMContentLoaded', init);
})(window);
