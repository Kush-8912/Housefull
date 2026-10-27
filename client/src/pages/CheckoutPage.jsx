import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CreditCard, Lock, Minus, Plus, Popcorn, Shirt, Tag, TimerOff, X } from 'lucide-react';
import { api } from '../lib/api';
import { amount, dateTime, money } from '../lib/format';
import { BillLines } from '../components/BillLines';
import { mmss, useCountdown } from '../hooks/useCountdown';
import { ErrorState, FieldError, Notice, PageLoader, Spinner } from '../components/States';
import { Scramble } from '../components/Motion';
import { POLICY_SMALL_PRINT, policyOf } from '../lib/refundPolicy';

const TEST_CARDS = [
  ['4242 4242 4242 4242', 'Succeeds'],
  ['4000 0000 0000 0002', 'Declined'],
  ['4000 0000 0000 9995', 'Insufficient funds'],
  ['4000 0000 0000 0119', 'Gateway error'],
];

const newKey = () => crypto.randomUUID();

export function CheckoutPage() {
  const { holdId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [card, setCard] = useState({ number: '', exp: '', cvc: '', name: '' });
  const [payError, setPayError] = useState(null);
  const [busy, setBusy] = useState(false);
  // The same key is reused if a request fails in transit (so a retry can never
  // double-charge) and replaced after a definitive answer from the server.
  const keyRef = useRef(newKey());

  const load = useCallback(async () => {
    try {
      setData(await api(`/holds/${holdId}`));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [holdId]);
  useEffect(() => { load(); }, [load]);

  const left = useCountdown(data?.hold.expiresAt);
  const expired = data && (data.hold.status !== 'active' || left === 0);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <PageLoader label="Loading your seats…" />;

  if (data.hold.status === 'converted') {
    return (
      <ErrorState title="Already purchased" error={{ message: 'These seats have already been paid for.' }} />
    );
  }

  if (expired) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <TimerOff className="h-8 w-8 text-warn" aria-hidden />
        <p className="eyebrow mt-6">Hold expired · 00:00</p>
        <h1 className="display mt-3 text-6xl">Time&apos;s up.</h1>
        <p className="mt-4 text-muted">We released your seats so other people could book them. They may still be free.</p>
        <Link to={`/events/${data.hold.event}`} className="btn-primary mt-8">Pick seats again</Link>
      </div>
    );
  }

  const free = data.total === 0;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setPayError(null);
    const [mm, yy] = card.exp.split('/').map((s) => s.trim());
    const body = free ? {} : {
      card: { number: card.number, expMonth: Number(mm), expYear: 2000 + Number(yy), cvc: card.cvc, name: card.name },
    };
    try {
      const res = await api(`/holds/${holdId}/checkout`, { method: 'POST', body, headers: { 'Idempotency-Key': keyRef.current } });
      toast.success('Payment successful — your tickets are ready!');
      navigate(`/orders/${res.order._id}`, { replace: true, state: { celebrate: true } });
    } catch (err) {
      if (err.code !== 'NETWORK' && err.status < 500) keyRef.current = newKey();
      if (err.code === 'HOLD_EXPIRED') { load(); return; }
      if (err.code?.startsWith('PROMO_')) load(); // refresh the price shown
      setPayError(err);
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    try {
      await api(`/holds/${holdId}`, { method: 'DELETE' });
    } catch { /* already released or expired: either way, go back */ }
    navigate(`/events/${data.hold.event}`);
  };

  const fe = payError?.fieldErrors ?? {};
  const urgent = left < 60;
  const created = data.hold.createdAt ? new Date(data.hold.createdAt).getTime() : null;
  const span = created ? (new Date(data.hold.expiresAt).getTime() - created) / 1000 : 0;
  const remaining = span > 0 ? Math.min(1, Math.max(0, left / span)) : null;

  return (
    <div className="mx-auto max-w-5xl">
      <p className="eyebrow">Checkout · step 2 of 2</p>
      <h1 className="display mt-3 text-6xl sm:text-7xl"><Scramble text="Pay & go." /></h1>

      <div className="mt-10 grid gap-10 md:grid-cols-[1fr_21rem]">
        <form onSubmit={submit} noValidate className="order-2 md:order-1">
          <div className={`flex items-center justify-between gap-4 border px-5 py-4 transition-colors ${urgent ? 'animate-shake border-stop bg-stop/10' : 'border-line bg-ink-900'}`} role="timer" aria-live={urgent ? 'assertive' : 'off'}>
            <div>
              <p className="eyebrow">Seats held for</p>
              <p className="mt-1 text-sm text-muted">{urgent ? 'Hurry. Your seats are released at zero.' : 'Nobody else can book them until then.'}</p>
            </div>
            <p className={`font-mono text-4xl font-semibold tabular ${urgent ? 'animate-heartbeat text-stop' : 'text-fg'}`}>
              <span className="sr-only">{mmss(left)}</span>
              {/* Each digit drops in when it changes, like a departures board. */}
              {[...mmss(left)].map((ch, i) => <span key={`${i}${ch}`} className="inline-block animate-tick" aria-hidden>{ch}</span>)}
            </p>
          </div>
          {remaining !== null && (
            <div className="h-0.5 bg-line" aria-hidden>
              <div className={`h-full transition-[width] duration-1000 ease-linear ${urgent ? 'bg-stop' : 'bg-signal'}`} style={{ width: `${remaining * 100}%` }} />
            </div>
          )}

          <h2 className="mt-10 flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-fg">
            <CreditCard className="h-4 w-4 text-signal" aria-hidden /> Payment
          </h2>
          {free ? (
            <p className="mt-4 text-sm text-muted">This event is free. Confirm to get your tickets.</p>
          ) : (
            <div className="mt-5 space-y-5">
              <div>
                <label className="label" htmlFor="cc-name">Name on card</label>
                <input id="cc-name" className={`input ${fe['card.name'] ? 'input-error' : ''}`} autoComplete="cc-name" value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} />
                <FieldError message={fe['card.name']} />
              </div>
              <div>
                <label className="label" htmlFor="cc-number">Card number</label>
                <input id="cc-number" inputMode="numeric" autoComplete="cc-number" placeholder="4242 4242 4242 4242" className={`input font-mono tracking-wider ${fe['card.number'] ? 'input-error' : ''}`}
                  value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value.replace(/[^\d ]/g, '').slice(0, 23) })} />
                <FieldError message={fe['card.number']} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="cc-exp">Expiry</label>
                  <input id="cc-exp" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" className={`input font-mono ${fe['card.expMonth'] || fe['card.expYear'] ? 'input-error' : ''}`}
                    value={card.exp} onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                      setCard({ ...card, exp: digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits });
                    }} />
                  <FieldError message={fe['card.expMonth'] || fe['card.expYear']} />
                </div>
                <div>
                  <label className="label" htmlFor="cc-cvc">CVC</label>
                  <input id="cc-cvc" inputMode="numeric" autoComplete="cc-csc" placeholder="123" className={`input font-mono ${fe['card.cvc'] ? 'input-error' : ''}`}
                    value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
                  <FieldError message={fe['card.cvc']} />
                </div>
              </div>
              <details className="group border border-dashed border-line-strong px-4 py-3 text-xs text-muted">
                <summary className="cursor-pointer list-none font-mono font-medium uppercase tracking-[0.12em] text-fg [&::-webkit-details-marker]:hidden">
                  <span className="text-signal">+</span> Demo test cards <span className="text-faint normal-case tracking-normal">(any future expiry, any CVC)</span>
                </summary>
                <ul className="mt-3 space-y-1.5">
                  {TEST_CARDS.map(([n, label]) => (
                    <li key={n} className="flex items-center justify-between gap-3">
                      <button type="button" className="font-mono text-fg underline decoration-line-strong underline-offset-4 hover:text-signal hover:decoration-signal" onClick={() => setCard({ number: n, exp: '12/30', cvc: '123', name: card.name || 'Demo Buyer' })}>{n}</button>
                      <span className="font-mono uppercase tracking-[0.08em] text-faint">{label}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          {data.menu?.length > 0 && (
            <AddonMenu holdId={holdId} menu={data.menu} chosen={data.addons} error={data.addonsError} onChange={(quote) => setData((d) => ({ ...d, ...quote }))} disabled={busy} />
          )}

          <PromoField holdId={holdId} quote={data} onChange={(quote) => setData((d) => ({ ...d, ...quote }))} onRemoved={load} disabled={busy} />

          {payError && !Object.keys(fe).length && (
            <Notice tone="stop" className="mt-6">
              <span role="alert">
                {payError.message}
                {payError.code === 'PAYMENT_FAILED' && `${payError.message.endsWith('.') ? '' : '.'} Your seats are still held, so you can try another card.`}
              </span>
            </Notice>
          )}

          <button className={`btn-primary mt-8 w-full py-4 text-base ${busy ? '' : 'animate-glow'}`} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : <Lock className="h-4 w-4" aria-hidden />}
            {busy ? 'Processing…' : free ? 'Confirm free tickets' : `Pay ${money(data.total)}`}
          </button>
          <button type="button" className="btn-ghost mt-2 w-full" onClick={release} disabled={busy}>Cancel and release seats</button>
        </form>

        <aside className="order-1 md:order-2">
          <div className="notch-b animate-print bg-paper px-6 pb-6 pt-5 text-paper-ink md:sticky md:top-24">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-paper-ink/60">Order summary</p>
            <h2 className="display mt-3 text-3xl">{data.event.title}</h2>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.06em] text-paper-ink/70">{dateTime(data.event.startsAt)}<br />{data.event.venue.name}</p>
            <ul className="mt-5 border-t-2 border-dashed border-paper-line font-mono text-sm">
              {data.seats.map((s, i) => (
                <li key={s._id} className="flex animate-rise justify-between border-b border-paper-line/70 py-2" style={{ animationDelay: `${450 + i * 80}ms` }}>
                  <span><strong>{s.label}</strong> <span className="text-paper-ink/60">{s.tier}</span></span>
                  <span>{money(s.price)}</span>
                </li>
              ))}
            </ul>
            <BillLines bill={data} promoCode={data.promo && !data.promo.error ? data.promo.code : null} />
            <div className="mt-4 flex items-baseline justify-between">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em]">Total</span>
              <span key={data.total} className="display inline-block animate-pop text-4xl">{money(data.total)}</span>
            </div>
            <p className="mt-4 border-t border-dashed border-paper-line pt-3 text-xs text-paper-ink/70">
              <strong className="font-mono font-semibold uppercase tracking-[0.1em] text-paper-ink">Cancellation · {policyOf(data.event).label}.</strong> {policyOf(data.event).summary} {POLICY_SMALL_PRINT}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PromoField({ holdId, quote, onChange, onRemoved, disabled }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const applied = quote.promo && !quote.promo.error ? quote.promo : null;

  const apply = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await api(`/holds/${holdId}/promo`, { method: 'POST', body: { code } }));
      setCode('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/holds/${holdId}/promo`, { method: 'DELETE' });
      onRemoved(); // re-price: the fee depends on the discount
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (applied) {
    return (
      <div className="mt-6 flex animate-pop items-center justify-between gap-3 border border-go/40 bg-go/10 px-4 py-3">
        <span className="flex items-center gap-2 text-sm text-fg">
          <Tag className="h-4 w-4 text-go" aria-hidden />
          <span className="font-mono font-semibold">{applied.code}</span>
          <span className="text-muted">−{amount(quote.discount)}{applied.kind === 'percent' ? ` (${applied.value}% off)` : ''}</span>
        </span>
        <button type="button" className="btn-ghost px-2 py-1" onClick={remove} disabled={busy || disabled} aria-label={`Remove promo code ${applied.code}`}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  }

  // A form can't be nested in the payment form, so this is a group with its own submit.
  return (
    <div className="mt-6">
      <label className="label" htmlFor="promo">Promo code</label>
      <div className="flex gap-2">
        <input
          id="promo"
          className={`input font-mono uppercase ${error ? 'input-error' : ''}`}
          placeholder="Optional"
          autoComplete="off"
          value={code}
          maxLength={24}
          onChange={(e) => { setCode(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') apply(e); }}
        />
        <button type="button" className="btn-secondary" onClick={apply} disabled={busy || disabled || !code.trim()}>
          {busy && <Spinner className="h-4 w-4" />} Apply
        </button>
      </div>
      {(error || quote.promo?.error) && <FieldError message={error ?? `${quote.promo.code}: ${quote.promo.error}`} />}
    </div>
  );
}

// Food & merch for this show. Each change re-prices the order on the server.
function AddonMenu({ holdId, menu, chosen, error, onChange, disabled }) {
  const [busy, setBusy] = useState(false);
  const qtyOf = (id) => chosen.find((c) => String(c.addon) === String(id))?.qty ?? 0;

  const setQty = async (item, qty) => {
    const items = menu
      .map((m) => ({ addon: m._id, qty: String(m._id) === String(item._id) ? qty : qtyOf(m._id) }))
      .filter((i) => i.qty > 0);
    setBusy(true);
    try {
      onChange(await api(`/holds/${holdId}/addons`, { method: 'PUT', body: { items } }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10" aria-labelledby="addons-title">
      <h2 id="addons-title" className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-fg">
        <Popcorn className="h-4 w-4 text-signal" aria-hidden /> Add food &amp; merch
      </h2>
      <p className="mt-1 text-xs text-muted">Collect at the venue counter with your order number.</p>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {menu.map((m) => {
          const qty = qtyOf(m._id);
          const soldOut = m.remaining === 0 && qty === 0;
          const cap = Math.min(m.maxPerOrder, m.remaining == null ? Infinity : m.remaining + qty);
          const Icon = m.kind === 'merch' ? Shirt : Popcorn;
          return (
            <li key={m._id} className="flex items-center gap-4 py-3">
              <Icon className="h-5 w-5 shrink-0 text-faint" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{m.name}</p>
                <p className="text-xs text-muted">
                  {[
                    m.description,
                    soldOut ? <span key="s" className="text-stop">Sold out</span> : m.remaining != null && m.remaining <= 10 ? <span key="l" className="text-warn">{m.remaining} left</span> : null,
                  ].filter(Boolean).map((part, i) => <span key={i}>{i > 0 && ' · '}{part}</span>)}
                </p>
              </div>
              <span className="font-mono text-sm">{amount(m.price)}</span>
              <div className="flex items-center border border-line-strong">
                <button type="button" className="px-2 py-1.5 text-muted hover:text-fg disabled:opacity-30" onClick={() => setQty(m, qty - 1)} disabled={busy || disabled || qty === 0} aria-label={`One fewer ${m.name}`}>
                  <Minus className="h-3.5 w-3.5" aria-hidden />
                </button>
                <span className="w-7 text-center font-mono text-sm tabular" aria-live="polite">{qty}</span>
                <button type="button" className="px-2 py-1.5 text-muted hover:text-fg disabled:opacity-30" onClick={() => setQty(m, qty + 1)} disabled={busy || disabled || qty >= cap} aria-label={`One more ${m.name}`}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 text-sm text-stop" role="alert">{error}</p>}
    </section>
  );
}
