/*!
 * scoring-core.js — 前端手语评分核心（移植自 packages/scoring-core/score_holistic_sequence_mvp.py）
 * 纯数值函数，无 DOM 依赖。输入为前端 web holistic 采集的 landmark_rows，
 * 输出与后端 /api/scoring/score (landmark_rows 路径) 对齐的评分结果。
 * 模板（standard）特征由 Python 侧预计算打包（scoring_templates_v1.json）。
 */
(function (global) {
  'use strict';

  /* ================= 常量（与 Python 对齐） ================= */
  const POSE_CORE_INDICES = [0, 11, 12, 13, 14, 15, 16, 23, 24];
  const FACE_CORE_INDICES = [33, 133, 159, 145, 362, 263, 386, 374, 61, 291, 13, 14];
  const POSE_LANDMARK_COUNT = 33;
  const HAND_LANDMARK_COUNT = 21;
  const FACE_LANDMARK_COUNT = 478;

  const LANDMARK_XY_VISIBLE_MIN = -0.15;
  const LANDMARK_XY_VISIBLE_MAX = 1.15;
  const LANDMARK_Z_VISIBLE_MIN = -1.0;
  const LANDMARK_Z_VISIBLE_MAX = 1.0;
  const LANDMARK_ZERO_MISSING_EPS = 1e-7;

  const POSE_FALLBACK_XY_MIN = -0.25;
  const POSE_FALLBACK_XY_MAX = 1.25;
  const POSE_FALLBACK_Z_MIN = -2.0;
  const POSE_FALLBACK_Z_MAX = 1.0;
  const POSE_FALLBACK_SCALE_MIN = 0.06;
  const POSE_FALLBACK_SCALE_MAX = 0.85;

  const POSE_SHOULDER_X_MIN = -0.25, POSE_SHOULDER_X_MAX = 1.25;
  const POSE_SHOULDER_Y_MIN = -0.25, POSE_SHOULDER_Y_MAX = 1.40;
  const POSE_SHOULDER_Z_MIN = -2.0, POSE_SHOULDER_Z_MAX = 1.0;
  const POSE_SHOULDER_SCALE_MIN = 0.06, POSE_SHOULDER_SCALE_MAX = 0.85;
  const POSE_SHOULDER_NOSE_Y_GAP_MIN = 0.0, POSE_SHOULDER_NOSE_Y_GAP_MAX = 0.50;
  const POSE_SHOULDER_NOSE_Z_GAP_MIN = 0.05, POSE_SHOULDER_NOSE_Z_GAP_MAX = 1.10;
  const POSE_SHOULDER_HIP_Y_GAP_MIN = 0.02, POSE_SHOULDER_HIP_Y_GAP_MAX = 1.00;
  const POSE_SHOULDER_HIP_Z_GAP_MIN = -1.20, POSE_SHOULDER_HIP_Z_GAP_MAX = 0.50;

  const GROUP_WEIGHTS = {
    left_hand: 0.32, right_hand: 0.32,
    left_hand_shape: 0.00, right_hand_shape: 0.00,
    pose: 0.24, face: 0.06, missing: 0.06,
  };
  const BASE_GROUPS = ['left_hand', 'right_hand', 'pose', 'face'];
  const HAND_GROUPS = ['left_hand', 'right_hand', 'left_hand_shape', 'right_hand_shape'];
  const HAND_SHAPE_GROUPS = ['left_hand_shape', 'right_hand_shape'];
  const RELATIVE_MOTION_GROUPS = [
    'left_hand_motion', 'right_hand_motion',
    'left_hand_shape_motion', 'right_hand_shape_motion',
    'two_hand_relation', 'two_hand_relation_motion',
  ];

  const FINGER_TIPS = [4, 8, 12, 16, 20];
  const FINGER_MCPS = [1, 5, 9, 13, 17];
  const FINGER_PIPS = [2, 6, 10, 14, 18];
  const FINGER_DIPS = [3, 7, 11, 15, 19];
  const SPREAD_PAIRS = [[4, 8], [8, 12], [12, 16], [16, 20], [8, 20]];
  const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];

  const SCORE_SCALE = 0.12;
  const DEFAULT_FPS = 25.0;
  const EPS = 1e-6;

  /* ================= 基础工具 ================= */
  function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function f32(value, fallback) {
    const n = Number(value);
    return isFiniteNumber(n) ? n : (fallback === undefined ? 0.0 : fallback);
  }

  function v3(point) {
    // 前端 landmark 点为数组 [x,y,z] 或 [x,y,z,visibility,presence]
    if (Array.isArray(point)) {
      const x = f32(point[0]), y = f32(point[1]), z = f32(point[2]);
      return [x, y, z];
    }
    if (point && typeof point === 'object') {
      return [f32(point.x), f32(point.y), f32(point.z)];
    }
    return [0, 0, 0];
  }

  function pointVisible(point, xyBounds, zBounds, zeroEps) {
    const p = v3(point);
    if (!p.every(isFiniteNumber)) return false;
    if (xyBounds) {
      const [low, high] = xyBounds;
      if (p[0] < low || p[0] > high || p[1] < low || p[1] > high) return false;
    }
    if (zBounds) {
      const [low, high] = zBounds;
      if (p[2] < low || p[2] > high) return false;
    }
    if (zeroEps !== undefined && Math.abs(p[0]) <= zeroEps && Math.abs(p[1]) <= zeroEps && Math.abs(p[2]) <= zeroEps) return false;
    return true;
  }

  function vecAdd(a, b) { return a.map((v, i) => v + b[i]); }
  function vecSub(a, b) { return a.map((v, i) => v - b[i]); }
  function vecMul(a, s) { return a.map(v => v * s); }
  function vecLen(a) { return Math.sqrt(a.reduce((s, v) => s + v * v, 0)); }
  function vecDot(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }
  function vecNorm(a) { const l = vecLen(a); return l > 1e-8 ? vecMul(a, 1 / l) : a.slice(); }
  function median(arr) {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  function quantile(arr, q) {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort((x, y) => x - y);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
  }

  /* ================= 特征抽取（query 侧，从 landmark_rows） ================= */
  /**
   * 从 landmark 点列表按索引提取坐标与可见性 mask。
   * landmarks: 数组，每点为 [x,y,z,(vis),(pres)] 或 {x,y,z}
   */
  function landmarkArray(items, indices, opts) {
    opts = opts || {};
    const selected = indices || (opts.expectedCount != null
      ? Array.from({ length: opts.expectedCount }, (_, i) => i)
      : items.map((_, i) => i));
    const coords = [], mask = [];
    const xyBounds = opts.xyBounds || null;
    const zBounds = opts.zBounds || null;
    for (const idx of selected) {
      if (idx >= 0 && idx < items.length) {
        const p = items[idx];
        const vis = pointVisible(p, xyBounds, zBounds, opts.zeroMissingEps);
        coords.push(vis ? v3(p) : [0, 0, 0]);
        mask.push(vis ? 1 : 0);
      } else {
        coords.push([0, 0, 0]);
        mask.push(0);
      }
    }
    return { values: coords, mask };
  }

  function handLandmarkArrays(resultData) {
    const left = landmarkArray(resultData.left_hand_landmarks || [], null, {
      expectedCount: HAND_LANDMARK_COUNT, xyBounds: [LANDMARK_XY_VISIBLE_MIN, LANDMARK_XY_VISIBLE_MAX], zBounds: [LANDMARK_Z_VISIBLE_MIN, LANDMARK_Z_VISIBLE_MAX],
    });
    const right = landmarkArray(resultData.right_hand_landmarks || [], null, {
      expectedCount: HAND_LANDMARK_COUNT, xyBounds: [LANDMARK_XY_VISIBLE_MIN, LANDMARK_XY_VISIBLE_MAX], zBounds: [LANDMARK_Z_VISIBLE_MIN, LANDMARK_Z_VISIBLE_MAX],
    });
    return [left, right];
  }

  function dist3(a, b) { return vecLen(vecSub(a, b)); }

  function angleStraightness(a, b, c) {
    const left = vecSub(a, b), right = vecSub(c, b);
    const denom = vecLen(left) * vecLen(right);
    if (denom <= 1e-8) return 0;
    let cosv = vecDot(left, right) / denom;
    cosv = Math.max(-1, Math.min(1, cosv));
    return (1 - cosv) / 2;
  }

  /** 20 维手形特征（对应 _hand_shape_feature） */
  function handShapeFeature(hand, handMask) {
    const values = [], masks = [];
    const wristOk = handMask.length > 0 && handMask[0] > 0;
    const palmRefs = [];
    for (const idx of [5, 9, 13, 17]) {
      if (wristOk && idx < handMask.length && handMask[idx] > 0) palmRefs.push(dist3(hand[idx], hand[0]));
    }
    if (handMask[5] > 0 && handMask[17] > 0) palmRefs.push(dist3(hand[5], hand[17]));
    if (!palmRefs.length) return { values: new Array(20).fill(0), mask: new Array(20).fill(0) };
    const palmScale = Math.max(palmRefs.reduce((s, v) => s + v, 0) / palmRefs.length, 1e-3);

    const appendDistance = (aIdx, bIdx) => {
      const ok = aIdx < handMask.length && bIdx < handMask.length && handMask[aIdx] > 0 && handMask[bIdx] > 0;
      values.push(ok ? dist3(hand[aIdx], hand[bIdx]) / palmScale : 0);
      masks.push(ok ? 1 : 0);
    };
    for (const tip of FINGER_TIPS) appendDistance(0, tip);
    for (const [a, b] of SPREAD_PAIRS) appendDistance(a, b);
    for (let k = 0; k < FINGER_MCPS.length; k++) appendDistance(FINGER_MCPS[k], FINGER_TIPS[k]);
    for (let k = 0; k < FINGER_MCPS.length; k++) {
      const mcp = FINGER_MCPS[k], pip = FINGER_PIPS[k], tip = FINGER_TIPS[k];
      const ok = handMask[mcp] > 0 && handMask[pip] > 0 && handMask[tip] > 0;
      values.push(ok ? angleStraightness(hand[mcp], hand[pip], hand[tip]) : 0);
      masks.push(ok ? 1 : 0);
    }
    return { values, mask: masks };
  }

  function appendGroup(parts, masks, groups, name, arr, mask) {
    const start = parts.reduce((s, p) => s + p.length, 0);
    const flat = arr.slice();
    parts.push(flat);
    const repeat = Math.max(1, Math.floor(flat.length / Math.max(mask.length, 1)));
    const repMask = [];
    for (const m of mask) for (let k = 0; k < repeat; k++) repMask.push(m);
    masks.push(repMask);
    groups[name] = [start, start + flat.length];
  }

  /* —— 归一化（逐行对齐 Python _hand_fallback_normalization / _shoulder_normalization） —— */
  function handFallbackNormalization(hands) {
    const centers = [], palmScales = [];
    for (const [hand, handMask] of hands) {
      if (!hand.length || !handMask.length) continue;
      const visible = handMask.map((m, i) => m > 0 && hand[i].every(isFiniteNumber));
      if (!visible.some(Boolean)) continue;
      if (visible[0]) {
        centers.push(hand[0].slice());
      } else {
        const pts = hand.filter((_, i) => visible[i]);
        centers.push([median(pts.map(p => p[0])), median(pts.map(p => p[1])), median(pts.map(p => p[2]))]);
      }
      if (!visible[0]) continue;
      const distances = [];
      for (const idx of [5, 9, 13, 17]) {
        if (idx < visible.length && visible[idx]) distances.push(dist3(hand[idx], hand[0]));
      }
      if (visible.length > 17 && visible[5] && visible[17]) distances.push(dist3(hand[5], hand[17]));
      const finiteDist = distances.filter(v => isFiniteNumber(v) && v > 1e-6);
      if (finiteDist.length >= 2) palmScales.push(finiteDist.reduce((s, v) => s + v, 0) / finiteDist.length);
    }
    if (!centers.length || !palmScales.length) return null;
    const n = centers.length;
    const center = [0, 0, 0];
    for (const c of centers) { center[0] += c[0]; center[1] += c[1]; center[2] += c[2]; }
    center[0] /= n; center[1] /= n; center[2] /= n;
    const sorted = palmScales.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianScale = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const scale = Math.max(POSE_FALLBACK_SCALE_MIN, Math.min(POSE_FALLBACK_SCALE_MAX, medianScale * 4.0));
    return { center, scale };
  }

  function shoulderNormalization(pose, poseMask, hands) {
    // pose 已是 POSE_CORE_INDICES 选取后的 9 点：0=鼻, 1=左肩(11), 2=右肩(12), 7=左髋(23), 8=右髋(24)
    const finite = pose.map(p => p.every(isFiniteNumber));
    if (!(pose.length >= 3 && poseMask[1] > 0 && poseMask[2] > 0 && finite[1] && finite[2])) return null;
    const scale = Math.hypot(pose[1][0] - pose[2][0], pose[1][1] - pose[2][1]);
    const center = vecMul(vecAdd(pose[1], pose[2]), 0.5);
    const shouldersValid =
      pose[1][0] >= POSE_SHOULDER_X_MIN && pose[1][0] <= POSE_SHOULDER_X_MAX &&
      pose[2][0] >= POSE_SHOULDER_X_MIN && pose[2][0] <= POSE_SHOULDER_X_MAX &&
      pose[1][1] >= POSE_SHOULDER_Y_MIN && pose[1][1] <= POSE_SHOULDER_Y_MAX &&
      pose[2][1] >= POSE_SHOULDER_Y_MIN && pose[2][1] <= POSE_SHOULDER_Y_MAX &&
      pose[1][2] >= POSE_SHOULDER_Z_MIN && pose[1][2] <= POSE_SHOULDER_Z_MAX &&
      pose[2][2] >= POSE_SHOULDER_Z_MIN && pose[2][2] <= POSE_SHOULDER_Z_MAX &&
      scale >= POSE_SHOULDER_SCALE_MIN && scale <= POSE_SHOULDER_SCALE_MAX;
    if (!shouldersValid) return null;

    const posePointValid = (idx) => idx < poseMask.length && poseMask[idx] > 0 && idx < finite.length && finite[idx];

    if (posePointValid(0)) {
      const noseY = center[1] - pose[0][1];
      const noseZ = center[2] - pose[0][2];
      if (!(noseY >= POSE_SHOULDER_NOSE_Y_GAP_MIN && noseY <= POSE_SHOULDER_NOSE_Y_GAP_MAX &&
            noseZ >= POSE_SHOULDER_NOSE_Z_GAP_MIN && noseZ <= POSE_SHOULDER_NOSE_Z_GAP_MAX)) return null;
    }
    if (posePointValid(7) && posePointValid(8)) {
      const hipCenter = vecMul(vecAdd(pose[7], pose[8]), 0.5);
      const hipWidth = Math.hypot(pose[7][0] - pose[8][0], pose[7][1] - pose[8][1]);
      const hipY = hipCenter[1] - center[1];
      const hipZ = center[2] - hipCenter[2];
      const hipX = Math.abs(center[0] - hipCenter[0]);
      if (!(hipY >= POSE_SHOULDER_HIP_Y_GAP_MIN && hipY <= POSE_SHOULDER_HIP_Y_GAP_MAX &&
            hipZ >= POSE_SHOULDER_HIP_Z_GAP_MIN && hipZ <= POSE_SHOULDER_HIP_Z_GAP_MAX &&
            hipX <= 0.35)) return null;
      if (hipWidth > 1e-6) {
        const ratio = scale / hipWidth;
        if (!(ratio >= 0.75 && ratio <= 2.50)) return null;
      }
    }
    const poseWrists = [5, 6].filter(idx => posePointValid(idx)).map(idx => pose[idx]);
    if (poseWrists.length) {
      for (const [hand, handMask] of hands) {
        if (!hand.length || !handMask.length || handMask[0] <= 0 || !hand[0].every(isFiniteNumber)) continue;
        const d = Math.min(...poseWrists.map(w => Math.hypot(hand[0][0] - w[0], hand[0][1] - w[1])));
        if (d > 0.35) return null;
      }
    }
    return { center, scale };
  }

  function normalizationFromPose(pose, poseMask, hands) {
    if (pose.length) {
      const shoulder = shoulderNormalization(pose, poseMask, hands);
      if (shoulder) return shoulder;
    }
    const handFallback = handFallbackNormalization(hands);
    if (handFallback) return handFallback;

    const validMask = [];
    for (let i = 0; i < pose.length; i++) {
      validMask.push(poseMask[i] > 0 && pose[i].every(isFiniteNumber));
    }
    for (let i = 0; i < pose.length; i++) {
      if (validMask[i]) {
        validMask[i] = pose[i][0] >= POSE_FALLBACK_XY_MIN && pose[i][0] <= POSE_FALLBACK_XY_MAX &&
          pose[i][1] >= POSE_FALLBACK_XY_MIN && pose[i][1] <= POSE_FALLBACK_XY_MAX &&
          pose[i][2] >= POSE_FALLBACK_Z_MIN && pose[i][2] <= POSE_FALLBACK_Z_MAX;
      }
    }
    const valid = pose.filter((_, i) => validMask[i]);
    if (valid.length > 0) {
      const center = [median(valid.map(p => p[0])), median(valid.map(p => p[1])), median(valid.map(p => p[2]))];
      let scale;
      if (valid.length >= 3) {
        const low = [quantile(valid.map(p => p[0]), 0.10), quantile(valid.map(p => p[1]), 0.10)];
        const high = [quantile(valid.map(p => p[0]), 0.90), quantile(valid.map(p => p[1]), 0.90)];
        scale = Math.hypot(high[0] - low[0], high[1] - low[1]);
      } else {
        const xs = valid.map(p => p[0]), ys = valid.map(p => p[1]);
        scale = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      }
      scale = Math.max(POSE_FALLBACK_SCALE_MIN, Math.min(POSE_FALLBACK_SCALE_MAX, scale));
      return { center, scale };
    }
    return { center: [0, 0, 0], scale: 1.0 };
  }

  /* —— 单帧特征（对应 _landmark_feature） —— */
  function landmarkFeatureFromRow(row, fps, frameIdx, totalFrames) {
    const pose = landmarkArray(row.pose_landmarks || [], POSE_CORE_INDICES, {
      requiredInputCount: POSE_LANDMARK_COUNT,
    });
    const [left, right] = handLandmarkArrays(row);
    const face = landmarkArray(row.face_core_landmarks && row.face_core_landmarks.length ? row.face_core_landmarks : (row.face_landmarks || []), null, {
      expectedCount: FACE_CORE_INDICES.length,
      xyBounds: [LANDMARK_XY_VISIBLE_MIN, LANDMARK_XY_VISIBLE_MAX],
      zBounds: [LANDMARK_Z_VISIBLE_MIN, LANDMARK_Z_VISIBLE_MAX],
      zeroMissingEps: LANDMARK_ZERO_MISSING_EPS,
    });
    const norm = normalizationFromPose(pose.values, pose.mask, [[left.values, left.mask], [right.values, right.mask]]);

    const normArr = (arr) => arr.map(p => vecMul(vecSub(p, norm.center), 1 / norm.scale));

    const parts = [], masks = [], groups = {};
    appendGroup(parts, masks, groups, 'pose', normArr(pose.values).flat(), pose.mask);
    appendGroup(parts, masks, groups, 'left_hand', normArr(left.values).flat(), left.mask);
    appendGroup(parts, masks, groups, 'right_hand', normArr(right.values).flat(), right.mask);
    const leftShape = handShapeFeature(normArr(left.values), left.mask);
    const rightShape = handShapeFeature(normArr(right.values), right.mask);
    appendGroup(parts, masks, groups, 'left_hand_shape', leftShape.values, leftShape.mask);
    appendGroup(parts, masks, groups, 'right_hand_shape', rightShape.values, rightShape.mask);
    appendGroup(parts, masks, groups, 'face', normArr(face.values).flat(), face.mask);

    const timestampSec = row.timestamp_ms != null && row.timestamp_ms > 0 ? row.timestamp_ms / 1000 : (frameIdx / Math.max(fps, 1e-6));
    const frameWeight = f32(row.frame_weight, 1);
    return {
      frameIdx,
      timestampSec,
      vector: parts.flat(),
      mask: masks.flat(),
      groups,
      presence: {
        pose: pose.mask.some(v => v > 0),
        left_hand: left.mask.some(v => v > 0),
        right_hand: right.mask.some(v => v > 0),
        face: face.mask.some(v => v > 0),
      },
      frameWeight,
      semanticPhase: 0,
    };
  }

  /** 从 landmark_rows 构建序列（对应 load_sequence landmark 模式） */
  function sequenceFromRows(rows, fps, totalFrames) {
    const features = rows.map((row, idx) => landmarkFeatureFromRow(row, fps, idx, totalFrames));
    features.sort((a, b) => a.frameIdx - b.frameIdx);
    return { source: 'browser_web_holistic', mode: 'landmark', fps: fps || DEFAULT_FPS, totalFrames: totalFrames || features.length, features };
  }

  /* ================= 动态特征（motion 组 + 语义帧权重 + phase） ================= */
  function groupSlice(feature, group) {
    const g = feature.groups[group];
    if (!g) return null;
    const [start, end] = g;
    return { values: feature.vector.slice(start, end), mask: feature.mask.slice(start, end) };
  }

  /** 2x2 SVD（对应 numpy.linalg.svd 的 h = U @ diag(S) @ Vt 约定） */
  function svd2x2(h) {
    const a = h[0][0], b = h[0][1], c = h[1][0], d = h[1][1];
    const E = (a + d) / 2, F = (a - d) / 2, G = (c + b) / 2, H = (c - b) / 2;
    const Q = Math.hypot(E, H), R = Math.hypot(F, G);
    const sx = Q + R, sy = Q - R;
    const a1 = Math.atan2(G, F);
    const a2 = Math.atan2(H, E);
    const theta = (a2 - a1) / 2, phi = (a2 + a1) / 2;
    const U = [[Math.cos(phi), -Math.sin(phi)], [Math.sin(phi), Math.cos(phi)]];
    const V = [[Math.cos(theta), -Math.sin(theta)], [Math.sin(theta), Math.cos(theta)]];
    return { U, S: [sx, sy], V };
  }

  /** 对应 _similarity_aligned_xy_rmse：2D 相似变换对齐后的加权 RMSE（解析 Procrustes，无 SVD） */
  function similarityAlignedXyRmse(aPts, bPts, pointWeights) {
    if (aPts.length !== bPts.length || aPts.length < 3) return Infinity;
    let weights = pointWeights.map(w => (isFiniteNumber(w) ? Math.max(0, w) : 0));
    let wsum = weights.reduce((s, v) => s + v, 0);
    if (wsum <= 1e-8) weights = aPts.map(() => 1);
    wsum = weights.reduce((s, v) => s + v, 0);
    const inv = 1 / Math.max(wsum, 1e-8);
    weights = weights.map(w => w * inv);
    const aCenter = [0, 0], bCenter = [0, 0];
    for (let i = 0; i < aPts.length; i++) {
      aCenter[0] += weights[i] * aPts[i][0]; aCenter[1] += weights[i] * aPts[i][1];
      bCenter[0] += weights[i] * bPts[i][0]; bCenter[1] += weights[i] * bPts[i][1];
    }
    // 加权去中心后，最优旋转 θ = atan2(S, C)，scale = sqrt(C²+S²)/denom（Umeyama 解析解）
    let C = 0, S = 0, denom = 0;
    for (let i = 0; i < aPts.length; i++) {
      const a0x = aPts[i][0] - aCenter[0], a0y = aPts[i][1] - aCenter[1];
      const b0x = bPts[i][0] - bCenter[0], b0y = bPts[i][1] - bCenter[1];
      C += weights[i] * (a0x * b0x + a0y * b0y);
      S += weights[i] * (a0x * b0y - a0y * b0x);
      denom += weights[i] * (b0x * b0x + b0y * b0y);
    }
    if (denom <= 1e-8) return Infinity;
    const theta = Math.atan2(S, C);
    const scale = Math.max(0.70, Math.min(1.45, Math.sqrt(C * C + S * S) / denom));
    const cos = Math.cos(theta), sin = Math.sin(theta);
    let sq = 0;
    for (let i = 0; i < aPts.length; i++) {
      const b0x = bPts[i][0] - bCenter[0], b0y = bPts[i][1] - bCenter[1];
      const rx = cos * b0x - sin * b0y, ry = sin * b0x + cos * b0y;
      const alx = scale * rx + aCenter[0];
      const aly = scale * ry + aCenter[1];
      const dx = aPts[i][0] - alx, dy = aPts[i][1] - aly;
      sq += weights[i] * (dx * dx + dy * dy);
    }
    return Math.sqrt(sq);
  }

  /** 对应 _pose_robust_hand_distance：wrist-relative 手部距离 + 相似对齐距离 */
  function poseRobustHandDistance(av, bv, am, bm, fullDimWeights, rawDist, profile) {
    if (av.length % 3 !== 0 || av.length !== bv.length) return rawDist;
    const cfg = semanticDtwConfig(profile);
    if (!cfg.pose_robust_hand_position) return rawDist;
    const nPts = av.length / 3;
    const aPts = [], bPts = [], aMask = [], bMask = [], wPts = [];
    for (let i = 0; i < nPts; i++) {
      aPts.push([av[i * 3], av[i * 3 + 1], av[i * 3 + 2]]);
      bPts.push([bv[i * 3], bv[i * 3 + 1], bv[i * 3 + 2]]);
      aMask.push((am[i * 3] + am[i * 3 + 1] + am[i * 3 + 2]) / 3 > 0.5);
      bMask.push((bm[i * 3] + bm[i * 3 + 1] + bm[i * 3 + 2]) / 3 > 0.5);
      wPts.push([fullDimWeights[i * 3], fullDimWeights[i * 3 + 1], fullDimWeights[i * 3 + 2]]);
    }
    const both = aMask.map((v, i) => v && bMask[i]);
    const bothCount = both.filter(Boolean).length;
    if (bothCount < 2) return rawDist;
    let aAnchor, bAnchor;
    if (both[0]) {
      aAnchor = aPts[0]; bAnchor = bPts[0];
    } else {
      aAnchor = [0, 0, 0]; bAnchor = [0, 0, 0];
      for (let i = 0; i < nPts; i++) {
        if (!both[i]) continue;
        aAnchor[0] += aPts[i][0]; aAnchor[1] += aPts[i][1]; aAnchor[2] += aPts[i][2];
        bAnchor[0] += bPts[i][0]; bAnchor[1] += bPts[i][1]; bAnchor[2] += bPts[i][2];
      }
      aAnchor = aAnchor.map(v => v / bothCount);
      bAnchor = bAnchor.map(v => v / bothCount);
    }
    // local（anchor 相对坐标）
    const aLocal = aPts.map(p => [p[0] - aAnchor[0], p[1] - aAnchor[1], p[2] - aAnchor[2]]);
    const bLocal = bPts.map(p => [p[0] - bAnchor[0], p[1] - bAnchor[1], p[2] - bAnchor[2]]);
    const aFlat = [], bFlat = [], wFlat = [];
    const aBothPts = [], bBothPts = [], pointWeights = [];
    for (let i = 0; i < nPts; i++) {
      if (!both[i]) continue;
      for (let k = 0; k < 3; k++) {
        aFlat.push(aLocal[i][k]); bFlat.push(bLocal[i][k]); wFlat.push(wPts[i][k]);
      }
      aBothPts.push(aPts[i]); bBothPts.push(bPts[i]);
      pointWeights.push((wPts[i][0] + wPts[i][1]) / 2);
    }
    const localDist = weightedRmse(aFlat, bFlat, wFlat);
    const alignedXyDist = similarityAlignedXyRmse(aBothPts, bBothPts, pointWeights);
    const globalAnchorDist = Math.hypot(aAnchor[0] - bAnchor[0], aAnchor[1] - bAnchor[1], aAnchor[2] - bAnchor[2]);
    const globalWeight = cfg.hand_global_position_weight;
    const orientationDist = isFiniteNumber(alignedXyDist) ? alignedXyDist + globalWeight * globalAnchorDist : Infinity;
    const robustDist = Math.min(localDist + globalWeight * globalAnchorDist, orientationDist);
    return Math.min(rawDist, robustDist);
  }

  function groupDistanceBetween(a, b, aGroup, bGroup, profile) {
    if (!a.groups[aGroup] || !b.groups[bGroup]) return [0, 0];
    const ga = groupSlice(a, aGroup), gb = groupSlice(b, bGroup);
    const dim = Math.min(ga.values.length, gb.values.length);
    if (dim === 0 || ga.values.length !== gb.values.length) return [0, 1];
    // 对应 Python _group_distance_between：visible = mask>0；
    // missing = mismatch/either（双方都不可见不计入分母，全不可见时 0）
    let eitherSum = 0, mismatchSum = 0;
    const bothIdx = [];
    for (let i = 0; i < dim; i++) {
      const av = ga.mask[i] > 0, bv = gb.mask[i] > 0;
      if (av && bv) bothIdx.push(i);
      if (av || bv) eitherSum++;
      if (av !== bv) mismatchSum++;
    }
    let dist = 0;
    if (bothIdx.length > 0) {
      const fullDimWeights = dimensionWeights(aGroup, dim, profile);
      const left = bothIdx.map(i => ga.values[i]);
      const right = bothIdx.map(i => gb.values[i]);
      const w = bothIdx.map(i => fullDimWeights[i]);
      const cap = HAND_SHAPE_GROUPS.includes(aGroup) ? 0.35 : undefined;
      const rawDist = weightedRmse(left, right, w, cap);
      let d = rawDist;
      // 对应 _pose_robust_hand_distance：wrist-relative + 相似对齐的鲁棒手部距离
      if (aGroup === 'left_hand' || aGroup === 'right_hand') {
        d = Math.min(d, poseRobustHandDistance(ga.values, gb.values, ga.mask, gb.mask, fullDimWeights, rawDist, profile));
      }
      // 对应 scale 修正：alpha 缩放 + log 惩罚（在 pose_robust 之后，min 基于 d）
      if (aGroup === 'left_hand' || aGroup === 'right_hand' || aGroup === 'pose') {
        let denom = 0;
        for (let i = 0; i < right.length; i++) denom += w[i] * right[i] * right[i];
        if (denom > 1e-8) {
          let num = 0;
          for (let i = 0; i < left.length; i++) num += w[i] * left[i] * right[i];
          const alpha = Math.max(0.70, Math.min(1.45, num / denom));
          const scaledDist = weightedRmse(left, right.map(v => alpha * v), w);
          const scalePenalty = 0.004 * Math.abs(Math.log(Math.max(alpha, 1e-6)));
          d = Math.min(d, scaledDist + scalePenalty);
        }
      }
      dist = d;
    }
    const missingPenalty = eitherSum > 0 ? mismatchSum / eitherSum : 0;
    return [dist, missingPenalty];
  }

  function groupDistance(a, b, group, profile) {
    return groupDistanceBetween(a, b, group, group, profile);
  }

  function profileGroupWeights(profile, groups) {
    const raw = profile ? profile.group_weights : GROUP_WEIGHTS;
    const missing = Math.max(0, Math.min(f32(raw.missing, GROUP_WEIGHTS.missing), 0.35));
    const present = groups.filter(g => g !== 'missing');
    if (!present.length) return { missing };
    const sd = (profile && profile.semantic_dtw) ? profile.semantic_dtw : {};
    const relativeMotionWeight = Math.max(0, Math.min(f32(sd.relative_motion_weight, 0.28), 1.0));
    const twoHandRelationWeight = Math.max(0, Math.min(f32(sd.two_hand_relation_weight, 0.22), 1.0));
    const rawGroupWeight = (group) => {
      if (raw[group] !== undefined) return Math.max(0, f32(raw[group], 0));
      if (group.endsWith('_motion')) {
        const base = group.slice(0, -'_motion'.length);
        if (raw[base] !== undefined) return relativeMotionWeight * Math.max(0, f32(raw[base], 0));
      }
      if (group === 'two_hand_relation') {
        const left = Math.max(0, f32(raw.left_hand, 0)) + Math.max(0, f32(raw.left_hand_shape, 0));
        const right = Math.max(0, f32(raw.right_hand, 0)) + Math.max(0, f32(raw.right_hand_shape, 0));
        return twoHandRelationWeight * Math.min(left, right);
      }
      return 0;
    };
    let total = 0;
    for (const g of present) total += rawGroupWeight(g);
    if (total <= 1e-8) {
      // 回退到默认均衡权重
      const fallback = { ...GROUP_WEIGHTS };
      const out = {};
      const ftotal = present.reduce((s, g) => s + (fallback[g] !== undefined ? fallback[g] : 0), 0);
      if (ftotal <= 1e-8) return {};
      const fscale = (1 - missing) / ftotal;
      for (const g of present) out[g] = (fallback[g] !== undefined ? fallback[g] : 0) * fscale;
      out.missing = missing;
      return out;
    }
    const scale = (1 - missing) / total;
    const weights = {};
    for (const g of present) weights[g] = rawGroupWeight(g) * scale;
    weights.missing = missing;
    return weights;
  }

  function groupMissingDistanceWeight(profile, group) {
    // 对应 Python _group_missing_distance_weight：从 semantic_dtw 读配置，
    // focus 组取 max(base, focus)，two_hand_relation 用 relation，pose/face 用 min(base, 0.06)
    const sd = (profile && profile.semantic_dtw) ? profile.semantic_dtw : {};
    const base = Math.max(0, Math.min(f32(sd.group_missing_distance_weight, 0.0), 0.60));
    const focus = Math.max(0, Math.min(f32(sd.focus_missing_distance_weight, 0.0), 0.75));
    const relation = Math.max(0, Math.min(f32(sd.relation_missing_distance_weight, 0.0), 1.00));
    if (group === 'two_hand_relation') return relation;
    if (group === 'two_hand_relation_motion') return 0.5 * relation;
    const required = (sd.required_presence_groups || []).map(String);
    const focusGroups = (profile && profile.focus_groups) || [];
    if (required.includes(group) || focusGroups.includes(group)) return Math.max(base, focus);
    if (group.endsWith('_motion')) return 0.65 * base;
    if (group === 'pose' || group === 'face') return Math.min(base, 0.06);
    return base;
  }

  /** 维度权重（对应 _dimension_weights，keypoint_weights + 手指 alias） */
  function dimensionWeights(group, size, profile) {
    const weights = new Array(size).fill(1);
    if (!profile) return weights;
    if (group === 'two_hand_relation' && size === 8) {
      if (profile.word === '跳') return [0.90, 2.25, 0.75, 1.45, 0.65, 1.55, 1.25, 0.85];
      return [1.00, 1.35, 0.85, 1.10, 0.80, 1.10, 1.05, 0.90];
    }
    const spec = {};
    if (group.startsWith('left_hand')) {
      Object.assign(spec, profile.keypoint_weights?.left_hand || {});
      Object.assign(spec, profile.keypoint_weights?.hand || {});
    } else if (group.startsWith('right_hand')) {
      Object.assign(spec, profile.keypoint_weights?.right_hand || {});
      Object.assign(spec, profile.keypoint_weights?.hand || {});
    } else if (group === 'pose') {
      Object.assign(spec, profile.keypoint_weights?.pose || {});
    } else if (group === 'face') {
      Object.assign(spec, profile.keypoint_weights?.face || {});
    }
    if (!Object.keys(spec).length) return weights;
    if (group === 'left_hand' || group === 'right_hand') {
      for (const [rawIdx, rawWeight] of Object.entries(spec)) {
        const idx = parseInt(rawIdx, 10);
        const value = Math.max(0, Number(rawWeight) || 0);
        if (Number.isInteger(idx) && idx >= 0) {
          const start = idx * 3;
          if (start >= 0 && start < size) for (let k = start; k < Math.min(start + 3, size); k++) weights[k] *= value;
        }
      }
    } else if (group === 'left_hand_shape' || group === 'right_hand_shape') {
      const shapeAlias = {
        thumb: [0, 5, 10, 15], index: [1, 6, 11, 16], middle: [2, 7, 12, 17],
        ring: [3, 8, 13, 18], pinky: [4, 9, 14, 19],
        spread: [5, 6, 7, 8, 9], opening: [5, 6, 7, 8, 9, 15, 16, 17, 18, 19],
      };
      const lmAlias = { 4: shapeAlias.thumb, 8: shapeAlias.index, 12: shapeAlias.middle, 16: shapeAlias.ring, 20: shapeAlias.pinky, 1: shapeAlias.thumb, 5: shapeAlias.index, 9: shapeAlias.middle, 13: shapeAlias.ring, 17: shapeAlias.pinky };
      for (const [rawKey, rawWeight] of Object.entries(spec)) {
        const value = Math.max(0, Number(rawWeight) || 0);
        const key = String(rawKey);
        let indices;
        if (lmAlias[key]) indices = lmAlias[key];
        else if (/^\d+$/.test(key)) indices = [parseInt(key, 10)];
        else indices = shapeAlias[key] || [];
        for (const idx of indices) if (idx >= 0 && idx < size) weights[idx] *= value;
      }
    }
    return weights;
  }

  function weightedRmse(left, right, weights, cap) {
    let denom = 0;
    const diffs = [];
    for (let i = 0; i < left.length; i++) {
      const w = isFiniteNumber(weights[i]) ? weights[i] : 0;
      denom += w;
      let d = left[i] - right[i];
      if (cap && cap > 0) d = Math.max(-cap, Math.min(cap, d));
      diffs.push(w * d * d);
    }
    if (denom <= 1e-8) return 0;
    return Math.sqrt(diffs.reduce((s, v) => s + v, 0) / denom);
  }

  /** 相邻帧组间运动（对应 _adjacent_group_motion：维度加权 RMSE） */
  function adjacentGroupMotion(prev, curr, group, profile) {
    const gp = groupSlice(prev, group), gc = groupSlice(curr, group);
    if (!gp || !gc) return 0;
    const dim = Math.min(gp.values.length, gc.values.length);
    const both = [];
    for (let i = 0; i < dim; i++) if (gp.mask[i] > 0 && gc.mask[i] > 0) both.push(i);
    if (!both.length) return 0;
    const dimWeights = dimensionWeights(group, dim, profile);
    const left = both.map(i => gp.values[i]);
    const right = both.map(i => gc.values[i]);
    const w = both.map(i => dimWeights[i]);
    return weightedRmse(left, right, w);
  }

  function sequenceWithRelativeMotionFeatures(seq, profile) {
    const config = semanticDtwConfig(profile);
    const features = seq.features.map(f => cloneFeature(f));
    if (features.length < 1) return { ...seq, features };
    const motionEnabled = config.relative_motion_enabled;
    const baseGroups = ['left_hand', 'right_hand', 'left_hand_shape', 'right_hand_shape'];
    let prevRelation = null;
    for (let idx = 0; idx < features.length; idx++) {
      const f = features[idx];
      const prev = idx > 0 ? features[idx - 1] : null;
      if (motionEnabled) {
        for (const group of baseGroups) {
          if (!f.groups[group]) continue;
          const g = f.groups[group];
          const dim = g[1] - g[0];
          let mvec, mmask;
          if (prev && prev.groups[group]) {
            const pg = prev.groups[group];
            if (pg[1] - pg[0] === dim) {
              mvec = new Array(dim).fill(0);
              mmask = new Array(dim).fill(0);
              for (let k = 0; k < dim; k++) {
                const v = f.vector[g[0] + k] - prev.vector[pg[0] + k];
                const m = f.mask[g[0] + k] > 0 && prev.mask[pg[0] + k] > 0 ? 1 : 0;
                mvec[k] = v * m;
                mmask[k] = m;
              }
            } else {
              mvec = new Array(dim).fill(0);
              mmask = new Array(dim).fill(0);
            }
          } else {
            mvec = new Array(dim).fill(0);
            mmask = new Array(dim).fill(0);
          }
          // 方向性 motion 归一化
          const validCount = mmask.filter(x => x > 0).length;
          if (validCount > 0) {
            let norm = 0;
            for (let k = 0; k < dim; k++) if (mmask[k] > 0) norm += mvec[k] * mvec[k];
            norm = Math.sqrt(norm / validCount);
            if (norm > 1e-8) for (let k = 0; k < dim; k++) if (mmask[k] > 0) mvec[k] /= norm;
          }
          const name = group + '_motion';
          const gstart = f.vector.length;
          f.vector = f.vector.concat(mvec);
          f.mask = f.mask.concat(mmask);
          f.groups[name] = [gstart, f.vector.length];
        }
      }
      // two_hand_relation（总是生成）
      const rel = twoHandRelationFeature(f);
      const gstart = f.vector.length;
      f.vector = f.vector.concat(rel.values);
      f.mask = f.mask.concat(rel.mask);
      f.groups.two_hand_relation = [gstart, f.vector.length];
      if (motionEnabled) {
        const relValid = rel.mask.reduce((s, v) => s + v, 0) / rel.mask.length > 0.5;
        let rmVec, rmMask;
        if (prevRelation !== null && prevRelation.valid && relValid) {
          rmVec = [rel.values[0] - prevRelation.values[0], rel.values[1] - prevRelation.values[1], rel.values[2] - prevRelation.values[2]];
          rmMask = [1, 1, 1];
          const validCount = 3;
          let norm = 0;
          for (let k = 0; k < 3; k++) norm += rmVec[k] * rmVec[k];
          norm = Math.sqrt(norm / validCount);
          if (norm > 1e-8) for (let k = 0; k < 3; k++) rmVec[k] /= norm;
        } else {
          rmVec = [0, 0, 0];
          rmMask = [0, 0, 0];
        }
        const gs = f.vector.length;
        f.vector = f.vector.concat(rmVec);
        f.mask = f.mask.concat(rmMask);
        f.groups.two_hand_relation_motion = [gs, f.vector.length];
        prevRelation = { values: rel.values, valid: relValid };
      }
    }
    return { ...seq, features };
  }

  function cloneFeature(f) {
    return {
      frameIdx: f.frameIdx,
      timestampSec: f.timestampSec,
      vector: f.vector.slice(),
      mask: f.mask.slice(),
      groups: Object.fromEntries(Object.entries(f.groups).map(([k, v]) => [k, v.slice()])),
      presence: { ...f.presence },
      frameWeight: f.frameWeight,
      semanticPhase: f.semanticPhase || 0,
    };
  }

  function sequenceGroups(seq) {
    return seq.features.length ? Object.keys(seq.features[0].groups) : [];
  }

  /** semantic_dtw 配置（对应 _semantic_dtw_config，仅取 JS 需要的字段） */
  function semanticDtwConfig(profile) {
    const raw = (profile && profile.semantic_dtw) ? profile.semantic_dtw : {};
    let anchors = raw.anchor_phases || [0.10, 0.50, 0.90];
    if (!Array.isArray(anchors)) anchors = [0.10, 0.50, 0.90];
    const cleanAnchors = anchors.map(v => Math.max(0, Math.min(1, f32(v, 0)))).filter(v => v >= 0);
    return {
      enabled: raw.enabled !== false,
      local_phase_weight: f32(raw.local_phase_weight, 0.018),
      relative_motion_enabled: raw.relative_motion_enabled !== false,
      two_hand_relation_weight: f32(raw.two_hand_relation_weight, 0.22),
      relative_motion_weight: f32(raw.relative_motion_weight, 0.28),
      anchor_penalty_weight: Math.max(0, Math.min(f32(raw.anchor_penalty_weight, 0.10), 0.25)),
      anchor_phases: cleanAnchors.length ? cleanAnchors : [0.10, 0.50, 0.90],
      pose_robust_hand_position: raw.pose_robust_hand_position !== false,
      hand_global_position_weight: Math.max(0, Math.min(f32(raw.hand_global_position_weight, 0.25), 1.0)),
      visible_core_tolerance_cap: Math.max(0, Math.min(f32(raw.visible_core_tolerance_cap, 0.034), 0.080)),
      core_visible_dtw_threshold: Math.max(0, Math.min(f32(raw.core_visible_dtw_threshold, 0.045), 0.120)),
      core_visible_presence_threshold: Math.max(0, Math.min(f32(raw.core_visible_presence_threshold, 0.65), 1.0)),
      core_visible_score_scale: Math.max(SCORE_SCALE, Math.min(f32(raw.core_visible_score_scale, SCORE_SCALE), 0.180)),
      core_visible_max_normalized_distance: Math.max(0, Math.min(f32(raw.core_visible_max_normalized_distance, 0.080), 0.180)),
      flower_opening_guard_enabled: raw.flower_opening_guard_enabled === true,
      flower_opening_min_score: Math.max(0, Math.min(f32(raw.flower_opening_min_score, 0.30), 1.0)),
    };
  }

  /** 8 维双手相对关系特征（对应 _two_hand_relation_feature） */
  function twoHandRelationFeature(feature) {
    const relation = new Array(8).fill(0);
    const relationMask = new Array(8).fill(0);
    if (!feature.groups.left_hand || !feature.groups.right_hand) return { values: relation, mask: relationMask };
    const ls = feature.groups.left_hand, rs = feature.groups.right_hand;
    const lv = feature.vector.slice(ls[0], ls[1]);
    const rv = feature.vector.slice(rs[0], rs[1]);
    const lm = feature.mask.slice(ls[0], ls[1]);
    const rm = feature.mask.slice(rs[0], rs[1]);
    if (lv.length < 63 || rv.length < 63 || lv.length % 3 || rv.length % 3) return { values: relation, mask: relationMask };
    const toPts = (arr) => { const out = []; for (let i = 0; i < arr.length; i += 3) out.push([arr[i], arr[i + 1], arr[i + 2]]); return out; };
    const toMask = (arr) => { const out = []; for (let i = 0; i < arr.length; i += 3) out.push((arr[i] > 0 && arr[i + 1] > 0 && arr[i + 2] > 0) ? 1 : 0); return out; };
    const left = toPts(lv), right = toPts(rv);
    const leftMask = toMask(lm), rightMask = toMask(rm);
    const leftGroundIdx = [0, 5, 9, 13, 17];
    const rightTipIdx = [8, 12], rightBaseIdx = [5, 9];
    if (!leftGroundIdx.every(i => leftMask[i] > 0)) return { values: relation, mask: relationMask };
    if (![...rightTipIdx, ...rightBaseIdx].every(i => rightMask[i] > 0)) return { values: relation, mask: relationMask };
    const mean2 = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const leftGround = mean2(leftGroundIdx.map(i => left[i]));
    const rightTips = mean2(rightTipIdx.map(i => right[i]));
    const rightBases = mean2(rightBaseIdx.map(i => right[i]));
    const tipRel = [rightTips[0] - leftGround[0], rightTips[1] - leftGround[1]];
    const baseRel = [rightBases[0] - leftGround[0], rightBases[1] - leftGround[1]];
    const fingerAxis = [rightTips[0] - rightBases[0], rightTips[1] - rightBases[1]];
    const rel = [
      tipRel[0], tipRel[1], baseRel[0], baseRel[1],
      fingerAxis[0], fingerAxis[1],
      Math.hypot(tipRel[0], tipRel[1]), Math.hypot(baseRel[0], baseRel[1]),
    ];
    return { values: rel, mask: new Array(8).fill(1) };
  }

  function normalizeFrameWeights(values, low, high) {
    if (!values.length) return values;
    const clean = values.map(v => (isFiniteNumber(v) ? v : 1.0)).map(v => Math.max(v, 0.05));
    const mean = clean.reduce((s, v) => s + v, 0) / clean.length;
    if (mean <= 1e-8) return clean.map(() => 1);
    let out = clean.map(v => Math.max(low, Math.min(high, v / mean)));
    const m2 = out.reduce((s, v) => s + v, 0) / out.length;
    if (m2 > 1e-8) out = out.map(v => v / m2);
    return out;
  }

  function semanticPhaseFromWeights(values) {
    // 对应 Python _semantic_phase_from_weights：基线扣除 + 中点累计 + 首尾约束
    const n = values.length;
    if (n === 0) return [];
    if (n === 1) return [0];
    const clean = values.map(v => (isFiniteNumber(v) ? v : 1.0)).map(v => Math.max(v, 0.05));
    const baseline = quantile(clean, 0.20);
    const energy = clean.map(v => Math.max(v - baseline, 0));
    const totalEnergy = energy.reduce((s, v) => s + v, 0);
    if (totalEnergy <= 1e-8) {
      return clean.map((_, i) => i / (n - 1));
    }
    const out = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += energy[i];
      out.push(Math.max(0, Math.min(1, (acc - 0.5 * energy[i]) / totalEnergy)));
    }
    out[0] = Math.min(out[0], 0.02);
    out[n - 1] = Math.max(out[n - 1], 0.98);
    return out;
  }

  function computeSemanticFrameWeightValues(seq, profile, combineStored) {
    const n = seq.features.length;
    if (n === 0) return [];
    const groupsInSeq = sequenceGroups(seq);
    let focusGroups = (profile && profile.focus_groups) ? profile.focus_groups.filter(g => groupsInSeq.includes(g)) : [];
    if (!focusGroups.length) {
      const raw = profileGroupWeights(profile, groupsInSeq);
      focusGroups = groupsInSeq.filter(g => (raw[g] || 0) > 0);
    }
    let dynamic;
    if (!focusGroups.length) {
      dynamic = new Array(n).fill(1);
    } else {
      const groupWeights = profileGroupWeights(profile, focusGroups);
      const energy = new Array(n).fill(0);
      for (let idx = 1; idx < n; idx++) {
        const prev = seq.features[idx - 1], curr = seq.features[idx];
        let weightedMotion = 0, weightSum = 0;
        for (const group of focusGroups) {
          const gw = groupWeights[group] || 0;
          if (gw <= 0) continue;
          weightedMotion += gw * adjacentGroupMotion(prev, curr, group, profile);
          weightSum += gw;
        }
        const edgeEnergy = weightSum > 1e-8 ? weightedMotion / weightSum : 0;
        energy[idx - 1] += 0.5 * edgeEnergy;
        energy[idx] += 0.5 * edgeEnergy;
      }
      if (n >= 3) {
        const smooth = energy.slice();
        for (let i = 1; i < n - 1; i++) smooth[i] = 0.25 * energy[i - 1] + 0.5 * energy[i] + 0.25 * energy[i + 1];
        smooth[0] = 0.75 * energy[0] + 0.25 * energy[1];
        smooth[n - 1] = 0.75 * energy[n - 1] + 0.25 * energy[n - 2];
        for (let i = 0; i < n; i++) energy[i] = smooth[i];
      }
      const positive = energy.filter(v => v > 1e-8);
      if (!positive.length) {
        dynamic = new Array(n).fill(1);
      } else {
        const floor = (positive.reduce((s, v) => s + v, 0) / positive.length) * 0.20;
        dynamic = normalizeFrameWeights(energy.map(v => v + floor), 0.45, 2.75);
      }
    }
    if (!combineStored) return dynamic;
    const stored = normalizeFrameWeights(seq.features.map(f => Math.max(f32(f.frameWeight, 1), 0.05)), 0.35, 3.0);
    const combined = dynamic.map((v, i) => Math.sqrt(Math.max(v, 0.05) * Math.max(stored[i], 0.05)));
    return normalizeFrameWeights(combined, 0.40, 2.85);
  }

  function withDynamicFrameWeights(seq, profile) {
    const working = sequenceWithRelativeMotionFeatures(seq, profile);
    const values = computeSemanticFrameWeightValues(working, profile, true);
    const phases = semanticPhaseFromWeights(values);
    const features = working.features.map((f, idx) => {
      const item = cloneFeature(f);
      item.frameWeight = values[idx];
      item.semanticPhase = idx < phases.length ? phases[idx] : 0;
      return item;
    });
    return { ...working, features };
  }

  /* ================= 距离 ================= */
  function pairTemporalWeight(standardFrame, queryFrame) {
    const sw = Math.max(0.20, Math.min(3.50, f32(standardFrame.frameWeight, 1)));
    const qw = Math.max(0.20, Math.min(3.50, f32(queryFrame.frameWeight, 1)));
    return 0.70 * sw + 0.30 * qw;
  }

  function frameDistance(a, b, profile) {
    const groupMetrics = {};
    let weighted = 0, missing = 0;
    const groups = [];
    const candidates = ['left_hand', 'right_hand', 'left_hand_shape', 'right_hand_shape',
      'left_hand_motion', 'right_hand_motion', 'left_hand_shape_motion', 'right_hand_shape_motion',
      'two_hand_relation', 'two_hand_relation_motion', 'pose', 'face'];
    for (const g of candidates) {
      if (a.groups[g] && b.groups[g]) groups.push(g);
    }
    const weights = profileGroupWeights(profile, groups);
    const handLike = [...HAND_GROUPS, ...RELATIVE_MOTION_GROUPS];
    const handGroups = groups.filter(g => handLike.includes(g));
    const nonHandGroups = groups.filter(g => !handLike.includes(g));

    const directHand = {};
    for (const group of handGroups) directHand[group] = groupDistance(a, b, group, profile);
    const swappedHand = {};
    if (profile && profile.allow_hand_swap) {
      const swapPairs = {
        left_hand: ['left_hand', 'right_hand'], right_hand: ['right_hand', 'left_hand'],
        left_hand_shape: ['left_hand_shape', 'right_hand_shape'], right_hand_shape: ['right_hand_shape', 'left_hand_shape'],
        left_hand_motion: ['left_hand_motion', 'right_hand_motion'], right_hand_motion: ['right_hand_motion', 'left_hand_motion'],
        left_hand_shape_motion: ['left_hand_shape_motion', 'right_hand_shape_motion'], right_hand_shape_motion: ['right_hand_shape_motion', 'left_hand_shape_motion'],
      };
      for (const group of handGroups) {
        const pair = swapPairs[group];
        if (pair && a.groups[pair[0]] && b.groups[pair[1]]) {
          swappedHand[group] = groupDistanceBetween(a, b, pair[0], pair[1], profile);
        }
      }
    }
    const contributionDistance = (group, dist, miss) => dist + groupMissingDistanceWeight(profile, group) * miss;
    const sumW = (obj) => Object.keys(obj).reduce((s, g) => s + (weights[g] || 0) * contributionDistance(g, obj[g][0], obj[g][1]), 0);
    const directWeighted = sumW(directHand);
    const swappedWeighted = Object.keys(handGroups).length
      ? handGroups.reduce((s, g) => s + (weights[g] || 0) * contributionDistance(g, (swappedHand[g] || directHand[g] || [0, 0])[0], (swappedHand[g] || directHand[g] || [0, 0])[1]), 0)
      : 0;
    const useSwapped = Object.keys(swappedHand).length > 0 && swappedWeighted < directWeighted - 1e-6;
    const selectedHand = useSwapped ? swappedHand : directHand;

    let missingWeighted = 0, missingWeightSum = 0;
    for (const group of handGroups) {
      const pair = selectedHand[group] || directHand[group] || [0, 0];
      const dist = pair[0], miss = pair[1];
      const missingDistance = groupMissingDistanceWeight(profile, group) * miss;
      groupMetrics[group] = dist;
      groupMetrics[group + '_missing_penalty'] = miss;
      groupMetrics[group + '_missing_distance'] = missingDistance;
      const gw = weights[group] || 0;
      weighted += gw * (dist + missingDistance);
      missingWeighted += gw * miss;
      missingWeightSum += gw;
    }
    groupMetrics.hand_side_swapped = useSwapped ? 1 : 0;
    for (const group of nonHandGroups) {
      const pair = groupDistance(a, b, group, profile);
      const dist = pair[0], miss = pair[1];
      const missingDistance = groupMissingDistanceWeight(profile, group) * miss;
      groupMetrics[group] = dist;
      groupMetrics[group + '_missing_penalty'] = miss;
      groupMetrics[group + '_missing_distance'] = missingDistance;
      const gw = weights[group] || 0;
      weighted += gw * (dist + missingDistance);
      missingWeighted += gw * miss;
      missingWeightSum += gw;
    }
    missing = missingWeightSum > 1e-6 ? missingWeighted / missingWeightSum : 0;
    weighted += (weights.missing !== undefined ? weights.missing : (GROUP_WEIGHTS.missing !== undefined ? GROUP_WEIGHTS.missing : 0.06)) * missing;
    groupMetrics.missing = missing;
    groupMetrics.weighted = weighted;
    return [weighted, groupMetrics];
  }

  /* ================= 距离（快速路径） =================
   * 局部距离矩阵是 dtwAlign 的主要瓶颈（6 模板 × 40×40 帧对 × 406 维）。
   * 快速路径在不改变任何数值的前提下加速：
   * 1) 组权重/缺失权重/维度权重只预计算一次（原实现逐帧对重复计算）；
   * 2) 特征向量/掩码直接以组偏移访问，避免 groupSlice 逐对复制数组；
   * 3) 加权 RMSE 单遍批量累加（Float64Array），避免逐维度二次访问；
   * 4) poseRobustHandDistance 零分配化（复用 scratch，逐点偏移访问）。
   * 所有循环的累加顺序与原始实现逐条保持一致，结果浮点位一致。
   */
  const DISTANCE_CANDIDATES = ['left_hand', 'right_hand', 'left_hand_shape', 'right_hand_shape',
    'left_hand_motion', 'right_hand_motion', 'left_hand_shape_motion', 'right_hand_shape_motion',
    'two_hand_relation', 'two_hand_relation_motion', 'pose', 'face'];
  const HAND_LIKE_GROUPS = [...HAND_GROUPS, ...RELATIVE_MOTION_GROUPS];
  const HAND_SWAP_PAIRS = {
    left_hand: ['left_hand', 'right_hand'], right_hand: ['right_hand', 'left_hand'],
    left_hand_shape: ['left_hand_shape', 'right_hand_shape'], right_hand_shape: ['right_hand_shape', 'left_hand_shape'],
    left_hand_motion: ['left_hand_motion', 'right_hand_motion'], right_hand_motion: ['right_hand_motion', 'left_hand_motion'],
    left_hand_shape_motion: ['left_hand_shape_motion', 'right_hand_shape_motion'], right_hand_shape_motion: ['right_hand_shape_motion', 'left_hand_shape_motion'],
  };

  /** 检查序列所有帧的组结构（组名与 [start,end] 偏移）完全一致，
   *  一致时才可安全使用批量快速路径（组数据按帧对固定）。 */
  function sequenceGroupsUniform(features) {
    if (!features.length) return true;
    const first = features[0];
    const firstKeys = Object.keys(first.groups);
    for (let i = 1; i < features.length; i++) {
      const f = features[i];
      if (Object.keys(f.groups).length !== firstKeys.length) return false;
      for (let k = 0; k < firstKeys.length; k++) {
        const g = firstKeys[k];
        const g0 = first.groups[g], gi = f.groups[g];
        if (!gi || gi[0] !== g0[0] || gi[1] !== g0[1]) return false;
      }
    }
    return true;
  }

  /** 构建局部距离矩阵的快速计算上下文：组权重/维度权重/缺失权重/帧权重只算一次 */
  function buildDistanceContext(s, q, profile) {
    const ctx = { ready: false, profile };
    const sF = s.features, qF = q.features;
    if (!sF.length || !qF.length) return ctx;
    if (!sequenceGroupsUniform(sF) || !sequenceGroupsUniform(qF)) return ctx;
    const a0 = sF[0], b0 = qF[0];
    const groups = [];
    for (let g = 0; g < DISTANCE_CANDIDATES.length; g++) {
      const name = DISTANCE_CANDIDATES[g];
      if (a0.groups[name] && b0.groups[name]) groups.push(name);
    }
    ctx.ready = true;
    ctx.groups = groups;
    ctx.weights = profileGroupWeights(profile, groups);
    ctx.handGroups = [];
    ctx.nonHandGroups = [];
    for (let g = 0; g < groups.length; g++) {
      const name = groups[g];
      if (HAND_LIKE_GROUPS.includes(name)) ctx.handGroups.push(name);
      else ctx.nonHandGroups.push(name);
    }
    ctx.missingWeight = {};
    ctx.dimW = {};
    for (let g = 0; g < groups.length; g++) {
      const name = groups[g];
      ctx.missingWeight[name] = groupMissingDistanceWeight(profile, name);
      const ga = a0.groups[name];
      ctx.dimW[name] = Float64Array.from(dimensionWeights(name, ga[1] - ga[0], profile));
    }
    ctx.allowSwap = !!(profile && profile.allow_hand_swap);
    ctx.dtwCfg = semanticDtwConfig(profile);
    ctx.scratch = new Int32Array(64);
    ctx.sFeats = sF;
    ctx.qFeats = qF;
    // 预计算每帧 clamp 后的 frameWeight（pairTemporalWeight 用，避免逐帧对重复 clamp）
    ctx.sFW = new Float64Array(sF.length);
    ctx.qFW = new Float64Array(qF.length);
    for (let i = 0; i < sF.length; i++) ctx.sFW[i] = Math.max(0.20, Math.min(3.50, f32(sF[i].frameWeight, 1)));
    for (let j = 0; j < qF.length; j++) ctx.qFW[j] = Math.max(0.20, Math.min(3.50, f32(qF[j].frameWeight, 1)));
    return ctx;
  }

  /** 快速版 poseRobustHandDistance：零分配，直接以组偏移访问切片，
   *  累加顺序与原始逐点数组版完全一致（both 点 i 升序、通道 k 0..2）。 */
  function fastPoseRobustHandDistance(ctx, av, bv, am, bm, aOff, bOff, w, dim, rawDist) {
    if (dim % 3 !== 0) return rawDist;
    const cfg = ctx.dtwCfg;
    if (!cfg.pose_robust_hand_position) return rawDist;
    const nPts = dim / 3;
    const flag = ctx.scratch;
    let bothCount = 0;
    for (let i = 0; i < nPts; i++) {
      const a3 = aOff + i * 3, b3 = bOff + i * 3;
      const aOk = (am[a3] + am[a3 + 1] + am[a3 + 2]) / 3 > 0.5;
      const bOk = (bm[b3] + bm[b3 + 1] + bm[b3 + 2]) / 3 > 0.5;
      const both = aOk && bOk;
      flag[i] = both ? 1 : 0;
      if (both) bothCount++;
    }
    if (bothCount < 2) return rawDist;
    let ax, ay, az, bx, by, bz;
    if (flag[0]) {
      ax = av[aOff]; ay = av[aOff + 1]; az = av[aOff + 2];
      bx = bv[bOff]; by = bv[bOff + 1]; bz = bv[bOff + 2];
    } else {
      ax = 0; ay = 0; az = 0; bx = 0; by = 0; bz = 0;
      for (let i = 0; i < nPts; i++) {
        if (!flag[i]) continue;
        const a3 = aOff + i * 3, b3 = bOff + i * 3;
        ax += av[a3]; ay += av[a3 + 1]; az += av[a3 + 2];
        bx += bv[b3]; by += bv[b3 + 1]; bz += bv[b3 + 2];
      }
      ax /= bothCount; ay /= bothCount; az /= bothCount;
      bx /= bothCount; by /= bothCount; bz /= bothCount;
    }
    // localDist：加权 RMSE，顺序 = both 点 i 升序、通道 k 0..2（与原始 aFlat/bFlat/wFlat 一致）
    let lDenom = 0, lSq = 0;
    for (let i = 0; i < nPts; i++) {
      if (!flag[i]) continue;
      const a3 = aOff + i * 3, b3 = bOff + i * 3, w3 = i * 3;
      for (let c = 0; c < 3; c++) {
        const wc = w[w3 + c];
        lDenom += wc;
        // 各通道使用对应轴的锚点（x→ax/bx, y→ay/by, z→az/bz）
        const aa = c === 0 ? ax : (c === 1 ? ay : az);
        const bb = c === 0 ? bx : (c === 1 ? by : bz);
        const d = (av[a3 + c] - aa) - (bv[b3 + c] - bb);
        lSq += wc * d * d;
      }
    }
    const localDist = lDenom <= 1e-8 ? 0 : Math.sqrt(lSq / lDenom);
    // similarityAlignedXyRmse：加权 2D 相似对齐（Umeyama 解析解），点顺序与原始一致
    let alignedXyDist;
    if (bothCount < 3) {
      alignedXyDist = Infinity;
    } else {
      let wsum = 0;
      for (let i = 0; i < nPts; i++) {
        if (!flag[i]) continue;
        wsum += Math.max(0, (w[i * 3] + w[i * 3 + 1]) / 2);
      }
      const uniform = wsum <= 1e-8;
      if (uniform) wsum = bothCount;
      const inv = 1 / Math.max(wsum, 1e-8);
      // 加权去中心（加权质心）
      let aCx = 0, aCy = 0, bCx = 0, bCy = 0;
      for (let i = 0; i < nPts; i++) {
        if (!flag[i]) continue;
        const a3 = aOff + i * 3, b3 = bOff + i * 3;
        const wn = uniform ? inv : Math.max(0, (w[i * 3] + w[i * 3 + 1]) / 2) * inv;
        aCx += wn * av[a3]; aCy += wn * av[a3 + 1];
        bCx += wn * bv[b3]; bCy += wn * bv[b3 + 1];
      }
      let C = 0, S = 0, dnm = 0;
      for (let i = 0; i < nPts; i++) {
        if (!flag[i]) continue;
        const a3 = aOff + i * 3, b3 = bOff + i * 3;
        const wn = uniform ? inv : Math.max(0, (w[i * 3] + w[i * 3 + 1]) / 2) * inv;
        const a0x = av[a3] - aCx, a0y = av[a3 + 1] - aCy;
        const b0x = bv[b3] - bCx, b0y = bv[b3 + 1] - bCy;
        C += wn * (a0x * b0x + a0y * b0y);
        S += wn * (a0x * b0y - a0y * b0x);
        dnm += wn * (b0x * b0x + b0y * b0y);
      }
      if (dnm <= 1e-8) {
        alignedXyDist = Infinity;
      } else {
        const theta = Math.atan2(S, C);
        const scale = Math.max(0.70, Math.min(1.45, Math.sqrt(C * C + S * S) / dnm));
        const cos = Math.cos(theta), sin = Math.sin(theta);
        let sq = 0;
        for (let i = 0; i < nPts; i++) {
          if (!flag[i]) continue;
          const a3 = aOff + i * 3, b3 = bOff + i * 3;
          const wn = uniform ? inv : Math.max(0, (w[i * 3] + w[i * 3 + 1]) / 2) * inv;
          const b0x = bv[b3] - bCx, b0y = bv[b3 + 1] - bCy;
          const rx = cos * b0x - sin * b0y, ry = sin * b0x + cos * b0y;
          const alx = scale * rx + aCx, aly = scale * ry + aCy;
          const dx = av[a3] - alx, dy = av[a3 + 1] - aly;
          sq += wn * (dx * dx + dy * dy);
        }
        alignedXyDist = Math.sqrt(sq);
      }
    }
    const globalAnchorDist = Math.hypot(ax - bx, ay - by, az - bz);
    const globalWeight = cfg.hand_global_position_weight;
    const orientationDist = isFiniteNumber(alignedXyDist) ? alignedXyDist + globalWeight * globalAnchorDist : Infinity;
    const robustDist = Math.min(localDist + globalWeight * globalAnchorDist, orientationDist);
    return Math.min(rawDist, robustDist);
  }

  /** 快速版组距离：单遍 mask 扫描 + 单遍加权 RMSE 批量累加（Float64Array 维度权重），
   *  累加顺序与原始 groupDistanceBetween 完全一致（维度升序）。 */
  function fastGroupDistance(ctx, fa, fb, aGroup, bGroup) {
    const ga = fa.groups[aGroup], gb = fb.groups[bGroup];
    if (!ga || !gb) return [0, 0];
    const aLen = ga[1] - ga[0], bLen = gb[1] - gb[0];
    if (aLen === 0 || aLen !== bLen) return [0, 1];
    const aOff = ga[0], bOff = gb[0];
    const av = fa.vector, bv = fb.vector;
    const am = fa.mask, bm = fb.mask;
    let eitherSum = 0, mismatchSum = 0, bothCount = 0;
    for (let i = 0; i < aLen; i++) {
      const aOk = am[aOff + i] > 0, bOk = bm[bOff + i] > 0;
      if (aOk && bOk) bothCount++;
      if (aOk || bOk) eitherSum++;
      if (aOk !== bOk) mismatchSum++;
    }
    let dist = 0;
    if (bothCount > 0) {
      const w = ctx.dimW[aGroup];
      const cap = HAND_SHAPE_GROUPS.includes(aGroup) ? 0.35 : 0;
      // rawDist：与原始 weightedRmse 相同的累加顺序（denom 与平方差逐维顺序累加）
      let denom = 0, sq = 0;
      for (let i = 0; i < aLen; i++) {
        if (!(am[aOff + i] > 0 && bm[bOff + i] > 0)) continue;
        const wi = w[i];
        denom += wi;
        let d = av[aOff + i] - bv[bOff + i];
        if (cap > 0) d = Math.max(-cap, Math.min(cap, d));
        sq += wi * d * d;
      }
      let d = denom <= 1e-8 ? 0 : Math.sqrt(sq / denom);
      const isHand = aGroup === 'left_hand' || aGroup === 'right_hand';
      if (isHand) d = Math.min(d, fastPoseRobustHandDistance(ctx, av, bv, am, bm, aOff, bOff, w, aLen, d));
      // scale 修正：alpha 缩放 + log 惩罚（在 pose_robust 之后，min 基于 d）
      if (isHand || aGroup === 'pose') {
        let denom2 = 0;
        for (let i = 0; i < aLen; i++) {
          if (!(am[aOff + i] > 0 && bm[bOff + i] > 0)) continue;
          denom2 += w[i] * bv[bOff + i] * bv[bOff + i];
        }
        if (denom2 > 1e-8) {
          let num = 0;
          for (let i = 0; i < aLen; i++) {
            if (!(am[aOff + i] > 0 && bm[bOff + i] > 0)) continue;
            num += w[i] * av[aOff + i] * bv[bOff + i];
          }
          const alpha = Math.max(0.70, Math.min(1.45, num / denom2));
          // scaledDist = weightedRmse(left, right.map(v => alpha * v), w)，无 cap
          let sDenom = 0, sSq = 0;
          for (let i = 0; i < aLen; i++) {
            if (!(am[aOff + i] > 0 && bm[bOff + i] > 0)) continue;
            const wi = w[i];
            sDenom += wi;
            const dd = av[aOff + i] - alpha * bv[bOff + i];
            sSq += wi * dd * dd;
          }
          const scaledDist = sDenom <= 1e-8 ? 0 : Math.sqrt(sSq / sDenom);
          const scalePenalty = 0.004 * Math.abs(Math.log(Math.max(alpha, 1e-6)));
          d = Math.min(d, scaledDist + scalePenalty);
        }
      }
      dist = d;
    }
    const missingPenalty = eitherSum > 0 ? mismatchSum / eitherSum : 0;
    return [dist, missingPenalty];
  }

  /** 快速版 frameDistance：组权重/缺失权重/维度权重全部预计算，
   *  加权累加顺序与原始 frameDistance 完全一致（手部组 → 非手部组 → missing）。 */
  function fastFrameDistance(ctx, i, j) {
    const fa = ctx.sFeats[i], fb = ctx.qFeats[j];
    const weights = ctx.weights;
    const handGroups = ctx.handGroups, nonHandGroups = ctx.nonHandGroups;
    const groupMetrics = {};
    const directHand = {};
    for (let g = 0; g < handGroups.length; g++) {
      const group = handGroups[g];
      directHand[group] = fastGroupDistance(ctx, fa, fb, group, group);
    }
    const swappedHand = {};
    if (ctx.allowSwap) {
      for (let g = 0; g < handGroups.length; g++) {
        const group = handGroups[g];
        const pair = HAND_SWAP_PAIRS[group];
        if (pair && fa.groups[pair[0]] && fb.groups[pair[1]]) {
          swappedHand[group] = fastGroupDistance(ctx, fa, fb, pair[0], pair[1]);
        }
      }
    }
    let directWeighted = 0;
    for (let g = 0; g < handGroups.length; g++) {
      const group = handGroups[g];
      const pr = directHand[group];
      directWeighted += (weights[group] || 0) * (pr[0] + ctx.missingWeight[group] * pr[1]);
    }
    let swappedWeighted = 0;
    for (let g = 0; g < handGroups.length; g++) {
      const group = handGroups[g];
      const pr = swappedHand[group] || directHand[group] || [0, 0];
      swappedWeighted += (weights[group] || 0) * (pr[0] + ctx.missingWeight[group] * pr[1]);
    }
    const useSwapped = Object.keys(swappedHand).length > 0 && swappedWeighted < directWeighted - 1e-6;
    const selectedHand = useSwapped ? swappedHand : directHand;
    let weighted = 0, missingWeighted = 0, missingWeightSum = 0;
    for (let g = 0; g < handGroups.length; g++) {
      const group = handGroups[g];
      const pr = selectedHand[group] || directHand[group] || [0, 0];
      const dist = pr[0], miss = pr[1];
      const missingDistance = ctx.missingWeight[group] * miss;
      groupMetrics[group] = dist;
      groupMetrics[group + '_missing_penalty'] = miss;
      groupMetrics[group + '_missing_distance'] = missingDistance;
      const gw = weights[group] || 0;
      weighted += gw * (dist + missingDistance);
      missingWeighted += gw * miss;
      missingWeightSum += gw;
    }
    groupMetrics.hand_side_swapped = useSwapped ? 1 : 0;
    for (let g = 0; g < nonHandGroups.length; g++) {
      const group = nonHandGroups[g];
      const pr = fastGroupDistance(ctx, fa, fb, group, group);
      const dist = pr[0], miss = pr[1];
      const missingDistance = ctx.missingWeight[group] * miss;
      groupMetrics[group] = dist;
      groupMetrics[group + '_missing_penalty'] = miss;
      groupMetrics[group + '_missing_distance'] = missingDistance;
      const gw = weights[group] || 0;
      weighted += gw * (dist + missingDistance);
      missingWeighted += gw * miss;
      missingWeightSum += gw;
    }
    const missing = missingWeightSum > 1e-6 ? missingWeighted / missingWeightSum : 0;
    weighted += (weights.missing !== undefined ? weights.missing : (GROUP_WEIGHTS.missing !== undefined ? GROUP_WEIGHTS.missing : 0.06)) * missing;
    groupMetrics.missing = missing;
    groupMetrics.weighted = weighted;
    return [weighted, groupMetrics];
  }

  /* ================= DTW 主流程 ================= */
  function semanticActionWindow(seq) {
    const values = seq.features.map(f => f32(f.frameWeight, 1));
    const n = values.length;
    if (n === 0) return { start_index: 0, end_index: -1, length: 0, used: false, reason: 'empty' };
    if (n < 5) return { start_index: 0, end_index: n - 1, length: n, used: false, reason: 'too_short', energy_coverage: 1 };
    const pct = (arr, q) => {
      const sorted = arr.slice().sort((a, b) => a - b);
      const pos = (sorted.length - 1) * q;
      const base = Math.floor(pos), rest = pos - base;
      return sorted[base] + rest * (sorted[base + 1] !== undefined ? sorted[base + 1] - sorted[base] : 0);
    };
    const baseline = pct(values, 0.20);
    const energy = values.map(v => Math.max(v - baseline, 0));
    const totalEnergy = energy.reduce((s, v) => s + v, 0);
    let peakIndex = 0;
    for (let i = 1; i < n; i++) if (values[i] > values[peakIndex]) peakIndex = i;
    const peakWeight = values[peakIndex];
    const contrast = peakWeight / Math.max(Math.min(...values), 1e-6);
    if (totalEnergy <= 1e-8 || contrast < 1.12) {
      return { start_index: 0, end_index: n - 1, length: n, used: false, reason: 'weak_energy_contrast', energy_coverage: 1, peak_index: peakIndex, peak_weight: peakWeight, contrast };
    }
    const activeThreshold = Math.max(pct(values, 0.65), baseline + 0.42 * (peakWeight - baseline));
    const active = values.map(v => v >= activeThreshold);
    active[peakIndex] = true;

    const components = [];
    let idx = 0;
    while (idx < n) {
      if (!active[idx]) { idx++; continue; }
      const start = idx;
      while (idx + 1 < n && active[idx + 1]) idx++;
      components.push([start, idx]);
      idx++;
    }
    let peakComponent = components.find(([a, b]) => a <= peakIndex && peakIndex <= b) || [peakIndex, peakIndex];
    let left = peakComponent[0], right = peakComponent[1];
    const mergeGap = Math.max(1, Math.round(n * 0.06));
    const minComponentEnergy = 0.08 * energy.slice(left, right + 1).reduce((s, v) => s + v, 0);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [a, b] of components) {
        if (b < left && (left - b - 1) <= mergeGap && energy.slice(a, b + 1).reduce((s, v) => s + v, 0) >= minComponentEnergy) { left = a; changed = true; }
        if (a > right && (a - right - 1) <= mergeGap && energy.slice(a, b + 1).reduce((s, v) => s + v, 0) >= minComponentEnergy) { right = b; changed = true; }
      }
    }
    const leftPad = 0;
    const rightPad = Math.max(1, Math.round(n * 0.03));
    left = Math.max(0, left - leftPad);
    right = Math.min(n - 1, right + rightPad);

    const minFraction = n < 24 ? 0.40 : 0.28;
    const minBase = n >= 8 ? 6 : 4;
    const minWindow = Math.min(n, Math.max(minBase, Math.round(n * minFraction)));
    if (right - left + 1 < minWindow) {
      const extra = minWindow - (right - left + 1);
      const third = Math.max(0, Math.floor(extra / 3));
      left = Math.max(0, left - third);
      right = Math.min(n - 1, right + (extra - third));
      if (right - left + 1 < minWindow) {
        left = Math.max(0, right - minWindow + 1);
        right = Math.min(n - 1, left + minWindow - 1);
      }
    }
    const windowEnergy = energy.slice(left, right + 1).reduce((s, v) => s + v, 0);
    const coverage = totalEnergy > 1e-8 ? windowEnergy / totalEnergy : 1;
    const used = left > 0 || right < n - 1;
    return {
      start_index: left, end_index: right, length: right - left + 1, used,
      reason: used ? 'semantic_energy_window' : 'full_sequence_already_active',
      energy_coverage: coverage, baseline_weight: baseline, active_threshold: activeThreshold,
      peak_index: peakIndex, peak_weight: peakWeight, contrast,
    };
  }

  function sliceSequenceWindow(seq, window, name) {
    if (!window || !window.used) return seq;
    const s = Math.max(0, window.start_index), e = Math.min(seq.features.length - 1, window.end_index);
    const features = seq.features.slice(s, e + 1);
    return { ...seq, features };
  }

  function trimTolerantScoringPath(path, localMetrics, n, m) {
    // 对应 _trim_tolerant_scoring_path：容忍起点/终点裁剪 + skip 惩罚，
    // 缓解短动作窗口下标准/查询首尾未对齐导致的 DTW 距离虚高。
    if (!path || path.length === 0) return [path, { enabled: false }];
    if (!localMetrics) return [path, { enabled: false, reason: 'no_local_metrics' }];
    const lengthRatio = Math.min(n, m) / Math.max(n, m, 1);
    if (lengthRatio < 0.65 || lengthRatio > 0.95) {
      return [path, { enabled: false, reason: 'length_ratio_out_of_range' }];
    }
    const metricsAt = (i, j) => localMetrics[i * m + j];
    const pathDistance = (items) => {
      let weighted = 0, weightSum = 0;
      for (const [si, qj] of items) {
        const metrics = metricsAt(si, qj);
        const pairWeight = f32(metrics.frame_pair_weight, 1.0);
        weighted += pairWeight * f32(metrics.weighted, 0.0);
        weightSum += pairWeight;
      }
      return [weighted / Math.max(weightSum, 1e-6), weightSum];
    };
    const [originalDistance, originalWeightSum] = pathDistance(path);
    let bestPath = path;
    let bestDistance = originalDistance;
    let bestPenalized = originalDistance;
    const bestDetail = {
      enabled: true,
      used: false,
      raw_distance: originalDistance,
      raw_path_weight_sum: originalWeightSum,
    };
    const maxStdSkip = Math.max(0, Math.round(n * 0.22));
    const maxQrySkip = Math.max(0, Math.round(m * 0.22));
    const minQueryCoverage = 0.82;
    const minStandardCoverage = Math.max(0.62, lengthRatio - 0.08);
    for (let stdPrefix = 0; stdPrefix <= maxStdSkip; stdPrefix++) {
      for (let stdSuffix = 0; stdSuffix <= maxStdSkip - stdPrefix; stdSuffix++) {
        const stdLo = stdPrefix, stdHi = n - 1 - stdSuffix;
        if (stdLo > stdHi) continue;
        for (let qryPrefix = 0; qryPrefix <= maxQrySkip; qryPrefix++) {
          for (let qrySuffix = 0; qrySuffix <= maxQrySkip - qryPrefix; qrySuffix++) {
            const qryLo = qryPrefix, qryHi = m - 1 - qrySuffix;
            if (qryLo > qryHi) continue;
            if (stdPrefix === 0 && stdSuffix === 0 && qryPrefix === 0 && qrySuffix === 0) continue;
            const selected = path.filter(([si, qj]) => si >= stdLo && si <= stdHi && qj >= qryLo && qj <= qryHi);
            if (!selected.length) continue;
            const stdCovered = new Set(selected.map(([si]) => si)).size / Math.max(n, 1);
            const qryCovered = new Set(selected.map(([, qj]) => qj)).size / Math.max(m, 1);
            if (stdCovered < minStandardCoverage || qryCovered < minQueryCoverage) continue;
            const [distance, weightSum] = pathDistance(selected);
            const skipFraction = (stdPrefix + stdSuffix) / Math.max(n, 1) + (qryPrefix + qrySuffix) / Math.max(m, 1);
            const skipPenalty = 0.018 * skipFraction;
            const penalized = distance + skipPenalty;
            if (penalized < bestPenalized) {
              bestPath = selected;
              bestDistance = distance;
              bestPenalized = penalized;
              Object.assign(bestDetail, {
                enabled: true,
                used: true,
                raw_distance: originalDistance,
                raw_path_weight_sum: originalWeightSum,
                trimmed_distance: distance,
                penalized_distance: penalized,
                skip_penalty: skipPenalty,
                std_prefix_skip: stdPrefix,
                std_suffix_skip: stdSuffix,
                query_prefix_skip: qryPrefix,
                query_suffix_skip: qrySuffix,
                standard_coverage: stdCovered,
                query_coverage: qryCovered,
                path_weight_sum: weightSum,
              });
            }
          }
        }
      }
    }
    return [bestPath, bestDetail];
  }

  /** 对应 _resample_sequence_to_length：线性插值重采样到目标长度 */
  function resampleSequenceToLength(seq, targetLen) {
    const currentLen = seq.features.length;
    if (currentLen === 0 || targetLen <= 0 || currentLen === targetLen) return seq;
    const features = [];
    for (let t = 0; t < targetLen; t++) {
      const pos = currentLen === 1 ? 0 : (currentLen - 1) * t / (targetLen - 1);
      const leftIdx = Math.floor(pos);
      const rightIdx = Math.min(currentLen - 1, leftIdx + 1);
      const alpha = pos - leftIdx;
      const left = seq.features[leftIdx], right = seq.features[rightIdx];
      const vector = left.vector.map((v, k) => (1 - alpha) * v + alpha * right.vector[k]);
      const mask = left.mask.map((v, k) => Math.min(v, right.mask[k]));
      const frame = cloneFeature(left);
      frame.vector = vector;
      frame.mask = mask;
      frame.frameIdx = Math.round((1 - alpha) * left.frameIdx + alpha * right.frameIdx);
      frame.timestampSec = (1 - alpha) * left.timestampSec + alpha * right.timestampSec;
      frame.frameWeight = (1 - alpha) * left.frameWeight + alpha * right.frameWeight;
      frame.semanticPhase = (1 - alpha) * left.semanticPhase + alpha * right.semanticPhase;
      features.push(frame);
    }
    return { ...seq, features };
  }

  /** 对应 _phase_anchor_frame：找 semantic_phase 最接近 target 的帧 */
  function phaseAnchorFrame(seq, targetPhase) {
    if (!seq.features.length) return null;
    let phases = seq.features.map(f => f32(f.semanticPhase, 0));
    if (!phases.every(isFiniteNumber) || (Math.max(...phases) - Math.min(...phases)) <= 1e-6) {
      const idx = Math.round(Math.max(0, Math.min(1, targetPhase)) * (seq.features.length - 1));
      return seq.features[idx];
    }
    let bestIdx = 0, bestGap = Infinity;
    for (let i = 0; i < phases.length; i++) {
      const gap = Math.abs(phases[i] - targetPhase);
      if (gap < bestGap) { bestGap = gap; bestIdx = i; }
    }
    return seq.features[bestIdx];
  }

  /** 对应 _hand_dynamic_scale：纯手部语义时放大惩罚权重 */
  function handDynamicScale(profile, groups) {
    if (!profile) return 1.0;
    const weights = profileGroupWeights(profile, groups);
    const handMass = HAND_GROUPS.reduce((s, g) => s + f32(weights[g], 0), 0);
    const nonHandMass = f32(weights.pose, 0) + f32(weights.face, 0);
    if (handMass >= 0.85 && nonHandMass <= 0.03) return 1.55;
    if (handMass >= 0.75 && nonHandMass <= 0.06) return 1.25;
    return 1.0;
  }

  /** 对应 _presence_ratio：各组可见帧比例 */
  function presenceRatio(seq) {
    const n = seq.features.length;
    const out = { pose: 0, left_hand: 0, right_hand: 0, face: 0 };
    if (!n) return out;
    for (const f of seq.features) {
      for (const g of ['pose', 'left_hand', 'right_hand', 'face']) {
        if (f.presence && f.presence[g]) out[g]++;
      }
    }
    for (const g of Object.keys(out)) out[g] /= n;
    return out;
  }

  /** 对应 _hand_presence_value：双手语义取 min，否则 max */
  function handPresenceValue(presence, profile) {
    const left = f32(presence.left_hand, 0), right = f32(presence.right_hand, 0);
    const sd = (profile && profile.semantic_dtw) || {};
    const required = (sd.required_presence_groups || []).map(String);
    const focus = (profile && profile.focus_groups) || [];
    const twoHand = required.includes('two_hand_relation') || focus.includes('two_hand_relation')
      || (required.includes('left_hand') && required.includes('right_hand'));
    return twoHand ? Math.min(left, right) : Math.max(left, right);
  }

  /** 对应 _window_features：按窗口切片，少于 3 帧返回空 */
  function windowFeatures(seq, window) {
    if (!window || !window.used) return [];
    const start = Math.max(0, Math.min(f32(window.start_index, 0), seq.features.length - 1));
    const end = Math.max(start, Math.min(f32(window.end_index, -1), seq.features.length - 1));
    if (end < start) return [];
    const selected = seq.features.slice(start, end + 1);
    return selected.length >= 3 ? selected : [];
  }

  /** 对应 _semantic_core_hand_presence：完整序列与窗口 presence 取 max */
  function semanticCoreHandPresence(seq, profile, actionWindow) {
    const full = handPresenceValue(presenceRatio(seq), profile);
    const items = windowFeatures(seq, actionWindow);
    if (!items.length) return full;
    const windowPresence = handPresenceValue(presenceRatio({ features: items }), profile);
    return Math.max(full, windowPresence);
  }

  /** 对应 _sequence_motion_by_group：相邻帧组间 RMSE 均值 */
  function sequenceMotionByGroup(seq) {
    const groups = sequenceGroups(seq);
    if (seq.features.length < 2) {
      const out = {};
      for (const g of groups) out[g] = 0;
      return out;
    }
    const result = {};
    for (const group of groups) {
      const values = [];
      for (let i = 1; i < seq.features.length; i++) {
        const prev = seq.features[i - 1], curr = seq.features[i];
        const sl = prev.groups[group];
        const dim = sl[1] - sl[0];
        let sq = 0, cnt = 0;
        for (let k = 0; k < dim; k++) {
          if (prev.mask[sl[0] + k] > 0 && curr.mask[sl[0] + k] > 0) {
            const d = curr.vector[sl[0] + k] - prev.vector[sl[0] + k];
            sq += d * d; cnt++;
          }
        }
        if (cnt > 0) values.push(Math.sqrt(sq / cnt));
      }
      result[group] = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    }
    return result;
  }

  /** 对应 _sequence_roughness_by_group：三帧加速度 RMSE 均值 */
  function sequenceRoughnessByGroup(seq) {
    const groups = sequenceGroups(seq);
    if (seq.features.length < 3) {
      const out = {};
      for (const g of groups) out[g] = 0;
      return out;
    }
    const result = {};
    for (const group of groups) {
      const values = [];
      for (let i = 2; i < seq.features.length; i++) {
        const a = seq.features[i - 2], b = seq.features[i - 1], c = seq.features[i];
        const sl = a.groups[group];
        const dim = sl[1] - sl[0];
        let sq = 0, cnt = 0;
        for (let k = 0; k < dim; k++) {
          if (a.mask[sl[0] + k] > 0 && b.mask[sl[0] + k] > 0 && c.mask[sl[0] + k] > 0) {
            const accel = c.vector[sl[0] + k] - 2 * b.vector[sl[0] + k] + a.vector[sl[0] + k];
            sq += accel * accel; cnt++;
          }
        }
        if (cnt > 0) values.push(Math.sqrt(sq / cnt));
      }
      result[group] = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    }
    return result;
  }

  function safeLogRatio(a, b, eps) {
    const e = eps === undefined ? 1e-4 : eps;
    return Math.abs(Math.log((a + e) / (b + e)));
  }

  /** 对应 _sequence_hand_swap_allowed */
  function sequenceHandSwapAllowed(profile) {
    if (!profile || !profile.allow_hand_swap) return false;
    const focus = new Set(profile.focus_groups || []);
    if (focus.has('two_hand_relation')) return false;
    const sd = profile.semantic_dtw || {};
    const required = new Set((sd.required_presence_groups || []).map(String));
    if (required.has('two_hand_relation')) return false;
    return true;
  }

  /** 对应 _swapped_hand_group */
  function swappedHandGroup(group) {
    const swaps = {
      left_hand: 'right_hand', right_hand: 'left_hand',
      left_hand_shape: 'right_hand_shape', right_hand_shape: 'left_hand_shape',
      left_hand_motion: 'right_hand_motion', right_hand_motion: 'left_hand_motion',
      left_hand_shape_motion: 'right_hand_shape_motion', right_hand_shape_motion: 'left_hand_shape_motion',
    };
    return swaps[group] || group;
  }

  /** 对应 _maybe_swap_hand_delta */
  function maybeSwapHandDelta(standardValues, queryValues, groups, weights, profile, logRatio) {
    const direct = {}, swapped = {};
    let directWeighted = 0, swappedWeighted = 0;
    const handGroups = new Set(['left_hand', 'right_hand', 'left_hand_shape', 'right_hand_shape',
      'left_hand_motion', 'right_hand_motion', 'left_hand_shape_motion', 'right_hand_shape_motion']);
    for (const group of groups) {
      const stdValue = f32(standardValues[group], 0);
      const qryValue = f32(queryValues[group], 0);
      const directValue = logRatio ? Math.min(safeLogRatio(stdValue, qryValue), 3.0) : Math.abs(stdValue - qryValue);
      direct[group] = directValue;
      directWeighted += f32(weights[group], 0) * directValue;
      const swappedGroup = swappedHandGroup(group);
      let swappedValue;
      if (handGroups.has(group) && queryValues[swappedGroup] !== undefined) {
        const swappedQry = f32(queryValues[swappedGroup], 0);
        swappedValue = logRatio ? Math.min(safeLogRatio(stdValue, swappedQry), 3.0) : Math.abs(stdValue - swappedQry);
      } else {
        swappedValue = directValue;
      }
      swapped[group] = swappedValue;
      swappedWeighted += f32(weights[group], 0) * swappedValue;
    }
    const useSwapped = sequenceHandSwapAllowed(profile) && swappedWeighted < directWeighted;
    return [useSwapped ? swapped : direct, useSwapped];
  }

  /** 对应 _sequence_delta_by_group：首尾窗口 masked mean 差 */
  function sequenceDeltaByGroup(seq, group) {
    if (!seq.features.length || !seq.features[0].groups[group]) return [[], []];
    const validIndices = [];
    for (let idx = 0; idx < seq.features.length; idx++) {
      const item = seq.features[idx];
      const sl = item.groups[group];
      const dim = sl[1] - sl[0];
      let sum = 0;
      for (let k = 0; k < dim; k++) sum += item.mask[sl[0] + k];
      if (sum / dim >= 0.35) validIndices.push(idx);
    }
    if (!validIndices.length) return [[], []];
    const window = Math.max(1, Math.min(3, Math.round(validIndices.length * 0.20)));
    const startSet = new Set(validIndices.slice(0, window));
    const endSet = new Set(validIndices.slice(-window));
    const startItems = validIndices.filter(i => startSet.has(i)).map(i => seq.features[i]);
    const endItems = validIndices.filter(i => endSet.has(i)).map(i => seq.features[i]);
    const maskedMean = (items) => {
      const sl = items[0].groups[group];
      const dim = sl[1] - sl[0];
      const mean = new Array(dim).fill(0);
      const valid = new Array(dim).fill(0);
      const counts = new Array(dim).fill(0);
      for (const item of items) {
        for (let k = 0; k < dim; k++) {
          if (item.mask[sl[0] + k] > 0) { mean[k] += item.vector[sl[0] + k]; counts[k]++; }
        }
      }
      for (let k = 0; k < dim; k++) {
        if (counts[k] > 0) { mean[k] /= counts[k]; valid[k] = 1; }
      }
      return [mean, valid];
    };
    const [startMean, startMask] = maskedMean(startItems);
    const [endMean, endMask] = maskedMean(endItems);
    const delta = [], valid = [];
    for (let k = 0; k < startMean.length; k++) {
      delta.push(endMean[k] - startMean[k]);
      valid.push((startMask[k] > 0 && endMask[k] > 0) ? 1 : 0);
    }
    return [delta, valid];
  }

  /** 对应 _semantic_delta_penalty */
  function semanticDeltaPenaltyFn(standard, query, profile) {
    if (!profile) return [0, {}];
    const focus = (profile.focus_groups || []).filter(g => standard.features.length && standard.features[0].groups[g]);
    if (!focus.length) return [0, {}];
    const weights = profileGroupWeights(profile, focus);
    const details = {};
    let weighted = 0, weightSum = 0;
    for (const group of focus) {
      const [stdDelta, stdMask] = sequenceDeltaByGroup(standard, group);
      const [qryDelta, qryMask] = sequenceDeltaByGroup(query, group);
      if (!stdDelta.length || !qryDelta.length) continue;
      const bothIdx = [];
      for (let k = 0; k < stdMask.length; k++) if (stdMask[k] > 0 && qryMask[k] > 0) bothIdx.push(k);
      let value;
      if (!bothIdx.length) {
        value = 1.0;
      } else {
        let sq = 0;
        for (const k of bothIdx) { const d = stdDelta[k] - qryDelta[k]; sq += d * d; }
        const rmse = Math.sqrt(sq / bothIdx.length);
        let stdNorm = 0, qryNorm = 0, dot = 0;
        for (const k of bothIdx) { stdNorm += stdDelta[k] * stdDelta[k]; qryNorm += qryDelta[k] * qryDelta[k]; dot += stdDelta[k] * qryDelta[k]; }
        stdNorm = Math.sqrt(stdNorm); qryNorm = Math.sqrt(qryNorm);
        let directionError = 0;
        if (stdNorm * qryNorm <= 1e-8) directionError = 0;
        else {
          const cosine = Math.max(-1, Math.min(1, dot / (stdNorm * qryNorm)));
          directionError = Math.max(0, (0.25 - cosine) / 1.25);
        }
        value = 0.35 * rmse + 0.65 * directionError;
      }
      details[group] = value;
      const gw = f32(weights[group], 0);
      weighted += gw * value;
      weightSum += gw;
    }
    if (weightSum <= 1e-8) return [0, details];
    return [0.14 * (weighted / weightSum), details];
  }

  /**
   * 语义阶段完整性检查（G1 门控，与 Python semantic_stage_completeness 一致）
   * 输入：标准序列 s（features 含 semanticPhase）、查询序列 q、DTW 对齐路径 path（(pi,pj) 局部索引）、
   *       阶段数 stageCount、已算好的 stage_distances、配置 config。
   * 输出：逐阶段覆盖率 cov[k]、动静分类 dynamic[k]、目标形态到达距离、缺失判定 missing[k]、
   *       门控结论 gate（passed / capped / blocked）。
   * 阈值全部来自 config（默认保守值），可由校准 JSON 覆盖。
   */
  function semanticStageCompleteness(s, q, path, stageCount, stageDistances, config) {
    const cfg = config || {};
    const covThreshold = f32(cfg.cov_threshold, 0.15);
    const distRatioThreshold = f32(cfg.dist_ratio_threshold, 1.6);
    const distAbsThreshold = f32(cfg.dist_abs_threshold, 0.08);
    const motionThreshold = f32(cfg.motion_threshold, 0.02);
    const motionRelRatio = f32(cfg.motion_rel_ratio, 0.5);
    const shapeGateRatioThreshold = f32(cfg.shape_gate_ratio_threshold, 0.75);
    // 通用 shape 检测默认关闭（跨用户不可靠）；花词缺张开由 flowerOpeningGuard 负责
    const shapeGateMinSpan = f32(cfg.shape_gate_min_span, 1e9);
    // 时长完整性门：查询/标准 长度比低于该值 → 序列被截断（缺后半阶段）
    // 仅多阶段词启用（单阶段词无"后半阶段"概念，谗等短动作正样本帧数少会被误伤）
    const lengthMinRatio = (stageCount >= 2) ? f32(cfg.length_min_ratio, 0.6) : 0.0;
    const gateCap = f32(cfg.gate_cap, 60);
    const focusGroups = Array.isArray(cfg.focus_groups) ? cfg.focus_groups.map(String) : [];
    const stageOf = phase => Math.max(0, Math.min(stageCount - 1, Math.floor(phase * stageCount)));

    // 路径上的独特标准/查询帧（每阶段）
    const stdSets = Array.from({ length: stageCount }, () => new Set());
    const qrySets = Array.from({ length: stageCount }, () => new Set());
    for (const [pi, pj] of path) {
      const phase = s.features[pi] && isFiniteNumber(s.features[pi].semanticPhase) ? s.features[pi].semanticPhase : 0;
      const k = stageOf(phase);
      stdSets[k].add(pi);
      qrySets[k].add(pj);
    }
    const stdFrames = stdSets.map(x => x.size);
    const cov = qrySets.map((x, k) => x.size / Math.max(stdFrames[k], 1));

    // 动静分类：标准序列阶段内相邻帧的加权距离（vector 按 mask 加权 L2）
    const phaseByIdx = s.features.map(f => stageOf(isFiniteNumber(f.semanticPhase) ? f.semanticPhase : 0));
    const motion = new Array(stageCount).fill(0);
    const dynamic = new Array(stageCount).fill(false);
    for (let k = 0; k < stageCount; k++) {
      const idxs = [];
      for (let i = 0; i < phaseByIdx.length; i++) if (phaseByIdx[i] === k) idxs.push(i);
      if (idxs.length < 2) { motion[k] = 0; dynamic[k] = false; continue; }
      let acc = 0, cnt = 0;
      for (let t = 0; t + 1 < idxs.length; t++) {
        const va = s.features[idxs[t]].vector, ma = s.features[idxs[t]].mask;
        const vb = s.features[idxs[t + 1]].vector, mb = s.features[idxs[t + 1]].mask;
        let sqSum = 0, valid = 0;
        for (let d = 0; d < va.length; d++) {
          if ((ma[d] > 0) && (mb[d] > 0)) { const diff = va[d] - vb[d]; sqSum += diff * diff; valid++; }
        }
        if (valid > 0) { acc += Math.sqrt(sqSum / valid); cnt++; }
      }
      motion[k] = cnt ? acc / cnt : 0;
      dynamic[k] = motion[k] >= motionThreshold;
    }
    // 相对判定：静态准备阶段（如烤串 S1"准备形"）motion 低 → 不判动态 → cov 不触发
    {
      const posMotions = motion.filter(m => m > 0);
      if (posMotions.length) {
        const sorted = posMotions.slice().sort((a, b) => a - b);
        const median = sorted.length > 1 ? (sorted[Math.floor(sorted.length / 2)] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : sorted[0];
        for (let k = 0; k < stageCount; k++) dynamic[k] = motion[k] >= Math.max(motionThreshold, motionRelRatio * median);
      }
    }

    // 阶段全局距离基线
    let globalSum = 0, globalCnt = 0;
    for (const d of stageDistances) {
      if (d != null && isFiniteNumber(d) && d >= 0) { globalSum += d; globalCnt++; }
    }
    const globalMean = Math.max(globalCnt ? globalSum / globalCnt : 0, 1e-6);

    // ---- v3 目标形态检测：标准每阶段锚点形态 + 查询最短到达距离 ----
    // focus 组拼接向量；组内存在 mask=0 维度则视为不可用（跳过该帧）
    const focusVector = f => {
      if (!focusGroups.length) return null;
      const sel = [];
      for (const g of focusGroups) {
        const sl = f.groups && f.groups[g];
        if (!sl) return null;
        for (let d = sl[0]; d < sl[1]; d++) {
          if (!(f.mask[d] > 0)) return null;
          sel.push(f.vector[d]);
        }
      }
      return sel.length ? sel : null;
    };
    const stageAnchors = [];
    // 锚点形态来源：主模板 + 可选的其他模板（anchor_standards）——
    // 每模板单独提取阶段锚点；查询 d_target 取"到任一模板锚点的最短距离"，
    // 使跨用户正样本匹配任一模板用户的形态即可通过（跨用户鲁棒）
    const anchorStandards = Array.isArray(cfg.anchor_standards) ? cfg.anchor_standards : [];
    const allStandards = [s].concat(anchorStandards);
    const templateAnchors = [];
    for (const stdSeq of allStandards) {
      if (!stdSeq || !stdSeq.features) { templateAnchors.push(new Array(stageCount).fill(null)); continue; }
      const perStage = [];
      for (let k = 0; k < stageCount; k++) {
        const vecs = [];
        for (let i = 0; i < stdSeq.features.length; i++) {
          const ph = stdSeq.features[i] && isFiniteNumber(stdSeq.features[i].semanticPhase) ? stdSeq.features[i].semanticPhase : 0;
          if (stageOf(ph) === k) {
            const v = focusVector(stdSeq.features[i]);
            if (v) vecs.push(v);
          }
        }
        if (!vecs.length) { perStage.push(null); continue; }
        // 锚点 = 离阶段均值最近的实际帧（该模板内部）
        const dim = vecs[0].length;
        const centroid = new Array(dim).fill(0);
        for (const v of vecs) for (let d = 0; d < dim; d++) centroid[d] += v[d];
        for (let d = 0; d < dim; d++) centroid[d] /= vecs.length;
        let bestIdx = 0, bestDist = Infinity;
        for (let i = 0; i < vecs.length; i++) {
          let sq = 0;
          for (let d = 0; d < dim; d++) { const diff = vecs[i][d] - centroid[d]; sq += diff * diff; }
          if (sq < bestDist) { bestDist = sq; bestIdx = i; }
        }
        perStage.push(vecs[bestIdx]);
      }
      templateAnchors.push(perStage);
    }
    const dTarget = new Array(stageCount).fill(null);
    const spanK = new Array(stageCount).fill(0);
    for (let k = 1; k < stageCount; k++) {
      const spans = [];
      for (const perStage of templateAnchors) {
        const aPrev = perStage[k - 1], aK = perStage[k];
        if (!aPrev || !aK || aPrev.length !== aK.length) continue;
        let sq = 0;
        for (let d = 0; d < aK.length; d++) { const diff = aK[d] - aPrev[d]; sq += diff * diff; }
        spans.push(Math.sqrt(sq));
      }
      if (!spans.length) continue;
      const sorted = spans.slice().sort((a, b) => a - b);
      spanK[k] = sorted.length > 1 ? (sorted[Math.floor(sorted.length / 2)] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : sorted[0];
      let best = null;
      for (const perStage of templateAnchors) {
        const aK = perStage[k];
        if (!aK) continue;
        for (const f of q.features) {
          const v = focusVector(f);
          if (!v || v.length !== aK.length) continue;
          let sq = 0;
          for (let d = 0; d < v.length; d++) { const diff = v[d] - aK[d]; sq += diff * diff; }
          const d = Math.sqrt(sq);
          if (best == null || d < best) best = d;
        }
      }
      dTarget[k] = best;
    }

    // 缺失判定（per-stage 阈值可覆盖全局值）
    const missing = new Array(stageCount).fill(false);
    const reasons = [];
    // 时长完整性门：序列被截断（缺后半阶段）→ 所有动态阶段判缺失
    // 条件：长度比过低 且 至少一个阶段覆盖率低（区分"截断"与"完整快动作"——
    // 指示等词正样本可短但 cov 正常，花截断 len_ratio 低且 cov 低）
    if (lengthMinRatio > 0) {
      const lr = Math.min(s.features.length, q.features.length) / Math.max(Math.max(s.features.length, q.features.length), 1);
      const covMin = cov.length ? Math.min(...cov) : 1;
      if (lr < lengthMinRatio && covMin < 0.5) {
        for (let k = 0; k < stageCount; k++) if (dynamic[k]) missing[k] = true;
        reasons.push('sequence_truncated');
      }
    }
    const perStageCov = Array.isArray(cfg.per_stage_cov) ? cfg.per_stage_cov : null;
    const perStageShape = Array.isArray(cfg.per_stage_shape_ratio) ? cfg.per_stage_shape_ratio : null;
    for (let k = 0; k < stageCount; k++) {
      const dK = stageDistances[k];
      if (dK == null || !isFiniteNumber(dK) || stdFrames[k] === 0) continue;
      const covThr = perStageCov && isFiniteNumber(perStageCov[k]) ? perStageCov[k] : covThreshold;
      const shapeThr = perStageShape && isFiniteNumber(perStageShape[k]) ? perStageShape[k] : shapeGateRatioThreshold;
      const covLow = dynamic[k] && cov[k] < covThr;
      const distHigh = dK > distRatioThreshold * globalMean && dK > distAbsThreshold;
      // shape 检测仅在阶段间形态差异显著（span 足够大）时启用
      const shapeMiss = spanK[k] > shapeGateMinSpan && dTarget[k] != null && dTarget[k] > shapeThr * spanK[k];
      if (covLow) { missing[k] = true; reasons.push(`stage_${k}_not_covered`); }
      if (distHigh) { missing[k] = true; reasons.push(`stage_${k}_distance_too_high`); }
      if (shapeMiss) { missing[k] = true; reasons.push(`stage_${k}_shape_not_reached`); }
    }
    const missingCount = missing.reduce((a, b) => a + (b ? 1 : 0), 0);
    const minCov = cov.length ? Math.min(...cov) : 1;
    let gateLevel = 'passed';
    if (missingCount > 0) gateLevel = (missingCount >= 2 || minCov < 0.10) ? 'blocked' : 'capped';
    return {
      stage_count: stageCount,
      stage_distances: stageDistances,
      stage_coverage: cov,
      stage_motion: motion,
      stage_dynamic: dynamic,
      stage_shape_target_distance: dTarget,
      stage_shape_span: spanK,
      stage_missing: missing,
      missing_count: missingCount,
      min_coverage: minCov,
      global_mean_distance: globalMean,
      reasons,
      gate: {
        level: gateLevel,
        cap: gateCap,
        blocked: gateLevel === 'blocked',
        capped: gateLevel === 'capped',
        passed: gateLevel === 'passed',
      },
      config: {
        cov_threshold: covThreshold,
        dist_ratio_threshold: distRatioThreshold,
        dist_abs_threshold: distAbsThreshold,
        motion_threshold: motionThreshold,
        shape_gate_ratio_threshold: shapeGateRatioThreshold,
        gate_cap: gateCap,
        focus_groups: focusGroups,
      },
    };
  }

  /**
   * 花词张开检测（对应 Python _flower_opening_guard）
   * 用 right/left_hand_shape 组的 opening 索引（spread[5-9] + straightness[15-19]）
   * 计算"张开过程"得分：end-start 增量 + 全程幅度 → opening_score。
   * 花只做含苞不张开 → delta/range 小 → opening_score 低 → guard 不通过 → 不享受提分。
   */
  function flowerOpeningGuard(seq, profile, config) {
    const dtwCfg = semanticDtwConfig(profile);
    if (!profile || profile.word !== '花' || !dtwCfg.flower_opening_guard_enabled) {
      return { enabled: false, passed: true };
    }
    const openingIndices = [5, 6, 7, 8, 9, 15, 16, 17, 18, 19];
    const minScore = f32(dtwCfg.flower_opening_min_score, 0.30);
    const candidates = [];
    for (const group of ['right_hand_shape', 'left_hand_shape']) {
      if (!seq.features.length || !seq.features[0].groups || !seq.features[0].groups[group]) continue;
      const values = [];
      for (const item of seq.features) {
        const sl = item.groups[group];
        const seg = item.vector.slice(sl[0], sl[1]);
        const mseg = item.mask.slice(sl[0], sl[1]);
        let sum = 0, cnt = 0;
        for (const idx of openingIndices) {
          if (idx < seg.length && mseg[idx] > 0.5) { sum += seg[idx]; cnt++; }
        }
        if (cnt >= 4) values.push(sum / cnt);
      }
      if (values.length < 3) continue;
      const window = Math.max(1, Math.min(3, Math.round(values.length * 0.25)));
      const start = values.slice(0, window).reduce((a, b) => a + b, 0) / window;
      const end = values.slice(-window).reduce((a, b) => a + b, 0) / window;
      const delta = end - start;
      const valueRange = Math.max(...values) - Math.min(...values);
      const deltaScore = Math.max(0, Math.min(1, (delta - 0.035) / 0.120));
      const rangeScore = Math.max(0, Math.min(1, (valueRange - 0.420) / 0.200));
      const openingScore = 0.45 * deltaScore + 0.55 * rangeScore;
      candidates.push({ group, valid_count: values.length, start, end, delta, range: valueRange, delta_score: deltaScore, range_score: rangeScore, opening_score: openingScore });
    }
    let best = null;
    for (const c of candidates) if (!best || c.opening_score > best.opening_score) best = c;
    const bestScore = best ? best.opening_score : 0;
    return {
      enabled: true,
      passed: bestScore >= minScore,
      best_score: bestScore,
      min_score: minScore,
      best,
      candidates,
    };
  }

  /** 对应 _sequence_penalty：语义相位锚点惩罚 */
  function semanticPhaseAnchorPenalty(standard, query, profile) {
    const config = semanticDtwConfig(profile);
    if (!config.enabled || config.anchor_penalty_weight <= 0) return [0, { enabled: false }];
    let weighted = 0, weightSum = 0;
    const rows = [];
    for (const phase of config.anchor_phases) {
      const stdFrame = phaseAnchorFrame(standard, phase);
      const qryFrame = phaseAnchorFrame(query, phase);
      if (!stdFrame || !qryFrame) continue;
      const [dist, metrics] = frameDistance(stdFrame, qryFrame, profile);
      const semanticFocusDistance = metrics.weighted !== undefined ? metrics.weighted : dist;
      const phaseGap = Math.abs(f32(stdFrame.semanticPhase, 0) - f32(qryFrame.semanticPhase, 0));
      const anchorWeight = (phase >= 0.35 && phase <= 0.65) ? 1.25 : 1.0;
      weighted += anchorWeight * semanticFocusDistance;
      weightSum += anchorWeight;
      rows.push({
        target_phase: phase,
        standard_phase: f32(stdFrame.semanticPhase, 0),
        query_phase: f32(qryFrame.semanticPhase, 0),
        standard_frame_idx: stdFrame.frameIdx,
        query_frame_idx: qryFrame.frameIdx,
        phase_gap: phaseGap,
        distance: semanticFocusDistance,
      });
    }
    if (weightSum <= 1e-8) return [0, { enabled: false, reason: 'no_anchor_frames' }];
    const meanDistance = weighted / weightSum;
    return [config.anchor_penalty_weight * meanDistance, { enabled: true, anchor_penalty_weight: config.anchor_penalty_weight, mean_anchor_distance: meanDistance, anchors: rows }];
  }

  /** 对应 _score_scale_for_action_window */
  function scoreScaleForActionWindow(standard, actionWindow, baseScale) {
    const n = standard.features.length;
    const queryWindow = (actionWindow && actionWindow.query) || {};
    const queryContrast = f32(queryWindow.contrast, 1.0);
    const queryHasAction = queryContrast >= 1.15 && queryWindow.reason !== 'weak_energy_contrast';
    if (n < 12 && queryHasAction) {
      const scale = Math.min(0.180, baseScale * Math.sqrt(18.0 / Math.max(n, 1)));
      return [scale, { base_scale: baseScale, effective_scale: scale, reason: 'short_action_window_with_query_energy_peak', standard_action_length: n, query_contrast: queryContrast }];
    }
    return [baseScale, { base_scale: baseScale, effective_scale: baseScale, reason: 'default', standard_action_length: n, query_contrast: queryContrast }];
  }

  function dtwAlign(standard, query, profile, options) {
    const opts = options || {};
    // 模板（standard）由 Python 打包时已应用动态帧权重 + motion 特征；
    // query 由 rows 构造，需在此应用一次动态权重（对应 Python dtw_align 内 with_dynamic_frame_weights）。
    const fullStandard = opts.standardAlreadyDynamic ? standard : withDynamicFrameWeights(standard, profile);
    const fullQuery = opts.queryAlreadyDynamic ? query : withDynamicFrameWeights(query, profile);
    const standardWindow = semanticActionWindow(fullStandard);
    const queryWindow = semanticActionWindow(fullQuery);
    const standardAction = sliceSequenceWindow(fullStandard, standardWindow);
    const queryAction = sliceSequenceWindow(fullQuery, queryWindow);
    // 对应 Python _alignment_policy_for_window：仅当标准窗口很短且完整序列也不长时，
    // 才用语义能量窗口裁剪；否则保持完整序列对齐（如唱歌 27 帧模板）。
    const fullLen = fullStandard.features.length;
    const actionLen = standardWindow.length || fullLen;
    const shortStandardAction = actionLen < 12 && fullLen <= 24;
    const alignmentPolicy = {
      mode: shortStandardAction ? 'semantic_action_window' : 'full_sequence_with_action_window_diagnostics',
      used_action_window_for_scoring: shortStandardAction,
      reason: shortStandardAction ? 'short_standard_action_window' : 'long_or_context_sensitive_action_keep_full_sequence',
      standard_full_length: fullLen,
      standard_action_length: actionLen,
      standard_action_ratio: actionLen / Math.max(fullLen, 1),
    };
    let s = fullStandard, q = fullQuery;
    const temporalResample = {
      used: false,
      reason: 'full_sequence_alignment_policy',
      ratio: fullQuery.features.length / Math.max(fullLen, 1),
    };
    if (shortStandardAction) {
      s = standardAction;
      q = queryAction;
      // 对应 _maybe_resample_query_window：窗口模式下 query 远短于 standard 时线性重采样
      const m = q.features.length, n = s.features.length;
      if (m >= 4 && m / Math.max(n, 1) < 0.45) {
        q = resampleSequenceToLength(q, n);
        temporalResample.used = true;
        temporalResample.reason = 'linear_feature_interpolation_after_action_window';
        temporalResample.from_length = m;
        temporalResample.to_length = n;
      }
    }
    const n = s.features.length, m = q.features.length;
    const local = new Float32Array(n * m);
    const localMetrics = [];
    const phaseWeight = profile && profile.semantic_dtw && profile.semantic_dtw.enabled ? (profile.semantic_dtw.local_phase_weight || 0) : 0;

    // 局部距离矩阵快速路径：组权重/维度权重只算一次，批量累加（数值与原始 frameDistance 一致）
    const dctx = buildDistanceContext(s, q, profile);
    if (dctx.ready) {
      for (let i = 0; i < n; i++) {
        const a = s.features[i];
        const aw = dctx.sFW[i];
        for (let j = 0; j < m; j++) {
          const b = q.features[j];
          const [dist, metrics] = fastFrameDistance(dctx, i, j);
          const phaseGap = Math.abs(a.semanticPhase - b.semanticPhase);
          const phasePenalty = phaseWeight * Math.pow(phaseGap, 1.35);
          const pairWeight = 0.70 * aw + 0.30 * dctx.qFW[j];
          const scoringDist = dist + phasePenalty;
          local[i * m + j] = scoringDist * pairWeight;
          metrics.base_weighted = dist;
          metrics.semantic_phase_gap = phaseGap;
          metrics.semantic_phase_penalty = phasePenalty;
          metrics.frame_pair_weight = pairWeight;
          metrics.temporal_weighted_distance = local[i * m + j];
          metrics.standard_frame_weight = a.frameWeight;
          metrics.query_frame_weight = b.frameWeight;
          metrics.weighted = scoringDist;
          localMetrics.push(metrics);
        }
      }
    } else {
      // 兜底：组结构不一致等异常情况退回原始逐对 frameDistance，保证行为一致
      for (let i = 0; i < n; i++) {
        const a = s.features[i];
        for (let j = 0; j < m; j++) {
          const b = q.features[j];
          const [dist, metrics] = frameDistance(a, b, profile);
          const phaseGap = Math.abs(a.semanticPhase - b.semanticPhase);
          const phasePenalty = phaseWeight * Math.pow(phaseGap, 1.35);
          const pairWeight = pairTemporalWeight(a, b);
          const scoringDist = dist + phasePenalty;
          local[i * m + j] = scoringDist * pairWeight;
          metrics.base_weighted = dist;
          metrics.semantic_phase_gap = phaseGap;
          metrics.semantic_phase_penalty = phasePenalty;
          metrics.frame_pair_weight = pairWeight;
          metrics.temporal_weighted_distance = local[i * m + j];
          metrics.standard_frame_weight = a.frameWeight;
          metrics.query_frame_weight = b.frameWeight;
          metrics.weighted = scoringDist;
          localMetrics.push(metrics);
        }
      }
    }
    const localAt = (i, j) => local[i * m + j];
    const metricsAt = (i, j) => localMetrics[i * m + j];

    // DTW 累积
    const acc = new Float32Array(n * m).fill(Infinity);
    const back = new Int32Array(n * m * 2).fill(-1);
    acc[0] = localAt(0, 0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        if (i === 0 && j === 0) continue;
        let best = Infinity, bi = -1, bj = -1;
        if (i > 0) { const v = acc[(i - 1) * m + j]; if (v < best) { best = v; bi = i - 1; bj = j; } }
        if (j > 0) { const v = acc[i * m + (j - 1)]; if (v < best) { best = v; bi = i; bj = j - 1; } }
        if (i > 0 && j > 0) { const v = acc[(i - 1) * m + (j - 1)]; if (v < best) { best = v; bi = i - 1; bj = j - 1; } }
        acc[i * m + j] = localAt(i, j) + best;
        back[(i * m + j) * 2] = bi;
        back[(i * m + j) * 2 + 1] = bj;
      }
    }
    // 回溯
    const rawPath = [];
    let i = n - 1, j = m - 1;
    while (i >= 0 && j >= 0) {
      rawPath.push([i, j]);
      const pi = back[(i * m + j) * 2], pj = back[(i * m + j) * 2 + 1];
      if (pi < 0 || pj < 0) break;
      i = pi; j = pj;
    }
    rawPath.reverse();
    const [scoringPath, trimToleranceDetail] = trimTolerantScoringPath(rawPath, localMetrics, n, m);
    const path = scoringPath;

    // 分组误差统计
    const metricKeys = ['left_hand', 'right_hand', 'left_hand_shape', 'right_hand_shape',
      'left_hand_motion', 'right_hand_motion', 'left_hand_shape_motion', 'right_hand_shape_motion',
      'two_hand_relation', 'two_hand_relation_motion', 'pose', 'face', 'missing',
      'base_weighted', 'semantic_phase_gap', 'semantic_phase_penalty', 'weighted', 'hand_side_swapped'];
    const groupSums = {};
    for (const k of metricKeys) groupSums[k] = 0;
    let pathWeightSum = 0;
    for (const [pi, pj] of path) {
      const metrics = metricsAt(pi, pj);
      const pw = metrics.frame_pair_weight || 1;
      pathWeightSum += pw;
      for (const k of metricKeys) groupSums[k] += pw * (metrics[k] || 0);
    }
    const denom = Math.max(pathWeightSum, 1e-6);
    const groupMean = {};
    for (const k of metricKeys) groupMean[k] = groupSums[k] / denom;

    // 对齐路径每步的加权距离（供 ② 判别器的路径成本分段特征；与 Python alignment_path 的 distance 对应）
    const alignmentWeighted = path.map(([pi, pj]) => {
      const metrics = metricsAt(pi, pj);
      return metrics.weighted || 0;
    });

    // ---- 语义阶段距离（按标准帧 semantic_phase 等分阶段，DTW 路径分组聚合） ----
    // 用于评分后对每个核心语义阶段给出针对性指导建议。
    const stageCount = Math.max(1, Math.min(opts.stageCount || 2, 12));
    const stageWeighted = new Array(stageCount).fill(0);
    const stageWeightSum = new Array(stageCount).fill(0);
    const stageFrameCount = new Array(stageCount).fill(0);
    for (const [pi, pj] of path) {
      const metrics = metricsAt(pi, pj);
      const pw = metrics.frame_pair_weight || 1;
      const phase = s.features[pi] && isFiniteNumber(s.features[pi].semanticPhase) ? s.features[pi].semanticPhase : 0;
      const stage = Math.max(0, Math.min(stageCount - 1, Math.floor(phase * stageCount)));
      stageWeighted[stage] += pw * (metrics.weighted || 0);
      stageWeightSum[stage] += pw;
      stageFrameCount[stage] += 1;
    }
    const stageDistances = [];
    for (let k = 0; k < stageCount; k++) {
      stageDistances.push(stageWeightSum[k] > 1e-6 ? stageWeighted[k] / stageWeightSum[k] : null);
    }
    // ---- 语义阶段完整性（G1 门控：覆盖率/动静/目标形态/缺失判定） ----
    // 阈值优先级：scoreQuery 传入的校准配置（opts.stageGate）> profile.semantic_dtw 的 stage_gate_* > 默认
    const sg = (opts && opts.stageGate) || {};
    const focusGroups = (profile && Array.isArray(profile.focus_groups) && profile.focus_groups.length)
      ? profile.focus_groups.map(String)
      : [];
    const stageCompleteness = semanticStageCompleteness(s, q, path, stageCount, stageDistances, {
      cov_threshold: f32(sg.stage_gate_cov_threshold ?? (profile && profile.semantic_dtw && profile.semantic_dtw.stage_gate_cov_threshold), 0.15),
      dist_ratio_threshold: f32(profile && profile.semantic_dtw && profile.semantic_dtw.stage_gate_dist_ratio_threshold, 1.6),
      dist_abs_threshold: f32(profile && profile.semantic_dtw && profile.semantic_dtw.stage_gate_dist_abs_threshold, 0.08),
      motion_threshold: f32(profile && profile.semantic_dtw && profile.semantic_dtw.stage_gate_motion_threshold, 0.02),
      shape_gate_ratio_threshold: f32(sg.stage_gate_shape_ratio_threshold ?? (profile && profile.semantic_dtw && profile.semantic_dtw.stage_gate_shape_ratio_threshold), 0.75),
      shape_gate_min_span: f32(sg.stage_gate_shape_min_span ?? (profile && profile.semantic_dtw && profile.semantic_dtw.stage_gate_shape_min_span), 1e9),
      length_min_ratio: f32(sg.stage_gate_length_min_ratio ?? (profile && profile.semantic_dtw && profile.semantic_dtw.stage_gate_length_min_ratio), 0.6),
      gate_cap: f32(sg.stage_gate_cap ?? (profile && profile.semantic_dtw && profile.semantic_dtw.stage_gate_cap), 60),
      per_stage_cov: sg.stage_gate_per_stage_cov || null,
      per_stage_shape_ratio: sg.stage_gate_per_stage_shape_ratio || null,
      anchor_standards: opts && opts.anchorStandards ? opts.anchorStandards : null,
      focus_groups: focusGroups,
    });

    // trim 生效时用 penalized_distance 作为 dtw（对应 Python dtw_align 的 trim_tolerance）
    const dtwDistance = trimToleranceDetail.used ? trimToleranceDetail.penalized_distance : groupMean.weighted;
    const normalizedDistance = dtwDistance;

    // ---- 序列级惩罚（对应 _sequence_penalty 全量） ----
    const seqGroups = sequenceGroups(s);
    const hds = handDynamicScale(profile, seqGroups);
    const lengthRatio = Math.min(n, m) / Math.max(n, m, 1);
    const positiveLikeFloor = 0.50;
    let lengthPenalty = 0;
    if (lengthRatio < positiveLikeFloor) lengthPenalty = 0.28 * ((positiveLikeFloor - lengthRatio) / positiveLikeFloor);
    const temporalProfileFactor = lengthRatio <= 0.50 ? 0 : Math.min(1.0, (lengthRatio - 0.50) / 0.45);
    const standardPresence = presenceRatio(s);
    const queryPresence = presenceRatio(q);
    const penaltyWeights = profileGroupWeights(profile, seqGroups);
    const [presenceDelta, presenceSwapped] = maybeSwapHandDelta(standardPresence, queryPresence,
      ['left_hand', 'right_hand', 'pose', 'face'], penaltyWeights, profile, false);
    let presencePenalty = 0;
    for (const g of Object.keys(presenceDelta)) presencePenalty += f32(penaltyWeights[g], 0) * presenceDelta[g];
    presencePenalty *= 0.14;
    const standardMotion = sequenceMotionByGroup(s);
    const queryMotion = sequenceMotionByGroup(q);
    const [motionDelta, motionSwapped] = maybeSwapHandDelta(standardMotion, queryMotion, seqGroups, penaltyWeights, profile, true);
    let motionPenalty = 0;
    for (const g of Object.keys(motionDelta)) motionPenalty += f32(penaltyWeights[g], 0) * motionDelta[g];
    motionPenalty = temporalProfileFactor * 0.025 * hds * motionPenalty;
    const standardRoughness = sequenceRoughnessByGroup(s);
    const queryRoughness = sequenceRoughnessByGroup(q);
    const [roughnessDelta, roughnessSwapped] = maybeSwapHandDelta(standardRoughness, queryRoughness, seqGroups, penaltyWeights, profile, true);
    let roughnessPenalty = 0;
    for (const g of Object.keys(roughnessDelta)) roughnessPenalty += f32(penaltyWeights[g], 0) * roughnessDelta[g];
    roughnessPenalty = temporalProfileFactor * 0.095 * hds * roughnessPenalty;
    let infoPenalty = 0;
    if (m < 4 && n >= 8) infoPenalty = 0.16;
    else if (m < 0.25 * n) infoPenalty = 0.08;
    let endpointPenalty = 0;
    if (n >= 12 && lengthRatio >= 0.90 && s.features.length && q.features.length) {
      const startDist = frameDistance(s.features[0], q.features[0], profile)[0];
      const endDist = frameDistance(s.features[s.features.length - 1], q.features[q.features.length - 1], profile)[0];
      endpointPenalty = 0.30 * Math.max(0, ((startDist + endDist) / 2.0) - 0.02);
    }
    const handInfoStandard = Math.max(standardPresence.left_hand, standardPresence.right_hand);
    const handInfoQuery = Math.max(queryPresence.left_hand, queryPresence.right_hand);
    let confidenceWarningPenalty = 0;
    if (handInfoStandard < 0.20 || handInfoQuery < 0.20) confidenceWarningPenalty = 0.04;
    const [semanticDeltaPenalty, semanticDeltaDetail] = semanticDeltaPenaltyFn(s, q, profile);
    const [semanticAnchorPenaltyRaw, semanticAnchorDetail] = semanticPhaseAnchorPenalty(s, q, profile);
    const semanticAnchorPenalty = semanticAnchorPenaltyRaw * Math.min(hds, 1.35);
    const totalSequencePenalty = lengthPenalty + presencePenalty + motionPenalty + roughnessPenalty
      + infoPenalty + endpointPenalty + confidenceWarningPenalty
      + semanticDeltaPenalty * hds + semanticAnchorPenalty;
    const sequencePenalty = {
      length_ratio: lengthRatio,
      length_penalty: lengthPenalty,
      temporal_profile_factor: temporalProfileFactor,
      hand_dynamic_scale: hds,
      presence_delta: presenceDelta,
      presence_hand_side_swapped: presenceSwapped,
      presence_penalty: presencePenalty,
      required_presence_penalty: 0,
      required_presence_detail: {},
      motion_delta: motionDelta,
      motion_hand_side_swapped: motionSwapped,
      motion_penalty: motionPenalty,
      dynamic_required_penalty: 0,
      dynamic_required_detail: {},
      roughness_delta: roughnessDelta,
      roughness_hand_side_swapped: roughnessSwapped,
      roughness_penalty: roughnessPenalty,
      info_penalty: infoPenalty,
      endpoint_penalty: endpointPenalty,
      confidence_warning_penalty: confidenceWarningPenalty,
      semantic_delta_penalty: semanticDeltaPenalty * hds,
      semantic_delta_detail: semanticDeltaDetail,
      semantic_anchor_penalty: semanticAnchorPenalty,
      semantic_anchor_detail: semanticAnchorDetail,
      total_sequence_penalty: totalSequencePenalty,
    };
    // ---- score_scale（对应 _score_scale_for_action_window，先于 tolerance 计算） ----
    const baseScoreScale = (profile && profile.score_scale) ? profile.score_scale : SCORE_SCALE;
    const actionWindow = { standard: standardWindow, query: queryWindow, used_for_scoring: alignmentPolicy.used_action_window_for_scoring };
    const [baseEffectiveScoreScale, scoreScaleDetail] = scoreScaleForActionWindow(s, actionWindow, baseScoreScale);
    let effectiveScoreScale = baseEffectiveScoreScale;
    // ---- tolerance（对应 dtw_align：short_action_subsample 与 semantic_phase_trim 二选一） ----
    const dtwCfg = semanticDtwConfig(profile);
    const semanticCoreQueryHandPresence = semanticCoreHandPresence(q, profile, queryWindow);
    const scoringLengthRatio = Math.min(n, m) / Math.max(n, m, 1);
    let normalized = dtwDistance + sequencePenalty.total_sequence_penalty;
    let semanticPhaseTrimTolerance = 0, shortActionSubsampleTolerance = 0;
    if (
      scoreScaleDetail.reason === 'short_action_window_with_query_energy_peak'
      && scoringLengthRatio >= 0.60 && scoringLengthRatio <= 1.05
      && dtwDistance < 0.055
      && sequencePenalty.total_sequence_penalty > 0
    ) {
      shortActionSubsampleTolerance = Math.min(0.045, 0.65 * sequencePenalty.total_sequence_penalty);
      normalized = Math.max(dtwDistance, normalized - shortActionSubsampleTolerance);
      sequencePenalty.short_action_subsample_tolerance = -shortActionSubsampleTolerance;
      sequencePenalty.total_sequence_penalty_after_tolerance = normalized - dtwDistance;
    } else if (
      !alignmentPolicy.used_action_window_for_scoring
      && scoringLengthRatio >= 0.70 && scoringLengthRatio <= 1.0
      && dtwDistance < 0.012
      && sequencePenalty.total_sequence_penalty > 0
    ) {
      semanticPhaseTrimTolerance = Math.min(0.018, 0.45 * sequencePenalty.total_sequence_penalty);
      normalized = Math.max(dtwDistance, normalized - semanticPhaseTrimTolerance);
      sequencePenalty.semantic_phase_trim_tolerance = -semanticPhaseTrimTolerance;
      sequencePenalty.total_sequence_penalty_after_tolerance = normalized - dtwDistance;
    }
    // ---- visible_semantic_core_tolerance（对应 dtw_align：可见核心语义时宽容序列惩罚） ----
    let visibleSemanticCoreTolerance = 0;
    if (
      profile && hds > 1.0
      && semanticCoreQueryHandPresence >= dtwCfg.core_visible_presence_threshold
      && dtwDistance < dtwCfg.core_visible_dtw_threshold
      && f32(sequencePenalty.total_sequence_penalty_after_tolerance, sequencePenalty.total_sequence_penalty) > 0
    ) {
      const currentPenalty = f32(sequencePenalty.total_sequence_penalty_after_tolerance, sequencePenalty.total_sequence_penalty);
      visibleSemanticCoreTolerance = Math.min(dtwCfg.visible_core_tolerance_cap, 0.82 * currentPenalty);
      normalized = Math.max(dtwDistance, normalized - visibleSemanticCoreTolerance);
      sequencePenalty.visible_semantic_core_tolerance = -visibleSemanticCoreTolerance;
      sequencePenalty.total_sequence_penalty_after_tolerance = normalized - dtwDistance;
    }
    // ---- visible_semantic_core_scale（对应 dtw_align：可见核心语义时用更宽 scale 提分） ----
    // Python 侧受 flower_opening / flower_jump_confusion / phase_order 三个 guard 约束；
    // JS 已移植 flower_opening_guard（花词缺张开 → guard 不通过 → 不享受提分）。
    const flowerOpening = flowerOpeningGuard(q, profile, dtwCfg);
    const semanticCoreGuardPassed = !flowerOpening.enabled || flowerOpening.passed;
    let coreVisibleScaleUsed = false;
    if (
      profile && semanticCoreGuardPassed
      && semanticCoreQueryHandPresence >= dtwCfg.core_visible_presence_threshold
      && dtwDistance <= dtwCfg.core_visible_dtw_threshold
      && normalized <= dtwCfg.core_visible_max_normalized_distance
      && dtwCfg.core_visible_score_scale > effectiveScoreScale
    ) {
      effectiveScoreScale = dtwCfg.core_visible_score_scale;
      coreVisibleScaleUsed = true;
      scoreScaleDetail.reason = 'visible_semantic_core_scale';
    }
    scoreScaleDetail.core_visible_scale_used = coreVisibleScaleUsed;
    scoreScaleDetail.flower_opening_guard = flowerOpening;
    scoreScaleDetail.semantic_core_guard_passed = semanticCoreGuardPassed;
    // ---- noise_floor（对应 dtw_align 的 score 前噪声下限） ----
    let noiseFloor = 0;
    if (
      scoreScaleDetail.reason === 'short_action_window_with_query_energy_peak'
      && dtwDistance < 0.060
      && semanticCoreQueryHandPresence >= 0.50
    ) {
      noiseFloor = Math.min(0.020, 0.35 * dtwDistance);
    } else if (hds > 1.0 && dtwDistance < 0.025 && normalized < 0.060 && semanticCoreQueryHandPresence >= 0.60) {
      noiseFloor = Math.min(0.016, 0.65 * dtwDistance);
    }
    scoreScaleDetail.noise_floor_distance = noiseFloor;
    scoreScaleDetail.semantic_phase_trim_tolerance = semanticPhaseTrimTolerance;
    scoreScaleDetail.short_action_subsample_tolerance = shortActionSubsampleTolerance;
    scoreScaleDetail.visible_semantic_core_tolerance = visibleSemanticCoreTolerance;
    scoreScaleDetail.semantic_core_query_hand_presence = semanticCoreQueryHandPresence;
    const scoreDistance = Math.max(0, normalized - noiseFloor);
    scoreScaleDetail.effective_scale = effectiveScoreScale;
    let prototypeScore = 100 * Math.exp(-scoreDistance / effectiveScoreScale);
    prototypeScore = Math.max(0, Math.min(100, prototypeScore));

    return {
      standard_length: n,
      query_length: m,
      path_length: path.length,
      raw_path_length: rawPath.length,
      path_weight_sum: pathWeightSum,
      trim_tolerance: trimToleranceDetail,
      dtw_distance: dtwDistance,
      stage_distances: stageDistances,
      stage_weight_sum: stageWeightSum,
      stage_frame_count: stageFrameCount,
      stage_completeness: stageCompleteness,
      normalized_distance: normalized,
      prototype_score: prototypeScore,
      sequence_penalty: sequencePenalty,
      score_scale: scoreScaleDetail,
      group_mean: groupMean,
      alignment_policy: alignmentPolicy,
      action_window: actionWindow,
      temporal_resample: temporalResample,
      alignment_path: path,
      alignment_weighted: alignmentWeighted,
      features_standard: s.features,
      features_query: q.features,
    };
  }

  /** 入口：加载模板 + query rows → 评分结果 */
  /**
   * ② 判别器特征向量（与 Python train_stage_discriminator 的 _feature_vector 一致）
   * 布局：stage_distances[7] + cov[7] + focus_dists[M] +
   *       [len_ratio, motion_mean, norm_distance] +
   *       seg_costs[3]（对齐路径前/中/后 1/3 平均加权距离）+
   *       compress[7]（-log(max(cov,0.05))）+ slopes[6]（阶段距离差分）+
   *       [motion_std, hand_presence_delta]
   */
  function buildDiscriminatorFeatures(base, profile, stageCount) {
    if (!base) return null;
    const MAX_STAGE = 7;
    const stageD = new Array(MAX_STAGE).fill(0);
    for (let k = 0; k < MAX_STAGE; k++) {
      const v = base.stage_distances && base.stage_distances[k];
      stageD[k] = (v != null && isFiniteNumber(v)) ? v : (k < stageCount ? 1.0 : 0.0);
    }
    const cov = new Array(MAX_STAGE).fill(0);
    const completeness = base.stage_completeness || {};
    const covRaw = completeness.stage_coverage || [];
    for (let k = 0; k < MAX_STAGE; k++) cov[k] = k < covRaw.length ? covRaw[k] : 0;
    const focus = (profile && Array.isArray(profile.focus_groups)) ? profile.focus_groups.map(String) : [];
    const focusDists = focus.map(g => {
      const v = base.group_mean && base.group_mean[g];
      return (v != null && isFiniteNumber(v)) ? v : 0;
    });
    const n = base.standard_length || 0, m = base.query_length || 0;
    const lenRatio = Math.min(n, m) / Math.max(Math.max(n, m), 1);
    const motions = (completeness.stage_motion || []).filter(v => v != null && isFiniteNumber(v));
    const motionMean = motions.length ? motions.reduce((s, v) => s + v, 0) / motions.length : 0;
    const motionStd = motions.length > 1
      ? Math.sqrt(motions.reduce((s, v) => s + (v - motionMean) * (v - motionMean), 0) / motions.length) : 0;
    // norm_dist：与 Python dtw_align 的 normalized_distance 口径一致（dtw + 序列惩罚）
    const sp = base.sequence_penalty || {};
    const normDist = base.dtw_distance + (sp.total_sequence_penalty_after_tolerance != null && isFiniteNumber(sp.total_sequence_penalty_after_tolerance)
      ? sp.total_sequence_penalty_after_tolerance
      : (sp.total_sequence_penalty != null && isFiniteNumber(sp.total_sequence_penalty) ? sp.total_sequence_penalty : 0));
    // 对齐路径成本分段（前/中/后 1/3 平均加权距离）
    const segCosts = [0, 0, 0];
    const aw = base.alignment_weighted;
    if (aw && aw.length) {
      const total = aw.length;
      for (let s = 0; s < 3; s++) {
        const lo = Math.floor(total * s / 3), hi = Math.floor(total * (s + 1) / 3);
        const seg = aw.slice(lo, hi);
        if (seg.length) segCosts[s] = seg.reduce((a, b) => a + b, 0) / seg.length;
      }
    }
    // 阶段压缩率
    const compress = cov.map(c => Math.min(5, -Math.log(Math.max(c, 0.05))));
    // 阶段距离包络斜率
    const slopes = [];
    for (let k = 0; k < MAX_STAGE - 1; k++) slopes.push(Math.abs(stageD[k + 1] - stageD[k]));
    // 手部 presence 差
    const presenceDelta = (base.sequence_penalty && base.sequence_penalty.presence_delta) || {};
    const handPresenceDelta = Math.max(
      (presenceDelta.left_hand != null && isFiniteNumber(presenceDelta.left_hand)) ? presenceDelta.left_hand : 0,
      (presenceDelta.right_hand != null && isFiniteNumber(presenceDelta.right_hand)) ? presenceDelta.right_hand : 0,
    );
    return stageD.concat(cov, focusDists, [lenRatio, motionMean, normDist],
      segCosts, compress, slopes, [motionStd, handPresenceDelta]);
  }

  function scoreQuery(template, queryRows, fps, totalFrames, options) {
    const opts = options || {};
    const profile = template.profile || null;
    const query = sequenceFromRows(queryRows, fps, totalFrames);
    const stageCount = Math.max(1, Math.min(opts.stageCount || 2, 12));
    // 多模板并集：每词打包 1~3 个标准模板（多用户），距离取最小 top-2 截尾均值
    const templateList = (template.templates && template.templates.length)
      ? template.templates
      : [template];
    const results = templateList.map(tpl => {
      const standard = {
        source: template.word,
        mode: 'landmark',
        fps: tpl.fps || template.fps || fps || DEFAULT_FPS,
        totalFrames: tpl.total_frames || (tpl.features ? tpl.features.length : 0),
        features: (tpl.features || template.features).map(f => ({
          frameIdx: f.frame_idx, timestampSec: f.timestamp_sec,
          vector: f.vector, mask: f.mask, groups: f.groups,
          presence: f.presence, frameWeight: f.frame_weight, semanticPhase: f.semantic_phase || 0,
        })),
      };
      // 多模板锚点：其他模板的 standard（供 G1 目标形态检测跨用户鲁棒）
      const anchorStandards = templateList
        .filter(other => other !== tpl)
        .map(other => ({
          source: template.word,
          mode: 'landmark',
          fps: other.fps || template.fps || fps || DEFAULT_FPS,
          totalFrames: other.total_frames || (other.features ? other.features.length : 0),
          features: (other.features || template.features).map(f => ({
            frameIdx: f.frame_idx, timestampSec: f.timestamp_sec,
            vector: f.vector, mask: f.mask, groups: f.groups,
            presence: f.presence, frameWeight: f.frame_weight, semanticPhase: f.semantic_phase || 0,
          })),
        }));
      // 模板打包时已应用动态帧权重 + motion 特征，标记已动态避免二次应用
      return dtwAlign(standard, query, profile, {
        standardAlreadyDynamic: true, stageCount, stageGate: opts.stageGate, anchorStandards,
      });
    });
    // 聚合距离（对应校准的 aggregate_template_distance：最小 top-2 均值）
    const distances = results.map(r => r.normalized_distance).sort((a, b) => a - b);
    const aggregatedDistance = distances.length >= 2
      ? (distances[0] + distances[1]) / 2
      : distances[0];
    // 层 3 包络软化（对应校准 soften_distance：q50 内 ×0.35，q50→q90 斜率 0.5，超 q90 全罚）
    let softenedDistance = aggregatedDistance;
    const envelope = template.envelope;
    if (envelope && envelope.q50 > 0 && envelope.q90 > envelope.q50) {
      softenedDistance = softenEnvelopeDistance(aggregatedDistance, envelope.q50, envelope.q90, 0.35, 0.5);
    }
    const base = results[0];
    const scoreScaleDetail = base.score_scale || {};
    const noiseFloor = scoreScaleDetail.noise_floor_distance || 0;
    const scoreDistance = Math.max(0, softenedDistance - noiseFloor);
    const effectiveScale = scoreScaleDetail.effective_scale || 0.12;
    // 总分映射：有包络时用线性映射（中位正样本≈100、q90 边界≈80、超出骤降），
    // 保证"正确实现并集内"的高分与通过线 80 兼容；无包络回退原指数映射。
    let prototypeScore;
    if (envelope && envelope.q50 > 0 && envelope.q90 > envelope.q50) {
      const softBase = softenEnvelopeDistance(envelope.q50, envelope.q50, envelope.q90, 0.35, 0.5);
      const softQ90 = softenEnvelopeDistance(envelope.q90, envelope.q50, envelope.q90, 0.35, 0.5);
      const z = (softenedDistance - softBase) / Math.max(softQ90 - softBase, 1e-6);
      prototypeScore = z <= 1 ? 100 - 20 * z : 80 - 35 * (z - 1);
      prototypeScore = Math.max(0, Math.min(100, prototypeScore));
    } else {
      prototypeScore = 100 * Math.exp(-scoreDistance / effectiveScale);
      prototypeScore = Math.max(0, Math.min(100, prototypeScore));
    }

    // ---- 语义阶段指标：top-2 模板阶段距离均值 → 相对总距离 ratio → 阶段得分/短板 ----
    const sortedResults = [...results].sort((a, b) => a.normalized_distance - b.normalized_distance);
    const topResults = sortedResults.slice(0, 2);
    const stageDistances = [];
    for (let k = 0; k < stageCount; k++) {
      const values = topResults.map(r => r.stage_distances && r.stage_distances[k]).filter(v => v != null && Number.isFinite(v));
      stageDistances.push(values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);
    }
    const stageRatios = stageDistances.map(d =>
      (d != null && aggregatedDistance > 1e-6) ? d / aggregatedDistance : 1.0
    );
    const stageScores = stageRatios.map(ratio => Math.max(0, Math.min(100, 100 * (2 - ratio))));
    const stageWeak = stageRatios.map((ratio, k) => ratio > 1.2 && stageDistances[k] != null);

    // ---- 局部语义评分：按 landmark 局部特征组（静态组 + 帧序列动态 motion 组）加权综合 ----
    // 基于加权数据库：各组距离相对正样本组距离包络（group_envelope q50/q90）打分，
    // 综合分 = Σ w_g·localScore_g / Σ w_g（w_g = 判别力 group_weights）。
    // 动态组（*_motion）表达帧序列过程特征（如手部打开/移动过程），
    // 权重由 relative_motion_weight × 对应静态组权重决定（profileGroupWeights）。
    const GROUP_KEYS = ['pose', 'left_hand', 'right_hand', 'left_hand_shape', 'right_hand_shape', 'face', 'two_hand_relation',
      'left_hand_motion', 'right_hand_motion', 'left_hand_shape_motion', 'right_hand_shape_motion', 'two_hand_relation_motion'];
    const groupEnvelope = template.group_envelope || {};
    let groupMeans = {};
    if (topResults.length) {
      for (const g of GROUP_KEYS) {
        const values = topResults.map(r => r.group_mean && r.group_mean[g]).filter(v => v != null && Number.isFinite(v));
        groupMeans[g] = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
      }
    }
    // 局部语义评分只针对该词的核心语义组（focus_groups）：
    // 非核心组（如谗的左手/姿态）做错不影响总分，也不显示分数/判 weak，避免"总分 100 却显示一堆低分"的视觉矛盾。
    const focusGroups = (profile && Array.isArray(profile.focus_groups) && profile.focus_groups.length)
      ? profile.focus_groups.map(String)
      : null;
    const localScores = {};
    const groupWeak = {};
    for (const g of GROUP_KEYS) {
      // 局部评分只显示该词核心语义组（focus_groups）——用户确认 v2 行为：
      // 面板只需词汇对应核心局部的打分，非核心组（如谗的左手/姿态）不显示
      if (focusGroups && !focusGroups.includes(g)) {
        localScores[g] = null;
        groupWeak[g] = false;
        continue;
      }
      const env = groupEnvelope[g];
      const d = groupMeans[g];
      if (!env || d == null || !(env.q90 > env.q50)) {
        localScores[g] = null;
        groupWeak[g] = false;
        continue;
      }
      const z = (d - env.q50) / Math.max(env.q90 - env.q50, 1e-6);
      const score = z <= 0 ? 100 : z <= 1 ? 100 - 25 * z : 75 - 35 * (z - 1);
      localScores[g] = Math.max(0, Math.min(100, score));
      groupWeak[g] = localScores[g] < 80;
    }
    // 加权综合语义分（只使用该词核心语义组 focus_groups 的权重；motion 组按 relative_motion_weight×base 计算）
    const weightTable = profileGroupWeights(profile, GROUP_KEYS);
    let weightedSum = 0, weightTotal = 0;
    for (const g of GROUP_KEYS) {
      if (focusGroups && !focusGroups.includes(g)) continue;
      const w = Number(weightTable[g]) || 0;
      if (w > 0 && localScores[g] != null) { weightedSum += w * localScores[g]; weightTotal += w; }
    }
    const groupCompositeScore = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;
    const hasGroupEnvelope = Object.keys(groupEnvelope).length > 0;
    // 总分与核心组评分联动：取 min(总体包络分, 核心组加权评分)——
    // 核心组严重做错（如超市 right_hand 0 分）时总分必须明显降低，
    // 避免"核心局部全错却接近通过线"的虚高。交叉验证判定基于距离阈值，不受影响。
    if (groupCompositeScore != null && focusGroups) {
      prototypeScore = Math.min(prototypeScore, groupCompositeScore);
    }
    void hasGroupEnvelope;

    // ---- 语义阶段完整性门控（G1）：最近模板的完整性结果 + 硬性封顶 ----
    // 缺核心语义阶段（动态阶段覆盖率过低 / 阶段距离超限 / 序列截断）时分数封顶，
    // 避免"缺阶段仍高分"。gate 在组联动之后应用（硬性约束放最后）。
    const gateBase = base.stage_completeness || null;
    let stageGate = gateBase ? gateBase.gate : { level: 'passed', cap: 60, blocked: false, capped: false, passed: true };
    const stageGateApplied = gateBase && stageGate.level !== 'passed';
    if (stageGateApplied) {
      const cap = f32(stageGate.cap, 60);
      if (prototypeScore > cap) prototypeScore = cap;
    }

    // ---- ② 高维判别软压分（乱做/错词）：判别决策值 < 基线 → 乘性压分 ----
    // 特征与 Python train_stage_discriminator 的 _feature_vector 一致；
    // 弱词（AUC<0.85）不启用（依赖 G1 硬门兜底）。
    let discriminator = null;
    const discCfg = (opts && opts.discriminators && opts.discriminators.words && opts.discriminators.words[template.word]) || null;
    if (discCfg && discCfg.enabled && base) {
      const feat = buildDiscriminatorFeatures(base, profile, stageCount);
      if (feat && feat.length === discCfg.feature_dim) {
        let dec = discCfg.intercept;
        for (let i = 0; i < feat.length; i++) dec += discCfg.coef[i] * ((feat[i] - discCfg.mean[i]) / Math.max(discCfg.scale[i], 1e-9));
        const baseline = f32(discCfg.decision_baseline, 0);
        if (dec < baseline) {
          const maxPenalty = f32(discCfg.max_penalty, 0.5);
          const coeff = 1 - maxPenalty / (1 + Math.exp(-(dec - baseline) / 2));
          prototypeScore = Math.max(0, prototypeScore * coeff);
          discriminator = { applied: true, decision: dec, coefficient: coeff, auc: discCfg.auc };
        } else {
          discriminator = { applied: false, decision: dec, coefficient: 1, auc: discCfg.auc };
        }
      }
    }

    return {
      standard_length: base.standard_length,
      query_length: base.query_length,
      template_count: results.length,
      template_results: results.map(r => ({
        dtw_distance: r.dtw_distance,
        normalized_distance: r.normalized_distance,
        prototype_score: r.prototype_score,
      })),
      aggregated_distance: aggregatedDistance,
      softened_distance: softenedDistance,
      envelope_used: !!envelope,
      stage_count: stageCount,
      stage_distances: stageDistances,
      stage_ratios: stageRatios,
      stage_scores: stageScores,
      stage_weak: stageWeak,
      stage_coverage: gateBase ? gateBase.stage_coverage : null,
      stage_motion: gateBase ? gateBase.stage_motion : null,
      stage_dynamic: gateBase ? gateBase.stage_dynamic : null,
      stage_missing: gateBase ? gateBase.stage_missing : null,
      stage_gate: stageGate,
      stage_gate_applied: stageGateApplied,
      stage_gate_reasons: gateBase ? gateBase.reasons : [],
      discriminator,
      group_scores: localScores,
      group_weak: groupWeak,
      group_focus: focusGroups || [],
      group_mean: groupMeans,
      group_composite_score: groupCompositeScore,
      group_envelope_used: hasGroupEnvelope,
      dtw_distance: softenedDistance,
      normalized_distance: softenedDistance,
      prototype_score: prototypeScore,
      score_distance: scoreDistance,
      sequence_penalty: base.sequence_penalty,
      score_scale: scoreScaleDetail,
      alignment_policy: base.alignment_policy,
      features_standard: base.features_standard,
      features_query: base.features_query,
    };
  }

  /** 包络软化：并集内（≤q90）距离打折，超出全罚；与 Python 校准 soften_distance 一致 */
  function softenEnvelopeDistance(d, q50, q90, insideScale, rampSlope) {
    if (!(d >= 0) || !(q90 > q50)) return d;
    if (d <= q50) return insideScale * d;
    if (d <= q90) return insideScale * q50 + rampSlope * (d - q50);
    return insideScale * q50 + rampSlope * (q90 - q50) + (d - q90);
  }

  global.ScorerCore = {
    scoreQuery,
    sequenceFromRows,
    dtwAlign,
    withDynamicFrameWeights,
    frameDistance,
    // 暴露常量便于测试对照
    constants: {
      POSE_CORE_INDICES, FACE_CORE_INDICES, GROUP_WEIGHTS,
      HAND_GROUPS, RELATIVE_MOTION_GROUPS, FINGER_TIPS, FINGER_MCPS, FINGER_PIPS, FINGER_DIPS, SPREAD_PAIRS,
    },
    _internal: { landmarkArray, handShapeFeature, normalizationFromPose, groupDistance, groupDistanceBetween, profileGroupWeights, computeSemanticFrameWeightValues, semanticPhaseFromWeights, adjacentGroupMotion, dimensionWeights, weightedRmse, twoHandRelationFeature, sequenceWithRelativeMotionFeatures, poseRobustHandDistance, similarityAlignedXyRmse, svd2x2, groupMissingDistanceWeight, softenEnvelopeDistance, buildDistanceContext, fastFrameDistance, fastGroupDistance, fastPoseRobustHandDistance },
  };
})(typeof window !== 'undefined' ? window : globalThis);
