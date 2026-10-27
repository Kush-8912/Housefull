import { Fragment, useEffect, useRef, useState } from 'react';
import { calm } from '../lib/motion';

/**
 * Rolls a number up to `value` (from zero the first time, then from wherever
 * it was), easing out. `format` turns the in-between numbers into text.
 */
export function CountUp({ value, format = String, duration = 900 }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let frame = 0;
    const step = (now) => {
      const t = calm() ? 1 : Math.min(1, (now - start) / duration);
      const v = t === 1 ? value : a + (value - a) * (1 - (1 - t) ** 3);
      from.current = v;
      setShown(v);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return format(shown === value ? value : Math.round(shown));
}

/** Text that slides up out of a mask, like a line of type dropping into place. */
export function Mask({ children, delay = 0, className = '' }) {
  return (
    <span className="-mx-[0.05em] -my-[0.12em] inline-block overflow-hidden px-[0.05em] py-[0.12em] align-bottom">
      <span className={`inline-block animate-line-up ${className}`} style={{ animationDelay: `${delay}ms` }}>{children}</span>
    </span>
  );
}

/** A headline revealed a word at a time. */
export function Words({ children, delay = 0, step = 70, className }) {
  return String(children).split(' ').map((word, i) => (
    <Fragment key={i}>
      {i > 0 && ' '}
      <Mask delay={delay + i * step} className={className}>{word}</Mask>
    </Fragment>
  ));
}

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#&%';

/**
 * Text that flickers through random letters and settles left to right, like
 * a departures board, the first time it scrolls into view. The real text sits
 * underneath (invisible) to hold the width, and is what screen readers get.
 */
export function Scramble({ text, duration = 900 }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    el.textContent = text;
    if (calm()) return undefined;
    const chars = [...text];
    let frame = 0;
    let start = 0;
    let swapped = 0;
    const step = (now) => {
      start ||= now;
      const p = (now - start) / duration;
      if (p >= 1) { el.textContent = text; return; }
      if (now - swapped > 45) {
        swapped = now;
        el.textContent = chars
          .map((c, i) => (c === ' ' || p > 0.2 + (i / chars.length) * 0.8 ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]))
          .join('');
      }
      frame = requestAnimationFrame(step);
    };
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      frame = requestAnimationFrame(step);
    });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(frame); };
  }, [text, duration]);

  return (
    <span className="relative inline-block whitespace-nowrap">
      <span className="invisible" aria-hidden>{text}</span>
      <span ref={ref} className="absolute inset-0" aria-hidden />
      <span className="sr-only">{text}</span>
    </span>
  );
}
