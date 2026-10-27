import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, Lock, PartyPopper, Send, Users } from 'lucide-react';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import { StarInput } from '../components/Stars';
import { EmptyState, ErrorState, FieldError, PageLoader, Spinner } from '../components/States';
import { QuestionResult } from '../components/SurveyResults';
import { Scramble } from '../components/Motion';
import { confetti } from '../lib/confetti';

const isAnswered = (v) => v != null && v !== '' && !(Array.isArray(v) && !v.length);

/**
 * An organizer's feedback form, for someone who was at the show. After they
 * answer they see how everyone else did (once enough people have replied).
 */
export function FeedbackPage() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [answers, setAnswers] = useState({});
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState({});

  const load = useCallback(async () => {
    try {
      const [e, s] = await Promise.all([api(`/events/${id}`), api(`/events/${id}/survey`)]);
      setEvent(e.event);
      setData(s);
      setAnswers(Object.fromEntries((s.myAnswers ?? []).map((a) => [a.question, a.value])));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!data || !event) return <PageLoader label="Loading the form" />;

  const back = <Link to="/tickets" className="btn-secondary">Back to my tickets</Link>;
  if (!data.survey) {
    return <div className="mx-auto max-w-xl py-10"><EmptyState title="No feedback form" action={<Link to={`/events/${id}#reviews`} className="btn-primary">Leave a review instead</Link>}>The organizer of {event.title} hasn&apos;t made a feedback form.</EmptyState></div>;
  }
  if (!data.attended) {
    return <div className="mx-auto max-w-xl py-10"><EmptyState icon={Lock} title="For people who came" action={back}>Only people who were checked in at {event.title} can fill in its feedback form.</EmptyState></div>;
  }

  const { survey } = data;
  const answeredCount = survey.questions.filter((q) => isAnswered(answers[q._id])).length;
  const showForm = data.canRespond && (!data.myAnswers || editing);

  const submit = async () => {
    setBusy(true);
    setProblems({});
    try {
      const res = await api(`/events/${id}/survey/responses`, {
        method: 'POST',
        body: { answers: survey.questions.map((q) => ({ question: q._id, value: answers[q._id] ?? null })) },
      });
      const first = !data.myAnswers;
      setData(res);
      setEditing(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (first) confetti({ count: 120, duration: 3000 });
      toast.success(first ? 'Thanks! The organizer will love this.' : 'Answers updated');
    } catch (err) {
      setProblems(err.fieldErrors ?? {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow">Feedback · {event.title}</p>
      <h1 className="display mt-3 text-5xl sm:text-6xl"><Scramble text={survey.title} /></h1>
      {survey.intro && <p className="mt-3 text-muted">{survey.intro}</p>}

      {showForm ? (
        <>
          {/* Progress fills as questions get answered. */}
          <div className="sticky top-16 z-10 -mx-4 mt-8 bg-ink/90 px-4 py-3 backdrop-blur sm:mx-0 sm:px-0">
            <div className="flex justify-between font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
              <span>{answeredCount} of {survey.questions.length} answered</span>
              {data.closesAt && <span>Open until {dateTime(data.closesAt)}</span>}
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-800">
              <div className="h-full rounded-full bg-signal transition-[width] duration-500 ease-out" style={{ width: `${(answeredCount / survey.questions.length) * 100}%` }} />
            </div>
          </div>
          <ol className="mt-4 space-y-4">
            {survey.questions.map((q, i) => (
              <li key={q._id} className={`card animate-rise p-5 transition-colors ${problems[q._id] ? 'border-stop' : isAnswered(answers[q._id]) ? 'border-line-strong' : ''}`} style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}>
                <p className="flex items-start gap-3 font-semibold text-fg">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] transition-colors ${isAnswered(answers[q._id]) ? 'bg-go text-ink' : 'border border-line-strong text-muted'}`}>
                    {isAnswered(answers[q._id]) ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
                  </span>
                  <span>{q.label}{q.required && <span className="text-signal" aria-label="required"> *</span>}</span>
                </p>
                <div className="mt-4 pl-8">
                  <Answer q={q} value={answers[q._id]} onChange={(v) => { setAnswers((a) => ({ ...a, [q._id]: v })); setProblems((p) => ({ ...p, [q._id]: undefined })); }} />
                  <FieldError message={problems[q._id]} />
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            {data.myAnswers && <button type="button" className="btn-ghost" onClick={() => { setEditing(false); load(); }}>Cancel</button>}
            <button type="button" className="btn-primary py-3" onClick={submit} disabled={busy}>
              {busy ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" aria-hidden />} {data.myAnswers ? 'Update my answers' : 'Send feedback'}
            </button>
          </div>
        </>
      ) : (
        <Everyone data={data} onEdit={data.canRespond ? () => setEditing(true) : null} />
      )}
    </div>
  );
}

function Answer({ q, value, onChange }) {
  if (q.kind === 'rating') return <StarInput value={value ?? 0} onChange={onChange} label={q.label} />;
  if (q.kind === 'nps') {
    return (
      <div>
        <div className="grid grid-cols-11 gap-1" role="radiogroup" aria-label={q.label}>
          {Array.from({ length: 11 }, (_, n) => (
            <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => onChange(n)}
              className={`rounded-[3px] border py-2 font-mono text-sm transition-all duration-200 ${value === n
                ? `scale-110 border-transparent text-ink ${n <= 6 ? 'bg-stop' : n <= 8 ? 'bg-warn' : 'bg-go'}`
                : 'border-line-strong text-muted hover:border-fg/60 hover:text-fg'}`}>
              {n}
            </button>
          ))}
        </div>
        <p className="mt-1.5 flex justify-between font-mono text-[10px] uppercase tracking-[0.1em] text-faint"><span>Not likely</span><span>Very likely</span></p>
      </div>
    );
  }
  if (q.kind === 'choice' || q.kind === 'multi') {
    const multi = q.kind === 'multi';
    const picked = (o) => (multi ? (value ?? []).includes(o) : value === o);
    const toggle = (o) => onChange(multi ? (picked(o) ? value.filter((x) => x !== o) : [...(value ?? []), o]) : o);
    return (
      <div className="flex flex-wrap gap-2" role={multi ? 'group' : 'radiogroup'} aria-label={q.label}>
        {q.options.map((o) => (
          <button key={o} type="button" role={multi ? 'checkbox' : 'radio'} aria-checked={picked(o)} onClick={() => toggle(o)}
            className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-all duration-200 ${picked(o) ? 'border-signal bg-signal/15 text-fg' : 'border-line-strong text-muted hover:border-fg/60 hover:text-fg'}`}>
            {picked(o) && <Check className="h-3.5 w-3.5 animate-pop text-signal" aria-hidden />} {o}
          </button>
        ))}
        {multi && <p className="w-full font-mono text-[10px] uppercase tracking-[0.1em] text-faint">Pick as many as you like</p>}
      </div>
    );
  }
  return (
    <textarea className="input min-h-24" maxLength={1000} placeholder="Your answer" value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={q.label} />
  );
}

// After answering: thanks, then the anonymous totals with your picks marked.
function Everyone({ data, onEdit }) {
  const mine = Object.fromEntries((data.myAnswers ?? []).map((a) => [a.question, a.value]));
  const everyone = data.everyone;
  return (
    <div className="mt-8 space-y-6">
      {data.myAnswers ? (
        <div className="card flex flex-wrap items-center gap-4 border-go/40 p-5">
          <PartyPopper className="h-8 w-8 animate-pop text-go" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-fg">Thanks, your feedback is in.</p>
            <p className="text-sm text-muted">The organizer reads every answer. Here&apos;s how the audience felt.</p>
          </div>
          {onEdit && <button type="button" className="btn-secondary" onClick={onEdit}>Change my answers</button>}
        </div>
      ) : (
        <p className="text-sm text-muted">This form has closed.</p>
      )}
      {everyone?.hidden ? (
        <EmptyState icon={Users} title="Results soon">
          You&apos;ll see how everyone answered once {everyone.minimum} people have replied ({everyone.responses} so far). That way nobody&apos;s answers can be picked out.
        </EmptyState>
      ) : everyone ? (
        <>
          <p className="eyebrow">How everyone answered · {everyone.responses} responses</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {everyone.questions.map((q) => <QuestionResult key={q._id} q={q} mine={mine[q._id]} />)}
          </div>
        </>
      ) : null}
    </div>
  );
}
