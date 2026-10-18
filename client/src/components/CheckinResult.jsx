import { time } from '../lib/format';
import { Avatar } from './Avatar';

export const CHECKIN_MESSAGES = {
  ALREADY_CHECKED_IN: 'Already used',
  WRONG_EVENT: 'Wrong event',
  TICKET_CANCELLED: 'Cancelled ticket',
  INVALID_TICKET: 'Invalid ticket',
  TICKET_TRANSFERRED: 'Transferred ticket',
  NOT_YOUR_EVENT: 'Not your event',
  CHECKIN_CLOSED: 'Doors closed',
  EVENT_CANCELLED: 'Event cancelled',
};

// The ring draws itself, then the tick (or cross) strokes in after it.
function Mark({ ok }) {
  return (
    <svg viewBox="0 0 52 52" className="h-20 w-20 animate-pop" aria-hidden>
      <circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset="1" className="animate-draw" />
      <path
        d={ok ? 'M15 27 l7.5 7.5 L37.5 19' : 'M18 18 L34 34 M34 18 L18 34'}
        fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
        pathLength="1" strokeDasharray="1" strokeDashoffset="1"
        className="animate-draw [animation-delay:350ms]"
      />
    </svg>
  );
}

/**
 * What the guard at the door sees after a scan: big enough to read at arm's
 * length, green with the ticket holder's account name or red with the reason.
 * `result` is { ok: true, ...checkin } or { ok: false, title, message, details }.
 */
export function CheckinResult({ result, className = '' }) {
  if (result.ok) {
    return (
      <div key={result.at} className={`flex flex-col items-center justify-center bg-go p-8 text-center text-ink ${className}`} role="status">
        <Mark ok />
        <p className="mt-3 font-mono text-xs font-semibold uppercase tracking-[0.16em]">Verified · Admit</p>

        <div className="mt-6 flex animate-rise items-center gap-3 [animation-delay:450ms]">
          {/* The photo lets door staff check the person matches the account. */}
          <Avatar name={result.attendee} src={result.attendeeAvatarUrl} className={`bg-ink font-mono font-semibold text-go ${result.attendeeAvatarUrl ? 'h-16 w-16 ring-2 ring-ink' : 'h-12 w-12 text-sm'}`} />
          <span className="min-w-0 text-left">
            <span className="block truncate text-2xl font-bold leading-tight">{result.attendee ?? 'Unknown account'}</span>
            {result.attendeeEmail && <span className="block truncate text-sm opacity-75">{result.attendeeEmail}</span>}
          </span>
        </div>

        <div className="mt-6 flex animate-rise items-stretch divide-x divide-ink/20 border-y border-ink/20 [animation-delay:550ms]">
          <span className="px-5 py-2">
            <span className="block font-mono text-[10px] uppercase tracking-[0.14em] opacity-70">Seat</span>
            <span className="block font-mono text-3xl font-semibold">{result.label}</span>
          </span>
          <span className="px-5 py-2">
            <span className="block font-mono text-[10px] uppercase tracking-[0.14em] opacity-70">Tier</span>
            <span className="mt-1.5 block text-lg font-semibold">{result.tier}</span>
          </span>
        </div>
        {result.event && <p className="mt-4 animate-rise text-sm font-medium [animation-delay:600ms]">{result.event.title}{result.event.venue && ` · ${result.event.venue}`}</p>}
      </div>
    );
  }

  return (
    <div key={result.at} className={`flex flex-col items-center justify-center bg-stop p-8 text-center text-ink ${className}`} role="alert">
      <Mark ok={false} />
      <p className="display mt-4 text-6xl">Stop</p>
      <p className="mt-2 font-mono text-sm font-semibold uppercase tracking-[0.12em]">Do not admit · {result.title}</p>
      <p className="mt-3 text-sm font-medium">{result.message}</p>
      {result.details?.checkedInAt && (
        <p className="mt-1 text-sm">First scanned at {time(result.details.checkedInAt)}{result.details.attendee && ` · ${result.details.attendee}`}</p>
      )}
    </div>
  );
}
