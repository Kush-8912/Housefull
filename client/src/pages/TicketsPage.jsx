import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarPlus, CheckCircle2, ChevronDown, ClipboardList, Gift, MapPin, Popcorn, ShieldQuestion, Star, Ticket } from 'lucide-react';
import { api } from '../lib/api';
import { amount, byLabel, dateTime, dayMonth, plural } from '../lib/format';
import { TicketCard } from '../components/TicketCard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { downloadIcs } from '../lib/calendar';
import { Badge, EmptyState, ErrorState, FieldError, PageLoader } from '../components/States';
import { Mask, Scramble } from '../components/Motion';
import { confetti } from '../lib/confetti';
import { policyOf } from '../lib/refundPolicy';
import { useTicketCheckins } from '../hooks/useTicketCheckins';

// What the cancellation rules mean for this order right now, in a sentence.
// `c` is the server's quote (see server/src/services/refundPolicy.js).
function cancellationNote(c, event) {
  if (c.allowed) {
    const now = c.rescheduled
      ? `The show moved, so you can cancel for a full refund of your tickets until ${dateTime(c.until)}.`
      : `Cancel now and get ${c.percent}% of the ticket price back.`;
    const later = c.rescheduled ? '' : c.next ? ` It drops to ${c.next.percent}% after ${dateTime(c.until)}.` : ` Last chance: ${dateTime(c.until)}.`;
    return `${now}${later}`;
  }
  if (c.reason === 'NO_REFUNDS') return `${policyOf(event).label}: this event doesn’t allow cancellations.`;
  if (c.reason === 'CLOSED') return `Cancellation closed ${dateTime(c.closesAt)}. There are no cancellations on the day of the show.`;
  if (c.reason === 'CHECKED_IN') return 'These tickets have been used at the door, so they can’t be cancelled.';
  if (c.reason === 'TRANSFERRED') return 'You sent a ticket from this order to someone, so it can’t be cancelled.';
  return null;
}

