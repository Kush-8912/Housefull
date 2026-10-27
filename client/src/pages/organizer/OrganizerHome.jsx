import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { dateTime, dayMonth } from '../../lib/format';
import { Badge, EmptyState, ErrorState, PageLoader } from '../../components/States';

export function OrganizerHome() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => { api('/events/mine').then((d) => { setItems(d.items); setError(null); }).catch(setError); }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!items) return <PageLoader />;

  const now = new Date();
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Organizer</p>
          <h1 className="display mt-3 text-6xl sm:text-7xl">Your events</h1>
          <p className="mt-3 text-sm text-muted">Create events, track sales and check guests in at the door.</p>
        </div>
        <Link to="/organizer/events/new" className="btn-primary"><CalendarPlus className="h-4 w-4" aria-hidden /> New event</Link>
      </div>

      {items.length === 0 ? (
        <div className="mt-10">
          <EmptyState icon={CalendarPlus} title="No events yet" action={<Link to="/organizer/events/new" className="btn-primary">Create your first event</Link>}>
            Design your seating layout, set ticket prices, then publish when you&apos;re ready to sell.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-10 border-t border-line">
          {items.map((e, i) => {
            const a = e.availability;
            const soldPct = a ? (a.sold / a.total) * 100 : 0;
            const ended = new Date(e.startsAt) < now;
            const { day, month } = dayMonth(e.startsAt);
            return (
              <li key={e.id} className="animate-rise border-b border-line" style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}>
                <Link to={`/organizer/events/${e.id}`} className="group flex items-center gap-4 py-5 transition-colors hover:bg-ink-900 sm:gap-6 sm:px-3">
                  <div className={`w-14 shrink-0 text-center ${ended || e.status !== 'published' ? 'text-faint' : 'text-signal'}`}>
                    <span className="display block text-4xl leading-none">{day}</span>
                    <span className="font-mono text-[10px] font-semibold tracking-[0.16em]">{month}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="display text-2xl transition-colors group-hover:text-signal sm:text-3xl">{e.title}</h2>
                      <Badge status={ended && e.status === 'published' ? 'ended' : e.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted">{dateTime(e.startsAt)} · {e.venue.name}, {e.venue.city}</p>
                    <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-faint md:hidden">{a ? `${a.sold} / ${a.total} sold` : 'Not on sale'}</p>
                  </div>
                  <div className="hidden w-48 shrink-0 md:block">
                    {a ? (
                      <>
                        <div className="flex justify-between font-mono text-[11px] uppercase tracking-[0.08em]">
                          <span className="text-muted">Sold</span>
                          <span className="tabular text-fg">{a.sold} / {a.total}</span>
                        </div>
                        <div className="mt-2 h-1 bg-line">
                          <div className="h-full origin-left animate-grow-x bg-signal" style={{ width: `${soldPct}%`, animationDelay: `${250 + Math.min(i, 8) * 60}ms` }} />
                        </div>
                      </>
                    ) : (
                      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">{e.capacity} seats · not on sale</p>
                    )}
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
