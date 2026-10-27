import { attendeeRefundFor } from './pricing.js';

const HOUR = 3_600_000;

/**
 * Cancellation policies an organizer can pick per event, as ticketing apps
 * do. Each tier: cancel at least `hoursBefore` the show and get `percent` of
 * the ticket money back (the booking fee and its GST are never refunded).
 * Tiers run from most to least generous. The last one is always at least a
 * day out, and a show starts less than a day after its own midnight, so no
 * policy ever allows cancelling on the day of the show.
 */
export const CANCELLATION_POLICIES = {
  flexible: { label: 'Flexible', tiers: [{ hoursBefore: 24, percent: 100 }] },
  standard: { label: 'Standard', tiers: [{ hoursBefore: 7 * 24, percent: 100 }, { hoursBefore: 48, percent: 75 }, { hoursBefore: 24, percent: 50 }] },
  none: { label: 'No cancellations', tiers: [] },
};
export const DEFAULT_POLICY = 'standard';

/**
 * When each refund level ends for this event. If the organizer moved the
 * show after this booking, the buyer can get the full ticket price back right
 * up to a day before.
 */
export function refundSchedule(event, order) {
  const policy = CANCELLATION_POLICIES[event.cancellationPolicy] ?? CANCELLATION_POLICIES[DEFAULT_POLICY];
  const start = new Date(event.startsAt).getTime();
  const movedOnThem = event.rescheduledAt && order?.paidAt && new Date(event.rescheduledAt) > new Date(order.paidAt);
  const tiers = movedOnThem ? [{ hoursBefore: 24, percent: 100 }] : policy.tiers;
  return tiers.map((t) => ({ percent: t.percent, until: new Date(start - t.hoursBefore * HOUR) }));
}

/**
 * What cancelling this order right now would refund. `refund` is in whole
 * rupees; `next` says when the refund drops, so the app can warn about it.
 */
export function refundQuote(event, order, now = new Date()) {
  const schedule = refundSchedule(event, order);
  const i = schedule.findIndex((s) => now < s.until);
  const closesAt = schedule.at(-1)?.until ?? null;
  if (i === -1) return { allowed: false, percent: 0, refund: 0, closesAt, reason: schedule.length ? 'CLOSED' : 'NO_REFUNDS' };
  const { percent, until } = schedule[i];
  return {
    allowed: true,
    percent,
    refund: Math.floor((attendeeRefundFor(order) * percent) / 100),
    until,
    next: schedule[i + 1] ?? null,
    closesAt,
    rescheduled: Boolean(event.rescheduledAt && order.paidAt && new Date(event.rescheduledAt) > new Date(order.paidAt)),
  };
}
