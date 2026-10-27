import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Accessibility, Ban, LayoutTemplate, Plus, SeparatorVertical, Trash2, Wand2 } from 'lucide-react';
import { api } from '../../lib/api';
import { CATEGORY_LABELS } from '../../lib/format';
import { SeatMap, previewSeats } from '../../components/SeatMap';
import { ErrorState, FieldError, PageLoader, Spinner } from '../../components/States';
import { LAYOUT_TEMPLATES } from '../../lib/layoutTemplates';
import { CANCELLATION_POLICIES, POLICY_SMALL_PRINT } from '../../lib/refundPolicy';

const PALETTE = ['#e11d48', '#7c3aed', '#0891b2', '#ea580c', '#16a34a', '#ca8a04'];
const MAX_CAPACITY = 1500;
const MAX_PER_ORDER = 8; // the server's per-order ceiling
const CLOSE_OPTIONS = [[0, 'When the show starts'], [30, '30 minutes before'], [60, '1 hour before'], [120, '2 hours before'], [24 * 60, '1 day before']];

// What clicking a seat in the preview does.
const SEAT_TOOLS = [
  { id: 'aisle', label: 'Aisle', icon: SeparatorVertical, hint: 'Click a seat to put a walkway after it. Click again to remove.' },
  { id: 'blocked', label: 'Not for sale', icon: Ban, hint: 'Click seats that can’t be sold: pillars, crew, house seats. Click again to bring them back.' },
  { id: 'accessible', label: 'Wheelchair', icon: Accessibility, hint: 'Click seats to mark them as wheelchair spaces.' },
];

const toggleIn = (list = [], n) => (list.includes(n) ? list.filter((x) => x !== n) : [...list, n].sort((a, b) => a - b));

const toLocalInput = (iso) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const blank = () => ({
  title: '', description: '', category: 'music', venue: { name: '', city: '' },
  startsAt: toLocalInput(Date.now() + 14 * 86_400_000).slice(0, 11) + '19:00', durationMinutes: 120, coverImageUrl: '',
  tiers: [{ name: 'Premium', price: 1500, color: PALETTE[1], description: '' }, { name: 'Standard', price: 700, color: PALETTE[2], description: '' }],
  rows: [
    ...'ABC'.split('').map((label) => ({ label, seats: 12, tier: 'Premium', aisleAfter: [6], blocked: [], accessible: [] })),
    ...'DEFG'.split('').map((label) => ({ label, seats: 14, tier: 'Standard', aisleAfter: [7], blocked: [], accessible: [] })),
  ],
  maxPerOrder: MAX_PER_ORDER, salesOpen: 'publish', salesStartAt: '', salesCloseMinutes: 0, cancellationPolicy: 'standard',
});

// Next row label after the last one: A..Z, then AA, AB, ...
function nextLabel(rows) {
  const last = rows.at(-1)?.label;
  if (!last) return 'A';
  if (/^[A-Y]$/.test(last)) return String.fromCharCode(last.charCodeAt(0) + 1);
  if (last === 'Z') return 'AA';
  if (/^[A-Z]{2}$/.test(last) && last[1] !== 'Z') return last[0] + String.fromCharCode(last.charCodeAt(1) + 1);
  return `${last}1`.slice(0, 3);
}

