import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Camera, Check, Ticket, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { CATEGORY_LABELS, dayMonth, shortDate } from '../lib/format';
import { EmptyState, ErrorState, FieldError, Spinner } from '../components/States';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { PasswordInput } from '../components/PasswordInput';
import { passwordMeetsRules } from '../lib/passwordRules';
import { squareImage } from '../lib/squareImage';
import { Avatar } from '../components/Avatar';

const memberSince = (d) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(d));

const STATS = {
  attendee: [['attended', 'Shows attended'], ['upcoming', 'Upcoming'], ['reviews', 'Reviews written']],
  organizer: [['hosted', 'Events hosted'], ['upcoming', 'Upcoming'], ['sold', 'Tickets sold'], ['checkedIn', 'Guests checked in']],
};

export function ProfilePage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    api('/auth/me/profile').then((d) => { setSummary(d); setError(null); }).catch(setError);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <section className="flex flex-wrap items-end gap-6 border-b border-line pb-10">
        <ProfilePhoto />
        <div className="min-w-0">
          <p className="eyebrow">{user.role === 'organizer' ? 'Organizer account' : 'Your account'}</p>
          <h1 className="display mt-3 break-words text-6xl [word-spacing:0.18em] sm:text-7xl">{user.name}</h1>
          <p className="mt-3 font-mono text-xs uppercase tracking-[0.1em] text-muted">
            <span className="normal-case">{user.email}</span> · Member since {memberSince(user.createdAt)}
          </p>
        </div>
      </section>

      {error ? (
        <div className="mt-10"><ErrorState error={error} onRetry={load} /></div>
      ) : (
        <Stats role={user.role} stats={summary?.stats} />
      )}

      {user.role === 'attendee' && summary && <History items={summary.history} />}

      <section className="mt-16" aria-labelledby="settings">
        <h2 id="settings" className="display text-4xl">Account</h2>
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
          <NameForm />
          {user.hasPassword === false ? <GoogleOnly /> : <PasswordForm />}
        </div>
      </section>
    </div>
  );
}

