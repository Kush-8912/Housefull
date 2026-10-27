import { Fragment, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { FieldError, Spinner } from '../components/States';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { PasswordInput } from '../components/PasswordInput';
import { passwordMeetsRules } from '../lib/passwordRules';
import { Mask } from '../components/Motion';

// Only allow redirects back into the app (no open redirect via ?next=).
const safeNext = (next) => (next && next.startsWith('/') && !next.startsWith('//') ? next : null);

function AuthShell({ eyebrow, title, subtitle, poster, children }) {
  return (
    <div className="grid animate-rise overflow-hidden border border-line lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-signal p-10 text-ink lg:flex">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]">{eyebrow}</p>
        <p className="display relative z-10 text-[5.5rem]">
          {poster.map((line, i) => <Fragment key={i}>{i > 0 && <br />}<Mask delay={150 + i * 140}>{line}</Mask></Fragment>)}
        </p>
        {/* A few rows of seats, cropped, as texture; they fill in here and
            there like a house selling out. */}
        <div className="absolute -bottom-6 -right-10 grid rotate-[-8deg] animate-float grid-cols-9 gap-2 opacity-25" aria-hidden>
          {Array.from({ length: 45 }, (_, i) => (
            <span key={i} className="h-8 w-8 animate-twinkle rounded-t-[10px] rounded-b-[3px] border-2 border-ink" style={{ animationDelay: `${((i * 37) % 45) * 0.19}s` }} />
          ))}
        </div>
      </div>
      <div className="bg-ink-900 px-6 py-10 sm:px-12 sm:py-14">
        <h1 className="display text-5xl">{title}</h1>
        <p className="mt-2 text-sm text-muted">{subtitle}</p>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={safeNext(params.get('next')) ?? (user.role === 'organizer' ? '/organizer' : '/')} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(form.email, form.password);
      toast.success(`Welcome back, ${u.name.split(' ')[0]}`);
      navigate(safeNext(params.get('next')) ?? (u.role === 'organizer' ? '/organizer' : '/'), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const fe = error?.fieldErrors ?? {};
  return (
    <AuthShell eyebrow="Box office · returning guests" poster={['Your seat', 'is waiting.']} title="Log in" subtitle="Welcome back to SeatLock.">
      <form onSubmit={submit} noValidate className="space-y-5">
        {error && !Object.keys(fe).length && <p className="border-l-2 border-stop bg-stop/10 px-3 py-2 text-sm text-fg" role="alert">{error.message}</p>}
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" className={`input ${fe.email ? 'input-error' : ''}`} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <FieldError message={fe.email} />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <PasswordInput id="password" autoComplete="current-password" className={fe.password ? 'input-error' : ''} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <FieldError message={fe.password} />
        </div>
        <button className="btn-primary w-full py-3" disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Log in</button>
      </form>
      <p className="mt-8 text-sm text-muted">
        New here? <Link className="font-semibold text-fg underline decoration-signal underline-offset-4 hover:text-signal" to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next'))}` : ''}`}>Create an account</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'attendee' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    if (!passwordMeetsRules(form.password)) return;
    setBusy(true);
    setError(null);
    try {
      const u = await register(form);
      toast.success('Account created');
      navigate(safeNext(params.get('next')) ?? (u.role === 'organizer' ? '/organizer' : '/'), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const fe = error?.fieldErrors ?? {};
  const field = (name, label, props) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} className={`input ${fe[name] ? 'input-error' : ''}`} value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })} {...props} />
      <FieldError message={fe[name]} />
    </div>
  );

  return (
    <AuthShell eyebrow="Box office · new account" poster={['Front row', 'starts here.']} title="Create account" subtitle="Book seats, or sell tickets to your own events.">
      <form onSubmit={submit} noValidate className="space-y-5">
        {error && !Object.keys(fe).length && <p className="border-l-2 border-stop bg-stop/10 px-3 py-2 text-sm text-fg" role="alert">{error.message}</p>}
        <fieldset>
          <legend className="label">I want to</legend>
          <div className="grid grid-cols-2 gap-2">
            {[['attendee', 'Buy tickets'], ['organizer', 'Host events']].map(([value, label]) => (
              <label key={value} className={`cursor-pointer border px-3 py-3 text-center text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal ${form.role === value ? 'border-signal bg-signal/10 text-fg' : 'border-line-strong text-muted hover:border-faint hover:text-fg'}`}>
                <input type="radio" name="role" value={value} className="sr-only" checked={form.role === value} onChange={() => setForm({ ...form, role: value })} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {field('name', 'Full name', { autoComplete: 'name', required: true })}
        {field('email', 'Email', { type: 'email', autoComplete: 'email', required: true })}
        <div>
          <label className="label" htmlFor="password">Password</label>
          <PasswordInput
            id="password" autoComplete="new-password" required aria-describedby="password-rules"
            className={fe.password || (tried && !passwordMeetsRules(form.password)) ? 'input-error' : ''}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <PasswordChecklist id="password-rules" password={form.password} showErrors={tried} />
          <FieldError message={fe.password} />
        </div>
        <button className="btn-primary w-full py-3" disabled={busy}>{busy && <Spinner className="h-4 w-4" />} Create account</button>
      </form>
      <p className="mt-8 text-sm text-muted">
        Already have an account? <Link className="font-semibold text-fg underline decoration-signal underline-offset-4 hover:text-signal" to="/login">Log in</Link>
      </p>
    </AuthShell>
  );
}
