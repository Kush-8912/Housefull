import { useEffect, useRef, useState } from 'react';
import { calm, canHover } from '../lib/motion';
import { Logo } from './Logo';

const CLICKABLE = 'a[href], button:not(:disabled), select, summary, label[for], input[type="checkbox"], input[type="radio"]';

/**
 * A ring that trails the pointer and swells (inverting what's under it) over
 * anything clickable. Primary buttons are magnetic: they lean toward the
 * pointer while it's over them. Mouse and trackpad only.
 */
export function CursorFx() {
  const ring = useRef(null);

  useEffect(() => {
    const el = ring.current;
    if (!el || !canHover()) return undefined;
    let x = 0;
    let y = 0;
    let rx = 0;
    let ry = 0;
    let frame = 0;
    let magnet = null;

    const loop = () => {
      rx += (x - rx) * 0.2;
      ry += (y - ry) * 0.2;
      el.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
      frame = Math.abs(x - rx) + Math.abs(y - ry) > 0.2 ? requestAnimationFrame(loop) : 0;
    };
    const release = () => {
      if (magnet) magnet.style.transform = '';
      magnet = null;
    };
    const move = (e) => {
      if (!el.style.opacity) { rx = e.clientX; ry = e.clientY; }
      x = e.clientX;
      y = e.clientY;
      el.style.opacity = '1';
      el.toggleAttribute('data-hover', Boolean(e.target.closest?.(CLICKABLE)));
      const btn = e.target.closest?.('.btn-primary');
      if (btn !== magnet) release();
      if (btn) {
        magnet = btn;
        const r = btn.getBoundingClientRect();
        btn.style.transform = `translate(${(x - r.left - r.width / 2) * 0.22}px, ${(y - r.top - r.height / 2) * 0.35}px)`;
      }
      if (!frame) frame = requestAnimationFrame(loop);
    };
    const hide = () => { el.style.opacity = ''; release(); };

    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', hide);
    return () => {
      cancelAnimationFrame(frame);
      release();
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', hide);
    };
  }, []);

  return <div ref={ring} className="cursor-ring" aria-hidden />;
}

const INTRO_KEY = 'housefull:intro-seen';
const seenIntro = () => {
  try { return sessionStorage.getItem(INTRO_KEY) === '1'; } catch { return true; }
};

/**
 * Curtain up: the first time someone opens the site in a session, the logo
 * fills with seats on a velvet curtain, then the curtains part on the page.
 * Clicking skips it.
 */
export function CurtainIntro() {
  const [phase, setPhase] = useState(() => (calm() || seenIntro() ? 'gone' : 'closed'));
  const playing = phase !== 'gone';

  useEffect(() => {
    if (!playing) return undefined;
    try { sessionStorage.setItem(INTRO_KEY, '1'); } catch { /* private mode: it just plays again */ }
    const timers = [setTimeout(() => setPhase('opening'), 1500), setTimeout(() => setPhase('gone'), 2700)];
    return () => timers.forEach(clearTimeout);
  }, [playing]);

  if (phase === 'gone') return null;
  const opening = phase === 'opening';
  const ease = '1.1s cubic-bezier(0.7, 0, 0.2, 1) forwards';
  return (
    <div className="fixed inset-0 z-[110] cursor-pointer overflow-hidden" onClick={() => setPhase('gone')} aria-hidden>
      <div className="velvet absolute inset-y-0 left-0 w-[51%] origin-top-left shadow-[20px_0_60px_rgb(0_0_0/0.6)]" style={opening ? { animation: `curtain-l ${ease}` } : undefined} />
      <div className="velvet absolute inset-y-0 right-0 w-[51%] origin-top-right shadow-[-20px_0_60px_rgb(0_0_0/0.6)]" style={opening ? { animation: `curtain-r ${ease}` } : undefined} />
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5" style={opening ? { animation: 'curtain-mark 0.6s ease-in forwards' } : undefined}>
        <Logo size="xl" className="text-fg drop-shadow-[0_6px_30px_rgb(0_0_0/0.6)]" />
        <p className="animate-rise font-mono text-xs uppercase tracking-[0.3em] text-fg/80 [animation-delay:700ms]">Get in before it&apos;s housefull</p>
      </div>
    </div>
  );
}
