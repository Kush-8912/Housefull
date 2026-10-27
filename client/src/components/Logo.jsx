// A seat as drawn on the seat map: rounded back, square base (5 units square).
const seatPath = (x, y) => `M${x} ${y + 5}V${y + 2}a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2V${y + 5}z`;
// In the order they fill: front row sides, back row, then yours in the middle.
const LOGO_SEATS = [[6.5, 23], [20.5, 23], [10, 16], [17, 16], [13.5, 23]];

/**
 * The mark is a theatre house with its seats. On load they fill up, front row
 * first, yours (cream) last, and then the light in the gable comes on:
 * housefull. Hovering the logo lifts the roof. `compact` hides the wordmark
 * on phones so the header fits on one line; `size="xl"` is the curtain-up one.
 */
const SIZES = {
  md: { gap: 'gap-2', mark: 'h-7 w-7', word: 'text-[26px]' },
  xl: { gap: 'gap-4', mark: 'h-20 w-20 sm:h-24 sm:w-24', word: 'text-[64px] sm:text-[88px]' },
};

export function Logo({ className = '', compact = false, size = 'md' }) {
  const z = SIZES[size];
  return (
    <span className={`flex items-center ${z.gap} ${className}`}>
      <svg viewBox="0 0 32 32" className={`${z.mark} overflow-visible`} aria-hidden>
        <path d="M3.5 14 16 4.5 28.5 14" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="stroke-signal transition-transform duration-300 group-hover:-translate-y-[2.5px]" />
        {LOGO_SEATS.map(([x, y], i) => (
          <path
            key={i}
            d={seatPath(x, y)}
            strokeWidth="1"
            strokeLinejoin="round"
            className={`animate-seat-fill ${i === LOGO_SEATS.length - 1 ? 'fill-fg stroke-fg' : 'fill-signal stroke-signal'}`}
            style={{ animationDelay: `${250 + i * 120}ms` }}
          />
        ))}
        <circle cx="16" cy="10.4" r="1.6" className="origin-center animate-pop fill-fg [animation-delay:950ms] [transform-box:fill-box]" />
      </svg>
      <span className={`display ${z.word} leading-none tracking-[-0.02em] ${compact ? 'hidden sm:inline' : ''}`}>
        House<span className="text-signal">full</span>
      </span>
    </span>
  );
}

