import { useEffect, useRef, useState } from 'react';
import { calm } from '../lib/motion';

const FILL_MS = 8500; // empty house to housefull
const FULL_MS = 3400; // how long the sign stays lit
const CLEAR_MS = 1200; // house lights up, everyone leaves
const SIGNAL = '#ff5321';
const CREAM = '#f1ece3';

// Rows of seats in perspective: narrow and small near the stage (top), wide
// and big at the back (bottom). The canvas height follows from the width.
function layout(w) {
  const phone = w < 640;
  const rows = phone ? 9 : 12;
  const back = Math.max(14, Math.min(32, Math.round(w / 42)));
  const front = Math.round(back * 0.5);
  const stageH = phone ? 48 : 76;
  const seats = [];
  let y = stageH;
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const n = Math.round(front + (back - front) * t);
    const span = w * (0.34 + 0.62 * t);
    const pitch = span / n;
    const size = pitch * 0.74;
    const x0 = (w - span) / 2 + pitch / 2;
    for (let i = 0; i < n; i++) seats.push({ x: x0 + i * pitch, y: y + size / 2, s: size, r, at: -1 });
    y += size * 1.32;
  }
  return { seats, rows, stageH, height: Math.ceil(y + 18) };
}

// Best seats go first: front rows fill before the back, with some scatter.
// Yours, a good one near the front in the middle, is the very last seat sold.
function bookingOrder({ seats, rows }, w) {
  const yourRow = Math.floor(rows * 0.3);
  const offCentre = (i) => Math.abs(seats[i].x - w / 2);
  const yours = seats
    .map((s, i) => i)
    .filter((i) => seats[i].r === yourRow)
    .reduce((best, i) => (offCentre(i) < offCentre(best) ? i : best));
  const order = seats
    .map((s, i) => [i, s.r + Math.random() * rows * 0.4])
    .filter(([i]) => i !== yours)
    .sort((a, b) => a[1] - b[1])
    .map(([i]) => i);
  return { order: [...order, yours], yours };
}

function seatShape(ctx, x, y, s) {
  const w = s * 0.9;
  const r = s * 0.36;
  const l = x - w / 2;
  const t = y - s / 2;
  ctx.beginPath();
  ctx.moveTo(l, t + s);
  ctx.lineTo(l, t + r);
  ctx.arcTo(l, t, l + r, t, r);
  ctx.lineTo(l + w - r, t);
  ctx.arcTo(l + w, t, l + w, t + r, r);
  ctx.lineTo(l + w, t + s);
  ctx.closePath();
}

/**
 * A house selling out, on a loop: seats book themselves faster and faster,
 * front rows first, until the last one (yours, in cream) goes and the
 * HOUSEFULL sign flickers on. A follow-spot drifts over the seats, or
 * follows the pointer. Decorative only.
 */