export function EventEditor() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(editing ? null : blank());
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState({ count: 3, seats: 12, tier: '' });
  const [tool, setTool] = useState('aisle');

  useEffect(() => {
    if (!editing) return;
    api(`/events/${id}`)
      .then(({ event }) => {
        if (event.status !== 'draft') { navigate(`/organizer/events/${id}`, { replace: true }); return; }
        setForm({
          ...event,
          startsAt: toLocalInput(event.startsAt),
          tiers: event.tiers.map((t) => ({ description: '', ...t })),
          maxPerOrder: event.maxPerOrder ?? MAX_PER_ORDER,
          salesOpen: event.salesStartAt ? 'scheduled' : 'publish',
          salesStartAt: event.salesStartAt ? toLocalInput(event.salesStartAt) : '',
          salesCloseMinutes: event.salesCloseMinutes ?? 0,
          cancellationPolicy: event.cancellationPolicy ?? 'standard',
        });
      })
      .catch(setLoadError);
  }, [editing, id, navigate]);

  const seats = useMemo(() => (form ? previewSeats(form.rows, form.tiers) : []), [form]);

  if (loadError) return <ErrorState error={loadError} />;
  if (!form) return <PageLoader />;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setTier = (i, patch) => {
    const old = form.tiers[i].name;
    const tiers = form.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t));
    // Renaming a tier carries its rows along.
    const rows = patch.name !== undefined ? form.rows.map((r) => (r.tier === old ? { ...r, tier: patch.name } : r)) : form.rows;
    set({ tiers, rows });
  };
  const setRow = (i, patch) => set({
    rows: form.rows.map((r, j) => {
      if (j !== i) return r;
      const next = { ...r, ...patch };
      // Shrinking a row drops options that pointed past its new end.
      const n = Number(next.seats) || 0;
      return { ...next, aisleAfter: (next.aisleAfter ?? []).filter((x) => x < n), blocked: (next.blocked ?? []).filter((x) => x <= n), accessible: (next.accessible ?? []).filter((x) => x <= n) };
    }),
  });
  const capacity = seats.length;

  // Clicking a seat in the preview applies the selected tool to it.
  const editSeat = (rowLabel, n) => {
    const i = form.rows.findIndex((r) => r.label === rowLabel);
    if (i < 0) return;
    const row = form.rows[i];
    if (tool === 'aisle') {
      if (n >= Number(row.seats)) { toast.error('An aisle goes between seats, so not after the last one in a row'); return; }
      setRow(i, { aisleAfter: toggleIn(row.aisleAfter, n) });
    } else if (tool === 'blocked') {
      setRow(i, { blocked: toggleIn(row.blocked, n), accessible: (row.accessible ?? []).filter((x) => x !== n) });
    } else {
      if (row.blocked?.includes(n)) { toast.error(`${rowLabel}${n} is not for sale. Bring it back first with the Not for sale tool.`); return; }
      setRow(i, { accessible: toggleIn(row.accessible, n) });
    }
  };

  const applyTemplate = (template) => {
    const before = { tiers: form.tiers, rows: form.rows };
    set(template.build());
    setGen((g) => ({ ...g, tier: '' }));
    toast(`${template.name} layout applied`, { description: 'Edit anything below.', action: { label: 'Undo', onClick: () => set(before) } });
  };

  const generateRows = () => {
    const tier = gen.tier || form.tiers.at(-1)?.name;
    const rows = [...form.rows];
    for (let n = 0; n < gen.count; n += 1) rows.push({ label: nextLabel(rows), seats: Number(gen.seats), tier, aisleAfter: [], blocked: [], accessible: [] });
    set({ rows });
  };

  const fe = error?.fieldErrors ?? {};
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      title: form.title, description: form.description, category: form.category,
      venue: form.venue, startsAt: new Date(form.startsAt).toISOString(),
      durationMinutes: Number(form.durationMinutes), coverImageUrl: form.coverImageUrl.trim(),
      tiers: form.tiers.map((t) => ({ name: t.name, price: Number(t.price), color: t.color, description: (t.description ?? '').trim() })),
      rows: form.rows.map((r) => ({
        label: r.label, seats: Number(r.seats), tier: r.tier,
        aisleAfter: r.aisleAfter ?? [], blocked: r.blocked ?? [], accessible: r.accessible ?? [],
      })),
      maxPerOrder: Number(form.maxPerOrder) || null,
      salesStartAt: form.salesOpen === 'scheduled' && form.salesStartAt ? new Date(form.salesStartAt).toISOString() : null,
      salesCloseMinutes: Number(form.salesCloseMinutes) || 0,
      cancellationPolicy: form.cancellationPolicy,
    };
    if (form.salesOpen === 'scheduled' && !form.salesStartAt) {
      setError({ message: 'Choose when sales open', fieldErrors: { salesStartAt: 'Pick a date and time' } });
      setBusy(false);
      return;
    }
    try {
      const { event } = await api(editing ? `/events/${id}` : '/events', { method: editing ? 'PATCH' : 'POST', body });
      toast.success(editing ? 'Draft saved' : 'Draft created — review it and publish when ready');
      navigate(`/organizer/events/${event.id}`);
    } catch (err) {
      setError(err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Organizer · {editing ? 'draft' : 'create'}</p>
          <h1 className="display mt-3 text-6xl sm:text-7xl">{editing ? 'Edit draft' : 'New event'}</h1>
        </div>
        <button className="btn-primary" disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Save draft</button>
      </div>

      {error && (
        <div className="border-l-2 border-stop bg-stop/10 px-4 py-3 text-sm text-fg" role="alert">
          <p className="font-semibold">{error.message}</p>
          {Array.isArray(error.details) && (
            <ul className="mt-1 list-inside list-disc">{error.details.map((d) => <li key={d.field + d.message}>{d.field && <code className="font-mono text-stop">{d.field}</code>} {d.message}</li>)}</ul>
          )}
        </div>
      )}

      <section className="card grid gap-5 p-4 sm:p-8 md:grid-cols-2">
        <SectionTitle n="01" className="md:col-span-2">Basics</SectionTitle>
        <div className="md:col-span-2">
          <label className="label" htmlFor="title">Title</label>
          <input id="title" className={`input ${fe.title ? 'input-error' : ''}`} value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} />
          <FieldError message={fe.title} />
        </div>
        <div>
          <label className="label" htmlFor="category">Category</label>
          <select id="category" className="input" value={form.category} onChange={(e) => set({ category: e.target.value })}>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {/* Side by side only when there's room for the full date and time. */}
        <div className="@container">
        <div className="grid gap-3 @sm:grid-cols-[minmax(0,1fr)_7rem]">
          <div>
            <label className="label" htmlFor="startsAt">Starts</label>
            <input id="startsAt" type="datetime-local" className={`input ${fe.startsAt ? 'input-error' : ''}`} value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
            <FieldError message={fe.startsAt} />
          </div>
          <div>
            <label className="label" htmlFor="duration">Duration (min)</label>
            <input id="duration" type="number" min={15} max={1440} className="input" value={form.durationMinutes} onChange={(e) => set({ durationMinutes: e.target.value })} />
          </div>
        </div>
        </div>
        <div>
          <label className="label" htmlFor="venue">Venue</label>
          <input id="venue" className={`input ${fe['venue.name'] ? 'input-error' : ''}`} value={form.venue.name} onChange={(e) => set({ venue: { ...form.venue, name: e.target.value } })} />
          <FieldError message={fe['venue.name']} />
        </div>
        <div>
          <label className="label" htmlFor="city">City</label>
          <input id="city" className={`input ${fe['venue.city'] ? 'input-error' : ''}`} value={form.venue.city} onChange={(e) => set({ venue: { ...form.venue, city: e.target.value } })} />
          <FieldError message={fe['venue.city']} />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="desc">Description</label>
          <textarea id="desc" rows={4} className="input" value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={4000} />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="cover">Cover image URL <span className="text-faint normal-case tracking-normal">(optional)</span></label>
          <input id="cover" type="url" className={`input ${fe.coverImageUrl ? 'input-error' : ''}`} placeholder="https://…" value={form.coverImageUrl} onChange={(e) => set({ coverImageUrl: e.target.value })} />
          <FieldError message={fe.coverImageUrl} />
        </div>
      </section>

      <section className="card p-4 sm:p-8" aria-labelledby="templates">
        <h2 id="templates" className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          <LayoutTemplate className="h-4 w-4 text-signal" aria-hidden /> Start from a template
        </h2>
        <p className="mt-1 text-sm text-muted">Fills in tiers, prices and seating. You can change everything afterwards.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {LAYOUT_TEMPLATES.map((tpl) => (
            <button key={tpl.id} type="button" onClick={() => applyTemplate(tpl)} className="group border border-line-strong bg-ink px-4 py-3 text-left transition-colors hover:border-signal">
              <span className="block font-semibold text-fg group-hover:text-signal">{tpl.name}</span>
              <span className="mt-0.5 block text-xs text-muted">{tpl.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card p-4 sm:p-8">
        <div className="flex items-center justify-between">
          <SectionTitle n="02">Ticket tiers</SectionTitle>
          <button type="button" className="btn-ghost" disabled={form.tiers.length >= 6}
            onClick={() => set({ tiers: [...form.tiers, { name: `Tier ${form.tiers.length + 1}`, price: 500, color: PALETTE[form.tiers.length % PALETTE.length] }] })}>
            <Plus className="h-4 w-4" aria-hidden /> Add tier
          </button>
        </div>
        <div className="mt-4 space-y-4">
          {form.tiers.map((t, i) => (
            // Phones: colour, name and delete on one line, price and notes below.
            // Wider screens: colour, name, price and delete on one line.
            <div key={i} className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[2.75rem_minmax(0,1fr)_8rem_auto]">
              <input type="color" aria-label="Tier colour" className="h-10 w-11 cursor-pointer rounded-[3px] border border-line-strong bg-ink p-1" value={t.color} onChange={(e) => setTier(i, { color: e.target.value })} />
              <input aria-label="Tier name" className="input" value={t.name} onChange={(e) => setTier(i, { name: e.target.value })} maxLength={30} />
              <div className="relative col-start-2 row-start-2 max-w-40 sm:col-start-3 sm:row-start-1 sm:max-w-none">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-faint">₹</span>
                <input aria-label="Price" type="number" min={0} step={1} className="input pl-7 font-mono" value={t.price} onChange={(e) => setTier(i, { price: e.target.value })} />
              </div>
              <button type="button" className="btn-ghost col-start-3 row-start-1 px-2 sm:col-start-4" aria-label={`Remove ${t.name}`} disabled={form.tiers.length === 1}
                onClick={() => set({ tiers: form.tiers.filter((_, j) => j !== i), rows: form.rows.filter((r) => r.tier !== t.name) })}>
                <Trash2 className="h-4 w-4" />
              </button>
              <input
                aria-label={`What ${t.name || 'this tier'} includes`}
                className="input col-start-2 col-end-[-1] py-2 text-[13px]"
                placeholder="What’s included (optional), e.g. Front rows, free drink"
                value={t.description ?? ''}
                maxLength={120}
                onChange={(e) => setTier(i, { description: e.target.value })}
              />
            </div>
          ))}
          <p className="pt-1 text-xs text-faint">Set a price of 0 for free seats. Removing a tier removes its rows. Buyers see what&rsquo;s included in the price list and when they hover a seat.</p>
        </div>
      </section>

      <section className="card p-4 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle n="03">Seating layout</SectionTitle>
          <span className={`font-mono text-xs uppercase tracking-[0.1em] tabular ${capacity > MAX_CAPACITY ? 'font-semibold text-stop' : 'text-muted'}`}>{capacity} / {MAX_CAPACITY} seats</span>
        </div>
        <div className="mt-4 grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <div>
            <div className="mb-4 flex flex-wrap items-end gap-2 border border-dashed border-line-strong p-3">
              <label className="label mb-0">Add
                <input type="number" min={1} max={20} className="input mt-1 w-16" value={gen.count} onChange={(e) => setGen({ ...gen, count: e.target.value })} />
              </label>
              <label className="label mb-0">rows of
                <input type="number" min={1} max={60} className="input mt-1 w-16" value={gen.seats} onChange={(e) => setGen({ ...gen, seats: e.target.value })} />
              </label>
              <label className="label mb-0">in
                <select className="input mt-1 w-32 font-sans normal-case tracking-normal" value={gen.tier || form.tiers.at(-1)?.name} onChange={(e) => setGen({ ...gen, tier: e.target.value })}>
                  {form.tiers.map((t) => <option key={t.name}>{t.name}</option>)}
                </select>
              </label>
              <button type="button" className="btn-secondary" onClick={generateRows}><Wand2 className="h-4 w-4" aria-hidden /> Add</button>
            </div>
            <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {form.rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input aria-label="Row label" className="input w-12 shrink-0 px-1 text-center sm:w-14 font-mono font-semibold uppercase" value={r.label} maxLength={3} onChange={(e) => setRow(i, { label: e.target.value.toUpperCase() })} />
                  <input aria-label="Seats in row" type="number" min={1} max={60} className="input w-16 shrink-0 font-mono sm:w-20" value={r.seats} onChange={(e) => setRow(i, { seats: e.target.value })} />
                  <select aria-label="Row tier" className="input min-w-0 flex-1" value={r.tier} onChange={(e) => setRow(i, { tier: e.target.value })}>
                    {form.tiers.map((t) => <option key={t.name}>{t.name}</option>)}
                  </select>
                  <button type="button" className="btn-ghost px-2" aria-label={`Remove row ${r.label}`} disabled={form.rows.length === 1} onClick={() => set({ rows: form.rows.filter((_, j) => j !== i) })}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="min-w-0 border border-line bg-ink p-4 sm:p-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <p className="eyebrow">Live preview · click seats to edit</p>
              <div className="grid w-full grid-cols-3 rounded-[3px] border border-line-strong p-0.5 sm:flex sm:w-auto" role="radiogroup" aria-label="Seat tool">
                {SEAT_TOOLS.map(({ id: t, label, icon: Icon }) => (
                  <button
                    key={t} type="button" role="radio" aria-checked={tool === t} onClick={() => setTool(t)}
                    className={`flex flex-col items-center justify-center gap-1 whitespace-nowrap rounded-[2px] px-1.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.04em] transition-colors sm:flex-row sm:gap-1.5 sm:px-2.5 sm:text-[11px] sm:tracking-[0.08em] ${tool === t ? 'bg-fg text-ink' : 'text-muted hover:text-fg'}`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="-mt-3 mb-6 text-xs text-faint">{SEAT_TOOLS.find((t) => t.id === tool).hint}</p>
            <SeatMap rows={form.rows} tiers={form.tiers.map((t) => ({ ...t, price: Number(t.price) }))} seats={seats} onPosition={editSeat} />
          </div>
        </div>
      </section>

      <section className="card grid gap-6 p-4 sm:p-8 md:grid-cols-3">
        <SectionTitle n="04" className="md:col-span-3">Booking rules</SectionTitle>
        <div>
          <label className="label" htmlFor="maxPerOrder">Max tickets per order</label>
          <select id="maxPerOrder" className={`input ${fe.maxPerOrder ? 'input-error' : ''}`} value={form.maxPerOrder} onChange={(e) => set({ maxPerOrder: Number(e.target.value) })}>
            {Array.from({ length: MAX_PER_ORDER }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <p className="mt-1.5 text-xs text-faint">How many seats one buyer can pick at once.</p>
          <FieldError message={fe.maxPerOrder} />
        </div>
        <fieldset>
          <legend className="label">Sales open</legend>
          <div className="space-y-2">
            {[['publish', 'As soon as I publish'], ['scheduled', 'At a set time']].map(([v, label]) => (
              <label key={v} className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input type="radio" name="salesOpen" value={v} checked={form.salesOpen === v} onChange={() => set({ salesOpen: v })} className="accent-[var(--color-signal)]" />
                {label}
              </label>
            ))}
          </div>
          {form.salesOpen === 'scheduled' && (
            <input type="datetime-local" aria-label="Sales open at" className={`input mt-2 ${fe.salesStartAt ? 'input-error' : ''}`} value={form.salesStartAt} onChange={(e) => set({ salesStartAt: e.target.value })} />
          )}
          <FieldError message={fe.salesStartAt} />
        </fieldset>
        <div>
          <label className="label" htmlFor="salesClose">Sales close</label>
          <select id="salesClose" className={`input ${fe.salesCloseMinutes ? 'input-error' : ''}`} value={form.salesCloseMinutes} onChange={(e) => set({ salesCloseMinutes: Number(e.target.value) })}>
            {CLOSE_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            {!CLOSE_OPTIONS.some(([v]) => v === Number(form.salesCloseMinutes)) && <option value={form.salesCloseMinutes}>{form.salesCloseMinutes} minutes before</option>}
          </select>
          <p className="mt-1.5 text-xs text-faint">Tickets already sold can still be transferred until the show starts.</p>
          <FieldError message={fe.salesCloseMinutes} />
        </div>
        <fieldset className="md:col-span-3">
          <legend className="label">Cancellation policy</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.entries(CANCELLATION_POLICIES).map(([value, p]) => (
              <label key={value} className={`cursor-pointer border px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal ${form.cancellationPolicy === value ? 'border-signal bg-signal/10' : 'border-line-strong hover:border-faint'}`}>
                <input type="radio" name="cancellationPolicy" value={value} className="sr-only" checked={form.cancellationPolicy === value} onChange={() => set({ cancellationPolicy: value })} />
                <span className="block text-sm font-semibold text-fg">{p.label}</span>
                <span className="mt-1 block text-xs text-muted">{p.summary}</span>
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-faint">{POLICY_SMALL_PRINT} Locked once you publish, like prices.</p>
          <FieldError message={fe.cancellationPolicy} />
        </fieldset>
      </section>

      <div className="flex justify-end">
        <button className="btn-primary px-6 py-3" disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Save draft</button>
      </div>
    </form>
  );
}

function SectionTitle({ n, children, className = '' }) {
  return (
    <h2 className={`flex items-baseline gap-3 ${className}`}>
      <span className="font-mono text-[11px] text-signal">{n}</span>
      <span className="display text-3xl">{children}</span>
    </h2>
  );
}
