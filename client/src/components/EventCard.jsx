import { Link } from 'react-router-dom';
import { ArrowUpRight, Star } from 'lucide-react';
import { BADGES, CATEGORY_LABELS, dayMonth, money, time, weekday } from '../lib/format';
import { usePointer } from '../hooks/usePointer';

// Half-circle punched out of each side where the stub tears off.
export function Punches({ className = '' }) {
  return (
    <>
      <span className={`absolute -left-[9px] h-[18px] w-[18px] -translate-y-1/2 rounded-full border border-line bg-ink ${className}`} aria-hidden />
      <span className={`absolute -right-[9px] h-[18px] w-[18px] -translate-y-1/2 rounded-full border border-line bg-ink ${className}`} aria-hidden />
    </>
  );
}

export function EventCard({ event, index = 0 }) {
  const { day, month } = dayMonth(event.startsAt);
  const a = event.availability;
  const soldOut = a && a.available === 0;
  const few = a && !soldOut && a.available <= Math.max(5, a.total * 0.1);
  const tilt = usePointer({ tilt: 8 });

  // The first screenful rises in on load; cards further down rise as they scroll into view.
  return (
    <div className={index < 6 ? 'animate-rise' : 'reveal'} style={{ animationDelay: `${Math.min(index, 8) * 70}ms` }}>
      <Link
        ref={tilt}
        to={`/events/${event.id}`}
        className="tilt group relative flex h-full flex-col overflow-hidden rounded-[4px] border border-line bg-ink-900 hover:border-line-strong hover:shadow-2xl hover:shadow-black/50"
      >
        <span className="glare group-hover:opacity-100" aria-hidden />
        <div className="relative aspect-[16/10] overflow-hidden bg-ink-850">
          {event.coverImageUrl ? (
            <img
              src={event.coverImageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover opacity-80 grayscale-[85%] transition duration-500 group-hover:scale-[1.04] group-hover:opacity-100 group-hover:grayscale-0"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <span className="display absolute inset-0 flex items-center justify-center text-7xl text-line-strong" aria-hidden>
              {CATEGORY_LABELS[event.category]}
            </span>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/10 to-transparent" />
          <div className="absolute left-0 top-0 flex flex-col items-center bg-signal px-3 pb-1.5 pt-2 text-ink transition-[padding] duration-300 group-hover:pt-3.5">
            <span className="display text-[34px] leading-[0.8]">{day}</span>
            <span className="mt-1 font-mono text-[10px] font-semibold tracking-[0.16em]">{month}</span>
          </div>
          <span className="absolute right-3 top-3 border border-fg/25 bg-ink/60 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-fg backdrop-blur">
            {CATEGORY_LABELS[event.category]}
          </span>
          {event.badges?.length > 0 && (
            <div className="absolute bottom-3 left-3 flex flex-wrap gap-1.5">
              {event.badges.slice(0, 2).map((b) => (
                <span key={b} title={BADGES[b]?.hint} className={`px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${BADGES[b]?.tone}`}>
                  {BADGES[b]?.label ?? b}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col px-5 pb-5 pt-1">
          <h3 className="display text-[28px] text-fg transition-colors group-hover:text-signal">{event.title}</h3>
          <p className="mt-2 text-sm text-muted">{event.venue.name} · {event.venue.city}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-xs uppercase tracking-[0.08em] text-faint">
            <span>{weekday(event.startsAt)} · {time(event.startsAt)}</span>
            {event.showCount > 1 && <span className="text-signal">+{event.showCount - 1} more show{event.showCount > 2 ? 's' : ''}</span>}
            {event.rating?.count > 0 && (
              <span className="flex items-center gap-1 text-fg" title={`${event.rating.count} review${event.rating.count > 1 ? 's' : ''}`}>
                <Star className="h-3 w-3 fill-warn text-warn" aria-hidden /> {event.rating.avg.toFixed(1)}
              </span>
            )}
          </p>
        </div>

        <div className="relative flex items-center justify-between border-t border-dashed border-line-strong px-5 py-3.5">
          <Punches className="top-0" />
          <span className="font-mono text-sm font-medium text-fg">
            {event.minPrice === 0 ? 'Free' : <><span className="text-faint">from </span>{money(event.minPrice)}</>}
          </span>
          <span className="flex items-center gap-2">
            {soldOut ? (
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-stop">Sold out</span>
            ) : few ? (
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-warn">{a.available} left</span>
            ) : a ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-faint">{a.available} seats left</span>
            ) : null}
            <ArrowUpRight className="h-4 w-4 text-faint transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-signal" aria-hidden />
          </span>
        </div>
      </Link>
    </div>
  );
}
