import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { calm } from '../lib/motion';

const EASE = 'cubic-bezier(0.7, 0, 0.3, 1)';

/**
 * Clicking a link to another page plays a View Transition: the old page sinks
 * back and the new one opens out of a circle centred on the click. Browsers
 * without the API (or visitors who asked for less motion) navigate as usual.
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
      const root = document.documentElement;
      root.classList.add('vt');
      const t = document.startViewTransition(() => flushSync(() => navigate(url.pathname + url.search + url.hash)));
      t.ready.then(() => {
        const r = Math.hypot(Math.max(e.clientX, window.innerWidth - e.clientX), Math.max(e.clientY, window.innerHeight - e.clientY));
        root.animate(
          { clipPath: [`circle(0px at ${e.clientX}px ${e.clientY}px)`, `circle(${r}px at ${e.clientX}px ${e.clientY}px)`] },
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
