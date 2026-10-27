import { Star } from 'lucide-react';
import { QUESTION_KINDS } from '../lib/survey';

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

// A bar that grows in from the left; `you` marks the reader's own answer.
function Bar({ label, count, total, you, tone = 'bg-signal' }) {
  const p = pct(count, total);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={you ? 'font-semibold text-fg' : 'text-fg/85'}>
          {label}
          {you && <span className="ml-2 rounded-full bg-signal px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-ink">You</span>}
        </span>
        <span className="font-mono text-xs text-muted tabular">{p}% · {count}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-800">
        <div className={`h-full origin-left animate-grow-x rounded-full ${you ? tone : `${tone} opacity-60`}`} style={{ width: `${Math.max(p, count ? 2 : 0)}%` }} />
      </div>
    </div>
  );
}

/**
 * One question's results. `mine` is the reader's own answer (attendees), so
 * their pick is highlighted; the organizer's view passes none.
 */
export function QuestionResult({ q, mine }) {
  const total = q.answered;
  return (
    <section className="card p-5">
      <p className="eyebrow">{QUESTION_KINDS[q.kind]?.label} · {total} answer{total === 1 ? '' : 's'}</p>
      <h3 className="mt-2 font-semibold text-fg">{q.label}</h3>

      {q.kind === 'rating' && (
        <div className="mt-4 grid items-center gap-5 sm:grid-cols-[auto_1fr]">
          <div className="text-center">
            <p className="display text-6xl text-warn tabular">{q.average ?? '–'}</p>
            <p className="mt-1 flex justify-center gap-0.5" aria-hidden>
              {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`h-3.5 w-3.5 ${n <= Math.round(q.average ?? 0) ? 'fill-warn text-warn' : 'text-line-strong'}`} />)}
            </p>
          </div>
          <div className="space-y-2">
            {[5, 4, 3, 2, 1].map((n) => <Bar key={n} label={`${n} ★`} count={q.counts[n - 1]} total={total} you={mine === n} tone="bg-warn" />)}
          </div>
        </div>
      )}

      {q.kind === 'nps' && (
        <div className="mt-4">
          <div className="flex items-end gap-4">
            <p className={`display text-6xl tabular ${q.score == null ? 'text-muted' : q.score >= 30 ? 'text-go' : q.score >= 0 ? 'text-warn' : 'text-stop'}`}>{q.score ?? '–'}</p>
            <p className="pb-2 text-xs text-muted">Net Promoter Score<br />(% who’d recommend minus % who wouldn’t)</p>
          </div>
          {total > 0 && (
            <>
              <div className="mt-4 flex h-3 overflow-hidden rounded-full">
                <span className="animate-grow-x origin-left bg-stop" style={{ width: `${pct(q.detractors, total)}%` }} />
                <span className="animate-grow-x origin-left bg-warn [animation-delay:150ms]" style={{ width: `${pct(q.passives, total)}%` }} />
                <span className="animate-grow-x origin-left bg-go [animation-delay:300ms]" style={{ width: `${pct(q.promoters, total)}%` }} />
              </div>
              <p className="mt-2 flex justify-between font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
                <span className="text-stop">{q.detractors} 0–6</span><span className="text-warn">{q.passives} 7–8</span><span className="text-go">{q.promoters} 9–10</span>
              </p>
              {mine != null && <p className="mt-2 text-xs text-muted">You said <span className="font-semibold text-fg">{mine}</span>.</p>}
            </>
          )}
        </div>
      )}

      {(q.kind === 'choice' || q.kind === 'multi') && (
        <div className="mt-4 space-y-3">
          {[...q.options].sort((a, b) => b.count - a.count).map((o) => (
            <Bar key={o.option} label={o.option} count={o.count} total={total} you={Array.isArray(mine) ? mine.includes(o.option) : mine === o.option} />
          ))}
        </div>
      )}

      {q.kind === 'text' && (
        q.answers?.length ? (
          <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
            {q.answers.map((a, i) => <li key={i} className="border-l-2 border-line-strong bg-ink px-3 py-2 text-sm text-fg/90">“{a}”</li>)}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">{q.answers ? 'No written answers yet.' : 'Written answers go to the organizer only.'}</p>
        )
      )}
    </section>
  );
}
