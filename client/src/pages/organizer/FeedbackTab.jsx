import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Lightbulb, ListChecks, MessageSquareQuote, Plus, RefreshCw, Sparkles, ThumbsUp, Trash2, TriangleAlert, Wand2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { ErrorState, FieldError, Notice, PageLoader, Spinner } from '../../components/States';
import { QuestionResult } from '../../components/SurveyResults';
import { QUESTION_KINDS } from '../../lib/survey';
import { useSlidingIndicator } from '../../hooks/useSlidingIndicator';

const blankQuestion = (kind) => ({ kind, label: '', options: kind === 'choice' || kind === 'multi' ? ['', ''] : [], required: false });

/**
 * The organizer's feedback form for this production: build it (or have it
 * drafted), then watch answers come in and get a summary of what they say.
 */
export function FeedbackTab({ eventId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('results');
  const load = useCallback(() => {
    api(`/events/${eventId}/survey/manage`).then((d) => { setData(d); setError(null); }).catch(setError);
  }, [eventId]);
  useEffect(() => { load(); }, [load]);
  const [toggle, pill] = useSlidingIndicator(data?.survey ? view : null);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <PageLoader />;
  if (!data.survey) return <Builder eventId={eventId} onSaved={(d) => { setData(d); setView('results'); }} />;

  return (
    <div className="space-y-6">
      <div ref={toggle} className="relative inline-flex rounded-[3px] border border-line-strong p-0.5" role="tablist" aria-label="Feedback form">
        <span ref={pill} className="slider left-0 top-0 rounded-[2px] bg-fg" aria-hidden />
        {[['results', 'Results'], ['form', 'Edit form']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} data-active={view === k} onClick={() => setView(k)}
            className={`relative px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors duration-300 ${view === k ? 'text-ink' : 'text-muted hover:text-fg'}`}>
            {label}
          </button>
        ))}
      </div>
      {view === 'results'
        ? <Results eventId={eventId} data={data} onChange={setData} />
        : <Builder eventId={eventId} survey={data.survey} locked={data.results?.responses > 0} onSaved={(d) => { setData(d); setView('results'); }} />}
    </div>
  );
}

// ---- Results ----------------------------------------------------------------------