export function LiveHouse() {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const counter = useRef(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    const ctx = el.getContext('2d');
    const still = calm();
    let w = 0;
    let house = null;
    let plan = null;
    let clock = 0;
    let last = 0;
    let phase = 'fill';
    let phaseAt = 0;
    let booked = 0;
    let frame = 0;
    let visible = false;
    let pointer = null;
    const spot = { x: 0, y: 0 };

    const reset = () => {
      house.seats.forEach((s) => { s.at = -1; });
      plan = bookingOrder(house, w);
      clock = 0;
      booked = 0;
      phase = 'fill';
    };

    const size = () => {
      w = box.clientWidth;
      house = layout(w);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = w * dpr;
      el.height = house.height * dpr;
      el.style.height = `${house.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      spot.x = w / 2;
      spot.y = house.height * 0.6;
      reset();
      if (still) {
        house.seats.forEach((s) => { s.at = -1e9; });
        booked = house.seats.length;
        setFull(true);
        draw();
      } else {
        setFull(false);
      }
    };

    const draw = () => {
      const { seats, rows, stageH, height } = house;
      ctx.clearRect(0, 0, w, height);

      // The stage, glowing at the far end.
      const glow = ctx.createRadialGradient(w / 2, 0, 0, w / 2, 0, Math.min(w * 0.4, height * 0.75));
      glow.addColorStop(0, 'rgba(255,83,33,0.3)');
      glow.addColorStop(1, 'rgba(255,83,33,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, height);
      ctx.strokeStyle = SIGNAL;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.3, stageH * 0.32);
      ctx.quadraticCurveTo(w / 2, stageH * 0.78, w * 0.7, stageH * 0.32);
      ctx.stroke();

      // Follow-spot: the pointer, or a slow drift across the house.
      const tx = pointer ? pointer.x : w / 2 + Math.sin(clock / 1700) * w * 0.32;
      const ty = pointer ? pointer.y : height * 0.58 + Math.cos(clock / 2300) * height * 0.18;
      spot.x += (tx - spot.x) * 0.1;
      spot.y += (ty - spot.y) * 0.1;
      const R = Math.max(140, w * 0.16);
      const light = ctx.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, R);
      light.addColorStop(0, 'rgba(255,214,190,0.14)');
      light.addColorStop(1, 'rgba(255,214,190,0)');
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, w, height);

      const leaving = phase === 'clear' ? clock - phaseAt : -1;
      for (const s of seats) {
        const lit = Math.max(0, 1 - Math.hypot(s.x - spot.x, s.y - spot.y) / R);
        // On the way out the back rows empty first.
        const gone = leaving < 0 ? 0 : Math.min(1, Math.max(0, (leaving - (rows - 1 - s.r) * 55) / 450));
        if (s.at === -1 || gone === 1) {
          ctx.globalAlpha = 1;
          seatShape(ctx, s.x, s.y, s.s);
          ctx.fillStyle = `rgba(241,236,227,${0.035 + lit * 0.1})`;
          ctx.fill();
          ctx.strokeStyle = `rgba(241,236,227,${0.13 + lit * 0.4})`;
          ctx.lineWidth = 1;
          ctx.stroke();
          continue;
        }
        const age = clock - s.at;
        const mine = s === house.seats[plan.yours];
        const color = mine ? CREAM : SIGNAL;
        const pop = age < 320 ? 1 + (mine ? 1.1 : 0.7) * (1 - age / 320) ** 2 : 1;
        ctx.globalAlpha = 1 - gone;
        seatShape(ctx, s.x, s.y, s.s * pop);
        ctx.fillStyle = color;
        ctx.fill();
        if (lit > 0) {
          ctx.fillStyle = `rgba(255,255,255,${lit * 0.22})`;
          ctx.fill();
        }
        const ringFor = mine ? 1100 : 600;
        if (age < ringFor) {
          ctx.globalAlpha = (1 - gone) * (1 - age / ringFor) * 0.8;
          ctx.strokeStyle = color;
          ctx.lineWidth = mine ? 2.5 : 1.5;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.s * 0.5 + (age / ringFor) * s.s * (mine ? 4 : 1.4), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      if (counter.current) counter.current.textContent = `${booked} / ${seats.length} booked`;
    };

    const tick = (now) => {
      clock += last ? Math.min(now - last, 50) : 16;
      last = now;
      const total = house.seats.length;
      if (phase === 'fill') {
        // Sales start slow and get frantic near the end, like a real sell-out.
        const p = Math.min(1, clock / FILL_MS);
        const target = p === 1 ? total : Math.floor(total * p ** 1.8);
        while (booked < target) house.seats[plan.order[booked++]].at = clock;
        if (p === 1) { phase = 'full'; phaseAt = clock; setFull(true); }
      } else if (phase === 'full' && clock - phaseAt > FULL_MS) {
        phase = 'clear';
        phaseAt = clock;
        setFull(false);
      } else if (phase === 'clear' && clock - phaseAt > CLEAR_MS) {
        reset();
      }
      draw();
      frame = requestAnimationFrame(tick);
    };

    const run = () => {
      if (still || frame || !visible || document.hidden) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };
    const pause = () => { cancelAnimationFrame(frame); frame = 0; };

    size();
    const resize = new ResizeObserver(() => { if (box.clientWidth !== w) size(); });
    resize.observe(box);
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) run(); else pause(); });
    io.observe(box);
    const onVisibility = () => (document.hidden ? pause() : run());
    document.addEventListener('visibilitychange', onVisibility);
    const move = (e) => {
      const r = el.getBoundingClientRect();
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const leave = () => { pointer = null; };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerleave', leave);

    return () => {
      pause();
      resize.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerleave', leave);
    };
  }, []);

  return (
    <section ref={wrap} className="relative left-1/2 mb-12 w-screen -translate-x-1/2 overflow-hidden border-y border-line bg-[radial-gradient(ellipse_at_top,rgb(255_83_33/0.08),transparent_60%)]" aria-hidden>
      <canvas ref={canvas} className="block w-full" />
      <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto flex max-w-6xl items-center justify-between px-4 pt-4 sm:px-6">
        <span className="eyebrow">Watch a house sell out</span>
        <span ref={counter} className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted tabular" />
      </div>
      {full && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/45">
          <p className="display -rotate-6 animate-stamp border-[6px] border-double border-signal px-6 pb-1 pt-4 text-[clamp(3rem,11vw,9rem)]">
            <span className="animate-flicker text-signal">Housefull</span>
          </p>
        </div>
      )}
    </section>
  );
}
