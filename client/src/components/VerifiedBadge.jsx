import { BadgeCheck } from 'lucide-react';

// Shown wherever a host's identity check matters: their events and dashboard.
export function VerifiedBadge({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-go ${className}`} title="This host’s identity has been verified">
      <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified host
    </span>
  );
}
