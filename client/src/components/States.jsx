import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';

export function Spinner({ className = 'h-5 w-5' }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden />;
}

export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4" role="status">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="h-3 w-3 animate-pulse-dot rounded-t-[4px] rounded-b-[1px] bg-signal" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </span>
      <span className="eyebrow">{label.replace(/…$/, '')}…</span>
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }) {
  const notFound = error?.status === 404;
  return (
    <div className="mx-auto my-12 max-w-md border-l-2 border-warn bg-ink-900 p-8" role="alert">
      <AlertTriangle className="h-6 w-6 text-warn" aria-hidden />
      <h2 className="display mt-4 text-3xl">{notFound ? 'Not found' : title}</h2>
      <p className="mt-2 text-sm text-muted">{error?.message ?? 'Please try again.'}</p>
      {onRetry && !notFound && (
        <button type="button" className="btn-secondary mt-6" onClick={onRetry}>Try again</button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, children, action }) {
  return (
    <div className="flex flex-col items-center border border-dashed border-line-strong px-6 py-16 text-center">
      <Icon className="h-8 w-8 text-faint" strokeWidth={1.5} aria-hidden />
      <h3 className="display mt-4 text-2xl">{title}</h3>
      {children && <p className="mt-2 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

const BADGE = {
  draft: 'text-muted before:bg-faint',
  published: 'text-go before:bg-go',
  cancelled: 'text-stop before:bg-stop',
  paid: 'text-go before:bg-go',
  refunded: 'text-warn before:bg-warn',
  valid: 'text-go before:bg-go',
  used: 'text-sky-300 before:bg-sky-300',
  ended: 'text-muted before:bg-faint',
};

export function Badge({ status, children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-current/25 px-2 py-0.5 font-mono text-[10.5px] font-medium tracking-[0.08em] uppercase
        before:h-1.5 before:w-1.5 before:rounded-full ${BADGE[status] ?? BADGE.draft}`}
    >
      {children ?? status}
    </span>
  );
}

export function FieldError({ message }) {
  if (!message) return null;
  return <p className="mt-1.5 text-xs text-stop">{message}</p>;
}

export function Notice({ tone = 'warn', children, className = '' }) {
  const tones = {
    warn: 'border-warn text-warn',
    stop: 'border-stop text-stop',
    info: 'border-signal text-fg',
  };
  return (
    <div className={`border-l-2 bg-ink-900 px-4 py-3 text-sm ${tones[tone]} ${className}`} role="status">
      <span className="text-fg/90">{children}</span>
    </div>
  );
}
