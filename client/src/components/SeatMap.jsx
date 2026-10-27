import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Accessibility, MoveHorizontal } from 'lucide-react';
import { money } from '../lib/format';
import { calm } from '../lib/motion';

// Organizers pick tier colours for a light background; lift them so they
// stay readable against the dark house.
const lift = (hex) => `color-mix(in oklab, ${hex} 72%, white)`;
const tierColor = (tiers, name) => lift(tiers.find((t) => t.name === name)?.color ?? '#ff5321');

// Played on a seat the moment someone else grabs it while you're looking.
const TAKEN_FLASH = [
  { backgroundColor: '#ff5d5d', boxShadow: '0 0 0 0 rgb(255 93 93 / 0.7)' },
  { boxShadow: '0 0 0 14px rgb(255 93 93 / 0)' },
];

const BASE = 'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-t-[9px] rounded-b-[3px] font-mono text-[10px] font-semibold transition duration-150 sm:h-8 sm:w-8';

const Seat = memo(function Seat({ seat, color, note, selected, interactive, onToggle }) {
  const takenByOthers = seat.status === 'sold' || (seat.status === 'held' && !seat.mine);
  const active = selected || seat.mine;
  const disabled = !interactive || takenByOthers;

  const button = useRef(null);
  const lastStatus = useRef(seat.status);
  useEffect(() => {
    if (lastStatus.current === seat.status) return;
    lastStatus.current = seat.status;
    if (takenByOthers && !calm()) button.current?.animate(TAKEN_FLASH, { duration: 900, easing: 'ease-out' });
  }, [seat.status, takenByOthers]);

  let cls = BASE;
  if (seat.status === 'sold') {
    cls += ' bg-ink-800 text-faint';
  } else if (takenByOthers) {
    cls += ' hatch border border-line-strong text-faint';
  } else if (active) {
    cls += ' seat-picked border-2 border-[var(--tier)] bg-[var(--tier)] font-semibold text-ink shadow-[0_0_14px_-2px_var(--tier)]';
  } else {
    cls += ' border-2 border-[var(--tier)] bg-[color-mix(in_oklab,var(--tier)_14%,transparent)] text-[var(--tier)]';
    if (interactive) cls += ' cursor-pointer hover:scale-110 hover:bg-[color-mix(in_oklab,var(--tier)_38%,transparent)]';
  }

  const state = seat.status === 'sold' ? 'sold' : takenByOthers ? 'held by another buyer' : active ? 'selected' : 'available';
  const access = seat.accessible ? ', wheelchair space' : '';
  return (
    <button
      ref={button}
      type="button"
      className={cls}
      style={{ '--tier': color }}
      disabled={disabled}
      aria-pressed={interactive ? active : undefined}
      aria-label={`Seat ${seat.label}${access}, ${seat.tier}, ${money(seat.price)}, ${state}`}
      title={[`${seat.label}${seat.accessible ? ' (wheelchair space)' : ''}`, seat.tier, money(seat.price), note, state].filter(Boolean).join(' · ')}
      onClick={() => onToggle?.(seat)}
    >
      {seat.status === 'sold' ? '×' : seat.accessible ? <Accessibility className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> : seat.number}
    </button>
  );
});

// A spot in the row that isn't for sale (pillar, crew, house seat). In the
// editor it is a button so the organizer can click it back into a seat.
function BlockedSpot({ label, onClick }) {
  const cls = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-t-[9px] rounded-b-[3px] border border-dashed border-line-strong text-[10px] text-faint sm:h-8 sm:w-8';
  if (!onClick) return <span className={cls} title={`${label} · not for sale`} aria-hidden>·</span>;
  return (
    <button type="button" className={`${cls} cursor-pointer hover:border-fg/60`} title={`${label} · not for sale`} aria-label={`${label}, not for sale`} onClick={onClick}>·</button>
  );
}

function Stage() {
  return (
    <div className="relative mx-auto mb-10 w-full max-w-xl" aria-hidden>
      <svg viewBox="0 0 400 46" className="w-full overflow-visible">
        <defs>
          <linearGradient id="stage-edge" x1="0" x2="1">
            <stop offset="0" stopColor="#ff5321" stopOpacity="0" />
            <stop offset="0.5" stopColor="#ff5321" />
            <stop offset="1" stopColor="#ff5321" stopOpacity="0" />
          </linearGradient>
          <filter id="stage-blur" x="-20%" y="-100%" width="140%" height="300%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>
        <ellipse cx="200" cy="26" rx="170" ry="16" fill="#ff5321" opacity="0.22" filter="url(#stage-blur)" className="animate-breathe" />
        <path d="M0 4 Q200 44 400 4" fill="none" stroke="url(#stage-edge)" strokeWidth="2.5" />
      </svg>
      <p className="absolute inset-x-0 top-1.5 text-center font-mono text-[10px] font-semibold tracking-[0.5em] text-signal">STAGE</p>
    </div>
  );
}

/**
 * Renders the venue as rows of seats in the organizer-defined order, with the
 * row's aisles and blocked spots. Without `onToggle` it is read-only. The
 * editor passes `onPosition(rowLabel, number)` instead, which makes every
 * position clickable, including blocked ones.
 */
