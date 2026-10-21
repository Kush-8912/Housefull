import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarSearch, Search, X } from 'lucide-react';
import { api, isAbort } from '../lib/api';
import { CATEGORY_LABELS, money, shortDate, time, weekday } from '../lib/format';
import { useDebounced } from '../hooks/useDebounced';
import { setCityPref, useCityPref } from '../lib/cityPref';
import { EventCard } from '../components/EventCard';
import { EmptyState, ErrorState, Spinner } from '../components/States';

const WHEN = {
  any: { label: 'Any date' },
  week: { label: 'Next 7 days', days: 7 },
  month: { label: 'Next 30 days', days: 30 },
};

// Filters live in the URL so searches are shareable and survive refresh/back.
export function HomePage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const debouncedQ = useDebounced(q.trim());
  const category = params.get('category') ?? '';
  const city = params.get('city') ?? '';
  const when = params.get('when') ?? 'any';
  const sort = params.get('sort') ?? 'date';
  const savedCity = useCityPref();
  const page = Number(params.get('page') ?? 1);

  const [cities, setCities] = useState([]);
  const [lineup, setLineup] = useState(null);
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [reload, setReload] = useState(0);

  const update = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v == null || (k === 'when' && v === 'any') || (k === 'page' && v === 1)) next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (debouncedQ !== (params.get('q') ?? '')) update({ q: debouncedQ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  // Start in the visitor's chosen city (unless the link already says which).
  useEffect(() => {
    if (savedCity && !params.has('city')) update({ city: savedCity });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCity]);

  useEffect(() => {
    api('/events/cities').then((d) => setCities(d.cities)).catch(() => {});
    // The Next up board always shows what's on sale, whatever the filters say.
    api('/events').then(setLineup).catch(() => {});
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const qs = new URLSearchParams({ page: String(page) });
    if (params.get('q')) qs.set('q', params.get('q'));
    if (category) qs.set('category', category);
    if (city) qs.set('city', city);
    if (sort === 'trending') qs.set('sort', 'trending');
    if (WHEN[when]?.days) qs.set('to', new Date(Date.now() + WHEN[when].days * 86_400_000).toISOString());

    setState((s) => ({ ...s, status: 'loading', error: null }));
    api(`/events?${qs}`, { signal: ctrl.signal })
      .then((data) => setState({ status: 'ok', data, error: null }))
      .catch((error) => !isAbort(error) && setState({ status: 'error', data: null, error }));
    return () => ctrl.abort();
  }, [params, category, city, when, sort, page, reload]);

  const filtered = params.get('q') || category || city || when !== 'any';
  const clearAll = () => { setQ(''); setCityPref(''); setParams({}, { replace: true }); };

  return (
    <div>
      <section className="-mt-2 pb-12">
        <p className="eyebrow flex items-center gap-2">
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
          </span>
          Live seat maps{lineup ? ` · ${lineup.total} event${lineup.total === 1 ? '' : 's'} on sale` : ''}
        </p>
        <h1 className="display mt-6 text-[clamp(3.6rem,12.5vw,10.5rem)]">
          Pick the seat.
          <br />
          <span className="text-transparent [-webkit-text-stroke:2px_var(--color-fg)] sm:[-webkit-text-stroke-width:3px]">Not the</span>{' '}
          <span className="text-signal">section.</span>
        </h1>
        <div className="mt-10 grid gap-8 border-t border-line pt-8 md:grid-cols-[1.1fr_2fr]">
          <p className="max-w-sm text-[15px] leading-relaxed text-muted">
            Every seat in the house, updating live as people book. The ones you pick are held for you while you pay, so nobody can take them mid-checkout.
          </p>
          <ol className="grid gap-6 sm:grid-cols-3">
            {[
              ['01', 'Pick', 'Choose exact seats on the live map.'],
              ['02', 'Hold', 'They’re locked to you during checkout.'],
              ['03', 'Walk in', 'Show the QR ticket at the door.'],
            ].map(([n, title, text]) => (
              <li key={n} className="border-l border-line pl-4">
                <span className="font-mono text-[11px] text-signal">{n}</span>
                <p className="display mt-1 text-2xl">{title}</p>
                <p className="mt-1 text-sm text-muted">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {lineup?.items.length >= 3 && <NextUp items={lineup.items} />}

      <section className="pt-14" aria-labelledby="on-sale">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="on-sale" className="display text-5xl sm:text-6xl">On sale</h2>
          <label className="relative w-full sm:w-80">
            <span className="sr-only">Search events</span>
            <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search event, artist or venue"
              className="w-full border-0 border-b border-line-strong bg-transparent py-2.5 pl-7 pr-8 text-[15px] text-fg placeholder:text-faint focus:border-signal focus:outline-none"
            />
            {q && (
              <button type="button" onClick={() => setQ('')} className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-faint hover:text-fg" aria-label="Clear search">
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 border-y border-line py-3">
          {/* Phones: one row of chips that scrolls sideways, edge to edge. */}
          <div className="-mx-4 flex w-[calc(100%+2rem)] gap-1 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-[-0.25rem] sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden" role="group" aria-label="Category">
            <Chip active={!category} onClick={() => update({ category: '' })}>All</Chip>
            {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
              <Chip key={k} active={category === k} onClick={() => update({ category: k })}>{label}</Chip>
            ))}
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap">
            <Select value={sort} onChange={(v) => update({ sort: v === 'date' ? '' : v })} label="Sort">
              <option value="date">Soonest first</option>
              <option value="trending">Trending</option>
            </Select>
            {/* On phones the city comes from the map picker in the header. */}
            <Select className="hidden sm:block" value={city} onChange={(v) => { setCityPref(v); update({ city: v }); }} label="City">
              <option value="">All cities</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select value={when} onChange={(v) => update({ when: v })} label="Date">
              {Object.entries(WHEN).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </div>
        </div>

        <div className="mt-8">
          {state.status === 'error' ? (
            <ErrorState error={state.error} onRetry={() => setReload((n) => n + 1)} />
          ) : !state.data ? (
            <SkeletonGrid />
          ) : state.data.items.length === 0 ? (
            <EmptyState
              icon={CalendarSearch}
              title={filtered ? 'Nothing matches' : 'No events yet'}
              action={filtered && <button type="button" className="btn-secondary" onClick={clearAll}>Clear filters</button>}
            >
              {filtered ? 'Try a different search, city or date range.' : 'Check back soon. Organizers are still setting things up.'}
            </EmptyState>
          ) : (
            <>
              <p className="eyebrow mb-4 flex items-center gap-2" aria-live="polite">
                {state.data.total} result{state.data.total === 1 ? '' : 's'}
                {state.status === 'loading' && <Spinner className="h-3 w-3" />}
                {filtered && <button type="button" onClick={clearAll} className="ml-2 text-signal hover:underline">Clear filters</button>}
              </p>
              <div className={`grid gap-5 transition-opacity min-[540px]:grid-cols-2 lg:grid-cols-3 ${state.status === 'loading' ? 'opacity-50' : ''}`}>
                {state.data.items.map((e, i) => <EventCard key={e.id} event={e} index={i} />)}
              </div>
              {state.data.pages > 1 && (
                <nav className="mt-10 flex items-center justify-between border-t border-line pt-5" aria-label="Pagination">
                  <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>Previous</button>
                  <span className="font-mono text-xs uppercase tracking-[0.12em] text-muted">Page {page} / {state.data.pages}</span>
                  <button type="button" className="btn-secondary" disabled={page >= state.data.pages} onClick={() => update({ page: page + 1 })}>Next</button>
                </nav>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// The next few shows, listed like a box-office programme board.
function NextUp({ items }) {
  const soonest = [...items].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)).slice(0, 5);
  return (
    <section className="pt-4" aria-labelledby="next-up">
      <h2 id="next-up" className="eyebrow border-b border-line-strong pb-3 text-fg">Next up</h2>
      <ul>
        {soonest.map((e) => <NextUpRow key={e.id} event={e} />)}
      </ul>
    </section>
  );
}

function NextUpRow({ event: e }) {
  const a = e.availability;
  const taken = a?.total ? (a.total - a.available) / a.total : 0;
  const soldOut = a && a.available === 0;
  return (
    <li className="border-b border-line">
      <Link
        to={`/events/${e.id}`}
        className="group grid grid-cols-[4.5rem_1fr_auto] items-center gap-x-4 gap-y-1 py-4 transition-colors hover:bg-ink-900 sm:grid-cols-[6.5rem_1fr_9rem_5.5rem] sm:gap-x-6 sm:px-2"
      >
        <span className="row-span-2 font-mono text-xs uppercase leading-tight tracking-[0.08em] text-muted sm:row-span-1">
          <span className="block text-fg">{weekday(e.startsAt)} {shortDate(e.startsAt)}</span>
          {time(e.startsAt)}
        </span>
        <span className="min-w-0">
          <span className="block line-clamp-2 text-[17px] font-semibold leading-snug text-fg group-hover:text-signal sm:truncate">{e.title}</span>
          <span className="block truncate text-sm text-muted">{e.venue.name}, {e.venue.city}</span>
        </span>
        <span className="col-start-2 flex items-center gap-2.5 sm:col-start-auto" title={a ? `${a.available} of ${a.total} seats left` : undefined}>
          {a && (
            <>
              <span className="h-1 w-16 overflow-hidden bg-line" aria-hidden>
                <span className={`block h-full ${soldOut ? 'bg-stop' : taken >= 0.9 ? 'bg-warn' : 'bg-fg/60'}`} style={{ width: `${Math.max(taken * 100, 3)}%` }} />
              </span>
              <span className={`font-mono text-[11px] uppercase tracking-[0.08em] ${soldOut ? 'text-stop' : 'text-faint'}`}>
                {soldOut ? 'Sold out' : `${a.available} left`}
              </span>
            </>
          )}
        </span>
        <span className="col-start-3 row-start-1 text-right font-mono text-sm text-fg sm:col-start-auto sm:row-start-auto">
          {money(e.minPrice)}
        </span>
      </Link>
    </li>
  );
}

function Chip({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-[3px] px-2.5 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] transition-colors ${
        active ? 'bg-fg text-ink' : 'text-muted hover:bg-ink-850 hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

function Select({ value, onChange, label, children, className = '' }) {
  return (
    <select
      className={`${className} input w-full min-w-0 cursor-pointer truncate py-1.5 pl-2 pr-6 font-mono text-[11px] uppercase tracking-[0.08em] sm:w-auto sm:pl-3 sm:pr-8 sm:tracking-[0.1em]`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
    >
      {children}
    </select>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-5 min-[540px]:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading events">
      {[0, 1, 2].map((i) => (
        <div key={i} className="overflow-hidden rounded-[4px] border border-line bg-ink-900">
          <div className="aspect-[16/10] animate-pulse bg-ink-850" />
          <div className="space-y-3 p-5">
            <div className="h-6 w-3/4 animate-pulse bg-ink-850" />
            <div className="h-3 w-1/2 animate-pulse bg-ink-850" />
          </div>
          <div className="h-12 border-t border-dashed border-line" />
        </div>
      ))}
    </div>
  );
}
