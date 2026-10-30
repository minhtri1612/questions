/* Lightweight canvas confetti for the winner reveal. */
(function (root) {
  'use strict';

  const COLORS = ['#ffc94a', '#ff3d7f', '#3ad1ff', '#7cf29a', '#ffffff', '#b98cff'];
  let canvas = null;
  let particles = [];
  let raf = 0;

  function ensureCanvas() {
    if (canvas) return canvas;
    canvas = document.createElement('canvas');
    canvas.className = 'confetti-canvas';
    document.body.appendChild(canvas);
    return canvas;
  }

  function resize() {
    const dpr = root.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function burst(count = 220) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    ensureCanvas();
    resize();
    for (let i = 0; i < count; i++) {
      const fromLeft = i % 2 === 0;
      particles.push({
        x: fromLeft ? -10 : innerWidth + 10,
        y: innerHeight * (0.55 + Math.random() * 0.3),
        vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 10),
        vy: -(10 + Math.random() * 12),
        w: 6 + Math.random() * 8,
        h: 10 + Math.random() * 10,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: COLORS[i % COLORS.length],
        life: 0,
      });
    }
    if (!raf) raf = requestAnimationFrame(step);
  }

  function step() {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, innerWidth, innerHeight);
    particles = particles.filter((p) => p.y < innerHeight + 40 && p.life < 600);
    for (const p of particles) {
      p.life++;
      p.vy += 0.32;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.color;
      g.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.life * 0.1)), p.w, p.h * Math.abs(Math.cos(p.life * 0.1)) + 1);
      g.restore();
    }
    raf = particles.length ? requestAnimationFrame(step) : 0;
  }

  function stop() {
    particles = [];
    cancelAnimationFrame(raf);
    raf = 0;
    if (canvas) canvas.remove();
    canvas = null;
  }

  root.Confetti = { burst, stop };
})(window);
