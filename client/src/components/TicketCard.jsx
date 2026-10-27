import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Send } from 'lucide-react';
import { time } from '../lib/format';

// A paper ticket: seat on top, tear-off stub with the QR code underneath.
// `printed` feeds it out of a slot (for the moment you buy it) instead of fading it in.
export function TicketCard({ ticket, eventTitle, index = 0, onTransfer, printed = false }) {
  const [copied, setCopied] = useState(false);
  const used = Boolean(ticket.checkedInAt);
  const status = ticket.status === 'cancelled' ? 'cancelled' : ticket.status === 'transferred' ? 'sent' : used ? 'used' : 'valid';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ticket.qr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked; code is still visible to select */ }
  };

  return (
    <div
      className={`group relative text-paper-ink transition-transform duration-300 hover:-translate-y-1 hover:-rotate-1 ${printed ? 'animate-print' : 'animate-rise'}`}
      style={{ animationDelay: `${(printed ? 500 : 0) + Math.min(index, 8) * (printed ? 220 : 70)}ms` }}
    >
      <div className="notch-b relative rounded-t-[4px] bg-paper px-5 pb-5 pt-4">
        {/* Holographic foil: a band of light slides across when you hover. */}
        <span
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_35%,rgb(255_120_80/0.35)_45%,rgb(120_220_255/0.35)_52%,rgb(255_255_255/0.6)_56%,transparent_66%)] bg-[length:300%_100%] bg-[position:100%_0] mix-blend-overlay transition-[background-position] duration-1000 ease-out group-hover:bg-[position:0%_0]"
          aria-hidden
        />
        <div className="flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.16em]">
          <span>Admit one</span>
          <span className={status === 'valid' ? 'text-emerald-700' : 'text-paper-ink/50'}>{status === 'valid' ? 'Valid' : status}</span>
        </div>
        <p className="display mt-3 text-[64px] leading-[0.8]">{ticket.label}</p>
        {ticket.from && <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-paper-ink/60">From {ticket.from}</p>}
        <div className="mt-3 flex items-end justify-between gap-3 border-t border-paper-line pt-2">
          <span className="min-w-0 truncate text-xs font-medium" title={eventTitle}>{eventTitle}</span>
          <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">{ticket.tier}</span>
        </div>
      </div>

      <div className="notch-t flex flex-col items-center rounded-b-[4px] border-t-2 border-dashed border-paper-line bg-paper px-5 pb-4 pt-5">
        {ticket.qr ? (
          <>
            <QRCodeSVG
              value={ticket.qrUrl ?? ticket.qr}
              size={164}
              level="M"
              marginSize={2}
              bgColor="#ffffff"
              fgColor="#1b1916"
              className={status !== 'valid' ? 'opacity-25' : ''}
              title={`Ticket ${ticket.label} for ${eventTitle}`}
            />
            <div className="mt-3 flex items-center gap-4">
              <button
                type="button"
                onClick={copy}
                className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-paper-ink/60 hover:text-paper-ink"
              >
                {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />} {copied ? 'Copied' : 'Copy code'}
              </button>
              {onTransfer && (
                <button
                  type="button"
                  onClick={() => onTransfer(ticket)}
                  className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-paper-ink/60 hover:text-paper-ink"
                >
                  <Send className="h-3 w-3" aria-hidden /> Send
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="py-14 text-center font-mono text-xs uppercase tracking-[0.1em] text-paper-ink/50">
            {status === 'sent' ? <>Sent to {ticket.transferredTo?.name ?? 'another attendee'}<br />This QR no longer works</> : 'No longer valid'}
          </p>
        )}
      </div>

      {status !== 'valid' && (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] flex justify-center" aria-hidden>
          <span className="-rotate-12 animate-stamp border-[3px] border-double border-signal px-3 py-1 text-center font-mono text-xs font-bold uppercase leading-tight tracking-[0.14em] text-signal mix-blend-multiply" style={{ animationDelay: `${250 + Math.min(index, 8) * 70}ms` }}>
            {status === 'used' ? <>Checked in<br />{time(ticket.checkedInAt)}</> : status === 'sent' ? 'Transferred' : 'Void'}
          </span>
        </div>
      )}
    </div>
  );
}
