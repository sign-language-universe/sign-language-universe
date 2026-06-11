/* =============================================
   手语小宇宙 — 词汇展示动画引擎
   基于 Demo词汇.docx 中各词汇的语义说明
   每段动画包含手语手势 + 视觉叠加效果
   ============================================= */

// ============ 动画数据定义 ============
// 每个词汇的动画包含多个阶段，每阶段有 起始时间(0-1) 和绘制函数
const ANIMATIONS = {

  // ─────────────────────────────────────────
  //  1. 香蕉 — 左手食指=香蕉，右手剥皮
  // ─────────────────────────────────────────
  '香蕉': {
    duration: 4.0,      // 总时长 4 秒
    phases: [
      {
        name: '香蕉出现',
        start: 0, end: 0.25,
        draw(ctx, W, H, p) {
          const cx = W * 0.45, cy = H * 0.58;
          drawHandOutline(ctx, cx, cy, 1, { indexOnly: true });

          // 未剥皮香蕉叠加在食指上（黄色椭圆）
          ctx.save();
          const bananaX = cx + 8, bananaY = cy - 85;
          const bananaW = 30, bananaH = 90;
          // 香蕉主体
          const grad = ctx.createLinearGradient(bananaX, bananaY, bananaX + 20, bananaY);
          grad.addColorStop(0, '#FFE135');
          grad.addColorStop(0.5, '#FFC107');
          grad.addColorStop(1, '#E6A800');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(bananaX + bananaW / 2, bananaY + bananaH / 2, bananaW / 2, bananaH / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          // 高光
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.beginPath();
          ctx.ellipse(bananaX + bananaW * 0.4, bananaY + bananaH * 0.35, bananaW * 0.2, bananaH * 0.12, -0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      },
      {
        name: '剥皮动作',
        start: 0.25, end: 0.75,
        draw(ctx, W, H, p) {
          const cx = W * 0.45, cy = H * 0.58;
          drawHandOutline(ctx, cx, cy, 1, { indexOnly: true });

          // 右手（剥皮的手）从上方往下移动
          const peelY = H * 0.22 + p * H * 0.42;
          drawHandOutline(ctx, cx + 5, peelY, 1, { pinch: true });

          // 香蕉皮
          const bananaX = cx + 8, bananaY = cy - 85;
          const bananaW = 30, bananaH = 90;

          // 剥开程度随 p 增加
          const peelProgress = Math.max(0, (p - 0.1) / 0.7); // 重新映射 0.25-0.75 → 0-1

          // 左半边皮（已剥开部分）
          if (peelProgress > 0) {
            ctx.save();
            ctx.fillStyle = '#E8C840';
            ctx.beginPath();
            ctx.moveTo(bananaX + bananaW / 2, bananaY);
            ctx.quadraticCurveTo(bananaX - 10 - peelProgress * 20, bananaY + bananaH * peelProgress,
              bananaX - peelProgress * 18, bananaY + bananaH * 0.6);
            ctx.quadraticCurveTo(bananaX - peelProgress * 15, bananaY + bananaH * 0.3,
              bananaX + bananaW / 2, bananaY);
            ctx.fill();
            ctx.restore();
          }

          // 右半边皮
          if (peelProgress > 0) {
            ctx.save();
            ctx.fillStyle = '#E8C840';
            ctx.beginPath();
            ctx.moveTo(bananaX + bananaW / 2, bananaY);
            ctx.quadraticCurveTo(bananaX + bananaW + 10 + peelProgress * 20, bananaY + bananaH * peelProgress,
              bananaX + bananaW + peelProgress * 18, bananaY + bananaH * 0.6);
            ctx.quadraticCurveTo(bananaX + bananaW + peelProgress * 15, bananaY + bananaH * 0.3,
              bananaX + bananaW / 2, bananaY);
            ctx.fill();
            ctx.restore();
          }

          // 香蕉果肉（白色）
          ctx.fillStyle = '#FFF9C4';
          ctx.beginPath();
          ctx.ellipse(bananaX + bananaW / 2, bananaY + bananaH * (0.4 + peelProgress * 0.1),
            bananaW * 0.3, bananaH * (0.35 - peelProgress * 0.15),
            0, 0, Math.PI * 2);
          ctx.fill();
        }
      },
      {
        name: '剥好展示',
        start: 0.75, end: 1.0,
        draw(ctx, W, H, p) {
          const cx = W * 0.45, cy = H * 0.58;
          drawHandOutline(ctx, cx, cy, 1, { indexOnly: true });

          // 剥开的皮在两侧
          const bananaX = cx + 8, bananaY = cy - 85;
          ctx.save();
          ctx.strokeStyle = '#C8A000';
          ctx.lineWidth = 2;
          // 左皮
          ctx.beginPath();
          ctx.moveTo(bananaX + 15, bananaY);
          ctx.quadraticCurveTo(bananaX - 25, bananaY + 40, bananaX - 18, bananaY + 50);
          ctx.stroke();
          // 右皮
          ctx.beginPath();
          ctx.moveTo(bananaX + 15, bananaY);
          ctx.quadraticCurveTo(bananaX + 55, bananaY + 40, bananaX + 48, bananaY + 50);
          ctx.stroke();
          ctx.restore();

          // 白色果肉 + 脉冲发光
          const pulse = 1 + Math.sin(p * Math.PI * 4) * 0.08;
          ctx.save();
          ctx.translate(bananaX + 15, bananaY + 35);
          ctx.scale(pulse, pulse);
          const grad2 = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
          grad2.addColorStop(0, '#FFFFFF');
          grad2.addColorStop(0.5, '#FFF9C4');
          grad2.addColorStop(1, '#FFE082');
          ctx.fillStyle = grad2;
          ctx.beginPath();
          ctx.ellipse(0, 0, 10, 26, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // 发光光环
          ctx.save();
          ctx.shadowColor = 'rgba(255,235,59,0.6)';
          ctx.shadowBlur = 20;
          ctx.fillStyle = 'rgba(255,235,59,0.15)';
          ctx.beginPath();
          ctx.arc(bananaX + 15, bananaY + 35, 28, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    ]
  },

  // ─────────────────────────────────────────
  //  2. 花 — 手指撮合→上升张开→花朵绽放
  // ─────────────────────────────────────────
  '花': {
    duration: 4.0,
    phases: [
      {
        name: '花苞合拢',
        start: 0, end: 0.25,
        draw(ctx, W, H, p) {
          const cx = W * 0.5, baseY = H * 0.65;
          drawHandOutline(ctx, cx, baseY, 1, { bud: true });

          // 含苞的花
          const flowerX = cx, flowerY = baseY - 70;
          drawFlowerBud(ctx, flowerX, flowerY, 0);
        }
      },
      {
        name: '手指张开+花绽放',
        start: 0.25, end: 0.8,
        draw(ctx, W, H, p) {
          const easeP = easeOutCubic(p);
          const cx = W * 0.5, baseY = H * 0.65 - easeP * 20;
          // 手指从合拢变张开
          const openness = easeP;
          drawHandOutline(ctx, cx, baseY, 1, { bud: true, openness });

          // 花朵从花苞逐渐绽放
          const flowerX = cx, flowerY = baseY - 70;
          drawFlowerBloom(ctx, flowerX, flowerY, easeP);
        }
      },
      {
        name: '完全绽放',
        start: 0.8, end: 1.0,
        draw(ctx, W, H, p) {
          const cx = W * 0.5, baseY = H * 0.45;
          drawHandOutline(ctx, cx, baseY, 1, { bud: true, openness: 1 });

          const flowerX = cx, flowerY = baseY - 70;
          const pulse = 1 + Math.sin(p * Math.PI * 6) * 0.04;
          ctx.save();
          ctx.translate(flowerX, flowerY);
          ctx.scale(pulse, pulse);
          drawFlowerBloom(ctx, 0, 0, 1);
          ctx.restore();

          // 花瓣飘落粒子
          for (let i = 0; i < 5; i++) {
            const petalP = (p + i * 0.15) % 1;
            const px = flowerX + Math.sin(petalP * 6 + i) * 50;
            const py = flowerY + petalP * 90;
            const alpha = 1 - petalP;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#FF8AAD';
            ctx.beginPath();
            ctx.ellipse(px, py, 5, 3, petalP * Math.PI, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    ]
  },

  // ─────────────────────────────────────────
  //  3. 汽车 — 双手虚握方向盘左右转动
  // ─────────────────────────────────────────
  '汽车': {
    duration: 4.0,
    phases: [
      {
        name: '握方向盘',
        start: 0, end: 0.2,
        draw(ctx, W, H, p) {
          const cx = W * 0.5, cy = H * 0.5;
          // 双手虚握
          drawHandOutline(ctx, cx - 45, cy + 5, 0.9, { grip: true });
          drawHandOutline(ctx, cx + 45, cy + 5, 0.9, { grip: true, mirror: true });

          // 方向盘出现在手之间
          drawSteeringWheel(ctx, cx, cy - 10, 0);
        }
      },
      {
        name: '左右转动',
        start: 0.2, end: 0.95,
        draw(ctx, W, H, p) {
          const cx = W * 0.5, cy = H * 0.5;
          const rotation = Math.sin(p * Math.PI * 4.5) * 0.35;

          drawHandOutline(ctx, cx - 45, cy + 5, 0.9, { grip: true });
          drawHandOutline(ctx, cx + 45, cy + 5, 0.9, { grip: true, mirror: true });

          drawSteeringWheel(ctx, cx, cy - 10, rotation);
        }
      },
      {
        name: '展示方向盘',
        start: 0.95, end: 1.0,
        draw(ctx, W, H, p) {
          const cx = W * 0.5, cy = H * 0.5;
          drawSteeringWheel(ctx, cx, cy - 10, Math.sin(p * 4) * 0.08);

          // 脉冲
          const pulse = 1 + Math.sin(p * Math.PI * 8) * 0.06;
          ctx.save();
          ctx.translate(cx, cy - 10);
          ctx.scale(pulse, pulse);
          ctx.fillStyle = 'rgba(77,166,255,0.15)';
          ctx.beginPath();
          ctx.arc(0, 0, 48, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    ]
  },

  // ─────────────────────────────────────────
  //  4. 虎 — "王"字前额 + 虎爪下按
  // ─────────────────────────────────────────
  '虎': {
    duration: 4.5,
    phases: [
      {
        name: '比出王字',
        start: 0, end: 0.3,
        draw(ctx, W, H, p) {
          const cx = W * 0.5, headY = H * 0.28;
          // 画头部轮廓
          drawHeadOutline(ctx, cx, headY);

          // 左手在额头位置
          const handX = cx, handY = headY - 12;
          drawHandOutline(ctx, handX, handY, 0.7, { wangShape: true });

          // "王"字花纹渐显
          if (p > 0.15) {
            const alpha = Math.min(1, (p - 0.15) / 0.15);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#FF8C00';
            ctx.font = 'bold 24px serif';
            ctx.textAlign = 'center';
            ctx.fillText('王', cx, headY - 8);
            ctx.restore();
          }
        }
      },
      {
        name: '虎爪准备',
        start: 0.3, end: 0.55,
        draw(ctx, W, H, p) {
          const cx = W * 0.5, headY = H * 0.28;
          drawHeadOutline(ctx, cx, headY);
          // "王"字保持
          ctx.save();
          ctx.fillStyle = '#FF8C00';
          ctx.globalAlpha = 1;
          ctx.font = 'bold 24px serif';
          ctx.textAlign = 'center';
          ctx.fillText('王', cx, headY - 8);
          ctx.restore();

          // 双手形成虎爪，慢慢下移
          const clawY = H * 0.55 + p * 0.08 * H;
          const spread = Math.min(1, (p - 0.05) / 0.25);
          drawClawHand(ctx, cx - 35, clawY, spread, false);
          drawClawHand(ctx, cx + 35, clawY, spread, true);
        }
      },
      {
        name: '虎爪下按+留痕',
        start: 0.55, end: 1.0,
        draw(ctx, W, H, p) {
          const cx = W * 0.5, headY = H * 0.28;
          drawHeadOutline(ctx, cx, headY);
          ctx.save();
          ctx.fillStyle = '#FF8C00';
          ctx.font = 'bold 24px serif';
          ctx.textAlign = 'center';
          ctx.fillText('王', cx, headY - 8);
          ctx.restore();

          const clawY = H * 0.6 + Math.min(p, 0.5) * 0.05 * H;
          const pressP = Math.min(1, p / 0.4);

          // 爪痕
          if (pressP > 0.2) {
            const scratchAlpha = Math.min(1, (pressP - 0.2) / 0.5) * 0.7;
            for (let i = 0; i < 4; i++) {
              const sx = cx - 30 + i * 20;
              ctx.save();
              ctx.globalAlpha = scratchAlpha;
              ctx.strokeStyle = '#FF6B3D';
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.moveTo(sx, clawY - 10);
              ctx.lineTo(sx + (i === 1 ? 5 : i === 2 ? -5 : 0), clawY + 15 + i * 3);
              ctx.stroke();
              ctx.restore();
            }
          }

          drawClawHand(ctx, cx - 35, clawY, 1, false);
          drawClawHand(ctx, cx + 35, clawY, 1, true);
        }
      }
    ]
  },

  // ─────────────────────────────────────────
  //  5. 月亮 — 双手外移，指尖间距变窄
  // ─────────────────────────────────────────
  '月亮': {
    duration: 3.5,
    phases: [
      {
        name: '双手靠近',
        start: 0, end: 0.3,
        draw(ctx, W, H, p) {
          const cx = W * 0.5, cy = H * 0.5;
          drawFingertipsTogether(ctx, cx, cy, p * 0.2);
        }
      },
      {
        name: '向外移动形成弯月',
        start: 0.3, end: 0.8,
        draw(ctx, W, H, p) {
          const easeP = easeInOutCubic(p);
          const cx = W * 0.5, cy = H * 0.5;
          const spread = easeP * 80;
          drawFingertipsTogether(ctx, cx - spread / 2, cy, 1, 1);
          drawFingertipsTogether(ctx, cx + spread / 2, cy, 1, -1);

          // 弯月从两手之间浮现
          const moonAlpha = Math.min(1, (p - 0.1) / 0.3);
          const moonSize = 30 + easeP * 15;

          ctx.save();
          ctx.globalAlpha = moonAlpha;
          const moonGrad = ctx.createRadialGradient(cx, cy - 5, moonSize * 0.2, cx, cy, moonSize);
          moonGrad.addColorStop(0, '#FFFDE7');
          moonGrad.addColorStop(0.4, '#FFE082');
          moonGrad.addColorStop(0.8, '#FFA726');
          moonGrad.addColorStop(1, 'rgba(255,167,38,0)');
          ctx.fillStyle = moonGrad;

          // 弯月形状
          ctx.beginPath();
          ctx.arc(cx, cy, moonSize, -0.3, Math.PI + 0.3);
          ctx.lineTo(cx - moonSize * 0.5, cy + moonSize * 0.85);
          ctx.quadraticCurveTo(cx, cy + moonSize * 0.2, cx + moonSize * 0.5, cy + moonSize * 0.85);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      },
      {
        name: '弯月展示',
        start: 0.8, end: 1.0,
        draw(ctx, W, H, p) {
          const cx = W * 0.5, cy = H * 0.5;
          const pulse = 1 + Math.sin(p * Math.PI * 5) * 0.05;
          ctx.save();
          ctx.translate(cx, cy - 5);
          ctx.scale(pulse, pulse);

          // 发光弯月
          ctx.shadowColor = 'rgba(255,235,59,0.7)';
          ctx.shadowBlur = 35;
          const moonGrad = ctx.createRadialGradient(0, 0, 15, 0, 0, 50);
          moonGrad.addColorStop(0, '#FFFDE7');
          moonGrad.addColorStop(0.3, '#FFE082');
          moonGrad.addColorStop(0.7, '#FFA726');
          moonGrad.addColorStop(1, 'rgba(255,167,38,0)');
          ctx.fillStyle = moonGrad;
          ctx.beginPath();
          ctx.arc(0, 0, 45, -0.3, Math.PI + 0.3);
          ctx.lineTo(-22, 40);
          ctx.quadraticCurveTo(0, 10, 22, 40);
          ctx.closePath();
          ctx.fill();

          // 小星星
          for (let i = 0; i < 6; i++) {
            const sx = Math.cos(i * 1.1) * 70;
            const sy = Math.sin(i * 1.1) * 50 - 25;
            ctx.shadowBlur = 6;
            ctx.shadowColor = '#FFE082';
            ctx.fillStyle = '#FFFDE7';
            ctx.beginPath();
            ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }
    ]
  },

  // ─────────────────────────────────────────
  //  6. 跳 — 右手两指=双腿，左手=地面，弹跳
  // ─────────────────────────────────────────
  '跳': {
    duration: 4.0,
    phases: [
      {
        name: '双腿就位',
        start: 0, end: 0.25,
        draw(ctx, W, H, p) {
          const cx = W * 0.45, groundY = H * 0.65;
          // 左手=地面
          drawHandOutline(ctx, cx + 70, groundY + 20, 1, { flat: true });

          // 右手两指=双腿
          drawLegFingers(ctx, cx, groundY - 15, 0);
        }
      },
      {
        name: '弯曲蓄力',
        start: 0.25, end: 0.5,
        draw(ctx, W, H, p) {
          const cx = W * 0.45, groundY = H * 0.65;
          drawHandOutline(ctx, cx + 70, groundY + 20, 1, { flat: true });

          const bendAmount = p * 25 + 5;
          drawLegFingers(ctx, cx, groundY - 15 - bendAmount * 0.5, 0, { bent: bendAmount });
        }
      },
      {
        name: '弹跳起飞',
        start: 0.5, end: 0.75,
        draw(ctx, W, H, p) {
          const cx = W * 0.45, groundY = H * 0.65;
          drawHandOutline(ctx, cx + 70, groundY + 20, 1, { flat: true });

          const jumpP = Math.min(1, p / 0.6);
          const height = jumpP * 55;
          const parabolaY = groundY - 15 - height * (1 - Math.pow(jumpP * 2 - 1, 2));

          drawLegFingers(ctx, cx, parabolaY, 0, { jump: true });

          // 小人叠加
          drawJumpingPerson(ctx, cx, parabolaY - 28, jumpP);
        }
      },
      {
        name: '落地展示',
        start: 0.75, end: 1.0,
        draw(ctx, W, H, p) {
          const cx = W * 0.45, groundY = H * 0.65;
          drawHandOutline(ctx, cx + 70, groundY + 20, 1, { flat: true });
          drawLegFingers(ctx, cx, groundY - 15, 0);

          // 小人站在手指上
          drawJumpingPerson(ctx, cx, groundY - 43, 0.3);
        }
      }
    ]
  },

  // ─────────────────────────────────────────
  //  7. 朋友 — 两根拇指碰两下
  // ─────────────────────────────────────────
  '朋友': {
    duration: 3.5,
    phases: [
      {
        name: '拇指靠近',
        start: 0, end: 0.3,
        draw(ctx, W, H, p) {
          const cx = W * 0.5, cy = H * 0.48;
          const dist = (1 - p) * 60;
          drawThumbHead(ctx, cx - dist, cy, 'left', p < 0.15 ? 0 : (p - 0.15) / 0.15);
          drawThumbHead(ctx, cx + dist, cy, 'right', p < 0.15 ? 0 : (p - 0.15) / 0.15);
        }
      },
      {
        name: '第一次碰',
        start: 0.3, end: 0.5,
        draw(ctx, W, H, p) {
          const cx = W * 0.5, cy = H * 0.48;
          const bump = easeOutBack(Math.min(1, p * 3.5));
          const dist = bump < 0.8 ? 0 : (bump - 0.8) * 25;

          if (bump > 0.8 && bump < 0.95) {
            // 碰撞特效
            ctx.save();
            ctx.globalAlpha = 0.4;
            const hitGrad = ctx.createRadialGradient(cx, cy, 5, cx, cy, 20);
            hitGrad.addColorStop(0, '#FFD93D');
            hitGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = hitGrad;
            ctx.beginPath();
            ctx.arc(cx, cy, 20, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          drawThumbHead(ctx, cx - dist, cy, 'left', 1);
          drawThumbHead(ctx, cx + dist, cy, 'right', 1);
        }
      },
      {
        name: '第二次碰+笑脸',
        start: 0.5, end: 0.85,
        draw(ctx, W, H, p) {
          const cx = W * 0.5, cy = H * 0.48;
          const bump2 = easeOutBack(Math.min(1, (p - 0.1) * 3.5));
          const dist = bump2 < 0.8 ? 0 : (bump2 - 0.8) * 25;

          if (bump2 > 0.8 && bump2 < 0.95) {
            ctx.save();
            ctx.globalAlpha = 0.5;
            const hitGrad = ctx.createRadialGradient(cx, cy, 5, cx, cy, 25);
            hitGrad.addColorStop(0, '#FFD93D');
            hitGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = hitGrad;
            ctx.beginPath();
            ctx.arc(cx, cy, 25, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          drawThumbHead(ctx, cx - dist, cy, 'left', 1);
          drawThumbHead(ctx, cx + dist, cy, 'right', 1);

          // 笑脸叠加
          if (p > 0.2) {
            const smileAlpha = Math.min(1, (p - 0.2) / 0.3);
            drawSmileyOnThumb(ctx, cx - 18, cy, smileAlpha);
            drawSmileyOnThumb(ctx, cx + 18, cy, smileAlpha);
          }
        }
      },
      {
        name: '展示友情',
        start: 0.85, end: 1.0,
        draw(ctx, W, H, p) {
          const cx = W * 0.5, cy = H * 0.48;
          drawThumbHead(ctx, cx - 15, cy, 'left', 1);
          drawThumbHead(ctx, cx + 15, cy, 'right', 1);
          drawSmileyOnThumb(ctx, cx - 15, cy, 1);
          drawSmileyOnThumb(ctx, cx + 15, cy, 1);

          // 心形特效
          const pulse = 1 + Math.sin(p * Math.PI * 6) * 0.08;
          ctx.save();
          ctx.translate(cx, cy - 35);
          ctx.scale(pulse * 0.4, pulse * 0.4);
          ctx.fillStyle = '#FF6B9D';
          drawHeartPath(ctx, 0, 0, 25);
          ctx.fill();
          ctx.restore();
        }
      }
    ]
  },

  // ─────────────────────────────────────────
  //  8. 指示 — 左手拇指=人头，右手食指指挥
  // ─────────────────────────────────────────
  '指示': {
    duration: 3.5,
    phases: [
      {
        name: '拇指作为人头',
        start: 0, end: 0.3,
        draw(ctx, W, H, p) {
          const thumbCx = W * 0.35, thumbCy = H * 0.45;
          drawThumbHead(ctx, thumbCx, thumbCy, 'left', 1);

          // 表情逐步出现
          if (p > 0.1) {
            const alpha = Math.min(1, (p - 0.1) / 0.2);
            drawExpressionOnThumb(ctx, thumbCx, thumbCy, alpha);
          }
        }
      },
      {
        name: '食指指挥',
        start: 0.3, end: 0.85,
        draw(ctx, W, H, p) {
          const thumbCx = W * 0.35, thumbCy = H * 0.45;
          drawThumbHead(ctx, thumbCx, thumbCy, 'left', 1);
          drawExpressionOnThumb(ctx, thumbCx, thumbCy, 1);

          // 右手食指指挥
          const pointerBaseX = W * 0.55, pointerBaseY = H * 0.6;
          const swing = Math.sin(p * Math.PI * 4) * 18;
          const pointerAngle = -(0.3 + Math.sin(p * Math.PI * 6) * 0.25);
          drawPointingFinger(ctx, pointerBaseX, pointerBaseY, pointerAngle, 1);

          // 指挥轨迹箭头
          ctx.save();
          ctx.globalAlpha = 0.4;
          ctx.strokeStyle = '#4DA6FF';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(pointerBaseX - 20, pointerBaseY - 35);
          ctx.quadraticCurveTo(thumbCx - 5, thumbCy + 40, thumbCx + 5, thumbCy + 10);
          ctx.stroke();
          ctx.restore();
        }
      },
      {
        name: '指示确认',
        start: 0.85, end: 1.0,
        draw(ctx, W, H, p) {
          const thumbCx = W * 0.35, thumbCy = H * 0.45;
          drawThumbHead(ctx, thumbCx, thumbCy, 'left', 1);
          drawExpressionOnThumb(ctx, thumbCx, thumbCy, 1);

          drawPointingFinger(ctx, W * 0.55, H * 0.6, -0.3, 1);

          // 确认效果：指向目标
          const pulse = 1 + Math.sin(p * Math.PI * 8) * 0.06;
          ctx.save();
          ctx.globalAlpha = 0.7;
          const dotGrad = ctx.createRadialGradient(thumbCx + 5, thumbCy + 5, 2, thumbCx + 5, thumbCy + 5, 18 * pulse);
          dotGrad.addColorStop(0, '#4DA6FF');
          dotGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = dotGrad;
          ctx.beginPath();
          ctx.arc(thumbCx + 5, thumbCy + 5, 18 * pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    ]
  },

  // ─────────────────────────────────────────
  //  9. 唱歌 — 头部晃动+喉部外移+音符
  // ─────────────────────────────────────────
  '唱歌': {
    duration: 4.0,
    phases: [
      {
        name: '头部摆动',
        start: 0, end: 0.3,
        draw(ctx, W, H, p) {
          const headX = W * 0.5, headY = H * 0.35;
          const sway = Math.sin(p * Math.PI * 6) * 12;
          drawHeadOutline(ctx, headX + sway, headY);
          // 嘴巴张开
          drawMouth(ctx, headX + sway, headY + 15, Math.min(1, p / 0.15) * 0.6);
        }
      },
      {
        name: '喉部向外发声',
        start: 0.3, end: 0.7,
        draw(ctx, W, H, p) {
          const headX = W * 0.5, headY = H * 0.35;
          const sway = Math.sin(p * Math.PI * 6) * 10;
          drawHeadOutline(ctx, headX + sway, headY);
          drawMouth(ctx, headX + sway, headY + 15, 0.5 + Math.sin(p * 8) * 0.2);

          // 双手从喉部向外移动
          const spread = Math.min(1, (p - 0.05) / 0.35);
          const throatY = headY + 35;
          drawHandAtThroat(ctx, headX - 15 - spread * 55, throatY, spread < 0.3 ? 0 : (spread - 0.3) / 0.7);
          drawHandAtThroat(ctx, headX + 15 + spread * 55, throatY, spread < 0.3 ? 0 : (spread - 0.3) / 0.7, true);
        }
      },
      {
        name: '音符流动',
        start: 0.7, end: 1.0,
        draw(ctx, W, H, p) {
          const headX = W * 0.5, headY = H * 0.35;
          const sway = Math.sin(p * Math.PI * 8) * 8;
          drawHeadOutline(ctx, headX + sway, headY);
          drawMouth(ctx, headX + sway, headY + 15, 0.6);

          const throatY = headY + 35;
          drawHandAtThroat(ctx, headX - 70, throatY, 1);
          drawHandAtThroat(ctx, headX + 70, throatY, 1, true);

          // 流动音符
          const notes = ['♪', '♫', '♩', '♪', '♬'];
          for (let i = 0; i < 5; i++) {
            const np = (p + i * 0.15) % 1;
            const nx = headX + Math.sin(np * 7 + i * 1.5) * 50;
            const ny = headY - 25 - np * 90;
            const alpha = np < 0.2 ? np / 0.2 : np > 0.8 ? (1 - np) / 0.2 : 1;

            ctx.save();
            ctx.globalAlpha = alpha * 0.85;
            ctx.fillStyle = '#FFD93D';
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(notes[i], nx, ny);
            ctx.restore();
          }
        }
      }
    ]
  },

  // ─────────────────────────────────────────
  //  10. 馋 — 食指嘴角下滑+口水+舔嘴唇
  // ─────────────────────────────────────────
  '馋': {
    duration: 3.5,
    phases: [
      {
        name: '手指接近嘴角',
        start: 0, end: 0.3,
        draw(ctx, W, H, p) {
          const headX = W * 0.5, headY = H * 0.38;
          drawHeadOutline(ctx, headX, headY);
          drawMouth(ctx, headX, headY + 15, 0.2);

          // 食指移向嘴角
          const fingerX = headX + 30 - p * 25;
          const fingerY = headY + 8 + p * 12;
          drawPointingFinger(ctx, fingerX, fingerY, -1.2, 0.7);
        }
      },
      {
        name: '食指下滑+口水',
        start: 0.3, end: 0.65,
        draw(ctx, W, H, p) {
          const headX = W * 0.5, headY = H * 0.38;
          drawHeadOutline(ctx, headX, headY);
          drawMouth(ctx, headX, headY + 15, 0.25);

          const slideProgress = Math.min(1, (p - 0.05) / 0.55);
          const fingerX = headX + 5;
          const fingerY = headY + 18 + slideProgress * 35;
          drawPointingFinger(ctx, fingerX, fingerY, -Math.PI / 2, 0.7);

          // 口水从嘴角往下流
          if (p > 0.1) {
            const droolAlpha = Math.min(1, (p - 0.1) / 0.3) * 0.8;
            const droolLen = Math.min(1, p / 0.4) * 30;

            ctx.save();
            ctx.globalAlpha = droolAlpha;
            // 口水主体
            const droolGrad = ctx.createLinearGradient(headX + 12, headY + 8, headX + 12, headY + 8 + droolLen);
            droolGrad.addColorStop(0, 'rgba(180,220,255,0.9)');
            droolGrad.addColorStop(1, 'rgba(180,220,255,0)');
            ctx.fillStyle = droolGrad;
            ctx.beginPath();
            ctx.moveTo(headX + 8, headY + 12);
            ctx.bezierCurveTo(
              headX + 6, headY + 12 + droolLen * 0.4,
              headX + 18, headY + 12 + droolLen * 0.6,
              headX + 14, headY + 12 + droolLen
            );
            ctx.lineTo(headX + 10, headY + 12 + droolLen);
            ctx.bezierCurveTo(
              headX + 16, headY + 12 + droolLen * 0.6,
              headX + 4, headY + 12 + droolLen * 0.4,
              headX + 8, headY + 12
            );
            ctx.fill();
            ctx.restore();
          }

          // 舌头微伸
          if (p > 0.25) {
            const tongueAlpha = Math.min(1, (p - 0.25) / 0.15) * 0.7;
            ctx.save();
            ctx.globalAlpha = tongueAlpha;
            ctx.fillStyle = '#FF6B6B';
            ctx.beginPath();
            ctx.ellipse(headX + 14, headY + 26, 5, 3, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      },
      {
        name: '舔嘴唇',
        start: 0.65, end: 1.0,
        draw(ctx, W, H, p) {
          const headX = W * 0.5, headY = H * 0.38;
          drawHeadOutline(ctx, headX, headY);

          // 舌头舔嘴唇动画
          const lickProgress = Math.abs(Math.sin(p * Math.PI * 5));
          const tongueX = headX + 15 + lickProgress * 6;
          const tongueY = headY + 15 - lickProgress * 3;

          ctx.save();
          ctx.fillStyle = '#FF6B6B';
          ctx.globalAlpha = 0.7;
          ctx.beginPath();
          ctx.ellipse(tongueX, tongueY, 5 + lickProgress * 2, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // 嘴巴微张
          drawMouth(ctx, headX, headY + 15, 0.3 + lickProgress * 0.2);

          // 口水残留
          const droolGrad = ctx.createLinearGradient(headX + 12, headY + 12, headX + 12, headY + 25);
          droolGrad.addColorStop(0, 'rgba(180,220,255,0.6)');
          droolGrad.addColorStop(1, 'rgba(180,220,255,0)');
          ctx.fillStyle = droolGrad;
          ctx.beginPath();
          ctx.moveTo(headX + 8, headY + 14);
          ctx.bezierCurveTo(headX + 5, headY + 22, headX + 18, headY + 24, headX + 12, headY + 28);
          ctx.lineTo(headX + 10, headY + 28);
          ctx.bezierCurveTo(headX + 16, headY + 24, headX + 4, headY + 22, headX + 8, headY + 14);
          ctx.fill();

          // 满足感泡泡
          ctx.save();
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = '#FF8C42';
          ctx.beginPath();
          ctx.arc(headX + 40, headY - 5, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    ]
  }
};

// ============================================
//  绘制工具函数
// ============================================

// 画手部轮廓
function drawHandOutline(ctx, x, y, scale, opts = {}) {
  const s = scale * 30;
  ctx.save();
  ctx.translate(x, y);

  // 手掌
  const palmGrad = ctx.createLinearGradient(0, -s * 0.5, 0, s * 0.5);
  palmGrad.addColorStop(0, '#FFD5B8');
  palmGrad.addColorStop(0.5, '#F5C6A0');
  palmGrad.addColorStop(1, '#E8B890');
  ctx.fillStyle = palmGrad;
  ctx.strokeStyle = 'rgba(180,130,100,0.5)';
  ctx.lineWidth = 1.5;

  if (opts.indexOnly) {
    // 只有食指竖立
    ctx.beginPath();
    ctx.roundRect(-7, -s * 1.2, 14, s * 1.8, 7);
    ctx.fill();
    ctx.stroke();
    // 食指
    ctx.beginPath();
    ctx.roundRect(-3, -s * 2.0, 6, s * 1.2, 3);
    ctx.fill();
    ctx.stroke();
    // 其余四指弯曲包住
    ctx.beginPath();
    ctx.arc(0, -s * 0.2, 10, 0, Math.PI, false);
    ctx.fill();
  } else if (opts.pinch) {
    // 捏合手（剥皮）
    ctx.beginPath();
    ctx.roundRect(-8, -s * 0.6, 16, s * 1.0, 8);
    ctx.fill();
    ctx.stroke();
    // 拇指和食指捏合
    ctx.beginPath();
    ctx.ellipse(-5, -s * 0.7, 5, 3, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(5, -s * 0.7, 5, 3, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (opts.bud) {
    // 花苞手：手指撮合在上方
    ctx.beginPath();
    ctx.roundRect(-8, -s * 0.3, 16, s * 1.1, 8);
    ctx.fill();
    ctx.stroke();
    // 手指向上撮合
    const open = opts.openness || 0;
    for (let i = 0; i < 5; i++) {
      const angle = -0.6 + i * 0.3 - open * 0.4 + open * i * 0.2;
      const fy = -s * 0.8 - open * 30;
      const fx = -12 + i * 6 + open * (i - 2) * 12;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.roundRect(-2, -s * 0.4, 4, s * 0.6, 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  } else if (opts.grip) {
    // 虚握方向盘
    const mirror = opts.mirror ? -1 : 1;
    ctx.scale(mirror, 1);
    ctx.beginPath();
    ctx.roundRect(-8, -s * 0.5, 16, s * 1.0, 8);
    ctx.fill();
    ctx.stroke();
    // 弯曲的手指
    for (let i = 0; i < 5; i++) {
      const fy = -s * 0.6 + i * s * 0.3;
      ctx.beginPath();
      ctx.arc(-5, fy, 5, -Math.PI / 2, Math.PI / 2, true);
      ctx.fill();
      ctx.stroke();
    }
  } else if (opts.wangShape) {
    // "王"字形手势（左手中/无名/小指 + 右手食指）
    ctx.beginPath();
    ctx.roundRect(-10, -s * 0.3, 20, s * 0.8, 10);
    ctx.fill();
    ctx.stroke();
    // 左手三指
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.roundRect(-8 + i * 6, -s * 0.9, 4, s * 0.7, 2);
      ctx.fill();
      ctx.stroke();
    }
    // 右手食指横在中间
    ctx.beginPath();
    ctx.roundRect(-12, -s * 0.5, 24, 5, 2);
    ctx.fill();
    ctx.stroke();
  } else if (opts.flat) {
    // 平放的手（地面）
    ctx.beginPath();
    ctx.roundRect(-s * 1.2, -10, s * 2.4, 20, 10);
    ctx.fill();
    ctx.stroke();
    // 手指并拢平放
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.roundRect(-s * 1.2 + i * s * 0.48, -18, s * 0.35, 12, 3);
      ctx.fill();
      ctx.stroke();
    }
  } else {
    // 默认手掌
    ctx.beginPath();
    ctx.roundRect(-8, -s * 0.5, 16, s * 1.2, 8);
    ctx.fill();
    ctx.stroke();
    // 五根手指
    for (let i = 0; i < 5; i++) {
      const fx = -10 + i * 5;
      ctx.beginPath();
      ctx.roundRect(fx, -s * 0.9, 3, s * 0.5, 1.5);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore();
}

// 花苞
function drawFlowerBud(ctx, x, y, progress) {
  ctx.save();
  ctx.translate(x, y);
  const scale = 0.8 + progress * 0.2;

  // 花瓣合拢
  const petalColor = '#FF85A1';
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 / 6) * i - Math.PI / 2;
    ctx.save();
    ctx.rotate(angle + progress * 0.1);
    ctx.translate(0, -5 - progress * 8);
    ctx.fillStyle = petalColor;
    ctx.beginPath();
    ctx.ellipse(0, -12, 6, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 花心 - 绿色花萼
  const sepalGrad = ctx.createRadialGradient(0, 5, 2, 0, 8, 12);
  sepalGrad.addColorStop(0, '#4DE8A0');
  sepalGrad.addColorStop(1, '#2A8A5A');
  ctx.fillStyle = sepalGrad;
  ctx.beginPath();
  ctx.arc(0, 5, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// 花朵绽放
function drawFlowerBloom(ctx, x, y, progress) {
  ctx.save();
  ctx.translate(x, y);

  const petals = 6;
  const outerRadius = 18 + progress * 25;
  const innerRadius = 5;

  for (let i = 0; i < petals; i++) {
    const angle = (Math.PI * 2 / petals) * i - Math.PI / 2;
    const openAngle = progress * 0.45;
    const petalDist = 2 + progress * 18;

    ctx.save();
    ctx.rotate(angle);
    ctx.translate(0, petalDist);

    // 花瓣渐变
    const petalGrad = ctx.createLinearGradient(0, -outerRadius * 0.5, 0, outerRadius * 0.5);
    const hue = 340 + i * 8;
    petalGrad.addColorStop(0, `hsl(${hue}, 90%, 75%)`);
    petalGrad.addColorStop(0.5, `hsl(${hue}, 85%, 65%)`);
    petalGrad.addColorStop(1, `hsl(${hue}, 70%, 50%)`);
    ctx.fillStyle = petalGrad;

    ctx.beginPath();
    ctx.ellipse(0, -outerRadius * 0.55, outerRadius * 0.25, outerRadius * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 花瓣纹理
    ctx.strokeStyle = `hsla(${hue}, 70%, 55%, 0.3)`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, -outerRadius * 0.1);
    ctx.lineTo(0, -outerRadius * 0.8);
    ctx.stroke();

    ctx.restore();
  }

  // 花蕊
  const centerGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 10);
  centerGrad.addColorStop(0, '#FFD93D');
  centerGrad.addColorStop(0.6, '#FF8C00');
  centerGrad.addColorStop(1, '#E65100');
  ctx.fillStyle = centerGrad;
  ctx.beginPath();
  ctx.arc(0, 0, 8 + progress * 3, 0, Math.PI * 2);
  ctx.fill();

  // 花蕊点
  ctx.fillStyle = '#FFF9C4';
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 / 6) * i;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 5, Math.sin(a) * 5, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// 方向盘
function drawSteeringWheel(ctx, x, y, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  // 外环
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, 38, 0, Math.PI * 2);
  ctx.stroke();

  // 内部结构
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-35, 0);
  ctx.lineTo(35, 0);
  ctx.moveTo(0, -35);
  ctx.lineTo(0, 35);
  ctx.stroke();

  // 中心
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();

  // Logo
  ctx.fillStyle = '#888';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🚗', 0, 1);

  ctx.restore();
}

// 虎爪手
function drawClawHand(ctx, x, y, spread, mirrored) {
  ctx.save();
  ctx.translate(x, y);
  if (mirrored) ctx.scale(-1, 1);
  ctx.scale(0.8, 0.8);

  // 手掌
  ctx.fillStyle = '#F5C6A0';
  ctx.strokeStyle = 'rgba(180,130,100,0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-10, -5, 20, 25, 8);
  ctx.fill();
  ctx.stroke();

  // 五指弯曲
  for (let i = 0; i < 5; i++) {
    const fx = -12 + i * 6;
    const angle = -0.8 - spread * 0.5;
    ctx.save();
    ctx.translate(fx, -8);
    ctx.rotate(angle);
    // 爪尖
    ctx.fillStyle = '#3A2A1A';
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(-3, -16);
    ctx.lineTo(0, -13);
    ctx.lineTo(3, -16);
    ctx.closePath();
    ctx.fill();
    // 指节
    ctx.strokeStyle = 'rgba(180,130,100,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -5, 4, 0, Math.PI, false);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// 头部轮廓
function drawHeadOutline(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);

  // 脸部
  ctx.fillStyle = '#FFDFC4';
  ctx.strokeStyle = 'rgba(180,130,100,0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 28, 33, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 眼睛
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(-9, -5, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(9, -5, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // 眉毛
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-14, -11);
  ctx.lineTo(-5, -10);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(14, -11);
  ctx.lineTo(5, -10);
  ctx.stroke();

  // 头发
  ctx.fillStyle = '#3A2A1A';
  ctx.beginPath();
  ctx.arc(0, -18, 24, Math.PI, 0, false);
  ctx.fill();

  ctx.restore();
}

// 嘴巴
function drawMouth(ctx, x, y, openness) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#CC4444';
  ctx.beginPath();
  if (openness < 0.2) {
    ctx.moveTo(-6, 0);
    ctx.quadraticCurveTo(0, 3, 6, 0);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#CC6666';
    ctx.stroke();
  } else {
    ctx.ellipse(0, 0, 6, 3 + openness * 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 指尖捏合手势
function drawFingertipsTogether(ctx, x, y, scale, dir = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // 手掌
  ctx.fillStyle = '#FFD5B8';
  ctx.strokeStyle = 'rgba(180,130,100,0.5)';
  ctx.lineWidth = 1.5;

  const handX = dir > 0 ? 10 : -50;
  ctx.beginPath();
  ctx.roundRect(handX, -20, 40, 40, 12);
  ctx.fill();
  ctx.stroke();

  // 手指向中心延伸
  for (let i = 0; i < 5; i++) {
    const fx = handX + 5 + i * 7;
    const fy = -15 - i * 2;
    const targetX = dir > 0 ? 25 : -15;

    ctx.beginPath();
    ctx.roundRect(
      Math.min(fx, targetX), fy,
      Math.abs(fx - targetX) + 3, 4,
      2
    );
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

// 双腿手指
function drawLegFingers(ctx, x, y, scale, opts = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(0.8, 0.8);

  // 手背
  ctx.fillStyle = '#F5C6A0';
  ctx.strokeStyle = 'rgba(180,130,100,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-8, 5, 16, 30, 8);
  ctx.fill();
  ctx.stroke();

  if (opts.bent) {
    // 弯曲的腿
    const knee = opts.bent;
    ctx.strokeStyle = '#D4956B';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-3, -5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-8, knee * 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(3, -5);
    ctx.lineTo(3, 0);
    ctx.lineTo(8, knee * 0.3);
    ctx.stroke();
    // 关节
    ctx.fillStyle = '#E8A870';
    ctx.beginPath();
    ctx.arc(-3, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(3, 0, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (opts.jump) {
    // 跳跃中的腿
    ctx.strokeStyle = '#D4956B';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-3, -8);
    ctx.lineTo(-3, 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(3, -8);
    ctx.lineTo(3, 12);
    ctx.stroke();
  } else {
    // 直立的腿
    ctx.strokeStyle = '#D4956B';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-3, -8);
    ctx.lineTo(-3, 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(3, -8);
    ctx.lineTo(3, 20);
    ctx.stroke();
    // 鞋
    ctx.fillStyle = '#4DA6FF';
    ctx.beginPath();
    ctx.roundRect(-7, 18, 8, 6, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-1, 18, 8, 6, 2);
    ctx.fill();
  }

  ctx.restore();
}

// 跳跃的小人
function drawJumpingPerson(ctx, x, y, airProgress) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(0.6, 0.6);

  // 头
  ctx.fillStyle = '#FFDFC4';
  ctx.strokeStyle = 'rgba(180,130,100,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, -15, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 身体
  ctx.fillStyle = '#4DA6FF';
  ctx.beginPath();
  ctx.roundRect(-6, -5, 12, 20, 4);
  ctx.fill();

  // 手臂（伸展表示跳跃）
  const armAngle = -(Math.PI / 4) * airProgress;
  ctx.strokeStyle = '#D4956B';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-6, -3);
  ctx.lineTo(-20 + Math.cos(armAngle) * 5, -18 - airProgress * 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(6, -3);
  ctx.lineTo(20 - Math.cos(armAngle) * 5, -18 - airProgress * 10);
  ctx.stroke();

  // 腿
  ctx.beginPath();
  ctx.moveTo(-3, 15);
  ctx.lineTo(-8, 25 + airProgress * 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(3, 15);
  ctx.lineTo(8, 25 + airProgress * 5);
  ctx.stroke();

  ctx.restore();
}

// 拇指头部
function drawThumbHead(ctx, x, y, side, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;

  // 拇指
  ctx.fillStyle = '#F5C6A0';
  ctx.strokeStyle = 'rgba(180,130,100,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-7, -20, 14, 30, 7);
  ctx.fill();
  ctx.stroke();

  // 拇指顶部（头）
  ctx.fillStyle = '#FFDFC4';
  ctx.beginPath();
  ctx.arc(0, -18, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 小帽子/头发
  ctx.fillStyle = '#5B3A1A';
  ctx.beginPath();
  ctx.arc(0, -24, 8, Math.PI, 0, false);
  ctx.fill();

  ctx.restore();
}

// 拇指上的笑脸
function drawSmileyOnThumb(ctx, x, y, alpha) {
  ctx.save();
  ctx.translate(x, y - 18);
  ctx.globalAlpha = alpha * 0.8;

  // 圆脸背景
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();

  // 眼睛
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(-3, -2, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(3, -2, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // 笑脸
  ctx.strokeStyle = '#CC6666';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 1, 4, 0.2, Math.PI - 0.2);
  ctx.stroke();

  ctx.restore();
}

// 拇指上的表情
function drawExpressionOnThumb(ctx, x, y, alpha) {
  ctx.save();
  ctx.translate(x, y - 18);
  ctx.globalAlpha = alpha * 0.7;

  // 圆脸
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();

  // 眼睛（小圆点）
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(-3, -2, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(3, -2, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // 小嘴
  ctx.fillStyle = '#CC6666';
  ctx.beginPath();
  ctx.arc(0, 3, 2, 0, Math.PI);
  ctx.fill();

  // 小红晕
  ctx.fillStyle = 'rgba(255, 150, 150, 0.4)';
  ctx.beginPath();
  ctx.arc(-6, 2, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(6, 2, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// 指向手
function drawPointingFinger(ctx, x, y, angle, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  ctx.fillStyle = '#F5C6A0';
  ctx.strokeStyle = 'rgba(180,130,100,0.5)';
  ctx.lineWidth = 1.5;

  // 手掌
  ctx.beginPath();
  ctx.roundRect(-12, 5, 24, 22, 8);
  ctx.fill();
  ctx.stroke();

  // 食指（指向）
  ctx.beginPath();
  ctx.roundRect(-3, -25, 6, 30, 3);
  ctx.fill();
  ctx.stroke();

  // 其余手指弯曲
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(-8 + i * 8, 15, 5, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
  }

  // 拇指
  ctx.beginPath();
  ctx.arc(-5, 8, 6, 0.8, Math.PI + 0.8, false);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

// 喉部手
function drawHandAtThroat(ctx, x, y, openness, mirrored) {
  ctx.save();
  ctx.translate(x, y);
  if (mirrored) ctx.scale(-1, 1);
  ctx.scale(0.7, 0.7);

  ctx.fillStyle = '#F5C6A0';
  ctx.strokeStyle = 'rgba(180,130,100,0.4)';
  ctx.lineWidth = 1;

  // 手掌
  ctx.beginPath();
  ctx.roundRect(-8, -5, 16, 22, 8);
  ctx.fill();
  ctx.stroke();

  // 拇指和食指（从喉部移出）
  const spreadAngle = -0.8 - openness * 1.0;
  ctx.save();
  ctx.translate(5, -8);
  ctx.rotate(spreadAngle);
  ctx.beginPath();
  ctx.roundRect(-2, -12, 4, 14, 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(-5, -8);
  ctx.rotate(-spreadAngle);
  ctx.beginPath();
  ctx.roundRect(-2, -12, 4, 14, 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

// 爱心路径
function drawHeartPath(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.3);
  ctx.bezierCurveTo(x, y, x - size, y, x - size, y + size * 0.3);
  ctx.bezierCurveTo(x - size, y + size * 0.7, x, y + size, x, y + size * 1.2);
  ctx.bezierCurveTo(x, y + size, x + size, y + size * 0.7, x + size, y + size * 0.3);
  ctx.bezierCurveTo(x + size, y, x, y, x, y + size * 0.3);
}

// ============ 缓动函数 ============
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// ============================================
//  动画播放器
// ============================================
class AnimationPlayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.currentWord = null;
    this.animation = null;
    this.animData = null;
    this.animStart = 0;
    this.animFrame = null;
    this.playing = false;
    this.loop = true;
    this._onPhaseChange = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width, h = rect.height;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.W = w * dpr;
    this.H = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  load(word) {
    this.stop();
    this.currentWord = word;
    this.animData = ANIMATIONS[word];
    if (!this.animData) {
      this.animData = ANIMATIONS['香蕉']; // fallback
    }
    this.seek(0);
  }

  play(word) {
    if (word && word !== this.currentWord) {
      this.load(word);
    }
    this.playing = true;
    this.animStart = performance.now();
    this.tick();
  }

  stop() {
    this.playing = false;
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  seek(progress) {
    this.stop();
    const anim = this.animData;
    if (!anim) return;

    const totalMs = anim.duration * 1000;
    this.animStart = performance.now() - progress * totalMs;
    this.render(progress);
  }

  tick() {
    if (!this.playing || !this.animData) return;

    const elapsed = (performance.now() - this.animStart) / 1000;
    let rawProgress = elapsed / this.animData.duration;

    if (rawProgress > 1) {
      if (this.loop) {
        this.animStart = performance.now();
        rawProgress = 0;
      } else {
        rawProgress = 1;
        this.playing = false;
      }
    }

    this.render(rawProgress);
    this.animFrame = requestAnimationFrame(() => this.tick());
  }

  render(rawProgress) {
    if (!this.animData) return;
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    const dpr = window.devicePixelRatio || 1;
    const w = W / dpr, h = H / dpr;

    ctx.clearRect(0, 0, w, h);

    // 背景
    const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, w * 0.7);
    bgGrad.addColorStop(0, 'rgba(30, 30, 70, 0.4)');
    bgGrad.addColorStop(1, 'rgba(10, 10, 30, 0.9)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 绘制当前阶段
    const progress = Math.min(1, Math.max(0, rawProgress));
    let currentPhase = null;
    let phaseP = 0;

    for (const phase of this.animData.phases) {
      if (progress >= phase.start && progress <= phase.end) {
        currentPhase = phase;
        const range = phase.end - phase.start || 0.001;
        phaseP = (progress - phase.start) / range;
        break;
      }
    }

    if (currentPhase) {
      currentPhase.draw(ctx, w, h, phaseP);
    }

    // 调用阶段回调
    if (currentPhase && this._onPhaseChange && this._lastPhase !== currentPhase.name) {
      this._lastPhase = currentPhase.name;
      this._onPhaseChange(currentPhase.name);
    }
  }

  onPhaseChange(fn) {
    this._onPhaseChange = fn;
  }

  setLoop(loop) {
    this.loop = loop;
  }
}

// ============ 全局实例 ============
let animationPlayer = null;

function getAnimationPlayer(canvas) {
  if (!animationPlayer) {
    animationPlayer = new AnimationPlayer(canvas);
  }
  return animationPlayer;
}
