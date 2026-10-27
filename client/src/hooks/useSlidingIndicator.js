import { useLayoutEffect, useRef } from 'react';

/**
 * A highlight that glides to whichever option is active, instead of the
 * active option just changing colour. Put `container` on the group (it must
 * be `relative`) and `indicator` on an absolutely positioned element inside
 * it; mark the active option with `data-active` (or pass a `selector`).
 *
 * `axis: 'x'` only follows the option's left edge and width (an underline);
 * the default also follows its top and height (a pill or box behind it).
 * Positions are written straight to the indicator's style, so switching
 * never re-renders anything, and the very first placement doesn't animate.
 */
export function useSlidingIndicator(active, { selector = '[data-active="true"]', axis = 'xy' } = {}) {
  const container = useRef(null);
  const indicator = useRef(null);

  useLayoutEffect(() => {
    const box = container.current;
    const bar = indicator.current;
    if (!box || !bar) return undefined;

    const place = () => {
      const el = box.querySelector(selector);
      if (!el || !el.offsetWidth) { bar.style.opacity = '0'; return; }
      // Measured from the boxes (not offsetLeft/Width, which round to whole
      // pixels), relative to the group's padding edge and its scroll position.
      const b = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const x = r.left - b.left - box.clientLeft + box.scrollLeft;
      const y = r.top - b.top - box.clientTop + box.scrollTop;
      const first = !bar.dataset.placed;
      if (first) bar.style.transition = 'none';
      bar.style.opacity = '1';
      bar.style.width = `${r.width}px`;
      if (axis === 'x') {
        bar.style.transform = `translateX(${x}px)`;
      } else {
        bar.style.height = `${r.height}px`;
        bar.style.transform = `translate(${x}px, ${y}px)`;
      }
      if (first) {
        bar.dataset.placed = '1';
        bar.getBoundingClientRect(); // commit the jump before turning transitions back on
        bar.style.transition = '';
      }
    };

    place();
    // Wrapping, a resized window and late-loading fonts all move the options.
    const resize = new ResizeObserver(place);
    resize.observe(box);
    document.fonts?.ready.then(place);
    return () => resize.disconnect();
  }, [active, selector, axis]);

  return [container, indicator];
}