// The big avatar on the profile, with buttons to add, change or remove the photo.
function ProfilePhoto() {
  const { user, updateUser } = useAuth();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);

  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // picking the same file again should still fire
    if (!file) return;
    setBusy(true);
    try {
      const image = await squareImage(file);
      const { user: u } = await api('/auth/me/avatar', { method: 'PUT', body: image });
      updateUser(u);
      toast.success('Profile photo updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { user: u } = await api('/auth/me/avatar', { method: 'DELETE' });
      updateUser(u);
      toast.success('Profile photo removed');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="group relative rounded-full focus-visible:outline-offset-4"
        aria-label={user.avatarUrl ? 'Change profile photo' : 'Add a profile photo'}
      >
        <Avatar name={user.name} src={user.avatarUrl} className="display h-24 w-24 bg-signal text-5xl text-ink" />
        <span className={`absolute inset-0 flex items-center justify-center rounded-full bg-ink/60 text-fg transition-opacity ${busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`} aria-hidden>
          {busy ? <Spinner className="h-6 w-6" /> : <Camera className="h-6 w-6" />}
        </span>
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="sr-only" tabIndex={-1} onChange={choose} />
      <div className="flex items-center gap-3 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
        <button type="button" className="text-muted hover:text-fg disabled:opacity-50" disabled={busy} onClick={() => input.current?.click()}>
          {user.avatarUrl ? 'Change' : 'Add photo'}
        </button>
        {user.avatarUrl && (
          <button type="button" className="flex items-center gap-1 text-muted hover:text-stop disabled:opacity-50" disabled={busy} onClick={remove}>
            <Trash2 className="h-3 w-3" aria-hidden /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

function Stats({ role, stats }) {
  const items = STATS[role] ?? STATS.attendee;
  return (
    <dl className={`mt-10 grid gap-x-3 gap-y-6 sm:gap-6 ${items.length === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3'}`}>
      {items.map(([key, label]) => (
        <div key={key} className="flex flex-col border-l border-line pl-3 sm:pl-4">
          <dt className="eyebrow">{label}</dt>
          <dd className="display mt-auto pt-2 text-4xl tabular sm:text-5xl">
            {stats ? stats[key].toLocaleString('en-IN') : <span className="inline-block h-10 w-12 animate-pulse bg-ink-850" aria-label="Loading" />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Stubs from shows the attendee was checked in at: the paper that made it through the door.
function History({ items }) {
  return (
    <section className="mt-16" aria-labelledby="history">
      <h2 id="history" className="display text-4xl">Shows you&rsquo;ve been to</h2>
      {items.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={Ticket} title="No shows yet" action={<Link to="/" className="btn-primary">Find something to see</Link>}>
            Once your ticket is scanned at the door, the show is kept here.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((h) => {
            const { day, month } = dayMonth(h.startsAt);
            return (
              <li key={h.eventId}>
                <Link to={`/events/${h.eventId}`} className="group flex overflow-hidden rounded-[4px] bg-paper text-paper-ink transition-transform hover:-translate-y-0.5">
                  <span className="flex w-16 shrink-0 flex-col items-center justify-center border-r-2 border-dashed border-paper-line py-4">
                    <span className="display text-3xl leading-none">{day}</span>
                    <span className="mt-1 font-mono text-[10px] font-semibold tracking-[0.14em]">{month}</span>
                  </span>
                  <span className="min-w-0 flex-1 px-4 py-3">
                    <span className="block truncate font-semibold group-hover:underline">{h.title}</span>
                    <span className="block truncate text-xs text-paper-ink/70">{h.venue?.name}, {h.venue?.city}</span>
                    <span className="mt-2 flex items-center justify-between gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-paper-ink/70">
                      <span className="truncate">Seat{h.seats.length > 1 ? 's' : ''} {h.seats.join(', ')}</span>
                      <span className="shrink-0">{CATEGORY_LABELS[h.category] ?? ''}</span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 0 && <p className="mt-3 text-xs text-faint">Showing your {items.length} most recent · since {shortDate(items.at(-1).startsAt)}</p>}
    </section>
  );
}

function NameForm() {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const unchanged = name.trim() === user.name;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user: u } = await api('/auth/me', { method: 'PATCH', body: { name } });
      updateUser(u);
      setName(u.name);
      toast.success('Name updated');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const fe = error?.fieldErrors ?? {};
  return (
    <form onSubmit={submit} noValidate className="card p-6">
      <h3 className="eyebrow text-fg">Your name</h3>
      <p className="mt-1 text-sm text-muted">Shown on your tickets and to door staff when they scan you in.</p>
      <div className="mt-5">
        <label className="label" htmlFor="profile-name">Full name</label>
        <input id="profile-name" autoComplete="name" className={`input ${fe.name ? 'input-error' : ''}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <FieldError message={fe.name ?? (!Object.keys(fe).length ? error?.message : null)} />
      </div>
      <button className="btn-primary mt-5" disabled={busy || unchanged || !name.trim()}>{busy && <Spinner className="h-4 w-4" />} Save name</button>
    </form>
  );
}

// Accounts created with "Continue with Google" have no password to change.
function GoogleOnly() {
  return (
    <div className="card p-6">
      <h3 className="eyebrow text-fg">Password</h3>
      <p className="mt-3 text-sm text-muted">You sign in with Google, so there&apos;s no Housefull password on this account. Manage your sign-in from your Google account.</p>
    </div>
  );
}

const EMPTY_PASSWORDS = { currentPassword: '', newPassword: '', confirm: '' };

function PasswordForm() {
  const [form, setForm] = useState(EMPTY_PASSWORDS);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const rulesMet = passwordMeetsRules(form.newPassword);
  const matches = form.confirm !== '' && form.confirm === form.newPassword;

  const submit = async (e) => {
    e.preventDefault();
    setTried(true);
    if (!rulesMet) return;
    if (form.newPassword !== form.confirm) {
      setError({ fieldErrors: { confirm: 'Passwords don’t match' } });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      setForm(EMPTY_PASSWORDS);
      setTried(false);
      toast.success('Password changed', { description: 'You’ve been signed out on your other devices.' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const fe = error?.fieldErrors ?? {};
  const field = (key, label, autoComplete, { invalid = false, after = null } = {}) => (
    <div>
      <label className="label" htmlFor={`pw-${key}`}>{label}</label>
      <PasswordInput
        id={`pw-${key}`} autoComplete={autoComplete} aria-describedby={after ? `pw-${key}-help` : undefined}
        className={fe[key] || invalid ? 'input-error' : ''} value={form[key]} onChange={set(key)}
      />
      {after}
      <FieldError message={fe[key]} />
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="card space-y-4 p-6">
      <div>
        <h3 className="eyebrow text-fg">Change password</h3>
        <p className="mt-1 text-sm text-muted">Other devices are signed out when you change it.</p>
      </div>
      {error?.message && !Object.keys(fe).length && <p className="border-l-2 border-stop bg-stop/10 px-3 py-2 text-sm text-fg" role="alert">{error.message}</p>}
      {field('currentPassword', 'Current password', 'current-password')}
      {field('newPassword', 'New password', 'new-password', {
        invalid: tried && !rulesMet,
        after: <PasswordChecklist id="pw-newPassword-help" password={form.newPassword} showErrors={tried} />,
      })}
      {field('confirm', 'Confirm new password', 'new-password', {
        after: form.confirm && !fe.confirm ? (
          <p id="pw-confirm-help" className={`mt-2 flex items-center gap-1.5 text-xs ${matches ? 'text-go' : 'text-muted'}`}>
            {matches ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : null}
            {matches ? 'Passwords match' : 'Doesn’t match yet'}
          </p>
        ) : null,
      })}
      <button className="btn-primary" disabled={busy || !form.currentPassword || !form.newPassword || !form.confirm}>{busy && <Spinner className="h-4 w-4" />} Change password</button>
    </form>
  );
}
