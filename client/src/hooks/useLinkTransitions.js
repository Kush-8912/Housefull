import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { calm } from '../lib/motion';

const EASE = 'cubic-bezier(0.7, 0, 0.3, 1)';

/**
 * Clicking a link to another page plays a View Transition: the old page sinks
 * back and the new one opens out of a circle centred on the click (or on the
 * link, when it was opened from the keyboard). Browsers without the API (or
 * visitors who asked for less motion) navigate as usual.
 *
 * The listener runs in the capture phase, before React Router's own Link
 * handler, which then sees the click as handled and stays out of the way.
 */
export function useLinkTransitions(navigate) {
  useEffect(() => {
    if (!document.startViewTransition || calm()) return undefined;

    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      // Other sites, and links within the same page (#reviews), behave normally.
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;

      e.preventDefault();
      // Keyboard "clicks" (Enter on a focused link) have no pointer position,
      // so the circle opens from the middle of the link instead.
      let { clientX: x, clientY: y } = e;
      if (e.detail === 0) {
        const r = a.getBoundingClientRect();
        x = r.left + r.width / 2;
        y = r.top + r.height / 2;
      }
      const root = document.documentElement;
      root.classList.add('vt');
      const t = document.startViewTransition(() => flushSync(() => navigate(url.pathname + url.search + url.hash)));
      t.ready.then(() => {
        const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          { duration: 700, easing: EASE, pseudoElement: '::view-transition-new(root)' },
        );
        root.animate(
          { transform: ['none', 'scale(0.92)'], opacity: [1, 0.35], filter: ['none', 'blur(4px)'] },
          { duration: 700, easing: EASE, pseudoElement: '::view-transition-old(root)' },
        );
      }).catch(() => {});
      t.finished.finally(() => root.classList.remove('vt'));
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [navigate]);
}
