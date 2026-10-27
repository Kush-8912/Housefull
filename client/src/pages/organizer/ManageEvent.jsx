import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, CalendarClock, CalendarPlus, Download, ExternalLink, Mail, Plus, Popcorn, Power, Shirt, Star, Pencil, Rocket, Search, Trash2, XOctagon } from 'lucide-react';
import { api } from '../../lib/api';
import { amount, dateTime, money, pct, plural, shortDate, time } from '../../lib/format';
import { useEventChannel } from '../../hooks/useEventChannel';
import { useDebounced } from '../../hooks/useDebounced';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { QrScanner } from '../../components/QrScanner';
import { EventReport } from './EventReport';
import { CHECKIN_MESSAGES, CheckinResult } from '../../components/CheckinResult';
import { SeatMap, previewSeats } from '../../components/SeatMap';
import { Badge, EmptyState, ErrorState, FieldError, Notice, PageLoader, Spinner } from '../../components/States';
import { CountUp } from '../../components/Motion';
import { useAuth } from '../../context/AuthContext';

// <input type="datetime-local"> wants local time without a zone: 2026-11-08T19:00.
const toLocalInput = (iso) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function ManageEvent() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [shows, setShows] = useState([]);
  const [error, setError] = useState(null);
  const [newShow, setNewShow] = useState(null); // datetime-local string while the dialog is open
  const [showError, setShowError] = useState(null);
  const [moveTo, setMoveTo] = useState(null); // datetime-local string while "Reschedule" is open
  const [moveError, setMoveError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState(null); // 'publish' | 'delete' | 'cancel'
  const verified = useAuth().user?.verifiedHost;
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api(`/events/${id}`)
      .then(({ event: e, shows: s }) => {
        if (!e.isOwner) throw Object.assign(new Error('You can only manage your own events'), { status: 403 });
        setEvent(e);
        setShows(s);
        setError(null);
      })
      .catch(setError);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!event) return <PageLoader />;

  const isDraft = event.status === 'draft';
  const upcoming = new Date(event.startsAt) > new Date();

  // Ticket holders get an email and an inbox notice with the old and new time.
  const reschedule = async () => {
    setBusy(true);
    setMoveError(null);
    try {
      const { event: moved, notified } = await api(`/events/${id}/reschedule`, { method: 'POST', body: { startsAt: new Date(moveTo).toISOString() } });
      toast.success(`Moved to ${dateTime(moved.startsAt)}`, { description: notified ? `${plural(notified, 'ticket holder')} emailed about the change.` : 'No tickets sold yet, so nobody needed telling.' });
      setMoveTo(null);
      load();
    } catch (err) {
      setMoveError(err.fieldErrors?.startsAt ?? err.message);
    } finally {
      setBusy(false);
    }
  };

  const addShowtime = async () => {
    setBusy(true);
    setShowError(null);
    try {
      const { event: show } = await api(`/events/${id}/showtimes`, { method: 'POST', body: { startsAt: new Date(newShow).toISOString() } });
      toast.success(`Showtime added: ${dateTime(show.startsAt)}`);
      setNewShow(null);
      navigate(`/organizer/events/${show._id}`);
    } catch (err) {
      setShowError(err.fieldErrors?.startsAt ?? err.message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (kind) => {
    setBusy(true);
    try {
      if (kind === 'publish') {
        const { event: published } = await api(`/events/${id}/publish`, { method: 'POST' });
        const opensLater = published.salesStartAt && new Date(published.salesStartAt) > new Date();
        toast.success(opensLater ? `Published! Tickets go on sale ${dateTime(published.salesStartAt)}.` : 'Published! Tickets are on sale.');
        load();
      } else if (kind === 'delete') {
        await api(`/events/${id}`, { method: 'DELETE' });
        toast.success('Draft deleted');
        navigate('/organizer', { replace: true });
        return;
      } else if (kind === 'remind') {
        const { sent, orders } = await api(`/events/${id}/reminders`, { method: 'POST' });
        if (sent) toast.success(`Reminder sent to ${plural(sent, 'buyer')}`);
        else if (!orders) toast('No tickets sold yet, so there’s nobody to remind');
        else toast('Everyone with a ticket already has a reminder');
      } else if (kind === 'cancel') {
        const { refunded } = await api(`/events/${id}/cancel`, { method: 'POST' });
        toast.success(`Event cancelled. ${refunded} order${refunded === 1 ? '' : 's'} refunded.`);
        load();
      }
      setDialog(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Link to="/organizer" className="eyebrow inline-flex items-center gap-1.5 hover:text-fg"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Your events</Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <Badge status={event.status} />
          <h1 className="display mt-3 text-5xl sm:text-6xl">{event.title}</h1>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{dateTime(event.startsAt)} · {event.venue.name}, {event.venue.city} · {event.capacity} seats</p>
          {event.rating?.count > 0 && (
            <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-fg">
              <Star className="h-3.5 w-3.5 fill-warn text-warn" aria-hidden /> {event.rating.avg.toFixed(1)} from {plural(event.rating.count, 'review')} (all showtimes)
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {isDraft ? (
            <>
              <button type="button" className="btn-ghost text-stop hover:text-stop" onClick={() => setDialog('delete')}><Trash2 className="h-4 w-4" aria-hidden /> Delete</button>
              <Link to={`/organizer/events/${id}/edit`} className="btn-secondary"><Pencil className="h-4 w-4" aria-hidden /> Edit</Link>
              {verified ? (
                <button type="button" className="btn-primary" onClick={() => setDialog('publish')}><Rocket className="h-4 w-4" aria-hidden /> Publish</button>
              ) : (
                <Link to="/profile#verify" className="btn-primary"><Rocket className="h-4 w-4" aria-hidden /> Verify to publish</Link>
              )}
            </>
          ) : (
            <>
              {event.status !== 'cancelled' && (
                <button type="button" className="btn-secondary" onClick={() => { setNewShow(''); setShowError(null); }}><CalendarPlus className="h-4 w-4" aria-hidden /> Add showtime</button>
              )}
              {event.status === 'published' && upcoming && (
                <button type="button" className="btn-secondary" onClick={() => setDialog('remind')}><Mail className="h-4 w-4" aria-hidden /> Send reminders</button>
              )}
              {event.status === 'published' && upcoming && (
                <button type="button" className="btn-secondary" onClick={() => { setMoveTo(toLocalInput(event.startsAt)); setMoveError(null); }}><CalendarClock className="h-4 w-4" aria-hidden /> Reschedule</button>
              )}
              <Link to={`/events/${id}`} className="btn-secondary"><ExternalLink className="h-4 w-4" aria-hidden /> Public page</Link>
              {event.status === 'published' && upcoming && (
                <button type="button" className="btn-ghost text-stop hover:text-stop" onClick={() => setDialog('cancel')}><XOctagon className="h-4 w-4" aria-hidden /> Cancel event</button>
              )}
            </>
          )}
        </div>
      </div>

      {shows.length > 1 && (
        <nav className="mt-6 flex flex-wrap items-center gap-2" aria-label="Showtimes">
          <span className="eyebrow mr-1">Showtimes</span>
          {shows.map((sh) => (
            <Link
              key={sh.id}
              to={`/organizer/events/${sh.id}`}
              aria-current={String(sh.id) === id ? 'page' : undefined}
              className={`border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] ${String(sh.id) === id ? 'border-signal bg-signal text-ink' : sh.status === 'cancelled' || sh.past ? 'border-line text-faint' : 'border-line-strong text-fg hover:border-fg/60'}`}
            >
              {shortDate(sh.startsAt)} {time(sh.startsAt)}{sh.status !== 'published' ? ` · ${sh.status}` : ''}
            </Link>
          ))}
        </nav>
      )}

      {isDraft ? (
        <div className="mt-8 space-y-6">
          <Notice>This event is a draft and isn&apos;t visible to the public. The layout and prices lock once you publish.</Notice>
          {!verified && (
            <Notice tone="warn">
              Tickets only go on sale from verified hosts. <Link to="/profile#verify" className="font-semibold text-fg underline decoration-signal underline-offset-4">Verify your identity</Link> (takes a minute), then publish.
            </Notice>
          )}
          <div className="card min-w-0 px-3 py-8 sm:px-8"><SeatMap rows={event.rows} tiers={event.tiers} seats={previewSeats(event.rows, event.tiers)} /></div>
          <Addons eventId={id} event={event} />
        </div>
      ) : (
        <>
          {/* On phones the tabs scroll sideways; the faded right edge shows there are more. */}
          <div className="-mr-4 mt-10 flex gap-6 overflow-x-auto border-b border-line pr-8 [mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)] [scrollbar-width:none] sm:mr-0 sm:pr-0 sm:[mask-image:none] [&::-webkit-scrollbar]:hidden" role="tablist">
            {[['overview', 'Overview'], ['report', 'How it went'], ['checkin', 'Check-in'], ['guests', 'Guest list'], ['addons', 'Add-ons'], ['promos', 'Promo codes']].map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k}
                onClick={(e) => {
                  setTab(k);
                  // Bring the chosen tab into view on phones without scrolling the page.
                  const list = e.currentTarget.parentElement;
                  const box = e.currentTarget.getBoundingClientRect();
                  const view = list.getBoundingClientRect();
                  list.scrollBy({ left: box.left + box.width / 2 - (view.left + view.width / 2), behavior: 'smooth' });
                }}
                className={`-mb-px whitespace-nowrap border-b-2 pb-3 font-mono text-xs font-medium uppercase tracking-[0.12em] transition-colors ${tab === k ? 'border-signal text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="mt-8">
            {tab === 'overview' && <Overview eventId={id} />}
            {tab === 'report' && <EventReport eventId={id} />}
            {tab === 'checkin' && <CheckIn eventId={id} disabled={event.status === 'cancelled'} />}
            {tab === 'guests' && <Guests eventId={id} />}
            {tab === 'addons' && <Addons eventId={id} event={event} />}
            {tab === 'promos' && <Promos eventId={id} event={event} />}
          </div>
        </>
      )}

      <ConfirmDialog open={moveTo !== null} title="Reschedule this show" confirmLabel="Move and notify" busy={busy} onConfirm={reschedule} onClose={() => setMoveTo(null)}>
        <p>Seats, tickets and QR codes stay the same. Everyone holding a ticket gets an email and a notification with the old and new time, and reminders follow the new time.</p>
        <label className="label mt-5" htmlFor="move-at">New date and time</label>
        <input id="move-at" type="datetime-local" className={`input ${moveError ? 'input-error' : ''}`} value={moveTo ?? ''} onChange={(e) => { setMoveTo(e.target.value); setMoveError(null); }} />
        <FieldError message={moveError} />
      </ConfirmDialog>

      <ConfirmDialog open={newShow !== null} title="Add a showtime" confirmLabel="Add showtime" busy={busy} onConfirm={addShowtime} onClose={() => setNewShow(null)}>
        <p>Same layout, prices, description and add-on menu, with its own seats.{event.status === 'published' ? ' It goes on sale straight away.' : ' It starts as a draft.'} Promo codes work for every showtime.</p>
        <label className="label mt-5" htmlFor="show-at">Date and time</label>
        <input id="show-at" type="datetime-local" className={`input ${showError ? 'input-error' : ''}`} value={newShow ?? ''} onChange={(e) => { setNewShow(e.target.value); setShowError(null); }} />
        <FieldError message={showError} />
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'remind'} title="Send reminders now?" confirmLabel="Send reminders" busy={busy} onConfirm={() => act('remind')} onClose={() => setDialog(null)}>
        Everyone with a ticket who hasn&apos;t had a reminder gets one now, with your cover photo, their seats and tips for the night. Reminders also go out automatically the day before.
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'publish'} title="Publish this event?" confirmLabel="Publish" busy={busy} onConfirm={() => act('publish')} onClose={() => setDialog(null)}>
        {event.salesStartAt && new Date(event.salesStartAt) > new Date()
          ? `Tickets go on sale ${dateTime(event.salesStartAt)}. Until then buyers can see the event and its seat map.`
          : 'Tickets go on sale immediately.'}{' '}
        You won&apos;t be able to change the seating layout or prices afterwards.
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'delete'} title="Delete this draft?" confirmLabel="Delete" danger busy={busy} onConfirm={() => act('delete')} onClose={() => setDialog(null)}>
        This can&apos;t be undone.
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'cancel'} title="Cancel this event?" confirmLabel="Cancel event & refund all" cancelLabel="Keep event" danger busy={busy} onConfirm={() => act('cancel')} onClose={() => setDialog(null)}>
        Sales stop immediately, every ticket is voided and every buyer is refunded in full. This can&apos;t be undone.
      </ConfirmDialog>
    </div>
  );
}

function Overview({ eventId }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef(null);
  const [viewers, setViewers] = useState(0);

  const load = useCallback(() => {
    api(`/events/${eventId}/stats`).then((d) => { setStats(d.stats); setError(null); }).catch(setError);
  }, [eventId]);
  useEffect(() => { load(); return () => clearTimeout(timer.current); }, [load]);

  // Coalesce bursts of live events into one refetch.
  const refreshSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 800); };
  useEventChannel(eventId, { onSeats: refreshSoon, onCheckin: refreshSoon, onReconnect: load, onViewers: setViewers });

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!stats) return <PageLoader />;

  const cards = [
    { label: 'Revenue', value: <CountUp value={stats.revenue} format={amount} />, sub: plural(stats.ordersPaid, 'order') },
    { label: 'Tickets sold', value: <><CountUp value={stats.sold} /> / {stats.capacity}</>, sub: `${stats.held} on hold right now` },
    { label: 'Sell-through', value: <CountUp value={Math.round(stats.sellThrough * 100)} format={(n) => `${n}%`} />, sub: `${stats.available} seats left` },
    { label: 'Checked in', value: <><CountUp value={stats.checkins.checkedIn} /> / {stats.checkins.issued}</>, sub: stats.checkins.issued ? pct(stats.checkins.checkedIn / stats.checkins.issued) : '—' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 border-l border-t border-line lg:grid-cols-4">
        {cards.map(({ label, value, sub }, i) => (
          <div key={label} className="min-w-0 animate-rise border-b border-r border-line bg-ink-900 p-4 sm:p-5" style={{ animationDelay: `${i * 80}ms` }}>
            <p className="eyebrow">{label}</p>
            <p className={`display mt-3 break-words text-3xl tabular sm:text-5xl ${i === 0 ? 'text-signal' : ''}`}>{value}</p>
            <p className="mt-2 font-mono text-[11px] text-muted">{sub}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-2 border border-line bg-ink-900 px-5 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
        <span className="flex items-center gap-2 text-fg">
          <span className={`h-1.5 w-1.5 rounded-full ${viewers ? 'animate-pulse-dot bg-go' : 'bg-faint'}`} aria-hidden />
          {viewers === 1 ? '1 person' : `${viewers} people`} on the event page now
        </span>
        <span>{stats.waitlist} on the waitlist</span>
        <span>{amount(stats.addonsRevenue)} from add-ons</span>
        <span>{amount(stats.discounts)} in promo discounts</span>
      </div>
      {stats.refunds.count > 0 && (
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-warn">{stats.refunds.count} order{stats.refunds.count > 1 ? 's' : ''} cancelled · {amount(stats.refunds.amount)} refunded</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="eyebrow text-fg">Sales by tier</h2>
          <table className="mt-4 w-full text-sm">
            <thead className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
              <tr><th className="pb-2 font-medium">Tier</th><th className="pb-2 font-medium">Sold</th><th className="pb-2 text-right font-medium" title="Seat prices before promo discounts">Face value</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {stats.tiers.map((t) => (
                <tr key={t.tier}>
                  <td className="py-3">{t.tier} <span className="font-mono text-xs text-faint">· {money(t.price)}</span></td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-20 bg-line sm:w-24"><div className="h-full origin-left animate-grow-x bg-signal" style={{ width: pct(t.sold / t.capacity) }} /></div>
                      <span className="font-mono text-xs tabular text-muted">{t.sold}/{t.capacity}</span>
                    </div>
                  </td>
                  <td className="py-3 text-right font-mono tabular">{amount(t.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card p-5">
          <h2 className="eyebrow text-fg">Tickets sold per day</h2>
          {stats.salesByDay.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted">No sales yet.</p>
          ) : (
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.salesByDay} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="#2c2a26" />
                  <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} fontSize={11} fontFamily="IBM Plex Mono" stroke="#6f6a62" tickLine={false} axisLine={{ stroke: '#403c37' }} />
                  <YAxis allowDecimals={false} fontSize={11} fontFamily="IBM Plex Mono" stroke="#6f6a62" tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => [v, 'Tickets']} cursor={{ fill: '#ffffff08' }} contentStyle={{ background: '#1a1917', border: '1px solid #403c37', borderRadius: 4, fontFamily: 'IBM Plex Mono', fontSize: 12 }} labelStyle={{ color: '#a39d93' }} itemStyle={{ color: '#f1ece3' }} />
                  <Bar dataKey="tickets" fill="#ff5321" radius={[2, 2, 0, 0]} maxBarSize={48} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <section className="card p-5">
        <h2 className="eyebrow text-fg">Recent check-ins</h2>
        {stats.recentCheckins.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nobody has checked in yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm">
            {stats.recentCheckins.map((c) => (
              <li key={c.label + c.checkedInAt} className="flex justify-between py-2">
                <span><strong className="font-mono">{c.label}</strong> <span className="text-muted">· {c.attendee}</span></span><span className="font-mono text-xs text-muted">{time(c.checkedInAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CheckIn({ eventId, disabled }) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (qr) => {
    if (!qr.trim() || busy) return;
    setBusy(true);
    try {
      const { checkin } = await api(`/events/${eventId}/checkin`, { method: 'POST', body: { qr } });
      setResult({ ok: true, at: Date.now(), ...checkin });
      setCode('');
    } catch (err) {
      setResult({ ok: false, at: Date.now(), title: CHECKIN_MESSAGES[err.code] ?? 'Could not check in', message: err.message, details: err.details });
    } finally {
      setBusy(false);
    }
  };

  if (disabled) return <EmptyState icon={XOctagon} title="Event cancelled">Check-in is disabled for cancelled events.</EmptyState>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card p-5">
        <h2 className="eyebrow mb-5 text-fg">Scan ticket QR</h2>
        <QrScanner onScan={submit} paused={busy} />
        <form className="mt-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(code); }}>
          <label className="sr-only" htmlFor="code">Ticket code</label>
          <input id="code" className="input font-mono" placeholder="Or paste a ticket code: SL1.…" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn-secondary whitespace-nowrap" disabled={busy || !code.trim()}>{busy ? <Spinner className="h-4 w-4" /> : 'Check in'}</button>
        </form>
      </section>
      <section aria-live="assertive">
        {!result ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center border border-dashed border-line-strong p-8 text-center"><p className="eyebrow">Waiting for scan</p><p className="mt-2 text-sm text-muted">The result shows up here, big enough to read from the door.</p></div>
        ) : (
          <CheckinResult result={result} className="h-full min-h-64 animate-rise" />
        )}
      </section>
    </div>
  );
}

function Guests({ eventId }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim());
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api(`/events/${eventId}/attendees${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`, { signal: ctrl.signal })
      .then((d) => { setItems(d.items); setError(null); })
      .catch((err) => err.name !== 'AbortError' && setError(err));
    return () => ctrl.abort();
  }, [eventId, debounced]);

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="relative block w-full max-w-sm">
          <span className="sr-only">Search guests</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
          <input className="input pl-9" placeholder="Search name, email or seat" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <a href={`/api/events/${eventId}/attendees.csv`} download className="btn-secondary">
          <Download className="h-4 w-4" aria-hidden /> Export CSV
        </a>
      </div>
      {error ? <ErrorState error={error} /> : !items ? <PageLoader /> : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{debounced ? 'No guests match that search.' : 'No tickets sold yet.'}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm [&_td:not(:last-child)]:pr-4 [&_th:not(:last-child)]:pr-4">
            <thead className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
              <tr><th className="pb-2 font-medium">Seat</th><th className="pb-2 font-medium">Guest</th><th className="pb-2 font-medium">Tier</th><th className="pb-2 font-medium">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((t) => (
                <tr key={t._id}>
                  <td className="py-3 font-mono font-semibold">{t.label}</td>
                  <td className="py-3">{t.user?.name}<div className="text-xs text-muted">{t.user?.email}</div></td>
                  <td className="py-3 text-muted">{t.tier}</td>
                  <td className="py-3">{t.checkedInAt ? <Badge status="used">In at {time(t.checkedInAt)}</Badge> : <Badge status="draft">Not arrived</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const discountLabel = (p) => (p.kind === 'percent' ? `${p.value}% off` : `${money(p.value)} off`);

function Promos({ eventId, event }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const blank = { code: '', kind: 'percent', value: 10, maxUses: '', expiresAt: '' };
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api(`/events/${eventId}/promos`).then((d) => { setItems(d.items); setError(null); }).catch(setError);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api(`/events/${eventId}/promos`, {
        method: 'POST',
        body: {
          code: form.code,
          kind: form.kind,
          value: Number(form.value),
          maxUses: form.maxUses === '' ? null : Number(form.maxUses),
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        },
      });
      toast.success(`${form.code.toUpperCase()} created`);
      setForm(blank);
      load();
    } catch (err) {
      setFormError(err);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (p) => {
    try {
      await api(`/events/${eventId}/promos/${p._id}`, { method: 'PATCH', body: { active: !p.active } });
      load();
    } catch (err) { toast.error(err.message); }
  };
  const remove = async (p) => {
    try {
      await api(`/events/${eventId}/promos/${p._id}`, { method: 'DELETE' });
      toast.success(`${p.code} deleted`);
      load();
    } catch (err) { toast.error(err.message); }
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!items) return <PageLoader />;
  const fe = formError?.fieldErrors ?? {};
  const closed = event.status === 'cancelled';

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr] [&>*]:min-w-0">
      <form onSubmit={create} noValidate className="card space-y-4 self-start p-5">
        <h2 className="eyebrow text-fg">New code</h2>
        <div>
          <label className="label" htmlFor="promo-code">Code</label>
          <input id="promo-code" className={`input font-mono uppercase ${fe.code ? 'input-error' : ''}`} value={form.code} maxLength={24} placeholder="EARLYBIRD" onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <FieldError message={fe.code} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="promo-kind">Type</label>
            <select id="promo-kind" className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="percent">% off</option>
              <option value="flat">₹ off</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="promo-value">{form.kind === 'percent' ? 'Percent' : 'Rupees'}</label>
            <input id="promo-value" type="number" min={1} max={form.kind === 'percent' ? 100 : 100000} className={`input font-mono ${fe.value ? 'input-error' : ''}`} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          </div>
        </div>
        <FieldError message={fe.value} />
        <div>
          <label className="label" htmlFor="promo-max">Usage limit <span className="normal-case tracking-normal text-faint">(blank = unlimited)</span></label>
          <input id="promo-max" type="number" min={1} className={`input font-mono ${fe.maxUses ? 'input-error' : ''}`} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} />
          <FieldError message={fe.maxUses} />
        </div>
        <div>
          <label className="label" htmlFor="promo-exp">Expires <span className="normal-case tracking-normal text-faint">(optional)</span></label>
          <input id="promo-exp" type="datetime-local" className={`input ${fe.expiresAt ? 'input-error' : ''}`} value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          <FieldError message={fe.expiresAt} />
        </div>
        {formError && !Object.keys(fe).length && <p className="text-sm text-stop" role="alert">{formError.message}</p>}
        <button className="btn-primary w-full" disabled={busy || closed || !form.code.trim()}>{busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" aria-hidden />} Create code</button>
      </form>

      <section className="card p-5">
        <h2 className="eyebrow text-fg">Codes for this event</h2>
        <p className="mt-1 text-xs text-muted">Each code works for every showtime of this event.</p>
        {items.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">No codes yet. Buyers enter them at checkout.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[30rem] whitespace-nowrap text-sm [&_td:not(:last-child)]:pr-4 [&_th:not(:last-child)]:pr-4">
              <thead className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                <tr><th className="pb-2 font-medium">Code</th><th className="pb-2 font-medium">Discount</th><th className="pb-2 font-medium">Used</th><th className="pb-2 font-medium">Expires</th><th className="pb-2" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((p) => {
                  const expired = p.expiresAt && new Date(p.expiresAt) <= new Date();
                  return (
                    <tr key={p._id} className={p.active && !expired ? '' : 'text-faint'}>
                      <td className="py-3 font-mono font-semibold">{p.code}{!p.active && <span className="ml-2 font-normal text-faint">off</span>}</td>
                      <td className="py-3">{discountLabel(p)}</td>
                      <td className="py-3 font-mono tabular">{p.uses}{p.maxUses ? ` / ${p.maxUses}` : ''}</td>
                      <td className="py-3 font-mono text-xs">{p.expiresAt ? (expired ? 'Expired' : shortDate(p.expiresAt)) : '—'}</td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => toggle(p)} title={p.active ? 'Switch off' : 'Switch on'}>
                            <Power className="h-3.5 w-3.5" aria-hidden /> {p.active ? 'Off' : 'On'}
                          </button>
                          {p.uses === 0 && (
                            <button type="button" className="btn-ghost px-2 py-1 text-stop hover:text-stop" onClick={() => remove(p)} aria-label={`Delete ${p.code}`}>
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// Food & merch menu for one show. Price is fixed once created; sold items can
// only be switched off.
function Addons({ eventId, event }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const blank = { name: '', description: '', kind: 'food', price: 150, stock: '', maxPerOrder: 10 };
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api(`/events/${eventId}/addons`).then((d) => { setItems(d.items); setError(null); }).catch(setError);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api(`/events/${eventId}/addons`, {
        method: 'POST',
        body: { ...form, price: Number(form.price), maxPerOrder: Number(form.maxPerOrder), stock: form.stock === '' ? null : Number(form.stock) },
      });
      toast.success(`${form.name} added`);
      setForm(blank);
      load();
    } catch (err) {
      setFormError(err);
    } finally {
      setBusy(false);
    }
  };
  const patch = async (a, body) => {
    try {
      await api(`/events/${eventId}/addons/${a._id}`, { method: 'PATCH', body });
      load();
    } catch (err) { toast.error(err.message); }
  };
  const remove = async (a) => {
    try {
      await api(`/events/${eventId}/addons/${a._id}`, { method: 'DELETE' });
      load();
    } catch (err) { toast.error(err.message); }
  };

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!items) return <PageLoader />;
  const fe = formError?.fieldErrors ?? {};

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr] [&>*]:min-w-0">
      <form onSubmit={create} noValidate className="card space-y-4 self-start p-5">
        <h2 className="eyebrow text-fg">New add-on</h2>
        <div>
          <label className="label" htmlFor="ad-name">Name</label>
          <input id="ad-name" className={`input ${fe.name ? 'input-error' : ''}`} maxLength={60} placeholder="Popcorn combo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <FieldError message={fe.name} />
        </div>
        <div>
          <label className="label" htmlFor="ad-desc">Description <span className="normal-case tracking-normal text-faint">(optional)</span></label>
          <input id="ad-desc" className="input" maxLength={200} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="ad-kind">Type</label>
            <select id="ad-kind" className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="food">Food &amp; drink</option>
              <option value="merch">Merch</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ad-price">Price (₹)</label>
            <input id="ad-price" type="number" min={1} className={`input font-mono ${fe.price ? 'input-error' : ''}`} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </div>
        </div>
        <FieldError message={fe.price} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="ad-stock">Stock</label>
            <input id="ad-stock" type="number" min={1} placeholder="Unlimited" className={`input font-mono ${fe.stock ? 'input-error' : ''}`} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="ad-max">Max / order</label>
            <input id="ad-max" type="number" min={1} max={20} className="input font-mono" value={form.maxPerOrder} onChange={(e) => setForm({ ...form, maxPerOrder: e.target.value })} />
          </div>
        </div>
        <FieldError message={fe.stock} />
        {formError && !Object.keys(fe).length && <p className="text-sm text-stop" role="alert">{formError.message}</p>}
        <button className="btn-primary w-full" disabled={busy || event.status === 'cancelled' || !form.name.trim()}>{busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" aria-hidden />} Add to menu</button>
      </form>

      <section className="card p-5">
        <h2 className="eyebrow text-fg">Menu for this showtime</h2>
        <p className="mt-1 text-xs text-muted">Buyers add these at checkout and collect them at the venue. New showtimes copy this menu.</p>
        {items.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">No add-ons yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {items.map((a) => {
              const Icon = a.kind === 'merch' ? Shirt : Popcorn;
              const soldOut = a.stock != null && a.sold >= a.stock;
              return (
                <li key={a._id} className={`flex flex-wrap items-center gap-4 py-3 ${a.active ? '' : 'opacity-50'}`}>
                  <Icon className="h-5 w-5 text-faint" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg">{a.name}{!a.active && <span className="ml-2 font-mono text-[10px] uppercase text-faint">off</span>}</p>
                    <p className="font-mono text-[11px] text-muted">
                      {amount(a.price)} · {a.sold} sold{a.stock != null ? ` / ${a.stock}` : ''}{soldOut ? ' · sold out' : ''} · {amount(a.sold * a.price)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {a.stock != null && (
                      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => patch(a, { stock: a.stock + 10 })} title="Add 10 to stock">+10 stock</button>
                    )}
                    <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => patch(a, { active: !a.active })}>
                      <Power className="h-3.5 w-3.5" aria-hidden /> {a.active ? 'Off' : 'On'}
                    </button>
                    {a.sold === 0 && (
                      <button type="button" className="btn-ghost px-2 py-1 text-stop hover:text-stop" onClick={() => remove(a)} aria-label={`Delete ${a.name}`}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
