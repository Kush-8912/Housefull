import { describe, it, expect } from 'vitest';
import { refundQuote, refundSchedule } from '../src/services/refundPolicy.js';

const HOUR = 3_600_000;
// Sun 8 Nov 2026, 7:00 pm IST.
const startsAt = new Date('2026-11-08T13:30:00Z');
const order = { amount: 2142, bookingFee: 120, gst: 22, paidAt: new Date('2026-10-01T00:00:00Z') }; // ₹2,000 of tickets
const at = (hoursBefore) => new Date(startsAt.getTime() - hoursBefore * HOUR);
const quote = (policy, hoursBefore, extra = {}) => refundQuote({ startsAt, cancellationPolicy: policy, ...extra }, order, at(hoursBefore));

describe('cancellation policies', () => {
  it('standard: full refund a week out, then 75%, then 50%, then nothing', () => {
    expect(quote('standard', 8 * 24)).toMatchObject({ allowed: true, percent: 100, refund: 2000, next: { percent: 75 } });
    expect(quote('standard', 5 * 24)).toMatchObject({ percent: 75, refund: 1500 });
    expect(quote('standard', 30)).toMatchObject({ percent: 50, refund: 1000, next: null });
    expect(quote('standard', 20)).toMatchObject({ allowed: false, reason: 'CLOSED', refund: 0 });
  });

  it('flexible: full refund until a day before; none: never', () => {
    expect(quote('flexible', 26)).toMatchObject({ percent: 100, refund: 2000 });
    expect(quote('flexible', 23)).toMatchObject({ allowed: false });
    expect(quote('none', 30 * 24)).toMatchObject({ allowed: false, reason: 'NO_REFUNDS' });
  });

  it('never allows cancelling on the day of the show, whatever time it starts', () => {
    // From 12:05 am to 11:55 pm IST on 8 Nov: every policy closes before that day begins.
    const dayStart = new Date('2026-11-07T18:30:00Z').getTime(); // 8 Nov 00:00 IST
    for (const minutes of [5, 600, 1435]) {
      const show = new Date(dayStart + minutes * 60_000);
      for (const policy of ['flexible', 'standard']) {
        expect(refundSchedule({ startsAt: show, cancellationPolicy: policy }, order).at(-1).until.getTime()).toBeLessThanOrEqual(dayStart);
      }
    }
  });

  it('gives the full ticket price back if the show was moved after booking', () => {
    const moved = { rescheduledAt: new Date('2026-10-20T00:00:00Z') };
    expect(quote('standard', 30, moved)).toMatchObject({ percent: 100, refund: 2000, rescheduled: true });
    expect(quote('none', 30, moved)).toMatchObject({ percent: 100 });
  });
});
