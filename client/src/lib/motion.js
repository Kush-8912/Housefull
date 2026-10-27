// The JS-driven effects (tilt, spotlight, count-up, confetti) stand down when
// the visitor asked for less motion; the pointer ones also skip touch screens.
export const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const canHover = () => !calm() && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