export function SeatMap({ rows, tiers, seats, selected = new Set(), onToggle, onPosition }) {
  const byPosition = useMemo(() => new Map(seats.map((s) => [`${s.row}:${s.number}`, s])), [seats]);
  const interactive = Boolean(onToggle || onPosition);
  const pick = onPosition ? (seat) => onPosition(seat.row, seat.number) : onToggle;
  const notes = useMemo(() => new Map(tiers.map((t) => [t.name, t.description])), [tiers]);

  // On narrow screens the map scrolls sideways; start from the centre aisle.
  const scroller = useRef(null);
  const rowCount = rows.length;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [rowCount]);

  // Whether the map is wider than its box, so phones get a swipe hint and faded edges.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    // The grid's own width; scrollWidth also counts the 3D tilt's overhang.
    const measure = () => setWide((el.firstElementChild?.offsetWidth ?? 0) > el.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rows]);

  return (
    <div>
      <Stage />
      {wide && (
        <p className="mb-3 flex items-center justify-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
          <MoveHorizontal className="h-3.5 w-3.5" aria-hidden /> <span className="sm:hidden">Swipe</span><span className="hidden sm:inline">Scroll sideways</span> to see every seat
        </p>
      )}
      <div
        ref={scroller}
        className={`overflow-x-auto overscroll-x-contain pb-4 [perspective:1100px] ${wide ? '[mask-image:linear-gradient(to_right,transparent,#000_1.5rem,#000_calc(100%-1.5rem),transparent)]' : ''}`}
      >
        <div className="mx-auto flex w-max origin-bottom flex-col gap-1.5 px-2 [transform:rotateX(14deg)]">
          {rows.map((row, r) => (
            <div key={row.label} className="flex items-center gap-2">
              <span className="w-7 text-right font-mono text-[11px] font-semibold text-faint">{row.label}</span>
              <div className="flex flex-1 justify-center gap-1">
                {Array.from({ length: Number(row.seats) || 0 }, (_, i) => i + 1).map((n) => {
                  const seat = byPosition.get(`${row.label}:${n}`);
                  const aisle = row.aisleAfter?.includes(n);
                  // Seats fill in as a wave rolling back from the stage, centre first.
                  const wave = Math.min(1400, r * 45 + Math.abs(n - (Number(row.seats) + 1) / 2) * 14);
                  return (
                    <span key={n} className={`flex animate-seat-in ${aisle ? 'mr-4 sm:mr-6' : ''}`} style={{ animationDelay: `${wave}ms` }}>
                      {seat ? (
                        <Seat
                          seat={seat}
                          color={tierColor(tiers, seat.tier)}
                          note={notes.get(seat.tier)}
                          selected={selected.has(String(seat.id))}
                          interactive={interactive}
                          onToggle={pick}
                        />
                      ) : (
                        <BlockedSpot label={`${row.label}${n}`} onClick={onPosition ? () => onPosition(row.label, n) : undefined} />
                      )}
                    </span>
                  );
                })}
              </div>
              <span className="w-7 font-mono text-[11px] font-semibold text-faint">{row.label}</span>
            </div>
          ))}
        </div>
      </div>
      <Legend tiers={tiers} accessible={seats.some((s) => s.accessible)} blocked={rows.some((r) => r.blocked?.length)} />
    </div>
  );
}

function Legend({ tiers, accessible, blocked }) {
  const swatch = 'h-3.5 w-3.5 shrink-0 rounded-t-[5px] rounded-b-[2px]';
  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t border-line pt-5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
      {tiers.map((t) => (
        <span key={t.name} className="flex items-center gap-2">
          <span className={`${swatch} border-2`} style={{ borderColor: lift(t.color), backgroundColor: `color-mix(in oklab, ${lift(t.color)} 14%, transparent)` }} />
          {t.name} <span className="text-fg">{money(t.price)}</span>
        </span>
      ))}
      <span className="flex items-center gap-2"><span className={`${swatch} hatch border border-line-strong`} /> On hold</span>
      <span className="flex items-center gap-2"><span className={`${swatch} bg-ink-800`} /> Sold</span>
      {accessible && <span className="flex items-center gap-2"><Accessibility className="h-3.5 w-3.5 text-fg" aria-hidden /> Wheelchair space</span>}
      {blocked && <span className="flex items-center gap-2"><span className={`${swatch} border border-dashed border-line-strong`} /> Not for sale</span>}
    </div>
  );
}

// Fake seats for previewing a layout before it is published. Like the server,
// blocked spots get no seat.
export function previewSeats(rows, tiers) {
  return rows.flatMap((r) => {
    const tier = tiers.find((t) => t.name.toLowerCase() === String(r.tier).toLowerCase());
    return Array.from({ length: Number(r.seats) || 0 }, (_, i) => i + 1)
      .filter((n) => !r.blocked?.includes(n))
      .map((n) => ({
        id: `${r.label}-${n}`, row: r.label, number: n, label: `${r.label}${n}`,
        tier: tier?.name ?? r.tier, price: Number(tier?.price) || 0, status: 'available', accessible: Boolean(r.accessible?.includes(n)),
      }));
  });
}
