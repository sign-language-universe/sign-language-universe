/* =============================================
   手语小宇宙 — 星空背景
   动态 Canvas 星空 + 流星效果
   ============================================= */

(function() {
  const canvas = document.getElementById('starCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width, height;
  const stars = [];
  const STAR_COUNT = 200;
  const COLORS = ['#ffffff', '#ffe9c4', '#d4e4ff', '#ffd4e8', '#d4ffe4'];

  // 流星
  let meteors = [];

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function createStars() {
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 2 + 0.5,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        twinkle: Math.random() * Math.PI * 2,
        twinkleSpeed: Math.random() * 0.02 + 0.005,
        opacity: Math.random() * 0.7 + 0.3
      });
    }
  }

  function createMeteor() {
    if (Math.random() < 0.005) { // 0.5% 每帧生成流星
      meteors.push({
        x: Math.random() * width,
        y: -10,
        length: Math.random() * 80 + 40,
        speed: Math.random() * 6 + 4,
        opacity: 1
      });
    }
  }

  function updateMeteors() {
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.x += m.speed * 0.7;
      m.y += m.speed;
      m.opacity -= 0.015;
      if (m.opacity <= 0 || m.y > height + 50) {
        meteors.splice(i, 1);
      }
    }
  }

  function drawStars() {
    ctx.clearRect(0, 0, width, height);

    // 绘制星空渐变背景
    const gradient = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, Math.max(width, height) * 0.7);
    gradient.addColorStop(0, 'rgba(15, 15, 55, 0.3)');
    gradient.addColorStop(0.5, 'rgba(10, 10, 30, 0.5)');
    gradient.addColorStop(1, 'rgba(5, 5, 15, 0.8)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // 群星闪烁
    for (const star of stars) {
      star.twinkle += star.twinkleSpeed;
      const alpha = star.opacity * (0.6 + 0.4 * Math.sin(star.twinkle));
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fillStyle = star.color.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
      if (star.color.startsWith('#')) {
        ctx.fillStyle = star.color;
        ctx.globalAlpha = alpha;
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 流星
    for (const m of meteors) {
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.length * 0.5, m.y - m.length);
      ctx.strokeStyle = `rgba(255, 255, 255, ${m.opacity})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 流星头部光晕
      const glow = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 4);
      glow.addColorStop(0, `rgba(255, 255, 255, ${m.opacity})`);
      glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function animate() {
    createMeteor();
    updateMeteors();
    drawStars();
    requestAnimationFrame(animate);
  }

  resize();
  createStars();
  animate();

  window.addEventListener('resize', () => {
    resize();
    stars.length = 0;
    createStars();
  });
})();
