import { calm } from './motion';

const COLORS = ['#ff5321', '#f1ebe0', '#5fd38d', '#f2b13c', '#ff7146'];

/**
 * Fires two cannons of ticket-stub confetti from the bottom corners of the
 * screen. Returns a function that stops it early (and removes the canvas).
 */
export function confetti({ count = 180, duration = 4200 } = {}) {
  if (calm()) return () => {};
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:90';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const rand = (a, b) => a + Math.random() * (b - a);
  const pieces = Array.from({ length: count }, (_, i) => {
    const left = i % 2 === 0;
    const angle = (left ? rand(-75, -50) : rand(-130, -105)) * (Math.PI / 180);
    const speed = rand(9, 17) * Math.min(1.25, h / 700);
    return {
      x: left ? -10 : w + 10,
      y: h * rand(0.75, 0.95),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: rand(6, 11),
      h: rand(10, 18),
      rot: rand(0, Math.PI * 2),
      spin: rand(-0.25, 0.25),
      wobble: rand(0, Math.PI * 2),
      color: COLORS[i % COLORS.length],
    };
  });

  const start = performance.now();
  let frame = 0;
  const draw = (now) => {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.max(0, Math.min(1, (duration - t) / 800));
    for (const p of pieces) {
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.32;
      p.wobble += 0.12;
      p.x += p.vx + Math.sin(p.wobble) * 0.8;
      p.y += p.vy;
      p.rot += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.wobble)); // flip like paper turning over
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; // the stub's tear line
      ctx.fillRect(-p.w / 2, p.h / 6, p.w, 1);
      ctx.restore();
    }
    if (t < duration) frame = requestAnimationFrame(draw);
    else canvas.remove();
  };
  frame = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(frame);
    canvas.remove();
  };
}
