/**
 * ReviewPlayer —— 录制回看模块
 * 三视图：原始视频 / Holistic 骨架叠加 / 纯骨架
 * 输入：{ frames: [{index, image_base64}], landmarkRows: [{index, pose_landmarks, left_hand_landmarks, right_hand_landmarks, face_core_landmarks}] }
 * index 对齐：frames[k].index 与 landmarkRows[k].index 为同一录制帧（candidateIndex）
 * 数据源：ScoringBridge.getLastReviewData()（只保留最后一次录制的视频）
 * 依赖：无（自绘骨架，连接表从 @mediapipe/holistic 标准数据复制）
 */
const ReviewPlayer = (() => {
  // MediaPipe 标准连接表（与 vendor/mediapipe/holistic/holistic.js 一致）
  const POSE_CONNECTIONS = [[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],[27,29],[28,30],[29,31],[30,32],[27,31],[28,32]];
  const HAND_CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
  const COLORS = { pose: '#22d3ee', left: '#3b82f6', right: '#ef4444', face: '#94a3b8' };

  let frames = [];
  let landmarkRows = [];
  let mode = 'video';       // video | overlay | skeleton
  let canvas = null, ctx = null;
  let playing = false, timer = null, current = 0;

  /** 创建回看面板 DOM（modal），并绑定事件 */
  function createPanel(locale = 'zh') {
    const en = locale === 'en';
    const panel = document.createElement('div');
    panel.className = 'review-modal';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="review-modal-box">
        <div class="review-modal-header">
          <span class="review-title">📹 ${en ? 'Recording Review' : '动作回看'}</span>
          <div class="review-modes">
            <button type="button" data-review-mode="video" class="active">${en ? 'Video' : '原始视频'}</button>
            <button type="button" data-review-mode="overlay">${en ? 'Overlay' : '骨架叠加'}</button>
            <button type="button" data-review-mode="skeleton">${en ? 'Skeleton' : '纯骨架'}</button>
          </div>
          <button type="button" class="review-close" data-review-close aria-label="close">×</button>
        </div>
        <canvas data-review-canvas width="720" height="540"></canvas>
        <div class="review-controls">
          <button type="button" data-review-play>▶</button>
          <span class="review-pos" data-review-pos>0/0</span>
          <button type="button" data-review-replay title="${en ? 'Replay' : '重播'}">↺</button>
        </div>
      </div>`;
    panel.querySelector('[data-review-close]').addEventListener('click', () => close(panel));
    panel.querySelector('[data-review-play]').addEventListener('click', () => togglePlay(panel));
    panel.querySelector('[data-review-replay]').addEventListener('click', () => replay(panel));
    panel.querySelectorAll('[data-review-mode]').forEach(btn => {
      btn.addEventListener('click', () => setMode(panel, btn.getAttribute('data-review-mode')));
    });
    panel.addEventListener('click', (e) => { if (e.target === panel) close(panel); });
    return panel;
  }

  /** 启动回看。panel 为 createPanel() 创建的面板，data = { frames, landmarkRows } */
  function open(panel, data, opts = {}) {
    frames = (data && data.frames) || [];
    landmarkRows = (data && data.landmarkRows) || [];
    mode = opts.mode || 'video';
    current = 0;
    canvas = panel.querySelector('[data-review-canvas]');
    ctx = canvas ? canvas.getContext('2d') : null;
    // 画布比例适配帧宽高
    const firstFrame = frames[0];
    if (firstFrame) {
      const img = loadImage(firstFrame.image_base64);
      if (img) {
        img.onload = () => {
          if (img.naturalWidth && img.naturalHeight) {
            canvas.width = Math.min(900, img.naturalWidth);
            canvas.height = Math.round(canvas.width * img.naturalHeight / img.naturalWidth);
          }
          renderFrame(panel);
        };
      }
    }
    panel.hidden = false;
    syncModeButtons(panel);
    updatePosLabel(panel);
    if (ctx) renderFrame(panel);
  }

  function close(panel) {
    pause();
    panel.hidden = true;
  }

  function setMode(panel, m) {
    mode = m;
    syncModeButtons(panel);
    if (ctx) renderFrame(panel);
  }

  function togglePlay(panel) {
    if (playing) pause();
    else play(panel);
  }

  function play(panel) {
    if (playing || !frames.length) return;
    playing = true;
    const btn = panel.querySelector('[data-review-play]');
    if (btn) btn.textContent = '⏸';
    timer = setInterval(() => {
      current = (current + 1) % frames.length;
      updatePosLabel(panel);
      renderFrame(panel);
    }, 100); // ~10fps，与录制帧率一致
  }

  function pause() {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
    const btn = document.querySelector('[data-review-play]');
    if (btn) btn.textContent = '▶';
  }

  function replay(panel) {
    current = 0;
    updatePosLabel(panel);
    if (ctx) renderFrame(panel);
    play(panel);
  }

  function syncModeButtons(panel) {
    panel.querySelectorAll('[data-review-mode]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-review-mode') === mode);
    });
  }

  function updatePosLabel(panel) {
    const el = panel.querySelector('[data-review-pos]');
    if (el) el.textContent = frames.length ? `${current + 1}/${frames.length}` : '0/0';
  }

  /** 找 landmarkRows 中与帧 index 匹配的行 */
  function rowFor(index) {
    return landmarkRows.find(r => r.index === index) || null;
  }

  /** 渲染当前帧（按 mode 决定绘制内容） */
  function renderFrame(panel) {
    const f = frames[current];
    if (!ctx) return;
    const W = canvas.width || 720, H = canvas.height || 540;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, H);
    const img = f && f.image_base64 ? loadImage(f.image_base64) : null;
    const drawVideo = mode === 'video' || mode === 'overlay';
    if (drawVideo && img && img.complete) {
      ctx.drawImage(img, 0, 0, W, H);
    }
    if (mode === 'skeleton' || mode === 'overlay') {
      const row = f ? rowFor(f.index) : null;
      if (row) drawSkeleton(ctx, row, W, H);
      else {
        ctx.fillStyle = '#fbbf24';
        ctx.font = '13px sans-serif';
        ctx.fillText('该帧未提取到关键点', 10, H - 10);
      }
    }
    if (drawVideo && !(img && img.complete)) {
      ctx.fillStyle = '#64748b';
      ctx.font = '13px sans-serif';
      ctx.fillText('无视频帧', 10, H - 10);
    }
  }

  const _imgCache = {};
  function loadImage(base64) {
    if (!base64) return null;
    if (_imgCache[base64]) return _imgCache[base64];
    const img = new Image();
    img.src = 'data:image/jpeg;base64,' + base64;
    _imgCache[base64] = img;
    return img;
  }

  /** 画点 */
  function drawLandmarks(ctx, pts, W, H, color) {
    (pts || []).forEach(p => {
      const x = (Number(p && p.x) || 0) * W;
      const y = (Number(p && p.y) || 0) * H;
      if (x < 0 || y < 0 || x > W || y > H) return;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }

  /** 画连接线 */
  function drawConnectors(ctx, pts, conns, W, H, color) {
    if (!pts || !pts.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    (conns || []).forEach(([a, b]) => {
      const pa = pts[a], pb = pts[b];
      if (!pa || !pb) return;
      const x1 = (Number(pa.x) || 0) * W, y1 = (Number(pa.y) || 0) * H;
      const x2 = (Number(pb.x) || 0) * W, y2 = (Number(pb.y) || 0) * H;
      if (x1 < 0 || y1 < 0 || x1 > W || y1 > H || x2 < 0 || y2 < 0 || x2 > W || y2 > H) return;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    });
    ctx.stroke();
  }

  /** 绘制一帧骨架：pose + 左右手 + face core 点 */
  function drawSkeleton(ctx, row, W, H) {
    drawConnectors(ctx, row.pose_landmarks, POSE_CONNECTIONS, W, H, COLORS.pose);
    drawLandmarks(ctx, row.pose_landmarks, W, H, COLORS.pose);
    drawConnectors(ctx, row.left_hand_landmarks, HAND_CONNECTIONS, W, H, COLORS.left);
    drawLandmarks(ctx, row.left_hand_landmarks, W, H, COLORS.left);
    drawConnectors(ctx, row.right_hand_landmarks, HAND_CONNECTIONS, W, H, COLORS.right);
    drawLandmarks(ctx, row.right_hand_landmarks, W, H, COLORS.right);
    drawLandmarks(ctx, row.face_core_landmarks, W, H, COLORS.face);
  }

  /** 注入面板样式（幂等） */
  let _styleInjected = false;
  function ensureStyle() {
    if (_styleInjected) return;
    _styleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .review-modal { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center;
        background: rgba(2,6,23,0.82); backdrop-filter: blur(2px); }
      .review-modal[hidden] { display: none; }
      .review-modal-box { background: #0f172a; border: 1px solid rgba(148,163,184,0.35); border-radius: 12px;
        padding: 12px; max-width: 92vw; max-height: 92vh; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
      .review-modal-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .review-title { font-size: 14px; font-weight: 700; color: #e2e8f0; }
      .review-modes { display: flex; gap: 6px; }
      .review-modes button { font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(148,163,184,0.4);
        background: transparent; color: #94a3b8; cursor: pointer; }
      .review-modes button.active { background: rgba(34,211,238,0.15); color: #22d3ee; border-color: #22d3ee; }
      .review-close { font-size: 18px; line-height: 1; padding: 2px 8px; border: none; background: transparent;
        color: #94a3b8; cursor: pointer; margin-left: auto; }
      .review-close:hover { color: #f87171; }
      .review-modal canvas { width: 100%; max-height: 74vh; object-fit: contain; background: #0f172a; border-radius: 8px; }
      .review-controls { display: flex; align-items: center; gap: 12px; justify-content: center; }
      .review-controls button { font-size: 14px; padding: 5px 14px; border-radius: 6px; border: 1px solid rgba(148,163,184,0.4);
        background: rgba(148,163,184,0.1); color: #e2e8f0; cursor: pointer; }
      .review-controls button:hover { background: rgba(34,211,238,0.15); }
      .review-pos { font-size: 12px; color: #94a3b8; min-width: 56px; text-align: center; }
    `;
    document.head.appendChild(style);
  }

  return { createPanel, open, close, setMode, togglePlay, replay, ensureStyle };
})();
globalThis.ReviewPlayer = ReviewPlayer;
if (typeof window !== 'undefined') window.ReviewPlayer = ReviewPlayer;
