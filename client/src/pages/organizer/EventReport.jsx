import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Lock, Star } from 'lucide-react';
import { api } from '../../lib/api';
import { amount, pct, plural, shortDate } from '../../lib/format';
import { Stars } from '../../components/Stars';
import { ErrorState, PageLoader } from '../../components/States';

const chartAxis = { fontSize: 11, fontFamily: 'IBM Plex Mono', stroke: '#6f6a62', tickLine: false };
const tooltip = {
  cursor: { fill: '#ffffff08' },
  contentStyle: { background: '#1a1917', border: '1px solid #403c37', borderRadius: 4, fontFamily: 'IBM Plex Mono', fontSize: 12 },
  labelStyle: { color: '#a39d93' },
  itemStyle: { color: '#f1ece3' },
};
const ASPECT_LABELS = { performance: 'The show itself', venue: 'Venue and staff', value: 'Value for money' };

// "-30" -> "30 min before", "15" -> "15 min after", "0" -> "At start"
const slotLabel = (m) => (m === 0 ? 'Start' : m < 0 ? `${-m}m before` : `+${m}m`);

/**
 * The organizer's after-show report: did people come, when did they arrive,
 * how did tickets sell, and what did attendees think.
 */
export function EventReport({ eventId }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    api(`/events/${eventId}/report`).then((d) => { setReport(d.report); setError(null); }).catch(setError);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!report) return <PageLoader label="Building the report" />;
  const { attendance: att, sales, feedback: fb } = report;

  const headline = [
    ['Turnout', att.sold ? pct(att.turnout) : '—', `${att.came} of ${plural(att.sold, 'ticket holder')} came`],
    ['No-shows', att.noShows, att.sold ? `${pct(att.noShows / att.sold)} of tickets sold` : 'No tickets sold'],
    ['House filled', pct(att.fill), `${att.sold} of ${att.capacity} seats sold`],
    ['Rating', fb.avg != null ? fb.avg.toFixed(1) : '—', fb.count ? `from ${plural(fb.count, 'review')} · ${pct(fb.responseRate)} replied` : 'No reviews yet'],
  ];

  return (
    <div className="space-y-6">
      {!report.event.ended && (
        <p className="border-l-2 border-warn bg-ink-900 px-4 py-3 text-sm text-fg/90">
          The show hasn&rsquo;t finished yet, so these numbers are still moving. Check back after it ends for the full picture.
        </p>
      )}

      <div className="grid border-l border-t border-line sm:grid-cols-2 lg:grid-cols-4">
        {headline.map(([label, value, sub], i) => (
          <div key={label} className="border-b border-r border-line bg-ink-900 p-5">
            <p className="eyebrow">{label}</p>
            <p className={`display mt-3 text-5xl tabular ${i === 0 ? 'text-signal' : ''}`}>{value}</p>
            <p className="mt-2 font-mono text-[11px] text-muted">{sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="eyebrow text-fg">When people arrived</h2>
          <p className="mt-1 text-xs text-muted">
            Door scans in {att.arrivals.slotMinutes}-minute slots around the start time.
            {att.arrivals.peak && <> Busiest: <span className="text-fg">{slotLabel(att.arrivals.peak.minutes)}</span> ({plural(att.arrivals.peak.count, 'person', 'people')}).</>}
            {att.afterStart > 0 && <> {plural(att.afterStart, 'person', 'people')} came in after it started.</>}
          </p>
          {att.came === 0 ? (
            <p className="py-16 text-center text-sm text-muted">Nobody has been scanned in yet.</p>
          ) : !att.arrivals.peak ? (
            <p className="py-16 text-center text-sm text-muted">
              Every scan was more than 90 minutes from the start time ({att.arrivals.early} early, {att.arrivals.late} late), so there&rsquo;s no arrival curve to draw.
            </p>
          ) : (
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={att.arrivals.slots} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="#2c2a26" />
                  <XAxis dataKey="minutes" tickFormatter={slotLabel} {...chartAxis} axisLine={{ stroke: '#403c37' }} interval={1} />
                  <YAxis allowDecimals={false} {...chartAxis} axisLine={false} />
                  <Tooltip formatter={(v) => [v, 'Scanned in']} labelFormatter={slotLabel} {...tooltip} />
                  <Bar dataKey="count" fill="#5fd38d" radius={[2, 2, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="eyebrow text-fg">Turnout by tier</h2>
          <table className="mt-4 w-full text-sm">
            <thead className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
              <tr><th className="pb-2 font-medium">Tier</th><th className="pb-2 font-medium">Came / sold</th><th className="pb-2 text-right font-medium">Turnout</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {att.tiers.map((t) => (
                <tr key={t.tier}>
                  <td className="py-3">{t.tier}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-20 bg-line sm:w-24"><div className="h-full bg-go" style={{ width: pct(t.turnout) }} /></div>
                      <span className="font-mono text-xs tabular text-muted">{t.came}/{t.sold}</span>
                    </div>
                  </td>
                  <td className="py-3 text-right font-mono tabular">{pct(t.turnout)}</td>
                </tr>
              ))}
              {att.tiers.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-muted">No tickets sold.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="eyebrow text-fg">How far ahead people booked</h2>
          <p className="mt-1 text-xs text-muted">Tickets by how long before the show they were bought.</p>
          <div className="mt-4 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sales.leadTime} margin={{ left: -20 }}>
                <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="#2c2a26" />
                <XAxis dataKey="label" {...chartAxis} axisLine={{ stroke: '#403c37' }} />
                <YAxis allowDecimals={false} {...chartAxis} axisLine={false} />
                <Tooltip formatter={(v) => [v, 'Tickets']} {...tooltip} />
                <Bar dataKey="tickets" fill="#ff5321" radius={[2, 2, 0, 0]} maxBarSize={48} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="eyebrow text-fg">Sales</h2>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            {[
              ['Your revenue', amount(sales.revenue)],
              ['Orders', sales.orders],
              ['Average order', amount(sales.averageOrder)],
              ['Tickets per order', sales.ticketsPerOrder || '—'],
              ['From add-ons', amount(sales.addons)],
              ['Promo codes used', `${sales.promoOrders} · ${amount(sales.discounts)} off`],
              ['Refunded', `${sales.refunds.orders} · ${amount(sales.refunds.amount)}`],
              ['Interested / waitlist', `${sales.interested} · ${sales.waitlist}`],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="eyebrow">{label}</dt>
                <dd className="mt-1 font-mono tabular text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section className="card p-5">
        <h2 className="eyebrow text-fg">What attendees said</h2>
        {fb.count === 0 ? (
          <p className="mt-3 text-sm text-muted">No feedback yet. People who were scanned in get an email asking for it a couple of hours after the show.</p>
        ) : (
          <div className="mt-5 grid gap-8 lg:grid-cols-[16rem_1fr]">
            <div className="space-y-5">
              <div>
                <p className="display text-6xl">{fb.avg.toFixed(1)}</p>
                <Stars value={fb.avg} size="h-4 w-4" />
                <ul className="mt-4 space-y-1.5">
                  {[5, 4, 3, 2, 1].map((r) => (
                    <li key={r} className="flex items-center gap-2 font-mono text-[11px] text-muted">
                      <span className="w-3">{r}</span>
                      <span className="h-1 flex-1 bg-line"><span className="block h-full bg-warn" style={{ width: pct(fb.distribution[r] / fb.count) }} /></span>
                      <span className="w-5 text-right tabular">{fb.distribution[r]}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <ul className="space-y-2 border-t border-line pt-4 text-sm">
                {Object.entries(fb.aspects).map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between">
                    <span className="text-muted">{ASPECT_LABELS[k]}</span>
                    <span className="flex items-center gap-1 font-mono tabular text-fg">{v != null ? <><Star className="h-3 w-3 fill-warn text-warn" aria-hidden />{v.toFixed(1)}</> : '—'}</span>
                  </li>
                ))}
                {fb.recommend && (
                  <li className="flex items-center justify-between">
                    <span className="text-muted">Would recommend</span>
                    <span className="font-mono tabular text-go">{pct(fb.recommend.yes / fb.recommend.answered)}</span>
                  </li>
                )}
              </ul>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <p className="eyebrow">Public comments</p>
                {fb.comments.length === 0 ? <p className="mt-2 text-sm text-muted">No written comments.</p> : (
                  <ul className="mt-2 divide-y divide-line">
                    {fb.comments.map((c, i) => (
                      <li key={i} className="py-3">
                        <div className="flex items-center gap-2"><Stars value={c.rating} /><span className="text-xs text-muted">{c.author} · {shortDate(c.createdAt)}</span></div>
                        <p className="mt-1.5 text-sm text-fg/90">{c.text}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="eyebrow flex items-center gap-1.5"><Lock className="h-3 w-3" aria-hidden /> Notes only you can see</p>
                {fb.privateNotes.length === 0 ? <p className="mt-2 text-sm text-muted">No private notes.</p> : (
                  <ul className="mt-2 divide-y divide-line">
                    {fb.privateNotes.map((c, i) => (
                      <li key={i} className="py-3">
                        <p className="text-xs text-muted">{c.author} · {c.rating}★ · {shortDate(c.createdAt)}</p>
                        <p className="mt-1.5 text-sm text-fg/90">{c.note}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
