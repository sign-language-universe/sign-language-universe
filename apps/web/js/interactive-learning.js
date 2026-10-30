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
    lastScore: null,
    teacherOpen: false,
    teacherFocusReturn: null,
    teacherUi: null,
    teacherHistory: [],
    teacherHistoryIndex: null,
    teacherCleanup: null
  };

  const TEXT = {
    zh: {
      universeTitle: '🪐 手语小宇宙',
      labTitle: '互动学习实验室',
      title: '手语小宇宙 - 互动学习实验室',
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
      current: ''
    },
    en: {
      universeTitle: '🪐 Sign Language Universe',
      labTitle: 'Interactive Learning Lab',
      title: 'Sign Language Universe - Interactive Learning Lab',
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

  function handleInteractiveScore(item, result) {
    const rawScore = result?.score;
    const score = rawScore == null || rawScore === '' || !Number.isFinite(Number(rawScore)) ? null : Math.round(Number(rawScore));
    const thresholdRaw = result?.pass_threshold ?? result?.diagnostics?.pass_threshold;
    const threshold = thresholdRaw == null || thresholdRaw === '' ? null : Number(thresholdRaw);
    const mode = String(result?.diagnostics?.scoring_mode || result?.level || '').toLowerCase();
    const isFallback = mode.includes('fallback') || mode.includes('browser_frame_fallback');
    const isCaptureQuality = mode.includes('capture_quality') || mode.includes('web_holistic_capture_quality');
    const safeMode = isFallback || isCaptureQuality;
    const valid = result?.score_valid === true;
    const thresholdValid = Number.isFinite(threshold);
    const validJudgment = valid && !safeMode && score !== null && thresholdValid;
    const passed = validJudgment && score >= threshold;
    state.lastScore = result;
    const teacherFeedback = TeacherAgent.scoreFeedback(result, item, state.locale);
    const resultAdvice = document.getElementById('scoring-result-advice');
    if (resultAdvice) resultAdvice.hidden = true;
    const root = document.getElementById('interactive-score-host');
    const teacherAdvice = root?.querySelector('#interactive-teacher-feedback');
    if (teacherAdvice) {
      teacherAdvice._resultAvatar?.destroy?.();
      teacherAdvice.innerHTML = `<span class="teacher-avatar-host teacher-result-avatar" data-teacher-result-avatar aria-hidden="true"></span><span>${esc(teacherFeedback.text)}</span>`;
      teacherAdvice.hidden = false;
      const resultAvatar = window.TeacherAvatar?.mount(teacherAdvice.querySelector('[data-teacher-result-avatar]'), {label: state.locale === 'en' ? 'Mia' : '小语老师'});
      teacherAdvice._resultAvatar = resultAvatar;
      resultAvatar?.setState(valid && !safeMode ? (passed ? 'happy' : 'thinking') : 'idle');
    }
    const duplicateAdvice = root?.querySelector('#interactive-group-advice');
    if (duplicateAdvice) duplicateAdvice.hidden = true;
    const stageAdvice = root?.querySelector('#interactive-stage-advice');
    if (stageAdvice) stageAdvice.hidden = true;
    if (state.teacherHistoryIndex !== item.index) { state.teacherHistory=[]; state.teacherHistoryIndex=item.index; }
    if (state.teacherUi) state.teacherUi.replaceScoreFeedback(result);
    else {
      const prior = state.teacherHistory.findIndex(message => message.scoreFeedback);
      if (prior >= 0) state.teacherHistory.splice(prior,1);
      state.teacherHistory.push({text:teacherFeedback.text,who:'coach',scoreFeedback:true});
    }
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
    const celebrateScore = valid && !safeMode && score !== null && score >= 80;
    if (icon) icon.textContent = celebrateScore ? '🎉' : '🔄';
    // 主分标注模型来源：submitFrames 主路径（v5 扁平模型语义打分）vs 降级路径
    const modeLabel = result?.diagnostics?.scoring_mode || result?.level || '';
    const isV5 = String(modeLabel).includes('web_model_semantic');
    if (scoreEl) scoreEl.textContent = score === null
      ? (state.locale === 'en' ? 'No valid score' : '无有效分数')
      : `${score} ${state.locale === 'en' ? 'points' : '分'}${isV5 ? (state.locale === 'en' ? ' · model v5' : ' · 模型 v5') : ''}`;
    const status = document.getElementById('interactive-score-state');
    if (status) status.textContent = !validJudgment
      ? (state.locale === 'en' ? 'No pass/fail judgment is available for this result.' : '本次结果不用于判断是否达标。')
      : passed ? t('success') : t('retryHint');
    // 展示顺序：针对性建议 → 局部语义评分（分数下方直接是建议，不重复小字提示）
    if (!valid || safeMode) {
      ['interactive-group-advice','interactive-group-scores','interactive-tree-score'].forEach(id => { const node=document.getElementById(id); if(node) node.hidden=true; });
    } else {
      renderGroupAdvice(result);
      renderGroupScores(result);
      renderTreeScore(result);
    }
    renderReviewButton(result);
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
        <strong>⚠️ ${esc(item[`stage_label_${state.locale}`] || item.stage_label || `${item.stage_index + 1}`)}</strong>
        <p>${esc(item[`suggestion_${state.locale}`] || item.suggestion || '')}</p>
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

  /** 语义树模型分：树模块已下线（纯语义头 v5 打分），树分面板直接隐藏。
   *  保留函数名与调用点，避免改动调用结构。 */
  function renderTreeScore(result) {
    const host = document.getElementById('interactive-tree-score');
    if (host) host.hidden = true;
  }

  /** 回看按钮：打开录制回看（原始视频 / 骨架叠加 / 纯骨架三视图）。
   *  数据只保留最后一次录制（ScoringBridge.getLastReviewData），录制新动作后旧回看自动失效。 */
  function renderReviewButton(result) {
    const host = document.getElementById('interactive-review-slot');
    if (!host) return;
    const available = result?.diagnostics?.review_available === true;
    if (!available) { host.innerHTML = ''; return; }
    const en = state.locale === 'en';
    host.innerHTML = `<button type="button" class="action-btn secondary review-open-btn" data-review-open>📹 ${en ? 'Review recording' : '回看录制'}</button>`;
    host.querySelector('[data-review-open]').addEventListener('click', () => {
      if (typeof ReviewPlayer === 'undefined') return;
      const data = (typeof ScoringBridge !== 'undefined' && ScoringBridge.getLastReviewData)
        ? ScoringBridge.getLastReviewData() : null;
      if (!data || !data.frames || !data.frames.length) return;
      ReviewPlayer.ensureStyle();
      document.querySelectorAll('.review-modal').forEach(p => p.remove());
      const panel = ReviewPlayer.createPanel(state.locale);
      document.body.appendChild(panel);
      ReviewPlayer.open(panel, data);
    });
  }

  function renderGroupAdvice(result) {
    const host = document.getElementById('interactive-group-advice');
    if (!host) return;
    const advice = result?.diagnostics?.group_advice;
    const stageAdvice = result?.diagnostics?.stage_advice;
    const en = state.locale === 'en';
    const validGroups = Array.isArray(advice) ? advice : [];
    const validStages = Array.isArray(stageAdvice) ? stageAdvice : [];
    if (!validGroups.length && !validStages.length) {
      host.innerHTML = `<h4>💡 ${esc(en ? 'Targeted part guidance' : '针对性局部指导')}</h4><p>${esc(en ? 'No valid local semantic detail is available; I will not infer a correction from the overall score.' : '目前没有有效的局部语义信息；我不会只凭总分推断动作问题。')}</p>`;
      host.hidden = false;
      return;
    }
    const heads = validGroups.map(item => `<span class="advice-head">${esc(item[`group_label_${state.locale}`] || item[`related_stage_label_${state.locale}`] || item.group_label || item.group)} ${item.group_score != null ? item.group_score : '--'}</span>`).join('');
    const seenDetails = new Set();
    const bodyParts = [];
    for (const item of validGroups) {
      // 双语字段优先，按当前 UI 语言显式选择（避免打分时 locale 检测与渲染不一致导致混中文）
      const label = en
        ? (item.related_stage_label_en || item.related_stage_label)
        : (item.related_stage_label_zh || item.related_stage_label);
      const detail = en
        ? (item.related_stage_detail_en || item.related_stage_detail)
        : (item.related_stage_detail_zh || item.related_stage_detail);
      if (detail && !seenDetails.has(detail)) {
        seenDetails.add(detail);
        bodyParts.push(
          en ? `Focus on the semantic stage "${label}": ${detail}.` : `重点练习核心语义【${label}】：${detail}。`
        );
      }
    }
    for (const item of validStages) {
      const label = item[`stage_label_${state.locale}`] || item.stage_label || '';
      const detail = item[`suggestion_${state.locale}`] || item.suggestion || '';
      if (detail && !seenDetails.has(detail)) {
        seenDetails.add(detail);
        bodyParts.push(en ? `${label ? `${label}: ` : ''}${detail}` : `${label ? `【${label}】` : ''}${detail}`);
      }
    }
    const tail = en
      ? 'Compare with the reference and practice these reported parts.'
      : '请对照示范，练习以上评分实际反馈的局部。';
    const body = bodyParts.length ? bodyParts.join(' ') + ' ' + tail : tail;
    host.innerHTML = `<h4>💡 ${esc(en ? 'Targeted part guidance' : '针对性局部指导')}</h4>
      <div class="advice-heads">${heads}</div>
      <p class="advice-body">${esc(body)}</p>`;
    host.hidden = false;
  }

  function collectSample(isPositive) {
    const item = state.contracts[state.index];
    if (!item) return;
    const alias = { '馋': '谗（羡慕）', '汽车': '汽车（一）' };
    const word = alias[item.practice_word || item.zh] || item.practice_word || item.zh;
    const label = isPositive ? 'pos' : 'neg';
    if (typeof window.ScoringBridge?.collectSample !== 'function') {
      showToast('收集服务未连接（需本地 127.0.0.1:8200）', 'error');
      return;
    }
    window.ScoringBridge.collectSample(word, label).then(res => {
      if (res.ok) {
        showToast(state.locale === 'en'
          ? `Saved as ${label === 'pos' ? 'positive' : 'negative'} sample: ${res.sample_id}`
          : `已记录${label === 'pos' ? '正' : '负'}样本：${res.sample_id}`);
      } else {
        showToast(state.locale === 'en' ? `Save failed: ${res.error}` : `保存失败：${res.error}`, 'error');
      }
    });
  }

  function mountScoring(item) {
    const host = document.getElementById('interactive-score-host');
    if (!host || !window.ScoringBridge?.mountInteractive) return false;
    syncChallengeWord(item);
    state.scoringMounted = window.ScoringBridge.mountInteractive(host, {
      onResult: result => handleInteractiveScore(item, result),
      onCaptureStart: () => {
        const message = state.locale === 'en' ? 'Your recording has started. Show the sign clearly; I will review the key movements when scoring is ready.' : '已经开始采集了，请清晰展示手语动作；评分完成后我会马上和你一起看关键动作。';
        state.teacherUi?.say(message);
      }
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
      '<label><span>' + (en ? 'Frame width' : '帧宽') + '</span><input id="scoring-frame-width" type="number" min="480" max="1280" step="40" value="720"></label>',
      '</div>',
      '<div class="scoring-capture-hint" id="scoring-capture-hint">' + (en ? 'Capture settings loading' : '采样参数待确认') + '</div>',
      '<div class="scoring-web-holistic-note" id="scoring-web-holistic-note">Web Holistic ' + (en ? 'loading' : '准备中') + '</div>',
      '<button class="scoring-holistic-retry-btn" id="scoring-holistic-retry-btn" type="button" onclick="ScoringBridge.retryBrowserHolistic()" hidden>' + (en ? 'Reload Web Holistic' : '重新加载 Web Holistic') + '</button>',
      '<div class="scoring-progress-wrap" aria-hidden="true"><div class="scoring-progress-bar" id="scoring-progress-bar"></div></div>',
      '<div class="challenge-controls" id="challenge-controls">',
      '<button class="challenge-ctrl-btn start-btn" id="btn-start-record" onclick="InteractiveLearning.beginRecording()"><span class="ctrl-icon">🎥</span><span>' + (en ? 'Record' : '录制') + '</span></button>',
      '</div>',
      '<div class="scoring-service-row" id="scoring-service-row" style="display:none;"><span class="service-dot idle" id="scoring-service-dot"></span>',
      '<input id="scoring-api-base-input" class="scoring-api-input" type="url" inputmode="url" placeholder="' + (en ? 'Scoring API URL' : '评分 API 地址') + '" aria-label="' + (en ? 'Scoring API URL' : '评分 API 地址') + '">',
      '<button class="scoring-api-btn" type="button" onclick="ScoringBridge.saveApiBaseFromInput()">' + (en ? 'Connect' : '连接') + '</button></div>',
      '<div class="scoring-worker-note" id="scoring-worker-note">' + (en ? 'Scoring service pending' : '评分服务待连接') + '</div>',
      '<div class="scoring-auto-note" id="scoring-auto-note" hidden></div>',
      '</div>',
      '<div class="challenge-result interactive-score-result" id="challenge-result" style="display:none;">',
      '<div class="result-icon" id="result-icon">🎯</div><div class="result-score" id="result-score">--</div>',
      '<div class="scoring-result-details" id="scoring-result-details" hidden>',
      '<div><span>' + (en ? 'Scoring mode' : '评分模式') + '</span><strong id="scoring-result-mode">--</strong></div>',
      '<div><span>' + (en ? 'Frames' : '上传帧数') + '</span><strong id="scoring-result-frames">--</strong></div>',
      '<div><span>Worker</span><strong id="scoring-result-worker">--</strong></div>',
      '<div><span>Request</span><strong id="scoring-result-request">--</strong></div><p id="scoring-result-advice">--</p></div>',
      '<div class="interactive-teacher-feedback" id="interactive-teacher-feedback" hidden></div>',
      '<div class="interactive-group-advice" id="interactive-group-advice" hidden></div>',
      '<div class="interactive-group-scores" id="interactive-group-scores" hidden></div>',
      '<div class="interactive-tree-score" id="interactive-tree-score" hidden></div>',
      '<div class="interactive-review-slot" id="interactive-review-slot"></div>',
      '<div class="result-actions">',
      (isCollectMode()
        ? '<button class="action-btn secondary collect-btn" type="button" onclick="InteractiveLearning.collectSample(true)">✅ ' + (en ? 'Save as positive' : '记为正样本') + '</button>' +
          '<button class="action-btn secondary collect-btn" type="button" onclick="InteractiveLearning.collectSample(false)">❌ ' + (en ? 'Save as negative' : '记为负样本') + '</button>'
        : ''),
      '<button class="action-btn secondary" type="button" onclick="InteractiveLearning.retryScore()">↻ ' + esc(t('retry')) + '</button>',
      '<button class="action-btn primary" type="button" onclick="InteractiveLearning.next()">→ ' + esc(t('nextAfterScore')) + '</button></div>',
      '</div></div>'
    ].join('');
  }

  /** 测试模式：本地地址（localhost/127.0.0.1）或 URL 带 collect=1 时显示样本收集按钮（正式公开版隐藏；?collect=0 可强制隐藏） */
  function isCollectMode() {
    const host = (typeof window !== 'undefined' && window.location && window.location.hostname) || '';
    const local = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('172.');
    const search = (typeof window !== 'undefined' && window.location) ? new URLSearchParams(window.location.search) : null;
    const flagOff = search && search.get('collect') === '0';
    const flag = search && search.get('collect') === '1';
    return (local && !flagOff) || flag;
  }

  function setLocale(locale) {
    const wasScoringMounted = state.scoringMounted;
    state.locale = locale === 'en' ? 'en' : 'zh';
    state.teacherHistory = [];
    window.localStorage.setItem('sluInteractiveLocale', state.locale);
    // 同步到 AppState（model-scoring 等模块按此读取界面语言）
    if (window.AppState) window.AppState.locale = state.locale;
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
        state.referenceMedia = {};
        (Array.isArray(mediaPayload.entries) ? mediaPayload.entries : []).forEach(entry => {
          if (entry && entry.word_index && entry.path) state.referenceMedia[String(entry.word_index)] = entry;
        });
        // 临时展示版：只展示已上线（有已审核 wan 演示视频）的词，其余默认隐藏；恢复全量词时删除下面一行过滤即可
        state.contracts = (Array.isArray(payload.contracts) ? payload.contracts : [])
          .filter(item => Boolean(state.referenceMedia[String(item.index)]));
        state.loaded = state.contracts.length > 0;
        state.index = 0;
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
    const universeTitle = document.getElementById('interactive-universe-title');
    const title = document.getElementById('interactive-learning-title');
    const subtitle = document.getElementById('interactive-learning-subtitle');
    const localeBtn = document.getElementById('interactive-locale-toggle');
    const indexLabel = document.getElementById('interactive-index-label');
    const backBtn = document.getElementById('interactive-back-btn');
    if (universeTitle) universeTitle.textContent = t('universeTitle');
    // 组合标题：主标题（渐变）+ 分隔符 + 实验室名（蓝色调，与主标题区分）
    if (title) {
      title.innerHTML = `<span class="slu-title-main">${esc(t('universeTitle'))}</span><span class="slu-title-sep"> - </span><span class="slu-title-lab">${esc(t('labTitle'))}</span>`;
    }
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
    if (!document.getElementById('screen-interactive-learning')?.classList.contains('active')) return;
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
      ? `<div class="interactive-reference-video">${hasSemanticVideo ? `<div class="interactive-video-mode-controls"><button type="button" class="reference-video-mode-btn active" data-reference-video-mode="original" onclick="InteractiveLearning.setReferenceVideoMode('original')">${esc(t('originalVideo'))}</button><button type="button" class="reference-video-mode-btn" data-reference-video-mode="semantic" onclick="InteractiveLearning.setReferenceVideoMode('semantic')">${esc(t('semanticVideo'))}</button></div>` : ''}<video id="interactive-reference-video" data-reference-video-role="original" controls preload="metadata" autoplay loop muted playsinline onclick="InteractiveLearning.toggleReferenceVideo(event)" src="${esc(media.path)}" aria-label="${esc(t('videoLabel'))}"></video>${hasSemanticVideo ? `<video id="interactive-semantic-reference-video" data-reference-video-role="semantic" controls preload="metadata" loop muted playsinline hidden onclick="InteractiveLearning.toggleReferenceVideo(event)" src="${esc(media.semantic_overlay_path)}" aria-label="${esc(t('semanticVideo'))}"></video>` : ''}</div>`
      : `<div class="interactive-video-empty"><strong>📹 ${esc(t('noVideo'))}</strong></div>`;
    const referenceHeading = media ? t('videoLabel') : t('schematic');
    const referenceBadge = media
      ? ''
      : (state.locale === 'en' ? 'Schematic placeholder' : '示意动画占位');
    const referenceVisual = media
      ? mediaBlock
      : `<div class="interactive-schematic-viewer"><canvas id="interactive-reference-canvas" aria-label="${esc(item.en)} schematic animation"></canvas><canvas id="interactive-avatar3d-canvas" class="interactive-avatar3d-canvas" aria-label="${esc(item.en)} 3D teaching avatar animation" hidden></canvas><div id="interactive-phase-label" class="interactive-phase-label">${state.locale === 'en' ? '2D motion schematic' : '2D动作示意'}</div></div><div class="interactive-media-controls"><button class="reference-mode-btn" data-reference-mode="2d" type="button" onclick="InteractiveLearning.setReferenceMode('2d')">2D ${esc(t('schematic'))}</button><button class="reference-mode-btn" data-reference-mode="3d" type="button" disabled aria-disabled="true" title="${state.locale === 'en' ? 'A reviewed rigged avatar is being rebuilt' : '正在依据三视角人工帧重制可审核的人物模型'}">3D ${state.locale === 'en' ? 'rebuilding' : '重制中'}</button><button type="button" onclick="InteractiveLearning.togglePlay()">${esc(t('play'))}</button></div>${mediaBlock}`;

    host.innerHTML = `
      <button type="button" class="interactive-side-nav interactive-side-nav-prev" onclick="InteractiveLearning.previous()" aria-label="${esc(t('previous'))}" title="${esc(t('previous'))}">‹</button>
      <button type="button" class="interactive-side-nav interactive-side-nav-next" onclick="InteractiveLearning.next()" aria-label="${esc(t('next'))}" title="${esc(t('next'))}">›</button>
      <div class="interactive-word-toolbar">
        <button type="button" class="interactive-nav-btn" onclick="InteractiveLearning.previous()">◀ ${esc(t('previous'))}</button>
        <label class="interactive-word-select-label" for="interactive-word-select">
          <select id="interactive-word-select" aria-label="${esc(state.locale === 'en' ? 'Current word' : '选择词汇')}" onchange="InteractiveLearning.select(Number(this.value))">
            ${state.contracts.map((entry, idx) => `<option value="${idx}" ${idx === state.index ? 'selected' : ''}>${idx + 1}. ${esc(wordLabel(entry))}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="interactive-nav-btn" onclick="InteractiveLearning.next()">${esc(t('next'))} ▶</button>
      </div>
      <section class="interactive-hero-card">
        <div class="interactive-word-heading">
          <span class="interactive-index-badge">#${item.index}</span>
          <div class="interactive-word-title">
            <h2>${esc(item.zh)}<span class="interactive-word-en">${esc(item.en)}</span></h2>
          </div>
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

    // 默认优先显示语义叠加（semantic overlay）展示视频：该词有语义叠加视频时，
    // 默认展示 semantic 并自动播放，用户可手动切回原始演示；无语义叠加的词保持原逻辑（显示 original）
    if (hasSemanticVideo) setReferenceVideoMode('semantic');

    initAnimation(item);
    setReferenceMode(state.referenceMode, true);
    renderInteractiveScoringPanel(item, canPractice, statusText, statusDetail);
    if (canPractice) mountScoring(item);
    mountTeacherAgent(item);
  }

  function mountTeacherAgent(item) {
    const host = document.getElementById('interactive-learning-content');
    if (!host || !window.TeacherAgent) return;
    state.teacherCleanup?.();
    if (!document.getElementById('screen-interactive-learning')?.classList.contains('active')) return;
    state.teacherUi?.destroy?.();
    state.teacherUi = null;
    document.querySelectorAll('.teacher-agent-launcher, #teacher-agent-panel').forEach(node => node.remove());
    state.teacherOpen = false;
    if (state.teacherHistoryIndex !== item.index) {
      state.teacherHistory = [];
      state.teacherHistoryIndex = item.index;
      state.teacherUi = null;
    }
    const en = state.locale === 'en';
    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'teacher-agent-launcher';
    launcher.dataset.teacherAgentUi = 'launcher';
    launcher.innerHTML = `<span class="teacher-avatar-host teacher-agent-floating-avatar" data-teacher-launch-avatar aria-hidden="true"></span><span>${en ? 'Ask Mia' : '问问小语'}</span>`;
    const launcherAvatar = window.TeacherAvatar?.mount(launcher.querySelector('[data-teacher-launch-avatar]'), {label: en ? 'Mia' : '小语老师'});
    launcherAvatar?.setState('idle');
    launcher.setAttribute('aria-label', en ? 'Open Mia, your sign-language coach' : '打开小语老师，查看当前词动作提示或提问');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', 'teacher-agent-panel');
    const panel = document.createElement('div');
    panel.id = 'teacher-agent-panel';
    panel.className = 'teacher-agent-panel';
    panel.hidden = true;
    document.body.append(launcher, panel);
    let autoCloseTimer = null;
    let disposed = false;
    function positionTeacherPanel() {
      if (disposed) return;
      const reference = host.querySelector('.interactive-schematic-panel');
      const badge = document.getElementById('build-badge');
      const app = document.getElementById('app');
      const appRect = app?.getBoundingClientRect();
      const referenceMedia = reference
        ? Array.from(reference.querySelectorAll('.interactive-reference-video video:not([hidden]), .interactive-schematic-viewer'))
          .filter(node => !node.hidden && getComputedStyle(node).display !== 'none')
        : [];
      const referenceBottom = referenceMedia.length
        ? Math.max(...referenceMedia.map(node => node.getBoundingClientRect().bottom))
        : reference?.getBoundingClientRect().bottom ?? innerHeight * 0.72;
      const badgeTop = badge?.getBoundingClientRect().top ?? innerHeight - 8;
      const contentTop = appRect?.top ?? 0;
      const contentBottom = Math.min(badgeTop, appRect?.bottom ?? innerHeight);
      const moduleBottom = reference?.getBoundingClientRect().bottom ?? referenceBottom;
      const top = Math.max(contentTop + 8, referenceBottom + 16, moduleBottom + 16);
      const available = Math.max(0, contentBottom - top - 8);
      panel.style.top = `${top}px`;
      panel.style.height = `${available}px`;
      panel.style.maxHeight = `${available}px`;
    }
    function alignPracticePage() {
      const app = document.getElementById('app');
      const screen = document.getElementById('screen-interactive-learning');
      const wordBar = host.querySelector('.interactive-hero-card');
      if (!app || !screen || !wordBar) return;
      const header = screen.querySelector('.interactive-top-bar');
      const headerHeight = header?.getBoundingClientRect().height ?? 0;
      const target = Math.max(0, app.scrollTop + wordBar.getBoundingClientRect().top - app.getBoundingClientRect().top - headerHeight - 8);
      screen.style.minHeight = `${app.clientHeight + target}px`;
      app.scrollTop = target;
    }
    function openAfterScroll() {
      alignPracticePage();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (disposed || !document.getElementById('screen-interactive-learning')?.classList.contains('active')) return;
        positionTeacherPanel();
        panel.hidden = false;
        state.teacherOpen = true;
      }));
    }
    function openPanel(autoCloseMs = 0) {
      state.teacherOpen = false;
      panel.hidden = true;
      panel.classList.add('is-floating');
      launcher.classList.add('is-open');
      launcher.setAttribute('aria-expanded', 'true');
      state.teacherHistoryIndex = item.index;
      state.teacherUi = TeacherAgent.render(panel, {locale:state.locale,item,result:state.lastScore,history:state.teacherHistory,avatar:launcherAvatar,close});
      state.teacherHistory = state.teacherUi.history;
      clearTimeout(autoCloseTimer);
      if (autoCloseMs > 0) {
        autoCloseTimer = setTimeout(() => {
          if (state.teacherOpen) close();
        }, autoCloseMs);
      }
      openAfterScroll();
    }
    function keepPanelOpen() {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
    function scrollThenPosition() {
      if (!disposed && !panel.hidden) requestAnimationFrame(positionTeacherPanel);
    }
    function mediaLayoutChanged() {
      if (disposed || panel.hidden) return;
      alignPracticePage();
      scrollThenPosition();
    }
    const reference = host.querySelector('.interactive-schematic-panel');
    const app = document.getElementById('app');
    const resizeObserver = new ResizeObserver(mediaLayoutChanged);
    if (reference) {
      resizeObserver.observe(reference);
      reference.querySelectorAll('video, .interactive-schematic-viewer').forEach(node => resizeObserver.observe(node));
      reference.addEventListener('loadedmetadata', mediaLayoutChanged, true);
    }
    window.addEventListener('resize', scrollThenPosition);
    app?.addEventListener('scroll', scrollThenPosition);
    state.teacherCleanup = () => {
      disposed = true;
      clearTimeout(autoCloseTimer);
      resizeObserver.disconnect();
      reference?.removeEventListener('loadedmetadata', mediaLayoutChanged, true);
      window.removeEventListener('resize', scrollThenPosition);
      app?.removeEventListener('scroll', scrollThenPosition);
      launcherAvatar?.destroy?.();
      launcher.remove();
      panel.remove();
      state.teacherOpen = false;
      state.teacherCleanup = null;
    };
    function close() {
      state.teacherHistory = state.teacherUi?.history || state.teacherHistory;
      state.teacherUi?.destroy?.();
      state.teacherUi = null;
      panel.hidden = true;
      panel.classList.remove('is-floating', 'is-dragging');
      launcher.classList.remove('is-open');
      clearTimeout(autoCloseTimer);
      panel.style.removeProperty('left');
      panel.style.removeProperty('top');
      panel.style.removeProperty('right');
      panel.style.removeProperty('bottom');
      panel.style.removeProperty('height');
      panel.style.removeProperty('max-height');
      launcher.hidden = false;
      launcher.setAttribute('aria-expanded', 'false');
      state.teacherOpen = false;
      state.teacherFocusReturn = launcher;
      launcher.focus();
    }
    launcher.addEventListener('click', () => {
      if (state.teacherOpen) { close(); return; }
      openPanel();
    });
    openPanel(10000);
    panel.addEventListener('pointerdown', keepPanelOpen);
    panel.addEventListener('focusin', keepPanelOpen);
    panel.addEventListener('teacher-action', event => {
      keepPanelOpen();
      const target = event.detail === 'guidance' ? host.querySelector('.semantic-contract-panel') : event.detail === 'reference' ? host.querySelector('.interactive-schematic-panel') : null;
      if (target) target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
      if (event.detail === 'practice') document.getElementById('interactive-score-launcher')?.focus();
    });
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
  function toggleReferenceVideo(event) {
    const video = event?.currentTarget || document.querySelector('.interactive-reference-video video:not([hidden])');
    if (!video || video.hidden) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
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
      const message = state.locale === 'en' ? 'Preparing the camera and getting your scoring session ready.' : '正在准备摄像头和评分流程，请按页面提示完成开启。';
      state.teacherUi?.say(message);
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
    state.teacherCleanup?.();
    stopInteractiveScoring();
    if (state.player) state.player.stop();
    if (state.avatar3d) state.avatar3d.stop();
    state.teacherUi?.destroy?.();
    state.teacherUi = null;
    state.teacherOpen = false;
    document.querySelectorAll('.teacher-agent-launcher, .teacher-agent-nudge, #teacher-agent-panel').forEach(node => node.remove());
  }

  global.InteractiveLearning = {
    init, load, render, select, previous, next, setLocale, toggleLocale,
    togglePlay, replay, toggleReferenceVideo, setReferenceVideoMode, setReferenceMode, openPractice, startScore, beginRecording, retryScore, stop, collectSample
  };
  document.addEventListener('DOMContentLoaded', init);
})(window);
