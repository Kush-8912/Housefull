import { Interest } from '../models/Interest.js';
import { Order } from '../models/Order.js';
import { Review } from '../models/Review.js';
import { Ticket } from '../models/Ticket.js';
import { WaitlistEntry } from '../models/WaitlistEntry.js';
import { seriesKey } from '../models/Event.js';

const MIN = 60_000;
const DAY = 86_400_000;
// Arrivals are grouped in 15-minute slots from 90 minutes before the start to 90 after.
const SLOT_MIN = 15;
const ARRIVAL_WINDOW = { before: 90, after: 90 };
// How far ahead people bought, in days before the show.
const LEAD_BUCKETS = [
  { label: 'Same day', max: 1 },
  { label: '1–3 days', max: 4 },
  { label: '4–7 days', max: 8 },
  { label: '1–2 weeks', max: 15 },
  { label: '2+ weeks', max: Infinity },
];
const ASPECTS = ['performance', 'venue', 'value'];

const round1 = (x) => Math.round(x * 10) / 10;
const ratio = (a, b) => (b ? a / b : 0);

/**
 * "How did it go": the after-show view of one event for its organizer.
 * Attendance (who came, who didn't, when they arrived), how and when tickets
 * sold, money in and out, and what attendees said, including the notes they
 * left only for the organizer. Every number is aggregated from the source
 * collections, so it always matches the dashboard and the guest list.
 */
export async function eventReport(event) {
  const start = event.startsAt.getTime();
  const key = seriesKey(event);

  const [tierRows, arrivals, orders, reviews, waitlist, interested] = await Promise.all([
    Ticket.aggregate([
      { $match: { event: event._id, status: 'valid' } },
      { $group: { _id: '$tier', sold: { $sum: 1 }, came: { $sum: { $cond: [{ $ne: ['$checkedInAt', null] }, 1, 0] } } } },
    ]),
    Ticket.find({ event: event._id, status: 'valid', checkedInAt: { $ne: null } }, 'checkedInAt').lean(),
    Order.find({ event: event._id, status: { $in: ['paid', 'refunded', 'cancelled'] } }, 'status items amount bookingFee gst refundedAmount discount promo addonsTotal paidAt').lean(),
    Review.find({ event: event._id }, 'rating text aspects recommend privateNote createdAt user').sort({ createdAt: -1 }).populate('user', 'name').lean(),
    WaitlistEntry.countDocuments({ event: event._id }),
    Interest.countDocuments({ series: key }),
  ]);

  // Attendance
  const tierOrder = event.tiers.map((t) => t.name);
  const tiers = tierRows
    .map((r) => ({ tier: r._id, sold: r.sold, came: r.came, turnout: ratio(r.came, r.sold) }))
    .sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier));
  const sold = tiers.reduce((s, t) => s + t.sold, 0);
  const came = tiers.reduce((s, t) => s + t.came, 0);

  const slots = [];
  for (let m = -ARRIVAL_WINDOW.before; m < ARRIVAL_WINDOW.after; m += SLOT_MIN) slots.push({ minutes: m, count: 0 });
  let early = 0;
  let late = 0;
  for (const { checkedInAt } of arrivals) {
    const mins = (checkedInAt.getTime() - start) / MIN;
    if (mins < -ARRIVAL_WINDOW.before) early += 1;
    else if (mins >= ARRIVAL_WINDOW.after) late += 1;
    else slots[Math.floor((mins + ARRIVAL_WINDOW.before) / SLOT_MIN)].count += 1;
  }
  const afterStart = arrivals.filter((t) => t.checkedInAt.getTime() > start).length;
  const peak = slots.reduce((best, s) => (s.count > (best?.count ?? 0) ? s : best), null);

  // Sales
  const paid = orders.filter((o) => o.status === 'paid');
  const lead = LEAD_BUCKETS.map((b) => ({ label: b.label, tickets: 0 }));
  for (const o of paid) {
    const days = (start - new Date(o.paidAt).getTime()) / DAY;
    const i = LEAD_BUCKETS.findIndex((b) => days < b.max);
    lead[i === -1 ? lead.length - 1 : i].tickets += o.items.length;
  }
  const ticketsInPaidOrders = paid.reduce((s, o) => s + o.items.length, 0);
  const net = (o) => o.amount - (o.bookingFee ?? 0) - (o.gst ?? 0);
  const revenue = paid.reduce((s, o) => s + net(o), 0);
  const refunded = orders.filter((o) => o.status !== 'paid');

  // Feedback
  const rated = reviews.length;
  const aspects = Object.fromEntries(ASPECTS.map((a) => {
    const scores = reviews.map((r) => r.aspects?.[a]).filter(Boolean);
    return [a, scores.length ? round1(scores.reduce((s, x) => s + x, 0) / scores.length) : null];
  }));
  const answered = reviews.filter((r) => r.recommend !== null && r.recommend !== undefined);
  const name = (r) => r.user?.name?.split(' ')[0] ?? 'Attendee';

  return {
    event: { id: event._id, title: event.title, startsAt: event.startsAt, status: event.status, ended: Date.now() > start + event.durationMinutes * MIN },
    attendance: {
      capacity: event.capacity,
      sold,
      came,
      noShows: sold - came,
      turnout: ratio(came, sold),
      fill: ratio(sold, event.capacity),
      afterStart,
      tiers,
      arrivals: { slotMinutes: SLOT_MIN, slots, early, late, peak: peak && peak.count > 0 ? peak : null },
    },
    sales: {
      orders: paid.length,
      ticketsPerOrder: round1(ratio(ticketsInPaidOrders, paid.length)),
      revenue,
      averageOrder: Math.round(ratio(revenue, paid.length)),
      addons: paid.reduce((s, o) => s + (o.addonsTotal ?? 0), 0),
      discounts: paid.reduce((s, o) => s + (o.discount ?? 0), 0),
      promoOrders: paid.filter((o) => o.promo?.code).length,
      refunds: { orders: refunded.length, amount: refunded.reduce((s, o) => s + (o.refundedAmount ?? 0), 0) },
      leadTime: lead,
      waitlist,
      interested,
    },
    feedback: {
      count: rated,
      responseRate: ratio(rated, came),
      avg: rated ? round1(reviews.reduce((s, r) => s + r.rating, 0) / rated) : null,
      distribution: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, reviews.filter((r) => r.rating === n).length])),
      aspects,
      recommend: answered.length ? { yes: answered.filter((r) => r.recommend).length, answered: answered.length } : null,
      comments: reviews.filter((r) => r.text).slice(0, 10).map((r) => ({ author: name(r), rating: r.rating, text: r.text, createdAt: r.createdAt })),
      privateNotes: reviews.filter((r) => r.privateNote).slice(0, 20).map((r) => ({ author: name(r), rating: r.rating, note: r.privateNote, createdAt: r.createdAt })),
    },
  };
}
