import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BellRing, CalendarPlus, Heart, Settings, Share2, Star, Timer, Wand2 } from 'lucide-react';
import { api } from '../lib/api';
import { BADGES, CATEGORY_LABELS, dateMedium, dateTime, money, plural, shortDate, time, weekday } from '../lib/format';
import { Stars, StarInput } from '../components/Stars';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { useEventChannel } from '../hooks/useEventChannel';
import { mmss, useCountdown } from '../hooks/useCountdown';
import { SeatMap } from '../components/SeatMap';
import { findBestSeats } from '../lib/bestSeats';
import { downloadIcs } from '../lib/calendar';
import { ErrorState, FieldError, Notice, PageLoader, Spinner } from '../components/States';
import { CountUp, Words } from '../components/Motion';

const MAX_SEATS = 8; // fallback; each event says its own limit (maxPerOrder) and the server enforces it

export function EventPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [seats, setSeats] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  // How many seats the buyer wants: caps picking by hand and sizes "Find best seats".
  const [seatCount, setSeatCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [viewers, setViewers] = useState(null);
  // Our own hold request broadcasts 'held' for our seats before the HTTP
  // response arrives; those must not be reported as taken by someone else.
  const holdingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await api(`/events/${id}`);
      setData(d);
      setSeats(d.seats);
      setError(null);
      // Drop selections that are no longer available after a refresh.
      setSelected((prev) => new Set([...prev].filter((sid) => d.seats.some((s) => String(s.id) === sid && s.status === 'available'))));
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => { load(); }, [load, user]);
  // Switching showtime is a different seat map: start fresh.
  useEffect(() => {
    setSelected(new Set());
    setViewers(null);
  }, [id]);

  // Live updates: merge status changes from other buyers into the map.
  useEventChannel(id, {
    onSeats: (changes) => {
      const byId = new Map(changes.map((c) => [String(c.id), c.status]));
      setSeats((prev) => prev.map((s) => {
        const status = byId.get(String(s.id));
        if (!status) return s;
        return { ...s, status, mine: status === 'held' ? s.mine : false };
      }));
      // Side effects stay outside state updaters (StrictMode runs updaters twice).
      const lost = holdingRef.current ? [] : [...selected].filter((sid) => byId.has(sid) && byId.get(sid) !== 'available');
      if (lost.length) {
        const labels = seats.filter((s) => lost.includes(String(s.id))).map((s) => s.label);
        toast.warning(`${labels.join(', ') || 'A seat you picked'} ${labels.length > 1 ? 'were' : 'was'} just taken by someone else`);
        setSelected((prev) => new Set([...prev].filter((sid) => !lost.includes(sid))));
      }
    },
    onReconnect: load,
    onViewers: setViewers,
  }, { view: true });

  // The organizer's per-order limit caps the count the buyer can choose.
  const maxSeats = data?.event?.maxPerOrder ?? MAX_SEATS;
  const count = Math.min(seatCount, maxSeats);

  const toggle = useCallback((seat) => {
    const key = String(seat.id);
    if (!selected.has(key) && selected.size >= count) {
      toast.error(`You've already picked ${plural(count, 'seat')}`, {
        id: 'seat-limit',
        description: count < maxSeats ? 'Unselect one to swap it, or choose more seats above the map.' : `${maxSeats} is the most per order for this event. Unselect one to swap it.`,
      });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, [selected, count, maxSeats]);

  // Lowering the count keeps the seats picked first and lets go of the rest.
  const changeSeatCount = (n) => {
    setSeatCount(n);
    if (selected.size > n) {
      setSelected(new Set([...selected].slice(0, n)));
      toast(`Kept your first ${plural(n, 'seat')}`, { id: 'seat-count' });
    }
  };

  const picked = useMemo(() => seats.filter((s) => selected.has(String(s.id))), [seats, selected]);
  const total = picked.reduce((s, x) => s + x.price, 0);

  const holdSeats = async () => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/events/${id}`)}`);
      return;
    }
    setBusy(true);
    holdingRef.current = true;
    try {
      const { hold } = await api(`/events/${id}/holds`, { method: 'POST', body: { seatIds: [...selected] } });
      navigate(`/checkout/${hold._id}`);
    } catch (err) {
      holdingRef.current = false;
      if (err.code === 'SEATS_UNAVAILABLE') {
        const lost = new Set(err.details.seatIds.map(String));
        setSeats((prev) => prev.map((s) => (lost.has(String(s.id)) ? { ...s, status: 'held', mine: false } : s)));
        setSelected((prev) => new Set([...prev].filter((sid) => !lost.has(sid))));
      }
      toast.error(err.message);
      if (err.code === 'NOT_ON_SALE') load();
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <PageLoader label="Loading seat map…" />;

  const { event, hold, shows } = data;
  const available = seats.filter((s) => s.status === 'available').length;
  const canBuy = event.onSale && !event.isOwner && user?.role !== 'organizer';

  return (
    <div>
      <header className="relative left-1/2 -mt-10 w-screen -translate-x-1/2 overflow-hidden border-b border-line">
        {event.coverImageUrl && (
          <img key={event.id} src={event.coverImageUrl} alt="" className="absolute inset-0 h-full w-full animate-ken-burns object-cover opacity-35 grayscale" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/80 to-ink/40" />
        <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-16 sm:px-6 sm:pt-24">
          <div className="flex flex-wrap items-center gap-3">
            <span className="bg-signal px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink">{CATEGORY_LABELS[event.category]}</span>
            {event.status === 'published' && event.onSale && (
              <span className="eyebrow tabular"><CountUp value={available} /> of {seats.length} seats open</span>
            )}
            {event.badges?.map((b) => (
              <span key={b} title={BADGES[b]?.hint} className={`px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] ${BADGES[b]?.tone}`}>{BADGES[b]?.label}</span>
            ))}
            {event.rating?.count > 0 && (
              <a href="#reviews" className="eyebrow flex items-center gap-1.5 text-fg hover:text-signal">
                <Star className="h-3.5 w-3.5 fill-warn text-warn" aria-hidden /> {event.rating.avg.toFixed(1)} · {plural(event.rating.count, 'review')}
              </a>
            )}
            {event.status === 'published' && event.onSale && viewers > 0 && (
              <span className="eyebrow flex items-center gap-1.5 text-fg" aria-live="polite">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-go" aria-hidden />
                {viewers === 1 ? 'Only you are looking right now' : `${viewers} people looking right now`}
              </span>
            )}
          </div>
          <h1 key={event.id} className="display mt-5 max-w-4xl text-[clamp(3rem,8vw,6.5rem)]"><Words delay={80}>{event.title}</Words></h1>
          <dl className="mt-8 grid max-w-3xl animate-rise grid-cols-2 gap-x-8 gap-y-5 border-t border-line pt-5 [animation-delay:350ms] sm:grid-cols-4">
            <Meta label="Date">{dateMedium(event.startsAt)}</Meta>
            <Meta label="Starts">{time(event.startsAt)}</Meta>
            <Meta label="Runs">{duration(event.durationMinutes)}</Meta>
            <Meta label="Venue">{event.venue.name}, {event.venue.city}</Meta>
          </dl>
          {shows.length > 1 && <Showtimes shows={shows} current={event.id} />}
          <div className="mt-8 flex flex-wrap gap-2">
            {!event.isOwner && event.status !== 'draft' && <InterestButton key={event.id} event={event} />}
            {event.status !== 'draft' && <ShareButton event={event} />}
            {event.isOwner && (
              <Link to={`/organizer/events/${event.id}`} className="btn-secondary bg-ink/50 backdrop-blur"><Settings className="h-4 w-4" aria-hidden /> Manage event</Link>
            )}
            {event.status === 'published' && (
              <button type="button" className="btn-secondary bg-ink/50 backdrop-blur" onClick={() => downloadIcs(event)}>
                <CalendarPlus className="h-4 w-4" aria-hidden /> Add to calendar
              </button>
            )}
          </div>
        </div>
      </header>

      <StatusBanner event={event} available={available} isOrganizer={user?.role === 'organizer' && !event.isOwner} />
      {event.onSale && available === 0 && !event.isOwner && user?.role !== 'organizer' && <Waitlist eventId={event.id} />}
      {hold && <ActiveHoldBanner hold={hold} onReleased={load} />}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_18rem]">
        <section className="card min-w-0 px-3 py-8 sm:px-8" aria-label="Seat map">
          {event.status === 'draft' ? (
            <p className="py-10 text-center text-sm text-muted">This is a draft. Seats are created when you publish it.</p>
          ) : (
            <>
              {canBuy && available > 0 && (
                <BestAvailable
                  rows={event.rows}
                  tiers={event.tiers}
                  seats={seats}
                  count={count}
                  max={maxSeats}
                  onCountChange={changeSeatCount}
                  onPick={(block) => setSelected(new Set(block.map((s) => String(s.id))))}
                />
              )}
              <SeatMap rows={event.rows} tiers={event.tiers} seats={seats} selected={selected} onToggle={canBuy ? toggle : undefined} />
            </>
          )}
        </section>
        <aside className="space-y-8 lg:pt-2">
          <div>
            <h2 className="eyebrow">About</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-fg/85">{event.description || 'No description provided.'}</p>
          </div>
          <div>
            <h2 className="eyebrow">Prices</h2>
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {event.tiers.map((t) => (
                <li key={t.name} className="py-2.5 text-sm">
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `color-mix(in oklab, ${t.color} 72%, white)` }} />{t.name}</span>
                    <span className="font-mono">{money(t.price)}</span>
                  </span>
                  {t.description && <span className="mt-0.5 block pl-[18px] text-xs text-muted">{t.description}</span>}
                </li>
              ))}
            </ul>
          </div>
          {event.status === 'published' && (
            <ul className="space-y-1 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
              <li>Up to {plural(maxSeats, 'ticket')} per order</li>
              {event.onSale && event.salesCloseMinutes > 0 && <li>Sales close {dateTime(event.salesEndAt)}</li>}
            </ul>
          )}
          <p className="eyebrow">Hosted by <span className="text-fg">{event.organizer?.name}</span></p>
        </aside>
      </div>

      {event.status !== 'draft' && <div className="reveal"><Reviews eventId={event.id} /></div>}

      {canBuy && (
        // Sticky rather than fixed: it rides along the bottom while you scroll,
        // then settles above the footer instead of covering it.
        <div className="sticky bottom-0 z-20 -mb-10 mt-12 mx-[calc(50%-50vw)] w-screen border-t border-line-strong bg-ink-850/95 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
            <div className="min-w-0">
              {picked.length ? (
                <>
                  <p className={`eyebrow ${picked.length === count ? 'text-go' : ''}`}>{picked.length} of {plural(count, 'seat')}{picked.length === count ? ' · all picked' : ''}</p>
                  <p className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="truncate font-mono text-sm font-semibold text-fg">{picked.map((s) => s.label).join(' · ')}</span>
                    <span key={total} className="display inline-block animate-pop text-2xl text-signal">{money(total)}</span>
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">Tap {count === 1 ? 'a seat' : `up to ${count} seats`} on the map to pick {count === 1 ? 'it' : 'them'}.</p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              {picked.length > 0 && <button type="button" className="btn-ghost hidden sm:inline-flex" onClick={() => setSelected(new Set())}>Clear</button>}
              <button type="button" className={`btn-primary py-3 ${picked.length === count ? 'animate-glow' : ''}`} disabled={!picked.length || busy} onClick={holdSeats}>
                {busy ? <Spinner className="h-4 w-4" /> : <Timer className="h-4 w-4" aria-hidden />} Hold &amp; checkout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Pick the best block of side-by-side seats for you; you can still adjust by hand.
function BestAvailable({ rows, tiers, seats, count, max, onCountChange, onPick }) {
  const [tier, setTier] = useState('');

  const pick = () => {
    const block = findBestSeats({ rows, seats, count, tier: tier || null });
    if (!block) {
      toast.error(`No ${count} seats together${tier ? ` in ${tier}` : ''} right now. Try fewer seats${tiers.length > 1 ? ' or another tier' : ''}.`);
      return;
    }
    onPick(block);
    toast.success(`Picked ${block[0].label}${block.length > 1 ? `\u2013${block.at(-1).label}` : ''}, the best ${block.length > 1 ? `${block.length} together` : 'seat'} available`);
  };

  return (
    <div className="mb-10 grid grid-cols-[5.5rem_1fr] items-end gap-2 border-b border-dashed border-line pb-6 sm:flex sm:flex-wrap sm:justify-center">
      <label className={`block ${tiers.length > 1 ? '' : 'col-span-2'}`}>
        <span className="label">Seats</span>
        <select className="input py-2 font-mono sm:w-20" value={count} onChange={(e) => onCountChange(Number(e.target.value))}>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {tiers.length > 1 && (
        <label className="block">
          <span className="label">Tier</span>
          <select className="input py-2 sm:w-44" value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="">Any tier</option>
            {tiers.map((t) => <option key={t.name} value={t.name}>{t.name} · {money(t.price)}</option>)}
          </select>
        </label>
      )}
      <button type="button" className="btn-secondary col-span-2 py-2" onClick={pick}>
        <Wand2 className="h-4 w-4 text-signal" aria-hidden /> Find best seats
      </button>
    </div>
  );
}

// Sold out: join the waitlist and get told (in-app and by email) when seats come back.
function Waitlist({ eventId }) {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/events/${eventId}/waitlist`).then((d) => setState(d.waitlist)).catch(() => {});
  }, [eventId, user]);

  const act = async (method) => {
    setBusy(true);
    try {
      const d = await api(`/events/${eventId}/waitlist`, { method });
      setState(d.waitlist);
      toast.success(method === 'POST' ? 'You\u2019re on the waitlist. We\u2019ll tell you when seats open up.' : 'You left the waitlist');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;
  const others = state.waiting - (state.joined ? 1 : 0);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border border-line-strong bg-ink-900 px-5 py-4">
      <div className="flex items-start gap-3">
        <BellRing className={`mt-0.5 h-5 w-5 shrink-0 ${state.joined ? 'text-signal' : 'text-muted'}`} aria-hidden />
        <div>
          <p className="text-sm font-semibold text-fg">{state.joined ? 'You\u2019re on the waitlist' : 'Get told when seats open up'}</p>
          <p className="mt-0.5 text-xs text-muted">
            {state.joined
              ? `We'll notify you here and by email.${others > 0 ? ` ${plural(others, 'other person')} waiting too.` : ''}`
              : `Everyone waiting is told at the same time, then it's first come, first served.${state.waiting ? ` ${state.waiting} waiting.` : ''}`}
          </p>
        </div>
      </div>
      {!user ? (
        <Link to={`/login?next=${encodeURIComponent(`/events/${eventId}`)}`} className="btn-primary">Log in to join</Link>
      ) : state.joined ? (
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => act('DELETE')}>Leave waitlist</button>
      ) : (
        <button type="button" className="btn-primary" disabled={busy} onClick={() => act('POST')}>{busy && <Spinner className="h-4 w-4" />} Join waitlist</button>
      )}
    </div>
  );
}

// Other dates and times of the same production.
function Showtimes({ shows, current }) {
  return (
    <div className="mt-8">
      <p className="eyebrow">{shows.length} showtimes</p>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {shows.map((s) => {
          const active = String(s.id) === String(current);
          const soldOut = s.availability && s.availability.available === 0;
          const off = s.status === 'cancelled' || s.past;
          const note = s.status === 'cancelled' ? 'Cancelled' : s.past ? 'Ended' : soldOut ? 'Sold out' : s.status === 'draft' ? 'Draft' : `${s.availability?.available ?? '\u2014'} left`;
          return (
            <Link
              key={s.id}
              to={`/events/${s.id}`}
              aria-current={active ? 'page' : undefined}
              className={`shrink-0 border px-4 py-2.5 transition-colors ${active ? 'border-signal bg-signal text-ink' : off ? 'border-line text-faint' : 'border-line-strong bg-ink/50 text-fg backdrop-blur hover:border-fg/60'}`}
            >
              <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] opacity-80">{weekday(s.startsAt)} {shortDate(s.startsAt)}</span>
              <span className="display mt-1 block text-2xl leading-none">{time(s.startsAt)}</span>
              <span className={`mt-1 block font-mono text-[10px] uppercase tracking-[0.08em] ${active ? '' : soldOut ? 'text-stop' : 'opacity-70'}`}>{note}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function InterestButton({ event }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState({ count: event.interested, mine: event.interestedByMe });
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/events/${event.id}`)}`);
      return;
    }
    setBusy(true);
    try {
      const d = await api(`/events/${event.id}/interest`, { method: state.mine ? 'DELETE' : 'POST' });
      setState(d.interest);
      if (d.interest.mine) toast.success('Saved. Find it under Saved.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className={`btn-secondary bg-ink/50 backdrop-blur ${state.mine ? 'border-signal text-fg' : ''}`} onClick={toggle} disabled={busy} aria-pressed={state.mine}>
      <Heart className={`h-4 w-4 ${state.mine ? 'fill-signal text-signal' : ''}`} aria-hidden />
      {state.mine ? 'Interested' : 'I\u2019m interested'}
      {state.count > 0 && <span className="font-mono text-xs text-muted">{state.count}</span>}
    </button>
  );
}

function ShareButton({ event }) {
  const share = async () => {
    const url = `${window.location.origin}/events/${event.id}`;
    const text = `${event.title}, ${dateMedium(event.startsAt)} at ${event.venue.name}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: event.title, text, url });
      } catch { /* dismissed */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Couldn\u2019t copy the link. Copy it from the address bar instead.');
    }
  };
  return (
    <button type="button" className="btn-secondary bg-ink/50 backdrop-blur" onClick={share}>
      <Share2 className="h-4 w-4" aria-hidden /> Share
    </button>
  );
}

const EMPTY_REVIEW = { rating: 0, text: '', aspects: {}, recommend: null, privateNote: '' };
const ASPECTS = [['performance', 'The show itself'], ['venue', 'Venue and staff'], ['value', 'Value for money']];

function Reviews({ eventId }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [writing, setWriting] = useState(false);
  const [form, setForm] = useState(EMPTY_REVIEW);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();

  const load = useCallback(() => {
    api(`/events/${eventId}/reviews?page=${page}`).then((d) => setData(d.reviews)).catch(() => {});
  }, [eventId, page]);
  useEffect(() => { load(); }, [load, user]);

  const open = () => {
    const m = data.mine;
    setForm(m ? { rating: m.rating, text: m.text ?? '', aspects: m.aspects ?? {}, recommend: m.recommend ?? null, privateNote: m.privateNote ?? '' } : EMPTY_REVIEW);
    setError(null);
    setWriting(true);
  };
  const save = async () => {
    if (!form.rating) { setError('Pick a star rating'); return; }
    setBusy(true);
    try {
      await api(`/events/${eventId}/reviews`, { method: 'PUT', body: form });
      toast.success(data.mine ? 'Review updated' : 'Thanks for your review');
      setWriting(false);
      setPage(1);
      load();
    } catch (err) {
      setError(Object.values(err.fieldErrors ?? {})[0] ?? err.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    try {
      await api(`/events/${eventId}/reviews`, { method: 'DELETE' });
      toast.success('Review deleted');
      load();
    } catch (err) { toast.error(err.message); }
  };

  if (!data || (data.count === 0 && !data.canReview)) return null;
  return (
    <section id="reviews" className="mt-12 scroll-mt-24 border-t border-line pt-10" aria-labelledby="reviews-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="reviews-title" className="display text-5xl">Reviews</h2>
        {data.canReview && (
          <div className="flex gap-2">
            {data.mine && <button type="button" className="btn-ghost" onClick={remove}>Delete mine</button>}
            <button type="button" className="btn-primary" onClick={open}><Star className="h-4 w-4" aria-hidden /> {data.mine ? 'Edit your review' : 'Write a review'}</button>
          </div>
        )}
      </div>
      <p className="mt-2 text-sm text-muted">Only people who were scanned in at the door can review.</p>

      {data.count > 0 ? (
        <div className="mt-8 grid gap-10 md:grid-cols-[14rem_1fr]">
          <div>
            <p className="display text-7xl">{data.avg.toFixed(1)}</p>
            <Stars value={data.avg} size="h-4 w-4" />
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{plural(data.count, 'review')}</p>
            <ul className="mt-5 space-y-1.5">
              {[5, 4, 3, 2, 1].map((r) => (
                <li key={r} className="flex items-center gap-2 font-mono text-[11px] text-muted">
                  <span className="w-3">{r}</span>
                  <span className="h-1 flex-1 bg-line"><span className="block h-full bg-warn" style={{ width: `${(data.distribution[r] / data.count) * 100}%` }} /></span>
                  <span className="w-5 text-right tabular">{data.distribution[r]}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <ul className="divide-y divide-line border-y border-line">
              {data.items.map((r) => (
                <li key={r._id} className="py-5">
                  <div className="flex items-center gap-3">
                    <Stars value={r.rating} />
                    <span className="text-sm font-semibold text-fg">{r.author}{r.mine && <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.1em] text-signal">You</span>}</span>
                    <span className="font-mono text-[11px] text-faint">{shortDate(r.createdAt)}</span>
                  </div>
                  {r.text && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-fg/85">{r.text}</p>}
                  {r.recommend && <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-go">Would recommend</p>}
                </li>
              ))}
            </ul>
            {data.pages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</button>
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{page} / {data.pages}</span>
                <button type="button" className="btn-ghost" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Older</button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-8 text-sm text-muted">No reviews yet. You went, so yours can be the first.</p>
      )}

      <ConfirmDialog open={writing} title={data.mine ? 'Edit your review' : 'Rate this event'} confirmLabel={data.mine ? 'Save' : 'Post review'} busy={busy} onConfirm={save} onClose={() => setWriting(false)}>
        <StarInput value={form.rating} onChange={(rating) => { setForm((f) => ({ ...f, rating })); setError(null); }} />
        <label className="label mt-5" htmlFor="review-text">What was it like? <span className="normal-case tracking-normal text-faint">(optional, public)</span></label>
        <textarea id="review-text" rows={3} maxLength={1000} className="input" value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} />

        <p className="label mt-5">Rate the details <span className="normal-case tracking-normal text-faint">(optional)</span></p>
        <div className="space-y-2">
          {ASPECTS.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-sm text-fg">{label}</span>
              <StarInput size="h-5 w-5" label={label} value={form.aspects[key] ?? 0} onChange={(v) => setForm((f) => ({ ...f, aspects: { ...f.aspects, [key]: v } }))} />
            </div>
          ))}
        </div>

        <p className="label mt-5">Would you recommend it to a friend?</p>
        <div className="flex gap-2">
          {[[true, 'Yes'], [false, 'No']].map(([v, label]) => (
            <button key={label} type="button" aria-pressed={form.recommend === v}
              onClick={() => setForm((f) => ({ ...f, recommend: f.recommend === v ? null : v }))}
              className={`btn px-4 py-2 ${form.recommend === v ? (v ? 'bg-go text-ink' : 'bg-stop text-ink') : 'border border-line-strong text-muted hover:text-fg'}`}>
              {label}
            </button>
          ))}
        </div>

        <label className="label mt-5" htmlFor="review-note">A note for the organizer <span className="normal-case tracking-normal text-faint">(optional, only they see it)</span></label>
        <textarea id="review-note" rows={2} maxLength={1000} className="input" placeholder="Anything they should fix or keep doing" value={form.privateNote} onChange={(e) => setForm((f) => ({ ...f, privateNote: e.target.value }))} />
        <FieldError message={error} />
      </ConfirmDialog>
    </section>
  );
}

function Meta({ label, children }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-fg">{children}</dd>
    </div>
  );
}

const duration = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h && `${h} hr`, m && `${m} min`].filter(Boolean).join(' ') || '—';
};

function StatusBanner({ event, available, isOrganizer }) {
  let msg = null;
  let tone = 'warn';
  if (event.status === 'cancelled') { msg = 'This event has been cancelled. All ticket holders have been refunded.'; tone = 'stop'; }
  else if (event.status === 'draft') msg = 'Draft preview. Only you can see this page.';
  else if (!event.onSale && event.salesStartAt && new Date(event.salesStartAt) > new Date()) {
    msg = `Ticket sales open ${dateTime(event.salesStartAt)}. The seat map is here so you can plan ahead.`;
  } else if (!event.onSale) msg = 'Ticket sales for this event have closed.';
  else if (available === 0) msg = 'Sold out. Seats on hold may come back if buyers don’t finish checkout. This map updates live.';
  else if (isOrganizer) msg = 'You’re signed in as an organizer. Use an attendee account to buy tickets.';
  if (!msg) return null;
  return <Notice tone={tone} className="mt-8">{msg}</Notice>;
}

function ActiveHoldBanner({ hold, onReleased }) {
  const left = useCountdown(hold.expiresAt);
  const [busy, setBusy] = useState(false);
  if (left === 0) return null;
  const release = async () => {
    setBusy(true);
    try {
      await api(`/holds/${hold._id}`, { method: 'DELETE' });
      toast.success('Seats released');
      onReleased();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border border-signal/40 bg-signal/[0.07] px-5 py-4">
      <p className="text-sm text-fg">
        You&apos;re holding <strong>{plural(hold.seats.length, 'seat')}</strong> for another{' '}
        <strong className="font-mono text-signal tabular">{mmss(left)}</strong>
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn-ghost" onClick={release} disabled={busy}>Release</button>
        <Link to={`/checkout/${hold._id}`} className="btn-primary">Continue to checkout</Link>
      </div>
    </div>
  );
}
