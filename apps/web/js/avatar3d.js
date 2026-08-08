/*
 * 手语小宇宙 — 21 词语义 3D 动作形象 MVP
 *
 * 这是一个 privacy-safe、无外部模型依赖的 2.5D/3D 风格渲染器：
 *   1. 底层：由 A-Z 教学示意图抽象出的匿名实体教学人物，表达手语动作本身；
 *   2. 上层：根据公开语义合同和 A–Z 示意资料绘制的相似物叠加层；
 *   3. 顶层：当前语义阶段和双层图例，方便学习者理解“动作”与“所指事物”。
 *
 * 这里不读取真人视频、landmark、用户编号或私有路径。动作 profile 与
 * apps/web/assets/content/interactive_learning_contracts.json 的 21 个公开合同保持
 * 同一词序和语义过程；未来可以将 profile 替换为审核通过的自有 3D rig。
 */
(function (global) {
  'use strict';

  const BONES = [
    ['head', 'neck'], ['neck', 'leftShoulder'], ['neck', 'rightShoulder'],
    ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
    ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
    ['neck', 'pelvis'], ['pelvis', 'leftHip'], ['pelvis', 'rightHip'],
    ['leftWrist', 'leftPalm'], ['rightWrist', 'rightPalm'],
    ['leftPalm', 'leftIndex'], ['rightPalm', 'rightIndex'],
    ['leftPalm', 'leftThumb'], ['rightPalm', 'rightThumb']
  ];

  const BASE = {
    head: [0, 1.48, 0], neck: [0, 1.18, 0],
    leftShoulder: [-0.28, 1.12, 0], rightShoulder: [0.28, 1.12, 0],
    leftElbow: [-0.48, 0.83, 0], rightElbow: [0.48, 0.83, 0],
    leftWrist: [-0.48, 0.55, 0], rightWrist: [0.48, 0.55, 0],
    leftPalm: [-0.48, 0.43, 0], rightPalm: [0.48, 0.43, 0],
    leftIndex: [-0.48, 0.19, 0], rightIndex: [0.48, 0.19, 0],
    leftThumb: [-0.34, 0.30, 0], rightThumb: [0.34, 0.30, 0],
    pelvis: [0, 0.61, 0], leftHip: [-0.16, 0.52, 0], rightHip: [0.16, 0.52, 0]
  };

  const ALIASES = {
    '谗（羡慕）': '馋',
    '谗': '馋',
    '汽车（一）': '汽车',
    '汽车1': '汽车',
    '汽车（二）': '汽车（二）',
    '汽车2': '汽车（二）',
    '船': '船（轮船）',
    '轮船': '船（轮船）',
    '人们': '人们（人民）',
    '人民': '人们（人民）'
  };

  // 21 个 profile 的 phase 文本与公开 semantic_process_contracts 保持一致。
  const PROFILES = {
    '馋': { en: 'Crave / Envy', object: 'crave', accent: '#ff8c42', phases: ['食指接近嘴角', '食指沿嘴角向下滑动'] },
    '唱歌': { en: 'Sing', object: 'sing', accent: '#ff6b9d', phases: ['头部左右晃动', '双手从喉部向外移出', '声音向外传播'] },
    '超市': { en: 'Supermarket', object: 'supermarket', accent: '#ffd93d', phases: ['虚握购物车把手', '向前推动购物车', '左、右、左、右抓取商品', '回到虚握购物车把手'] },
    '船（轮船）': { en: 'Ship', object: 'ship', accent: '#4da6ff', phases: ['双手形成船头', '保持船头向前航行'] },
    '公交车': { en: 'Bus', object: 'bus', accent: '#4de8a0', phases: ['虚握公交车把手', '前后晃动第 1 次', '前后晃动第 2 次'] },
    '虎': { en: 'Tiger', object: 'tiger', accent: '#ff8c42', phases: ['额头比出王字', '双手兽爪向前下方按动'] },
    '花': { en: 'Flower', object: 'flower', accent: '#ff6b9d', phases: ['撮合形成含苞', '向上并逐渐张开'] },
    '鸡蛋': { en: 'Egg', object: 'egg', accent: '#ffd93d', phases: ['撮合手指表示鸡', '双手组成鸡蛋椭圆', '分开完成打蛋'] },
    '烤串': { en: 'Barbecue Skewer', object: 'skewer', accent: '#ff8c42', phases: ['双手形成烤串准备形', '翻动烤串第 1 次', '翻动烤串第 2 次'] },
    '科学': { en: 'Science', object: 'science', accent: '#9b59ff', phases: ['双 K 手形交替向前绕圈', '撮合手从外向额头靠近', '按向额头'] },
    '牛奶': { en: 'Milk', object: 'milk', accent: '#dffaff', phases: ['手作牛角抵太阳穴', '挤压并向下挤牛奶'] },
    '朋友': { en: 'Friend', object: 'friend', accent: '#ffd93d', phases: ['两拇指形成两个人头', '人头相碰第 1 次', '人头相碰第 2 次'] },
    '汽车': { en: 'Car (1)', object: 'wheel', accent: '#4da6ff', phases: ['双手虚握方向盘', '双手协同左右转动方向盘'] },
    '汽车（二）': { en: 'Car (2)', object: 'car', accent: '#4da6ff', phases: ['单手形成汽车侧面', '汽车向前移动'] },
    '人们（人民）': { en: 'People', object: 'people', accent: '#4de8a0', phases: ['双食指形成“人”字', '人字顺时针环绕一圈'] },
    '森林': { en: 'Forest', object: 'forest', accent: '#4de8a0', phases: ['第 1 处树形位置', '第 2 处树形位置', '第 3 处树形位置'] },
    '跳': { en: 'Jump', object: 'jump', accent: '#9b59ff', phases: ['双腿手指先弯曲', '双腿快速伸直向上跳'] },
    '香蕉': { en: 'Banana', object: 'banana', accent: '#ffd93d', phases: ['辅助手竖起食指表示香蕉', '主手沿食指向下剥皮'] },
    '勇敢': { en: 'Brave', object: 'brave', accent: '#ff6b9d', phases: ['双手贴腹准备', '双手从腹部向两侧拉开'] },
    '月亮': { en: 'Moon', object: 'moon', accent: '#b9c7ff', phases: ['双手向两边移动并收窄间距'] },
    '指示': { en: 'Direct / Point', object: 'pointer', accent: '#4da6ff', phases: ['食指向左指挥', '食指向右指挥'] }
  };

  function canonicalWord(word) {
    const value = String(word || '');
    return PROFILES[value] ? value : (ALIASES[value] || value);
  }

  function cloneBase() {
    const frame = {};
    Object.keys(BASE).forEach(key => { frame[key] = BASE[key].slice(); });
    return frame;
  }

  function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
  function smooth(value) { const p = clamp(value); return p * p * (3 - 2 * p); }
  function pulse(value) { return 0.5 - 0.5 * Math.cos(value * Math.PI * 2); }
  function pingPong(value) { return 0.5 - 0.5 * Math.cos(value * Math.PI); }

  function phaseInfo(progress, phaseCount) {
    const q = clamp(progress) * phaseCount;
    const index = Math.min(phaseCount - 1, Math.floor(q));
    return { index, local: q - index };
  }

  // 用少量关节点组成可读的匿名手形。x/y/z 均为 avatar 局部坐标。
  function poseHand(frame, side, x, y, z, openness = 0.55, angle = 0) {
    const sign = side === 'left' ? -1 : 1;
    const prefix = side;
    frame[`${prefix}Elbow`] = [x - sign * 0.14, y + 0.19, z];
    frame[`${prefix}Wrist`] = [x, y, z];
    frame[`${prefix}Palm`] = [x, y - 0.10, z];
    frame[`${prefix}Index`] = [x + sign * 0.04 + Math.sin(angle) * 0.10, y - 0.22 + openness * 0.12, z + Math.cos(angle) * 0.04];
    frame[`${prefix}Thumb`] = [x + sign * (0.10 + openness * 0.05), y - 0.10 + openness * 0.06, z + 0.03];
  }

  function setHead(frame, sway = 0, lift = 0, depth = 0) {
    frame.head = [sway, 1.48 + lift, depth];
    frame.neck = [sway * 0.45, 1.18 + lift * 0.35, depth * 0.35];
  }

  function frameFor(progress, word) {
    const key = canonicalWord(word);
    const frame = cloneBase();
    const profile = PROFILES[key] || PROFILES['花'];
    const { index, local } = phaseInfo(progress, profile.phases.length);
    const q = clamp(progress);
    const t = smooth(local);
    const s = Math.sin(q * Math.PI * 2);
    let state = {};

    switch (key) {
      case '馋': {
        setHead(frame, 0, 0, 0);
        const slide = clamp(q * 1.35);
        poseHand(frame, 'right', 0.14, 1.34 - slide * 0.30, 0.06, 0.2, -Math.PI / 2);
        state = { drool: slide, side: 'right' };
        break;
      }
      case '唱歌': {
        setHead(frame, Math.sin(q * Math.PI * 6) * 0.07, 0, 0.02 * s);
        const spread = q < 0.25 ? 0.02 : smooth((q - 0.25) / 0.35) * 0.48;
        poseHand(frame, 'left', -0.08 - spread, 1.12, 0.04, 0.58, -0.25);
        poseHand(frame, 'right', 0.08 + spread, 1.12, 0.04, 0.58, 0.25);
        state = { sound: clamp((q - 0.25) / 0.45), throat: [0, 1.29, 0] };
        break;
      }
      case '超市': {
        const cart = { x: 0, y: 0.92, z: 0.08 };
        poseHand(frame, 'left', -0.24, 0.95, 0.10, 0.15, 0);
        poseHand(frame, 'right', 0.24, 0.95, 0.10, 0.15, 0);
        if (q >= 0.15 && q < 0.29) {
          const push = smooth((q - 0.15) / 0.14);
          cart.z += push * 0.26;
          poseHand(frame, 'left', -0.24, 0.95, 0.10 + push * 0.25, 0.15, 0);
          poseHand(frame, 'right', 0.24, 0.95, 0.10 + push * 0.25, 0.15, 0);
        } else if (q >= 0.29 && q < 0.86) {
          const grabQ = (q - 0.29) / 0.57;
          const grabIndex = Math.min(3, Math.floor(grabQ * 4));
          const grabLocal = grabQ * 4 - grabIndex;
          const active = grabIndex % 2 === 0 ? 'left' : 'right';
          const sign = active === 'left' ? -1 : 1;
          const reach = Math.sin(grabLocal * Math.PI);
          poseHand(frame, active, sign * (0.24 + reach * 0.30), 0.98 + reach * 0.08, 0.10 + reach * 0.08, 0.7, sign * 0.6);
          poseHand(frame, active === 'left' ? 'right' : 'left', active === 'left' ? 0.24 : -0.24, 0.95, 0.10, 0.15, 0);
          state = { cart, grabIndex, reach, productSide: active };
        }
        if (q >= 0.86) state = { cart, returnGrip: smooth((q - 0.86) / 0.14) };
        else if (!state.cart) state = { cart };
        break;
      }
      case '船（轮船）': {
        const travel = smooth(q);
        const y = 0.91 + travel * 0.16;
        poseHand(frame, 'left', -0.15, y, 0.03, 0.78, -0.7);
        poseHand(frame, 'right', 0.15, y, 0.03, 0.78, 0.7);
        frame.leftIndex = [0, y + 0.16, 0.05];
        frame.rightIndex = [0, y + 0.16, 0.05];
        state = { travel, bow: [0, y + 0.19, 0.06] };
        break;
      }
      case '公交车': {
        const sway = q < 0.20 ? 0 : Math.sin(((q - 0.20) / 0.68) * Math.PI * 4) * 0.22;
        poseHand(frame, 'right', 0.23 + sway, 1.08, 0.04, 0.12, 0.2);
        frame.rightIndex = [0.23 + sway, 1.24, 0.04];
        state = { sway, cycle: q < 0.20 ? 0 : Math.min(2, Math.floor(((q - 0.20) / 0.68) * 2) + 1) };
        break;
      }
      case '虎': {
        if (q < 0.27) {
          setHead(frame, 0, 0, 0);
          poseHand(frame, 'left', 0, 1.62, 0.08, 0.1, 0);
          frame.leftIndex = [0, 1.72, 0.10];
        } else {
          const claw = Math.sin(((q - 0.27) / 0.73) * Math.PI * 2);
          poseHand(frame, 'left', -0.24, 0.88 - Math.max(0, claw) * 0.16, 0.12, 0.22, -0.6);
          poseHand(frame, 'right', 0.24, 0.88 - Math.max(0, claw) * 0.16, 0.12, 0.22, 0.6);
        }
        state = { forehead: q < 0.27 ? 1 : 0, claw: q < 0.27 ? 0 : pulse((q - 0.27) / 0.73) };
        break;
      }
      case '花': {
        const rise = smooth(q);
        const open = q < 0.25 ? 0 : smooth((q - 0.25) / 0.65);
        poseHand(frame, 'right', 0.03, 0.72 + rise * 0.42, 0.04, 0.08 + open * 0.85, 0);
        state = { bloom: open, flower: [0.03, 1.03 + rise * 0.42, 0.10] };
        break;
      }
      case '鸡蛋': {
        if (q < 0.25) {
          poseHand(frame, 'right', 0.05, 1.28, 0.08, 0.05, 0);
          frame.rightThumb = [0.08, 1.38, 0.08];
          frame.rightIndex = [0.02, 1.38, 0.08];
        } else {
          const split = q < 0.70 ? 0.0 : smooth((q - 0.70) / 0.30) * 0.25;
          poseHand(frame, 'left', -0.19 - split, 0.99, 0.08, 0.5, -0.2);
          poseHand(frame, 'right', 0.19 + split, 0.99, 0.08, 0.5, 0.2);
        }
        state = { egg: q < 0.25 ? 0 : 1, split: q < 0.70 ? 0 : smooth((q - 0.70) / 0.30) };
        break;
      }
      case '烤串': {
        const flip = q < 0.22 ? 0 : pulse(((q - 0.22) / 0.68) * 2);
        const angle = (flip - 0.5) * 0.9;
        poseHand(frame, 'left', -0.30, 0.98, 0.10, 0.75, angle);
        poseHand(frame, 'right', 0.30, 0.98, 0.10, 0.75, angle);
        state = { flip, turns: q < 0.22 ? 0 : Math.min(2, Math.floor(((q - 0.22) / 0.68) * 2) + 1) };
        break;
      }
      case '科学': {
        if (q < 0.52) {
          const orbit = q / 0.52 * Math.PI * 4;
          poseHand(frame, 'left', -0.25 + Math.cos(orbit) * 0.16, 1.00 + Math.sin(orbit) * 0.14, 0.12, 0.48, orbit);
          poseHand(frame, 'right', 0.25 + Math.cos(orbit + Math.PI) * 0.16, 1.00 + Math.sin(orbit + Math.PI) * 0.14, 0.12, 0.48, orbit + Math.PI);
        } else {
          const approach = smooth((q - 0.52) / 0.48);
          poseHand(frame, 'right', 0.34 - approach * 0.34, 1.06 + approach * 0.42, 0.12, 0.08, 0);
          frame.rightIndex = [0.03, 1.50 + approach * 0.02, 0.16];
          frame.rightThumb = [0.08, 1.43 + approach * 0.02, 0.16];
        }
        state = { atom: q < 0.52 ? q / 0.52 : 1, forehead: q < 0.52 ? 0 : smooth((q - 0.52) / 0.48) };
        break;
      }
      case '牛奶': {
        if (q < 0.28) {
          poseHand(frame, 'right', 0.16, 1.39, 0.08, 0.2, 0);
          frame.rightIndex = [0.16, 1.60, 0.09];
          frame.rightThumb = [0.26, 1.49, 0.10];
        } else {
          const squeeze = pulse(((q - 0.28) / 0.72) * 2);
          poseHand(frame, 'right', 0.18, 1.12 - squeeze * 0.28, 0.08, 0.25, -0.5);
          frame.rightIndex = [0.18, 1.34 - squeeze * 0.28, 0.08];
          frame.rightThumb = [0.28, 1.24 - squeeze * 0.28, 0.09];
        }
        state = { horn: q < 0.28 ? 1 : 0, squeeze: q < 0.28 ? 0 : pulse(((q - 0.28) / 0.72) * 2) };
        break;
      }
      case '朋友': {
        const collide = q < 0.25 ? 0 : pulse(((q - 0.25) / 0.65) * 2);
        const gap = 0.25 - collide * 0.25;
        poseHand(frame, 'left', -gap, 0.92, 0.10, 0.05, 0);
        poseHand(frame, 'right', gap, 0.92, 0.10, 0.05, 0);
        frame.leftThumb = [-gap * 0.5, 1.08, 0.14];
        frame.rightThumb = [gap * 0.5, 1.08, 0.14];
        state = { collide, bumps: q < 0.25 ? 0 : Math.min(2, Math.floor(((q - 0.25) / 0.65) * 2) + 1) };
        break;
      }
      case '汽车': {
        const turn = q < 0.18 ? 0 : Math.sin(((q - 0.18) / 0.75) * Math.PI * 4) * 0.38;
        const radius = 0.27;
        poseHand(frame, 'left', -radius + turn * 0.32, 0.94 + Math.abs(turn) * 0.08, 0.12, 0.12, turn);
        poseHand(frame, 'right', radius + turn * 0.32, 0.94 - Math.abs(turn) * 0.08, 0.12, 0.12, turn);
        state = { wheelRotation: turn, ready: q < 0.18 ? 1 : 0 };
        break;
      }
      case '汽车（二）': {
        const travel = smooth(q);
        poseHand(frame, 'right', 0.12 + travel * 0.40, 0.98, 0.12, 0.35, 0);
        frame.rightIndex = [0.12 + travel * 0.40, 1.16, 0.12];
        frame.rightThumb = [0.25 + travel * 0.40, 1.07, 0.12];
        state = { travel };
        break;
      }
      case '人们（人民）': {
        const orbit = q < 0.24 ? 0 : ((q - 0.24) / 0.76) * Math.PI * 2;
        poseHand(frame, 'left', -0.13, 1.01, 0.08, 0.15, 0);
        poseHand(frame, 'right', 0.13, 1.01, 0.08, 0.15, 0);
        frame.leftIndex = [-0.04, 1.28, 0.10];
        frame.rightIndex = [0.04, 1.28, 0.10];
        if (q >= 0.24) {
          frame.rightWrist = [Math.cos(orbit) * 0.30, 1.04 + Math.sin(orbit) * 0.22, 0.14];
          frame.rightPalm = [Math.cos(orbit) * 0.30, 0.94 + Math.sin(orbit) * 0.22, 0.14];
          frame.rightIndex = [Math.cos(orbit) * 0.30, 1.18 + Math.sin(orbit) * 0.22, 0.14];
        }
        state = { peopleOrbit: orbit };
        break;
      }
      case '森林': {
        const treeIndex = Math.min(2, Math.floor(q * 3));
        const localTree = q * 3 - treeIndex;
        const x = -0.34 + treeIndex * 0.34;
        const grow = smooth(localTree);
        poseHand(frame, 'right', x, 0.72 + grow * 0.42, 0.08, 0.30 + grow * 0.55, 0);
        state = { treeIndex, grow };
        break;
      }
      case '跳': {
        const jump = q < 0.28 ? 0 : smooth((q - 0.28) / 0.72);
        const bend = q < 0.28 ? q / 0.28 : 1 - jump;
        poseHand(frame, 'right', 0.20, 0.72 + bend * 0.05 + jump * 0.42, 0.12, 0.1, 0);
        frame.rightIndex = [0.12, 0.54 + bend * 0.08 + jump * 0.42, 0.14];
        frame.rightThumb = [0.28, 0.54 + bend * 0.08 + jump * 0.42, 0.14];
        poseHand(frame, 'left', -0.26, 0.48, 0.05, 0.05, 0);
        frame.leftIndex = [-0.52, 0.48, 0.05];
        state = { jump, bend };
        break;
      }
      case '香蕉': {
        const peel = smooth(q);
        poseHand(frame, 'left', -0.15, 0.78, 0.08, 0.05, 0);
        frame.leftIndex = [-0.15, 1.28, 0.10];
        frame.leftThumb = [-0.05, 0.98, 0.10];
        poseHand(frame, 'right', 0.04, 1.27 - peel * 0.44, 0.14, 0.08, -Math.PI / 2);
        state = { peel };
        break;
      }
      case '勇敢': {
        const pull = smooth(q);
        setHead(frame, 0, pull * 0.04, 0);
        frame.neck[1] += pull * 0.04;
        poseHand(frame, 'left', -0.10 - pull * 0.38, 0.70 + pull * 0.12, 0.10, 0.15, 0);
        poseHand(frame, 'right', 0.10 + pull * 0.38, 0.70 + pull * 0.12, 0.10, 0.15, 0);
        state = { pull };
        break;
      }
      case '月亮': {
        const spread = smooth(q);
        const gap = 0.12 + spread * 0.34;
        poseHand(frame, 'left', -gap, 1.06, 0.08, 0.15, -0.25);
        poseHand(frame, 'right', gap, 1.06, 0.08, 0.15, 0.25);
        frame.leftIndex = [-gap + 0.03, 1.32 - spread * 0.10, 0.10];
        frame.rightIndex = [gap - 0.03, 1.32 - spread * 0.10, 0.10];
        state = { spread, crescentGap: gap };
        break;
      }
      case '指示':
      default: {
        poseHand(frame, 'left', -0.22, 0.94, 0.08, 0.05, 0);
        frame.leftThumb = [-0.22, 1.22, 0.12];
        const direction = q < 0.50 ? -1 : 1;
        const move = q < 0.50 ? smooth(q * 2) : smooth((q - 0.50) * 2);
        poseHand(frame, 'right', 0.20 + direction * move * 0.22, 1.00, 0.12, 0.05, direction * 0.5);
        frame.rightIndex = [0.20 + direction * (0.26 + move * 0.18), 1.12, 0.16];
        state = { direction, move };
        break;
      }
    }

    return { points: frame, state, phaseIndex: index, phaseName: profile.phases[index], profile };
  }

  // Private review mode may supply a local, privacy-reduced motion timeline.
  // The public site ships no such timeline; it only receives the generic code.
  // Timeline points are already stripped of pixels, source paths and face
  // coordinates, and are mapped onto this same anonymous teaching character.
  function interpolateVector(a, b, alpha) {
    if (!a && !b) return null;
    if (!a) return b.slice();
    if (!b) return a.slice();
    return a.map((value, index) => value + (b[index] - value) * alpha);
  }

  function timelineMotion(progress, timeline, word) {
    const frames = (timeline && timeline.frames) || [];
    if (!frames.length) return frameFor(progress, word);
    const duration = Math.max(0.001, Number(timeline.duration_sec) || Number(frames[frames.length - 1].t) || 1);
    const target = clamp(progress) * duration;
    let upper = frames.findIndex(item => Number(item.t) >= target);
    if (upper < 0) upper = frames.length - 1;
    const lower = Math.max(0, upper - 1);
    const before = frames[lower];
    const after = frames[upper];
    const span = Math.max(0.0001, Number(after.t) - Number(before.t));
    const alpha = lower === upper ? 0 : clamp((target - Number(before.t)) / span);
    const frame = cloneBase();
    const names = Object.keys(frame);
    names.forEach(name => {
      const raw = interpolateVector((before.points || {})[name], (after.points || {})[name], alpha);
      if (!raw) return;
      // Private timeline: shoulder-local x/y/z.  This affine map preserves
      // relative continuous motion while fitting the shared teaching avatar.
      frame[name] = [
        -raw[0] * 0.56,
        1.22 + raw[1] * 0.20,
        Math.max(-0.34, Math.min(0.34, raw[2] * 0.08))
      ];
    });
    const anchors = timeline.phase_anchors || [];
    const active = anchors.reduce((value, anchor) => (Number(anchor.t) <= target ? anchor : value), anchors[0]);
    const profile = PROFILES[canonicalWord(word)] || PROFILES['花'];
    const mouthA = (before.nonmanual || {}).mouth_open_ratio;
    const mouthB = (after.nonmanual || {}).mouth_open_ratio;
    const mouth = (typeof mouthA === 'number' && typeof mouthB === 'number') ? mouthA + (mouthB - mouthA) * alpha : null;
    return {
      points: frame,
      state: { mouthOpen: mouth },
      phaseIndex: active ? Math.max(0, Number(active.phase_index) - 1) : 0,
      phaseName: active ? `manual semantic phase ${String(active.phase_index).padStart(2, '0')}` : profile.phases[0],
      profile
    };
  }

  function project(point, width, height, rotation) {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const x = point[0] * cos - point[2] * sin;
    const z = point[0] * sin + point[2] * cos;
    const perspective = 1 / (1 + z * 0.18);
    return {
      x: width * 0.5 + x * width * 0.52 * perspective,
      y: height * 0.88 - point[1] * height * 0.50 * perspective,
      z
    };
  }

  function projectedPoints(points, width, height, rotation) {
    const result = {};
    Object.keys(points).forEach(key => { result[key] = project(points[key], width, height, rotation); });
    return result;
  }

  function pointDistance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function drawCapsule(ctx, a, b, radius, colors, outline = 'rgba(15,28,62,0.72)') {
    const length = Math.max(1, pointDistance(a, b));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(1, colors[1] || colors[0]);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(angle);
    ctx.fillStyle = gradient;
    ctx.strokeStyle = outline;
    ctx.lineWidth = Math.max(1.2, radius * 0.10);
    ctx.shadowColor = 'rgba(0,0,0,0.20)';
    ctx.shadowBlur = radius * 0.45;
    roundRect(ctx, 0, -radius, length, radius * 2, radius);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function handMode(profile, side, state) {
    switch (profile.object) {
      case 'crave': return side === 'right' ? 'point' : 'relaxed';
      case 'sing': return 'pinch';
      case 'supermarket': return state.productSide === side && (state.reach || 0) > 0.15 ? 'claw' : 'grip';
      case 'ship': return 'flat';
      case 'bus': return side === 'right' ? 'grip' : 'relaxed';
      case 'tiger': return state.forehead ? (side === 'left' ? 'point' : 'relaxed') : 'claw';
      case 'flower': return side === 'right' ? ((state.bloom || 0) < 0.3 ? 'pinch' : 'open') : 'relaxed';
      case 'egg': return state.egg ? 'cshape' : (side === 'right' ? 'pinch' : 'relaxed');
      case 'skewer': return 'flat';
      case 'science': return (state.forehead || 0) > 0 ? (side === 'right' ? 'pinch' : 'relaxed') : 'kshape';
      case 'milk': return state.horn ? (side === 'right' ? 'horn' : 'relaxed') : (side === 'right' ? 'grip' : 'relaxed');
      case 'friend': return 'thumb';
      case 'wheel': return 'grip';
      case 'car': return side === 'right' ? 'cshape' : 'relaxed';
      case 'people': return 'point';
      case 'forest': return side === 'right' ? 'cshape' : 'relaxed';
      case 'jump': return side === 'right' ? 'two' : 'flat';
      case 'banana': return side === 'left' ? 'point' : 'pinch';
      case 'brave': return 'spread-two';
      case 'moon': return 'pinch';
      case 'pointer': return side === 'left' ? 'thumb' : 'point';
      default: return 'relaxed';
    }
  }

  function drawFingerCapsule(ctx, start, tip, radius, skin, outline) {
    drawCapsule(ctx, start, tip, radius, skin, outline);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.beginPath(); ctx.ellipse(tip.x - radius * 0.12, tip.y - radius * 0.08, radius * 0.45, radius * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawHandVolume(ctx, projected, side, profile, state, width) {
    const palm = projected[`${side}Palm`];
    const wrist = projected[`${side}Wrist`];
    const indexTip = projected[`${side}Index`];
    const thumbTip = projected[`${side}Thumb`];
    const mode = handMode(profile, side, state);
    const scale = Math.max(0.72, Math.min(1.18, width / 560));
    const palmW = 16 * scale;
    const palmH = 22 * scale;
    const skin = ['#f6cba8', '#d99b78'];
    const outline = 'rgba(88,48,50,0.72)';
    const dirX = indexTip.x - palm.x;
    const dirY = indexTip.y - palm.y;
    const dirLength = Math.max(1, Math.hypot(dirX, dirY));
    const ux = dirX / dirLength;
    const uy = dirY / dirLength;
    const nx = -uy;
    const ny = ux;
    const palmAngle = Math.atan2(dirY, dirX) + Math.PI / 2;

    ctx.save();
    ctx.translate(palm.x, palm.y);
    ctx.rotate(palmAngle);
    const palmGradient = ctx.createRadialGradient(-palmW * 0.28, -palmH * 0.28, 2, 0, 0, palmH);
    palmGradient.addColorStop(0, '#ffe0c2');
    palmGradient.addColorStop(1, '#d99b78');
    ctx.fillStyle = palmGradient;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.ellipse(0, 0, palmW, palmH, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();

    const base = (offset, forward = 0.18) => ({
      x: palm.x + nx * offset + ux * palmH * forward,
      y: palm.y + ny * offset + uy * palmH * forward
    });
    const extended = (offset, length, bend = 0) => ({
      x: palm.x + nx * offset + ux * length + nx * bend,
      y: palm.y + ny * offset + uy * length + ny * bend
    });
    const curled = offset => ({
      x: palm.x + nx * offset + ux * palmH * 0.56,
      y: palm.y + ny * offset + uy * palmH * 0.56
    });

    const fingers = [];
    if (mode === 'open' || mode === 'flat' || mode === 'claw') {
      const clawBend = mode === 'claw' ? palmH * 0.55 : 0;
      [-10, -5, 0, 5].forEach((offset, i) => {
        const length = palmH * ([1.18, 1.34, 1.24, 0.94][i]);
        fingers.push([base(offset), extended(offset, length, (i - 1.5) * 2 + clawBend)]);
      });
    } else if (mode === 'point') {
      fingers.push([base(-4), indexTip]);
      [-1, 4, 9].forEach(offset => fingers.push([base(offset), curled(offset)]));
    } else if (mode === 'two' || mode === 'kshape' || mode === 'spread-two') {
      const spread = mode === 'spread-two' ? 8 : 4;
      fingers.push([base(-5), extended(-5, palmH * 1.32, -spread)]);
      fingers.push([base(2), extended(2, palmH * 1.22, spread)]);
      [7, 10].forEach(offset => fingers.push([base(offset), curled(offset)]));
    } else if (mode === 'cshape') {
      fingers.push([base(-5), { x: indexTip.x, y: indexTip.y }]);
      [-1, 4, 9].forEach(offset => fingers.push([base(offset), extended(offset, palmH * 0.78, -palmH * 0.34)]));
    } else if (mode === 'pinch') {
      const pinch = { x: (indexTip.x + thumbTip.x) * 0.5, y: (indexTip.y + thumbTip.y) * 0.5 };
      fingers.push([base(-4), pinch]);
      [-1, 4, 9].forEach(offset => fingers.push([base(offset), curled(offset)]));
    } else if (mode === 'horn') {
      fingers.push([base(-5), extended(-5, palmH * 1.15, -5)]);
      [0, 5].forEach(offset => fingers.push([base(offset), curled(offset)]));
      fingers.push([base(9), extended(9, palmH * 0.95, 8)]);
    } else {
      [-6, -1, 4, 9].forEach(offset => fingers.push([base(offset), curled(offset)]));
    }

    fingers.forEach(([start, tip], i) => drawFingerCapsule(ctx, start, tip, Math.max(3.0, 3.8 * scale - i * 0.12), skin, outline));

    if (mode === 'thumb' || mode === 'grip' || mode === 'relaxed' || mode === 'cshape' || mode === 'pinch' || mode === 'kshape' || mode === 'spread-two') {
      const thumbOffset = side === 'left' ? 10 : -10;
      const tuckedThumb = {
        x: palm.x + nx * thumbOffset + ux * palmH * (mode === 'relaxed' ? 0.34 : 0.48),
        y: palm.y + ny * thumbOffset + uy * palmH * (mode === 'relaxed' ? 0.34 : 0.48)
      };
      const semanticThumb = mode === 'grip' || mode === 'relaxed' ? tuckedThumb : thumbTip;
      drawFingerCapsule(ctx, base(thumbOffset, 0), semanticThumb, Math.max(3.5, 4.2 * scale), skin, outline);
    }
  }

  function drawFaceVolume(ctx, projected, profile, width, state = {}) {
    const head = projected.head;
    const neck = projected.neck;
    const scale = Math.max(0.78, Math.min(1.16, width / 560));
    const rx = 30 * scale;
    const ry = 39 * scale;
    ctx.save();
    const skin = ctx.createRadialGradient(head.x - rx * 0.36, head.y - ry * 0.34, 2, head.x, head.y, ry * 1.1);
    skin.addColorStop(0, '#ffe5c8'); skin.addColorStop(0.72, '#f1bd97'); skin.addColorStop(1, '#c88367');
    ctx.fillStyle = skin; ctx.strokeStyle = 'rgba(76,44,52,0.82)'; ctx.lineWidth = 1.7;
    ctx.shadowColor = 'rgba(0,0,0,0.24)'; ctx.shadowBlur = 9;
    ctx.beginPath(); ctx.ellipse(head.x, head.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#25304f';
    ctx.beginPath();
    ctx.moveTo(head.x - rx * 0.92, head.y - ry * 0.30);
    ctx.quadraticCurveTo(head.x - rx * 0.45, head.y - ry * 1.13, head.x + rx * 0.62, head.y - ry * 0.82);
    ctx.quadraticCurveTo(head.x + rx * 1.02, head.y - ry * 0.46, head.x + rx * 0.86, head.y - ry * 0.06);
    ctx.quadraticCurveTo(head.x + rx * 0.46, head.y - ry * 0.60, head.x - rx * 0.92, head.y - ry * 0.30);
    ctx.fill();
    ctx.strokeStyle = '#4e3540'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(head.x - rx * 0.50, head.y - 4); ctx.lineTo(head.x - rx * 0.18, head.y - 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(head.x + rx * 0.18, head.y - 5); ctx.lineTo(head.x + rx * 0.50, head.y - 4); ctx.stroke();
    ctx.fillStyle = '#2c2742';
    ctx.beginPath(); ctx.arc(head.x - rx * 0.33, head.y - 2, 2.3, 0, Math.PI * 2); ctx.arc(head.x + rx * 0.33, head.y - 2, 2.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#9d5f60'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(head.x, head.y + 2); ctx.quadraticCurveTo(head.x - 3, head.y + 10, head.x + 3, head.y + 11); ctx.stroke();
    if (profile.object === 'sing') {
      const openness = typeof state.mouthOpen === 'number' ? clamp((state.mouthOpen - 0.015) / 0.085) : 0.65;
      ctx.fillStyle = '#803f56'; ctx.beginPath(); ctx.ellipse(head.x, head.y + ry * 0.49, 6 + openness * 2, 4 + openness * 9, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = profile.object === 'brave' ? '#6e3447' : '#a55262'; ctx.lineWidth = 2;
      ctx.beginPath();
      if (profile.object === 'brave') {
        ctx.moveTo(head.x - 7, head.y + ry * 0.50); ctx.lineTo(head.x + 7, head.y + ry * 0.50);
      } else {
        ctx.arc(head.x, head.y + ry * 0.35, 9, 0.15, Math.PI - 0.15);
      }
      ctx.stroke();
    }
    ctx.restore();
    return { head, neck, rx, ry };
  }

  function drawTeachingAvatar(ctx, width, height, points, rotation, profile, state) {
    const p = projectedPoints(points, width, height, rotation);
    const bodyScale = Math.max(0.76, Math.min(1.18, width / 560));
    const sleeveRadius = 14 * bodyScale;
    const forearmRadius = 12 * bodyScale;
    const skinColors = ['#f6cba8', '#d99b78'];
    const clothColors = ['#4e72c8', '#20366f'];

    ctx.save();
    // Torso: a solid teaching-avatar body inspired by the simple A–Z figures.
    const torsoGradient = ctx.createLinearGradient(p.leftShoulder.x, p.neck.y, p.rightHip.x, p.pelvis.y);
    torsoGradient.addColorStop(0, '#557bd3'); torsoGradient.addColorStop(0.55, '#2d4b94'); torsoGradient.addColorStop(1, '#192d61');
    ctx.fillStyle = torsoGradient; ctx.strokeStyle = 'rgba(12,25,62,0.82)'; ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(0,0,0,0.26)'; ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(p.neck.x - 11 * bodyScale, p.neck.y - 2);
    ctx.quadraticCurveTo(p.leftShoulder.x + 9, p.leftShoulder.y - 8, p.leftShoulder.x - 8, p.leftShoulder.y + 8);
    ctx.lineTo(p.leftHip.x - 24 * bodyScale, p.leftHip.y + 24 * bodyScale);
    ctx.quadraticCurveTo(p.pelvis.x, p.pelvis.y + 34 * bodyScale, p.rightHip.x + 24 * bodyScale, p.rightHip.y + 24 * bodyScale);
    ctx.lineTo(p.rightShoulder.x + 8, p.rightShoulder.y + 8);
    ctx.quadraticCurveTo(p.rightShoulder.x - 9, p.rightShoulder.y - 8, p.neck.x + 11 * bodyScale, p.neck.y - 2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    // Collar and neck create a readable upper-body silhouette.
    drawCapsule(ctx, { x: p.neck.x, y: p.neck.y + 5 }, { x: p.head.x, y: p.head.y + 25 * bodyScale }, 10 * bodyScale, skinColors, 'rgba(88,48,50,0.66)');
    ctx.fillStyle = '#f0f4ff'; ctx.globalAlpha = 0.88;
    ctx.beginPath(); ctx.moveTo(p.neck.x, p.neck.y + 8); ctx.lineTo(p.neck.x - 24 * bodyScale, p.neck.y + 3); ctx.lineTo(p.neck.x - 10 * bodyScale, p.neck.y + 26 * bodyScale); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(p.neck.x, p.neck.y + 8); ctx.lineTo(p.neck.x + 24 * bodyScale, p.neck.y + 3); ctx.lineTo(p.neck.x + 10 * bodyScale, p.neck.y + 26 * bodyScale); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;

    ['left', 'right'].forEach(side => {
      drawCapsule(ctx, p[`${side}Shoulder`], p[`${side}Elbow`], sleeveRadius, clothColors);
      drawCapsule(ctx, p[`${side}Elbow`], p[`${side}Wrist`], forearmRadius, ['#4769bb', '#263f82']);
      drawCapsule(ctx, p[`${side}Wrist`], p[`${side}Palm`], 8 * bodyScale, skinColors, 'rgba(88,48,50,0.68)');
    });

    drawFaceVolume(ctx, p, profile, width, state);
    // Hands are rendered last within layer 1 so instructional handshapes stay visible.
    drawHandVolume(ctx, p, 'left', profile, state, width);
    drawHandVolume(ctx, p, 'right', profile, state, width);
    ctx.restore();
    return p;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function glow(ctx, x, y, radius, color) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = radius;
    ctx.beginPath(); ctx.arc(x, y, radius * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function objectLabel(ctx, title, subtitle, color, width, height) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.max(12, width * 0.034)}px system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.shadowColor = color; ctx.shadowBlur = 10;
    ctx.fillText(title, width * 0.5, height * 0.12);
    ctx.shadowBlur = 0;
    ctx.font = `${Math.max(10, width * 0.022)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(225,235,255,0.72)';
    ctx.fillText(subtitle, width * 0.5, height * 0.16);
    ctx.restore();
  }

  function drawBanana(ctx, x, y, scale, peel, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.lineCap = 'round'; ctx.lineWidth = 12;
    ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(0, 34); ctx.quadraticCurveTo(-40, 4, -6, -42); ctx.stroke();
    ctx.strokeStyle = '#fff2a3'; ctx.lineWidth = 4; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(0, 33); ctx.quadraticCurveTo(-34, 4, -5, -39); ctx.stroke();
    if (peel > 0.02) {
      ctx.strokeStyle = '#e8c840'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(-4, -37); ctx.quadraticCurveTo(-32 - peel * 22, -8, -28 - peel * 30, 28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4, -37); ctx.quadraticCurveTo(26 + peel * 20, -10, 24 + peel * 28, 28); ctx.stroke();
    }
    ctx.restore();
  }

  function drawFlower(ctx, x, y, scale, bloom, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.strokeStyle = '#4de8a0'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(0, 18); ctx.lineTo(0, 75); ctx.stroke();
    const open = 0.35 + bloom * 0.65;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      ctx.save(); ctx.rotate(a); ctx.fillStyle = color; ctx.globalAlpha = 0.80;
      ctx.beginPath(); ctx.ellipse(0, -18 * open, 14 + 12 * bloom, 28 + 12 * bloom, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.fillStyle = '#ffd93d'; ctx.beginPath(); ctx.arc(0, 0, 10 + 4 * bloom, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawWheel(ctx, x, y, scale, rotation, color) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rotation); ctx.scale(scale, scale);
    ctx.strokeStyle = color; ctx.lineWidth = 10; ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.lineWidth = 6;
    for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 40, Math.sin(a) * 40); ctx.stroke(); }
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawTiger(ctx, x, y, scale, claw, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.fillStyle = '#ffb347'; ctx.strokeStyle = color; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-24, -24); ctx.lineTo(-38, -47); ctx.lineTo(-7, -34); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(24, -24); ctx.lineTo(38, -47); ctx.lineTo(7, -34); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#8c5b22'; ctx.lineWidth = 4;
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 10, -15); ctx.lineTo(i * 12, 6); ctx.stroke(); }
    ctx.fillStyle = '#2b2140'; ctx.beginPath(); ctx.arc(-11, -3, 3, 0, Math.PI * 2); ctx.arc(11, -3, 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) { const xx = -18 + i * 18; ctx.beginPath(); ctx.moveTo(xx, 12); ctx.lineTo(xx + (i - 1) * 15, 18 + claw * 18); ctx.stroke(); }
    ctx.restore();
  }

  function drawMoon(ctx, x, y, scale, gap, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(18, -43);
    ctx.bezierCurveTo(-25, -30, -29, 27, 18, 43);
    ctx.bezierCurveTo(-4, 22, -4, -21, 18, -43);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.beginPath(); ctx.arc(-13, -10, 5, 0, Math.PI * 2); ctx.arc(-5, 16, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawCart(ctx, x, y, scale, color, products = 0) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-48, -28); ctx.lineTo(-33, 25); ctx.lineTo(35, 25); ctx.lineTo(48, -18); ctx.lineTo(-38, -18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-58, -38); ctx.lineTo(-44, -38); ctx.stroke();
    ctx.fillStyle = '#2b2140'; ctx.beginPath(); ctx.arc(-16, 38, 8, 0, Math.PI * 2); ctx.arc(24, 38, 8, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 4; i++) {
      const active = i < products;
      ctx.fillStyle = active ? ['#ff8c42', '#ff6b9d', '#4de8a0', '#ffd93d'][i] : 'rgba(255,255,255,0.16)';
      ctx.beginPath(); ctx.arc(-24 + i * 16, -34 - (i % 2) * 9, 7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawObjectLayer(ctx, width, height, projected, state, profile, rotation) {
    const color = profile.accent;
    const cx = width * 0.5;
    const top = height * 0.30;
    const leftHand = projected.leftPalm;
    const rightHand = projected.rightPalm;
    ctx.save();
    ctx.globalAlpha = 0.96;
    switch (profile.object) {
      case 'banana': drawBanana(ctx, leftHand.x + 8, leftHand.y - 80, 0.72, state.peel || 0, color); objectLabel(ctx, '香蕉 / Banana', '剥皮相似物 · peel overlay', color, width, height); break;
      case 'flower': drawFlower(ctx, rightHand.x, rightHand.y - 74, 0.82, state.bloom || 0, color); objectLabel(ctx, '花 / Flower', '绽放相似物 · bloom overlay', color, width, height); break;
      case 'wheel': drawWheel(ctx, cx, height * 0.48, 0.78, state.wheelRotation || 0, color); objectLabel(ctx, '方向盘 / Steering wheel', '协同转动 · turning overlay', color, width, height); break;
      case 'car': {
        const x = width * (0.44 + (state.travel || 0) * 0.20);
        ctx.save(); ctx.translate(x, height * 0.49); ctx.scale(0.85, 0.85); ctx.fillStyle = '#4da6ff'; ctx.strokeStyle = color; ctx.lineWidth = 4;
        roundRect(ctx, -50, -20, 100, 36, 10); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#bde8ff'; roundRect(ctx, -27, -38, 54, 22, 7); ctx.fill();
        ctx.fillStyle = '#172044'; ctx.beginPath(); ctx.arc(-30, 20, 9, 0, Math.PI * 2); ctx.arc(30, 20, 9, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        objectLabel(ctx, '汽车侧面 / Car side', '保持车身前移 · forward overlay', color, width, height); break;
      }
      case 'tiger': drawTiger(ctx, cx, top + 34, 0.78, state.claw || 0, color); objectLabel(ctx, '老虎 / Tiger', '王字与兽爪 · tiger overlay', color, width, height); break;
      case 'moon': drawMoon(ctx, cx, top + 30, 0.78, state.crescentGap || 0.3, color); objectLabel(ctx, '月亮 / Moon', '弯月轮廓 · crescent overlay', color, width, height); break;
      case 'supermarket': drawCart(ctx, cx, height * 0.48, 0.68, color, Math.min(4, (state.grabIndex || 0) + (state.reach > 0.7 ? 1 : 0))); objectLabel(ctx, '购物车 / Shopping cart', '抓取商品 · shopping overlay', color, width, height); break;
      case 'bus': {
        ctx.save(); ctx.translate(cx + (state.sway || 0) * width * 0.45, height * 0.47); ctx.fillStyle = '#3c8f9e'; ctx.strokeStyle = color; ctx.lineWidth = 4; roundRect(ctx, -62, -40, 124, 80, 14); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#bde8ff'; for (let i = 0; i < 4; i++) { roundRect(ctx, -48 + i * 25, -25, 18, 22, 4); ctx.fill(); } ctx.fillStyle = '#172044'; ctx.beginPath(); ctx.arc(-38, 45, 9, 0, Math.PI * 2); ctx.arc(38, 45, 9, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        objectLabel(ctx, '公交车 / Bus', '前后晃动 · ride overlay', color, width, height); break;
      }
      case 'ship': {
        const x = cx, y = height * (0.46 - (state.travel || 0) * 0.07);
        ctx.save(); ctx.translate(x, y); ctx.fillStyle = '#4da6ff'; ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-62, 8); ctx.lineTo(62, 8); ctx.lineTo(38, 35); ctx.lineTo(-38, 35); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -58); ctx.lineTo(46, 2); ctx.closePath(); ctx.fillStyle = '#ff6b9d'; ctx.fill(); ctx.stroke(); ctx.restore();
        objectLabel(ctx, '船 / Ship', '船头向前 · sailing overlay', color, width, height); break;
      }
      case 'egg': {
        const split = state.split || 0;
        ctx.save(); ctx.translate(cx, height * 0.46); ctx.scale(1 + split * 0.25, 1 - split * 0.10); ctx.fillStyle = '#fff6d2'; ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(0, 0, 32, 45, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#ffd93d'; ctx.beginPath(); ctx.arc(0, 7, 13, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        objectLabel(ctx, '鸡蛋 / Egg', '撮合、成形、打蛋 · egg overlay', color, width, height); break;
      }
      case 'skewer': {
        const angle = ((state.flip || 0) - 0.5) * 0.85;
        ctx.save(); ctx.translate(cx, height * 0.49); ctx.rotate(angle); ctx.strokeStyle = '#e8c840'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-70, 0); ctx.lineTo(70, 0); ctx.stroke(); ['#ff8c42', '#4de8a0', '#ff6b9d', '#ffd93d'].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(-48 + i * 32, 0, 10, 0, Math.PI * 2); ctx.fill(); }); ctx.restore();
        objectLabel(ctx, '烤串 / Skewer', '左右翻动两次 · flip overlay', color, width, height); break;
      }
      case 'science': {
        ctx.save(); ctx.translate(cx, top + 36); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.globalAlpha = 0.72; for (let i = 0; i < 3; i++) { ctx.save(); ctx.rotate(i * Math.PI / 3 + (state.atom || 0) * Math.PI * 2); ctx.beginPath(); ctx.ellipse(0, 0, 48, 18, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); } ctx.fillStyle = '#ffd93d'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        objectLabel(ctx, '科学 / Science', '交替绕圈、知识入额 · science overlay', color, width, height); break;
      }
      case 'milk': {
        ctx.save(); ctx.translate(cx + 48, height * 0.50); ctx.fillStyle = '#f4fbff'; ctx.strokeStyle = color; ctx.lineWidth = 4; roundRect(ctx, -22, -45, 44, 80, 8); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#4da6ff'; ctx.fillRect(-18, -29, 36, 12); ctx.fillStyle = '#4da6ff'; ctx.font = '700 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('MILK', 0, 8); ctx.restore();
        objectLabel(ctx, '牛奶 / Milk', '挤压向下 · milk overlay', color, width, height); break;
      }
      case 'friend': {
        const gap = (state.collide || 0) * 22;
        ctx.save(); ctx.translate(cx, top + 50); ctx.fillStyle = '#ffd93d'; ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(-24 + gap, 0, 15, 0, Math.PI * 2); ctx.arc(24 - gap, 0, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.strokeStyle = '#ff8c42'; ctx.beginPath(); ctx.moveTo(-24 + gap, 15); ctx.lineTo(-24 + gap, 38); ctx.moveTo(24 - gap, 15); ctx.lineTo(24 - gap, 38); ctx.stroke(); ctx.restore();
        objectLabel(ctx, '朋友 / Friend', '两个人头相碰两次 · friend overlay', color, width, height); break;
      }
      case 'people': {
        ctx.save(); ctx.translate(cx, top + 42); const count = 7; for (let i = 0; i < count; i++) { const a = i / count * Math.PI * 2 + (state.peopleOrbit || 0); const xx = Math.cos(a) * 42; const yy = Math.sin(a) * 18; ctx.fillStyle = i === 0 ? color : '#b9c7ff'; ctx.beginPath(); ctx.arc(xx, yy, 8, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(xx, yy + 8); ctx.lineTo(xx, yy + 25); ctx.stroke(); } ctx.restore();
        objectLabel(ctx, '人们 / People', '人字环绕一圈 · people overlay', color, width, height); break;
      }
      case 'forest': {
        ctx.save(); ctx.translate(cx, height * 0.48); for (let i = 0; i < 3; i++) { const xx = -56 + i * 56; const active = i === state.treeIndex; ctx.strokeStyle = '#8c5b22'; ctx.lineWidth = active ? 7 : 4; ctx.beginPath(); ctx.moveTo(xx, 42); ctx.lineTo(xx, -4); ctx.stroke(); ctx.fillStyle = active ? color : 'rgba(77,232,160,0.42)'; ctx.beginPath(); ctx.moveTo(xx, -62); ctx.lineTo(xx - 24, 0); ctx.lineTo(xx + 24, 0); ctx.closePath(); ctx.fill(); } ctx.restore();
        objectLabel(ctx, '森林 / Forest', '三个位置形成树形 · forest overlay', color, width, height); break;
      }
      case 'jump': {
        const y = height * (0.53 - (state.jump || 0) * 0.22);
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.moveTo(width * 0.28, height * 0.73); ctx.lineTo(width * 0.72, height * 0.73); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = color; ctx.globalAlpha = 0.65; ctx.beginPath(); ctx.arc(cx, y, 24 + (state.jump || 0) * 10, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        objectLabel(ctx, '跳 / Jump', '弯曲蓄力后弹起 · jump overlay', color, width, height); break;
      }
      case 'brave': {
        ctx.save(); ctx.translate(cx, height * 0.50); ctx.fillStyle = 'rgba(255,107,157,0.28)'; ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, -45); ctx.lineTo(40, -28); ctx.lineTo(32, 28); ctx.lineTo(0, 50); ctx.lineTo(-32, 28); ctx.lineTo(-40, -28); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = color; ctx.font = '700 32px system-ui'; ctx.textAlign = 'center'; ctx.fillText('★', 0, 10); ctx.restore();
        objectLabel(ctx, '勇敢 / Brave', '胆量向两侧撑开 · brave overlay', color, width, height); break;
      }
      case 'pointer': {
        const end = projected.rightIndex;
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.setLineDash([7, 7]); ctx.beginPath(); ctx.moveTo(projected.leftThumb.x, projected.leftThumb.y); ctx.lineTo(end.x, end.y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(end.x, end.y, 12, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(end.x, end.y, 28, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        objectLabel(ctx, '指示 / Point', '左右方向指挥 · pointer overlay', color, width, height); break;
      }
      case 'sing': {
        const throat = project([0, 1.32, 0], width, height, rotation);
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 3; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(throat.x, throat.y, 18 + i * 12, -Math.PI * 0.8, Math.PI * 0.8); ctx.stroke(); } ctx.fillStyle = '#ffd93d'; ctx.font = '700 28px serif'; ctx.fillText('♪', throat.x + 55, throat.y - 20); ctx.fillText('♫', throat.x - 60, throat.y - 40); ctx.restore();
        objectLabel(ctx, '唱歌 / Sing', '声音从喉部向外 · sound overlay', color, width, height); break;
      }
      case 'crave': {
        ctx.save(); ctx.fillStyle = '#ff6b6b'; ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, top + 34, 24, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#fff6d2'; ctx.beginPath(); ctx.arc(cx, top + 28, 8, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#7ec8ff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx + 16, top + 52); ctx.quadraticCurveTo(cx + 20, top + 72, cx + 15, top + 88); ctx.stroke(); ctx.restore();
        objectLabel(ctx, '馋 / Crave', '嘴角口水 · craving overlay', color, width, height); break;
      }
      default: break;
    }
  }

  function drawAvatar(ctx, width, height, motion, rotation) {
    const profile = motion.profile;
    const dayTheme = document.body.classList.contains('theme-day');
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createRadialGradient(width * 0.5, height * 0.42, 8, width * 0.5, height * 0.5, width * 0.75);
    gradient.addColorStop(0, dayTheme ? 'rgba(125, 181, 255, 0.24)' : 'rgba(91, 115, 255, 0.22)');
    gradient.addColorStop(1, dayTheme ? 'rgba(244, 250, 255, 0.70)' : 'rgba(8, 10, 32, 0.94)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);

    // Layer 1: filled anonymous teaching avatar derived from the A–Z figures.
    const projected = drawTeachingAvatar(ctx, width, height, motion.points, rotation, profile, motion.state);
    // Layer 2: semantic object overlay, intentionally drawn after the avatar.
    drawObjectLayer(ctx, width, height, projected, motion.state, profile, rotation);

    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = `${Math.max(10, width * 0.022)}px system-ui, sans-serif`;
    ctx.fillStyle = dayTheme ? 'rgba(28,47,75,0.78)' : 'rgba(225,235,255,0.74)';
    ctx.fillText(`阶段 / Stage: ${motion.phaseName || '--'}`, 14, height - 62);
    ctx.fillText('底层：3D教学人物 / 3D teaching avatar', 14, height - 39);
    ctx.fillStyle = profile.accent;
    ctx.fillText('上层：相似物叠加 / Semantic object overlay', 14, height - 18);
    ctx.restore();
  }

  function fixtureFrame(t, word) {
    return frameFor(t, word).points;
  }

  class Avatar3DPlayer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.word = '';
      this.playing = false;
      this.start = 0;
      this.rotation = 0;
      this.raf = 0;
      this.duration = 5200;
      this.timeline = null;
      this._lastProgress = 0;
      this.resize = this.resize.bind(this);
      this.tick = this.tick.bind(this);
      this.themeHandler = () => this.render(this._lastProgress);
      window.addEventListener('resize', this.resize);
      window.addEventListener('signUniverseThemeChanged', this.themeHandler);
      this.resize();
    }
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
      this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
      this.canvas._cssWidth = rect.width || 320;
      this.canvas._cssHeight = rect.height || 240;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.render(this._lastProgress);
    }
    load(word) {
      this.word = canonicalWord(word);
      this.timeline = null;
      this.render(0);
    }
    loadPrivateTimeline(timeline) {
      this.timeline = timeline || null;
      this.word = canonicalWord((timeline || {}).word || this.word);
      this.duration = Math.max(1200, Math.round((Number((timeline || {}).duration_sec) || 5.2) * 1000));
      this.render(0);
    }
    render(progress) {
      const width = this.canvas._cssWidth || this.canvas.clientWidth || 320;
      const height = this.canvas._cssHeight || this.canvas.clientHeight || 240;
      const motion = this.timeline ? timelineMotion(progress, this.timeline, this.word) : frameFor(progress, this.word);
      this._lastProgress = clamp(progress);
      drawAvatar(this.ctx, width, height, motion, this.rotation);
      this.canvas.dataset.phase = motion.phaseName || '';
    }
    tick(now) {
      if (!this.playing) return;
      if (!this.start) this.start = now;
      const progress = ((now - this.start) % this.duration) / this.duration;
      this.rotation = Math.sin(progress * Math.PI * 2) * 0.12;
      this.render(progress);
      this.raf = requestAnimationFrame(this.tick);
    }
    play() {
      if (this.playing) return;
      this.playing = true;
      this.start = performance.now() - this._lastProgress * this.duration;
      this.raf = requestAnimationFrame(this.tick);
    }
    stop() {
      this.playing = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.render(this._lastProgress);
    }
    destroy() {
      this.stop();
      window.removeEventListener('resize', this.resize);
      window.removeEventListener('signUniverseThemeChanged', this.themeHandler);
    }
  }

  global.Avatar3D = {
    create(canvas) { return canvas ? new Avatar3DPlayer(canvas) : null; },
    fixtureFrame,
    profiles: PROFILES,
    canonicalWord
  };
})(window);