function OrderCard({ order, onCancelled, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const event = order.event;
  const past = new Date(event.startsAt) < new Date();
  const c = order.cancellation ?? { allowed: false };
  const note = !past && order.status === 'paid' ? cancellationNote(c, event) : null;
  const fee = (order.bookingFee ?? 0) + (order.gst ?? 0);

  const cancel = async () => {
    setBusy(true);
    try {
      const { order: updated } = await api(`/orders/${order._id}/cancel`, { method: 'POST' });
      toast.success(updated.refundedAmount ? `Order cancelled. ${amount(updated.refundedAmount)} refunded to card ••${updated.payment.last4}` : 'Order cancelled');
      setConfirming(false);
      onCancelled();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const status = event.status === 'cancelled' && order.status === 'refunded' ? 'refunded' : past && order.status === 'paid' ? 'ended' : order.status;

  const { day, month } = dayMonth(event.startsAt);

  return (
    <article className={`overflow-hidden border bg-ink-900 transition-colors ${open ? 'border-line-strong' : 'border-line hover:border-line-strong'}`}>
      <button type="button" className="flex w-full items-stretch text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className={`flex w-20 shrink-0 flex-col items-center justify-center border-r border-dashed border-line-strong py-4 sm:w-24 ${past ? 'text-faint' : 'text-signal'}`}>
          <span className="display text-4xl leading-none">{day}</span>
          <span className="mt-1 font-mono text-[10px] font-semibold tracking-[0.16em]">{month}</span>
        </div>
        <div className="min-w-0 flex-1 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="display text-2xl sm:text-[28px]">{event.title}</h2>
            <Badge status={status} />
            {event.status === 'cancelled' && <Badge status="cancelled">event cancelled</Badge>}
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>{dateTime(event.startsAt)}</span>
            <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{event.venue.name}</span>
          </p>
          <p className="mt-1.5 font-mono text-xs text-fg/80">{order.items.map((i) => i.label).join(' · ')} <span className="text-faint">/</span> {amount(order.amount)}</p>
        </div>
        <span className="flex items-center pr-4 sm:pr-5">
          <ChevronDown className={`h-5 w-5 shrink-0 text-faint transition-transform ${open ? 'rotate-180 text-fg' : ''}`} aria-hidden />
        </span>
      </button>
      {open && (
        <div className="origin-top animate-[menu-drop_0.35s_cubic-bezier(0.2,0.7,0.2,1)] border-t border-line bg-ink px-4 py-6 sm:px-6">
          <TicketGrid tickets={order.tickets} event={event} onChanged={onCancelled} />
          <OrderExtras order={order} />
          {note && (
            <p className={`mt-6 flex items-start gap-2 border-l-2 px-3 py-2 text-sm ${c.allowed ? 'border-go bg-go/5 text-fg' : 'border-line-strong bg-ink-900 text-muted'}`}>
              <ShieldQuestion className={`mt-0.5 h-4 w-4 shrink-0 ${c.allowed ? 'text-go' : 'text-faint'}`} aria-hidden />
              <span>{note}</span>
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-faint">
              Order #{order._id.slice(-8).toUpperCase()}
              {order.payment?.last4 && ` · card ••${order.payment.last4}`}
              {order.refundedAmount > 0 && ` · ${amount(order.refundedAmount)} refunded`}
            </span>
            <div className="flex gap-2">
              {!past && event.status === 'published' && (
                <button type="button" className="btn-ghost" onClick={() => downloadIcs(event)}><CalendarPlus className="h-4 w-4" aria-hidden /> Calendar</button>
              )}
              {order.feedback?.form && order.tickets.some((t) => t.checkedInAt) && (
                <Link to={`/events/${event._id}/feedback`} className={order.feedback.answered ? 'btn-ghost' : 'btn-primary'}>
                  <ClipboardList className="h-4 w-4" aria-hidden /> {order.feedback.answered ? 'See how everyone answered' : 'Give feedback'}
                </Link>
              )}
              {past && order.tickets.some((t) => t.checkedInAt) && (
                <Link to={`/events/${event._id}#reviews`} className="btn-ghost"><Star className="h-4 w-4 text-warn" aria-hidden /> Rate</Link>
              )}
              <Link to={`/events/${event._id}`} className="btn-ghost">View event</Link>
              {c.allowed && (
                <button type="button" className="btn-secondary border-stop/50 text-stop hover:border-stop hover:bg-stop/10" onClick={() => setConfirming(true)}>
                  Cancel{c.refund > 0 ? ` · get ${amount(c.refund)} back` : ''}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog open={confirming} title="Cancel this order?" confirmLabel="Cancel order" cancelLabel="Keep tickets" danger busy={busy} onConfirm={cancel} onClose={() => setConfirming(false)}>
        All {plural(order.tickets.length, 'ticket')} will be voided{c.refund > 0
          ? <> and <strong className="text-fg">{amount(c.refund)}</strong> refunded to {order.payment?.last4 ? `card ••${order.payment.last4}` : 'your card'} ({c.percent}% of the ticket price)</>
          : ''}.
        {fee > 0 && ` The ${amount(fee)} booking fee (incl. GST) isn’t refundable.`} Your seats go back on sale immediately.
      </ConfirmDialog>
    </article>
  );
}

// Add-ons to collect, and the fee breakdown, under an order's tickets.
function OrderExtras({ order }) {
  if (!order.addons?.length && !order.bookingFee && !order.discount) return null;
  return (
    <div className="mt-6 grid gap-4 border border-line bg-ink-900 px-4 py-4 sm:grid-cols-2">
      {order.addons?.length > 0 && (
        <div>
          <p className="eyebrow flex items-center gap-2"><Popcorn className="h-3.5 w-3.5 text-signal" aria-hidden /> Add-ons to collect</p>
          <ul className="mt-2 space-y-1 text-sm text-fg">
            {order.addons.map((a) => <li key={String(a.addon)}>{a.name} <span className="font-mono text-muted">× {a.qty}</span></li>)}
          </ul>
          <p className="mt-2 text-xs text-muted">Show order #{order._id.slice(-8).toUpperCase()} at the venue counter.</p>
        </div>
      )}
      <dl className="space-y-1 font-mono text-xs text-muted sm:col-start-2">
        {[
          ['Tickets', order.subtotal],
          order.discount > 0 && [`Promo ${order.promo?.code ?? ''}`, -order.discount],
          order.addonsTotal > 0 && ['Add-ons', order.addonsTotal],
          order.bookingFee > 0 && ['Booking fee', order.bookingFee],
          order.gst > 0 && ['GST on fee (18%)', order.gst],
        ].filter(Boolean).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3"><dt>{k}</dt><dd>{v < 0 ? `−${amount(-v)}` : amount(v ?? 0)}</dd></div>
        ))}
        <div className="flex justify-between gap-3 border-t border-line pt-1 text-fg"><dt>Paid</dt><dd>{amount(order.amount)}</dd></div>
      </dl>
    </div>
  );
}

const canSend = (ticket, event) =>
  ticket.status === 'valid' && !ticket.checkedInAt && event.status === 'published' && new Date(event.startsAt) > new Date();

// Tickets for one event, with a "send to a friend" dialog.
function TicketGrid({ tickets, event, onChanged }) {
  const [sending, setSending] = useState(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const open = (t) => { setSending(t); setEmail(''); setError(null); };
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/tickets/${sending._id}/transfer`, { method: 'POST', body: { email } });
      toast.success(`Seat ${sending.label} sent to ${res.recipient.name}`);
      setSending(null);
      onChanged();
    } catch (err) {
      setError(err.fieldErrors?.email ?? err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="grid gap-5 min-[540px]:grid-cols-2 lg:grid-cols-3">
        {tickets.toSorted(byLabel).map((t, i) => (
          <TicketCard key={t._id} ticket={t} eventTitle={event.title} index={i} onTransfer={canSend(t, event) ? open : undefined} />
        ))}
      </div>
      <ConfirmDialog
        open={Boolean(sending)}
        title={`Send seat ${sending?.label ?? ''}`}
        confirmLabel="Send ticket"
        busy={busy}
        onConfirm={send}
        onClose={() => setSending(null)}
      >
        <p>They need a Housefull attendee account. Your QR code for this seat stops working and they get a new one. Refunds still go to you if the event is cancelled.</p>
        <form className="mt-5" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <label className="label" htmlFor="transfer-email">Their email</label>
          <input id="transfer-email" type="email" autoComplete="off" className={`input ${error ? 'input-error' : ''}`} value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} placeholder="friend@example.com" />
          <FieldError message={error} />
        </form>
      </ConfirmDialog>
    </>
  );
}

function Received({ groups, onChange }) {
  return (
    <section className="mt-12">
      <h2 className="eyebrow mb-4 flex items-center gap-3"><Gift className="h-3.5 w-3.5 text-signal" aria-hidden /> Sent to you <span className="text-faint">{groups.length}</span><span className="h-px flex-1 bg-line" /></h2>
      <div className="space-y-3">
        {groups.map(({ event, tickets }) => (
          <article key={event._id} className="border border-line bg-ink-900">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4">
              <div>
                <h3 className="display text-2xl sm:text-[28px]">{event.title}</h3>
                <p className="mt-1 text-sm text-muted">{dateTime(event.startsAt)} · {event.venue.name}</p>
              </div>
              {event.status === 'cancelled' && <Badge status="cancelled">event cancelled</Badge>}
            </div>
            <div className="border-t border-line bg-ink px-4 py-6 sm:px-6">
              <TicketGrid tickets={tickets} event={event} onChanged={onChange} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function TicketsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api('/orders').then((d) => { setData(d); setError(null); }).catch(setError);
  }, []);
  useEffect(() => { load(); }, [load]);
  useTicketCheckins(load);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <PageLoader label="Loading your tickets" />;

  const now = new Date();
  const upcoming = data.items.filter((o) => new Date(o.event.startsAt) >= now);
  const past = data.items.filter((o) => new Date(o.event.startsAt) < now);

  return (
    <div className="mx-auto max-w-4xl">
      <p className="eyebrow">Your wallet</p>
      <h1 className="display mt-3 text-6xl sm:text-7xl"><Scramble text="My tickets" /></h1>
      <p className="mt-4 max-w-lg text-sm text-muted">Show the QR code at the door. Each order shows what you&apos;d get back if you cancelled, by that event&apos;s cancellation policy.</p>
      {data.received.length > 0 && <Received groups={data.received} onChange={load} />}
      {data.items.length === 0 && data.received.length === 0 ? (
        <div className="mt-10">
          <EmptyState icon={Ticket} title="No tickets yet" action={<Link to="/" className="btn-primary">Browse events</Link>}>
            When you book seats they&apos;ll show up here with their QR codes.
          </EmptyState>
        </div>
      ) : (
        <>
          <Section title="Upcoming" orders={upcoming} onChange={load} openFirst />
          <Section title="Past" orders={past} onChange={load} />
        </>
      )}
    </div>
  );
}

function Section({ title, orders, onChange, openFirst }) {
  if (!orders.length) return null;
  return (
    <section className="mt-12">
      <h2 className="eyebrow mb-4 flex items-center gap-3">{title} <span className="text-faint">{orders.length}</span><span className="h-px flex-1 bg-line" /></h2>
      <div className="space-y-3">
        {orders.map((o, i) => (
          <div key={o._id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}>
            <OrderCard order={o} onCancelled={onChange} defaultOpen={openFirst && i === 0} />
          </div>
        ))}
      </div>
    </section>
  );
}

// Confirmation page right after checkout.
export function OrderPage() {
  const { id } = useParams();
  const { state } = useLocation();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => { api(`/orders/${id}`).then(setData).catch(setError); }, [id]);
  useEffect(() => { load(); }, [load]);
  useTicketCheckins(load);
  // Fresh from checkout: throw some confetti once the tickets are on screen.
  const loaded = Boolean(data);
  useEffect(() => {
    if (!loaded || !state?.celebrate) return undefined;
    return confetti();
  }, [loaded, state]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <PageLoader />;
  const { order, tickets } = data;

  return (
    <div className="mx-auto max-w-4xl">
      <p className="eyebrow flex items-center gap-2 text-go"><CheckCircle2 className="h-4 w-4" aria-hidden /> Order confirmed</p>
      <h1 className="display mt-4 text-[clamp(3.5rem,11vw,8rem)]">
        <Mask delay={80}>You&apos;re</Mask> <Mask delay={220}><span className="animate-flicker text-signal [animation-delay:1.5s]">in.</span></Mask>
      </h1>
      <p className="mt-3 font-mono text-xs uppercase tracking-[0.14em] text-muted">You got in before it went housefull.</p>
      <p className="mt-5 text-lg text-fg">{order.event.title}</p>
      <p className="mt-1 text-sm text-muted">{dateTime(order.event.startsAt)} · {order.event.venue.name}, {order.event.venue.city}</p>
      <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.1em] text-faint">
        {amount(order.amount)}{order.payment?.last4 ? ` charged to card ••${order.payment.last4}` : ''} · Order #{order._id.slice(-8).toUpperCase()}
      </p>
      <OrderExtras order={order} />
      <div className="mt-10 grid gap-5 min-[540px]:grid-cols-2 lg:grid-cols-3">
        {tickets.toSorted(byLabel).map((t, i) => <TicketCard key={t._id} ticket={t} eventTitle={order.event.title} index={i} printed />)}
      </div>
      <div className="mt-10 flex flex-wrap gap-2 border-t border-line pt-6">
        <Link to="/tickets" className="btn-primary">All my tickets</Link>
        <Link to="/" className="btn-secondary">Browse more events</Link>
      </div>
    </div>
  );
}
