import { useCallback } from 'react';
import { canHover } from '../lib/motion';

// Tracks the pointer over the element and writes its position as CSS
// variables (--mx/--my in px, --gx/--gy in %), plus --rx/--ry tilt angles
// when `tilt` is set. Styles do the rest, so React never re-renders.
// Returns a callback ref, so it also works on elements that appear later
// (after a loading state) and cleans up when they go.
export function usePointer({ tilt = 0 } = {}) {
  return useCallback((el) => {
    if (!el || !canHover()) return undefined;
    let frame = 0;
    const set = (vars) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v); });
    };
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      set({
        '--mx': `${e.clientX - r.left}px`,
        '--my': `${e.clientY - r.top}px`,
        '--gx': `${x * 100}%`,
        '--gy': `${y * 100}%`,
        ...(tilt && { '--rx': `${(0.5 - y) * tilt}deg`, '--ry': `${(x - 0.5) * tilt}deg` }),
      });
    };
    const leave = () => set({ '--rx': '0deg', '--ry': '0deg' });
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, [tilt]);
}