function Results({ eventId, data, onChange }) {
  const { survey, results } = data;
  const [busy, setBusy] = useState(false);
  const insights = survey.insights;
  const stale = insights && insights.responses !== results.responses;
  const rate = results.attendees ? Math.round((results.responses / results.attendees) * 100) : 0;

  const analyse = async () => {
    setBusy(true);
    try {
      onChange(await api(`/events/${eventId}/survey/insights`, { method: 'POST' }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-3">
        {[
          ['Responses', results.responses, `from ${results.attendees} checked-in guest${results.attendees === 1 ? '' : 's'}`],
          ['Response rate', `${rate}%`, rate >= 30 ? 'A healthy sample' : 'Share the link at the venue to get more'],
          ['Questions', survey.questions.length, `${survey.questions.filter((q) => q.required).length} required`],
        ].map(([label, value, sub]) => (
          <div key={label} className="bg-ink-900 p-5">
            <p className="eyebrow">{label}</p>
            <p className="display mt-2 text-5xl tabular">{value}</p>
            <p className="mt-1 text-xs text-muted">{sub}</p>
          </div>
        ))}
      </div>

      {/* overflow-clip, not hidden: the glow pokes out, and a hidden-overflow box can still be scrolled sideways by focus. */}
      <section className="card relative overflow-clip p-6">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-signal/10 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow flex items-center gap-2 text-fg"><Sparkles className="h-3.5 w-3.5 text-signal" aria-hidden /> Insights</p>
            {insights ? (
              <p className="mt-1 text-xs text-faint">
                {insights.source === 'built-in' ? 'Built-in summary' : 'Written by Claude'} · {insights.responses} response{insights.responses === 1 ? '' : 's'} · {dateTime(insights.generatedAt)}
                {stale && <span className="text-warn"> · {results.responses - insights.responses} new since</span>}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted">Turn the answers into what worked, what to fix and what to do next.</p>
            )}
          </div>
          <button type="button" className="btn-primary" onClick={analyse} disabled={busy || !results.responses}>
            {busy ? <Spinner className="h-4 w-4" /> : insights ? <RefreshCw className="h-4 w-4" aria-hidden /> : <Wand2 className="h-4 w-4" aria-hidden />}
            {busy ? 'Reading the answers…' : insights ? 'Refresh insights' : 'Generate insights'}
          </button>
        </div>
        {!results.responses && <p className="relative mt-4 text-sm text-muted">No answers yet. Attendees get the form in their post-show email and under <em>My tickets</em>.</p>}
        {insights && <InsightsBody insights={insights} />}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {results.questions.map((q) => <QuestionResult key={q._id} q={q} />)}
      </div>
    </div>
  );
}

function InsightsBody({ insights }) {
  const tone = { positive: 'border-go text-go', mixed: 'border-warn text-warn', negative: 'border-stop text-stop' }[insights.sentiment];
  const list = (title, Icon, items, color) => items?.length > 0 && (
    <div>
      <p className={`eyebrow flex items-center gap-2 ${color}`}><Icon className="h-3.5 w-3.5" aria-hidden /> {title}</p>
      <ul className="mt-2 space-y-1.5 text-sm text-fg/90">
        {items.map((t, i) => <li key={i} className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}>{t}</li>)}
      </ul>
    </div>
  );
  return (
    <div className="relative mt-6 animate-rise">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="display text-3xl">{insights.headline}</h3>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] ${tone}`}>{insights.sentiment}</span>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted">{insights.summary}</p>
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        {list('What they loved', ThumbsUp, insights.loved, 'text-go')}
        {list('What to fix', TriangleAlert, insights.improve, 'text-warn')}
        {list('Do next', Lightbulb, insights.actions, 'text-signal')}
      </div>
      {insights.quotes?.length > 0 && (
        <div className="mt-6">
          <p className="eyebrow flex items-center gap-2"><MessageSquareQuote className="h-3.5 w-3.5" aria-hidden /> In their words</p>
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            {insights.quotes.map((q, i) => <blockquote key={i} className="border-l-2 border-signal bg-ink px-3 py-2 text-sm italic text-fg/90">“{q}”</blockquote>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Builder ----------------------------------------------------------------------

function Builder({ eventId, survey, locked = false, onSaved }) {
  const [form, setForm] = useState(() => survey
    ? { title: survey.title, intro: survey.intro, questions: survey.questions.map((q) => ({ ...q })) }
    : { title: 'How was the show?', intro: 'Two minutes, and it really helps us make the next one better.', questions: [] });
  const [busy, setBusy] = useState(null); // 'save' | 'suggest'
  const [error, setError] = useState(null);
  const fe = error?.fieldErrors ?? {};

  const setQ = (i, patch) => setForm((f) => ({ ...f, questions: f.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
  const move = (i, by) => setForm((f) => {
    const qs = [...f.questions];
    [qs[i], qs[i + by]] = [qs[i + by], qs[i]];
    return { ...f, questions: qs };
  });

  const suggest = async () => {
    setBusy('suggest');
    try {
      const { questions, source } = await api(`/events/${eventId}/survey/suggest`, { method: 'POST' });
      setForm((f) => ({ ...f, questions }));
      toast.success(source === 'template' ? 'Starter questions added' : 'Claude drafted your questions', { description: 'Edit anything before saving.' });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      const body = { ...form, questions: form.questions.map(({ kind, label, options, required }) => ({ kind, label, options: options.filter((o) => o.trim()), required })) };
      onSaved(await api(`/events/${eventId}/survey`, { method: 'PUT', body }));
      toast.success(survey ? 'Form updated' : 'Feedback form is live', { description: 'People who were checked in can answer it now.' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {!survey && (
        <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="display text-2xl">Ask your audience</p>
            <p className="mt-1 max-w-xl text-sm text-muted">Build a short form for people who were checked in. They see how everyone answered once they&apos;ve replied; you get the numbers and a summary.</p>
          </div>
          <button type="button" className="btn-secondary" onClick={suggest} disabled={busy}>
            {busy === 'suggest' ? <Spinner className="h-4 w-4" /> : <Wand2 className="h-4 w-4 text-signal" aria-hidden />} Suggest questions
          </button>
        </div>
      )}
      {locked && <Notice>People have answered already, so you can reword questions but not add, remove or change their type or options.</Notice>}
      {error && !Object.keys(fe).length && <Notice tone="stop">{error.message}</Notice>}

      <div className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="fb-title">Form title</label>
          <input id="fb-title" className={`input ${fe.title ? 'input-error' : ''}`} value={form.title} maxLength={100} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <FieldError message={fe.title} />
        </div>
        <div>
          <label className="label" htmlFor="fb-intro">Intro (optional)</label>
          <input id="fb-intro" className="input" value={form.intro} maxLength={300} onChange={(e) => setForm({ ...form, intro: e.target.value })} />
        </div>
      </div>

      <ol className="space-y-3">
        {form.questions.map((q, i) => (
          <li key={q._id ?? `new-${i}`} className="card animate-rise p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-signal">{String(i + 1).padStart(2, '0')}</span>
              <select aria-label="Question type" className="input w-auto py-1.5 font-mono text-[11px] uppercase tracking-[0.08em]" value={q.kind} disabled={locked}
                onChange={(e) => setQ(i, { kind: e.target.value, options: ['choice', 'multi'].includes(e.target.value) ? (q.options.length ? q.options : ['', '']) : [] })}>
                {Object.entries(QUESTION_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <label className="ml-auto flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} className="accent-[var(--color-signal)]" /> Required
              </label>
              <span className="flex">
                <button type="button" className="btn-ghost px-2 py-1" aria-label="Move up" disabled={locked || i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" aria-hidden /></button>
                <button type="button" className="btn-ghost px-2 py-1" aria-label="Move down" disabled={locked || i === form.questions.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" aria-hidden /></button>
                <button type="button" className="btn-ghost px-2 py-1 hover:text-stop" aria-label="Remove question" disabled={locked} onClick={() => setForm((f) => ({ ...f, questions: f.questions.filter((_, j) => j !== i) }))}><Trash2 className="h-4 w-4" aria-hidden /></button>
              </span>
            </div>
            <input aria-label={`Question ${i + 1}`} className={`input mt-3 ${fe[`questions.${i}.label`] ? 'input-error' : ''}`} placeholder="Ask something" value={q.label} maxLength={140} onChange={(e) => setQ(i, { label: e.target.value })} />
            <FieldError message={fe[`questions.${i}.label`]} />
            {(q.kind === 'choice' || q.kind === 'multi') && (
              <div className="mt-3 space-y-2 pl-4">
                {q.options.map((o, k) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className={`h-3.5 w-3.5 shrink-0 border border-line-strong ${q.kind === 'choice' ? 'rounded-full' : 'rounded-[2px]'}`} aria-hidden />
                    <input aria-label={`Option ${k + 1}`} className="input py-1.5" value={o} maxLength={60} disabled={locked} placeholder={`Option ${k + 1}`}
                      onChange={(e) => setQ(i, { options: q.options.map((x, m) => (m === k ? e.target.value : x)) })} />
                    <button type="button" className="btn-ghost px-2 py-1" aria-label="Remove option" disabled={locked || q.options.length <= 2} onClick={() => setQ(i, { options: q.options.filter((_, m) => m !== k) })}><X className="h-4 w-4" aria-hidden /></button>
                  </div>
                ))}
                {!locked && q.options.length < 8 && (
                  <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setQ(i, { options: [...q.options, ''] })}><Plus className="h-3.5 w-3.5" aria-hidden /> Add option</button>
                )}
                <FieldError message={fe[`questions.${i}.options`]} />
              </div>
            )}
          </li>
        ))}
      </ol>

      {!locked && (
        <div className="flex flex-wrap items-center gap-2 border border-dashed border-line-strong p-3">
          <span className="eyebrow mr-1 flex items-center gap-2"><ListChecks className="h-3.5 w-3.5" aria-hidden /> Add</span>
          {Object.entries(QUESTION_KINDS).map(([k, v]) => (
            <button key={k} type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={form.questions.length >= 12}
              onClick={() => setForm((f) => ({ ...f, questions: [...f.questions, blankQuestion(k)] }))}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> {v.label}
            </button>
          ))}
        </div>
      )}
      <FieldError message={fe.questions} />

      <div className="flex flex-wrap justify-end gap-2">
        {survey && !locked && (
          <button type="button" className="btn-ghost" onClick={suggest} disabled={busy}>
            {busy === 'suggest' ? <Spinner className="h-4 w-4" /> : <Wand2 className="h-4 w-4" aria-hidden />} Replace with suggestions
          </button>
        )}
        <button type="button" className="btn-primary" onClick={save} disabled={busy || !form.questions.length}>
          {busy === 'save' && <Spinner className="h-4 w-4" />} {survey ? 'Save changes' : 'Publish form'}
        </button>
      </div>
    </div>
  );
}
