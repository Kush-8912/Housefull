import mongoose from 'mongoose';
import { Event, seriesKey } from '../models/Event.js';
import { Order } from '../models/Order.js';
import { Review } from '../models/Review.js';
import { Interest } from '../models/Interest.js';
import { availabilityFor, minPrice } from './eventService.js';

const DAY = 86_400_000;
const oid = (id) => new mongoose.Types.ObjectId(String(id));

// Tickets sold per event since a point in time.
export async function ticketsSoldSince(eventIds, since) {
  const rows = await Order.aggregate([
    { $match: { event: { $in: eventIds.map(oid) }, status: 'paid', paidAt: { $gte: since } } },
    { $group: { _id: '$event', n: { $sum: { $size: '$items' } } } },
  ]);
  const map = new Map(rows.map((r) => [String(r._id), r.n]));
  return (id) => map.get(String(id)) ?? 0;
}

export async function ratingsFor(seriesKeys) {
  const rows = await Review.aggregate([
    { $match: { series: { $in: seriesKeys.map(oid) } } },
    { $group: { _id: '$series', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const map = new Map(rows.map((r) => [String(r._id), { avg: Math.round(r.avg * 10) / 10, count: r.count }]));
  return (key) => map.get(String(key)) ?? { avg: null, count: 0 };
}

export async function interestCounts(seriesKeys) {
  const rows = await Interest.aggregate([
    { $match: { series: { $in: seriesKeys.map(oid) } } },
    { $group: { _id: '$series', n: { $sum: 1 } } },
  ]);
  const map = new Map(rows.map((r) => [String(r._id), r.n]));
  return (key) => map.get(String(key)) ?? 0;
}

/**
 * Labels computed from real numbers, never set by hand:
 *   almost_full   10% or fewer seats left
 *   filling_fast  at least 5% of the house (min 5 tickets) sold in the last 24 hours
 *   new           published in the last 3 days
 */
export function badgesFor({ event, availability, soldLastDay, now = new Date() }) {
  const badges = [];
  if (availability && availability.available > 0) {
    if (availability.available <= Math.max(1, Math.ceil(availability.total * 0.1))) badges.push('almost_full');
    if (soldLastDay >= Math.max(5, Math.ceil(availability.total * 0.05))) badges.push('filling_fast');
  }
  if (event.publishedAt && now - event.publishedAt < 3 * DAY) badges.push('new');
  return badges;
}

// Everything a card or event page shows besides the event itself.
export async function decorate(events, { showCounts = new Map() } = {}) {
  if (!events.length) return [];
  const now = new Date();
  const keys = events.map(seriesKey);
  const [avail, soldDay, rating, interest] = await Promise.all([
    availabilityFor(events.map((e) => e._id)),
    ticketsSoldSince(events.map((e) => e._id), new Date(now - DAY)),
    ratingsFor(keys),
    interestCounts(keys),
  ]);
  return events.map((e) => {
    const availability = avail(e._id);
    return {
      ...e.toJSON(),
      rows: undefined,
      minPrice: minPrice(e),
      availability,
      showCount: showCounts.get(String(seriesKey(e))) ?? 1,
      badges: badgesFor({ event: e, availability, soldLastDay: soldDay(e._id), now }),
      rating: rating(seriesKey(e)),
      interested: interest(seriesKey(e)),
    };
  });
}

/**
 * Public listing. Showtimes of one series collapse into a single result: the
 * next show that matches the filters, plus how many shows match.
 * sort=trending orders by tickets sold in the last 7 days.
 */
export async function listEvents({ filter, page, limit, sort }) {
  const groups = await Event.aggregate([
    { $match: filter },
    { $sort: { startsAt: 1 } },
    { $group: { _id: { $ifNull: ['$seriesId', '$_id'] }, first: { $first: '$_id' }, startsAt: { $first: '$startsAt' }, ids: { $push: '$_id' }, shows: { $sum: 1 } } },
    { $sort: { startsAt: 1, _id: 1 } },
  ]);

  if (sort === 'trending') {
    const sold = await ticketsSoldSince(groups.flatMap((g) => g.ids), new Date(Date.now() - 7 * DAY));
    for (const g of groups) g.score = g.ids.reduce((s, id) => s + sold(id), 0);
    groups.sort((a, b) => b.score - a.score || a.startsAt - b.startsAt);
  }

  const slice = groups.slice((page - 1) * limit, page * limit);
  const docs = await Event.find({ _id: { $in: slice.map((g) => g.first) } }).populate('organizer', 'name');
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const ordered = slice.map((g) => byId.get(String(g.first))).filter(Boolean);
  const showCounts = new Map(slice.map((g) => [String(g._id), g.shows]));

  return {
    items: await decorate(ordered, { showCounts }),
    page,
    pages: Math.max(1, Math.ceil(groups.length / limit)),
    total: groups.length,
  };
}

// Sibling showtimes for an event page (drafts only for their owner).
export async function showsFor(event, { includeDrafts = false } = {}) {
  if (!event.seriesId) return [];
  const statuses = includeDrafts ? ['draft', 'published', 'cancelled'] : ['published', 'cancelled'];
  const shows = await Event.find({ $or: [{ _id: event.seriesId }, { seriesId: event.seriesId }], status: { $in: statuses } }, 'startsAt status durationMinutes')
    .sort({ startsAt: 1 });
  const avail = await availabilityFor(shows.map((s) => s._id));
  const now = new Date();
  return shows.map((s) => ({ id: s._id, startsAt: s.startsAt, status: s.status, onSale: s.isOnSale(now), past: s.startsAt <= now, availability: avail(s._id) }));
}
