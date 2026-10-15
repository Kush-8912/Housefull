import mongoose from 'mongoose';
import { Event, rowCapacity } from '../models/Event.js';
import { Seat, effectiveStatus } from '../models/Seat.js';
import { Addon } from '../models/Addon.js';
import { AppError } from '../utils/AppError.js';

export const MAX_CAPACITY = 1500;

// Cross-field rules zod can't express per-field: tiers referenced by rows must
// exist, labels must be unique, and the venue can't exceed MAX_CAPACITY.
export function assertValidLayout({ tiers, rows }) {
  const tierNames = new Set();
  for (const t of tiers) {
    const key = t.name.toLowerCase();
    if (tierNames.has(key)) throw AppError.badRequest(`Duplicate tier "${t.name}"`);
    tierNames.add(key);
  }
  const labels = new Set();
  for (const r of rows) {
    const label = r.label.toUpperCase();
    if (labels.has(label)) throw AppError.badRequest(`Duplicate row "${r.label}"`);
    labels.add(label);
    if (!tierNames.has(r.tier.toLowerCase())) throw AppError.badRequest(`Row ${r.label} uses unknown tier "${r.tier}"`);
    assertSeatOptions(r);
  }
  const capacity = rows.reduce((s, r) => s + rowCapacity(r), 0);
  if (capacity < 1) throw AppError.badRequest('The layout needs at least one seat for sale');
  if (capacity > MAX_CAPACITY) throw AppError.badRequest(`Capacity ${capacity} exceeds the ${MAX_CAPACITY}-seat limit`);
}

// Aisles, blocked and accessible seats must point at real seats in the row.
function assertSeatOptions(row) {
  const check = (list = [], what, max) => {
    if (new Set(list).size !== list.length) throw AppError.badRequest(`Row ${row.label} lists the same ${what} twice`);
    const bad = list.find((n) => n < 1 || n > max);
    if (bad !== undefined) throw AppError.badRequest(`Row ${row.label} has ${row.seats} seats, so it can't have ${what} ${bad}`);
  };
  check(row.aisleAfter, 'an aisle after seat', row.seats - 1);
  check(row.blocked, 'blocked seat', row.seats);
  check(row.accessible, 'accessible seat', row.seats);
  const both = row.accessible?.find((n) => row.blocked?.includes(n));
  if (both !== undefined) throw AppError.badRequest(`Seat ${row.label}${both} can't be both blocked and accessible`);
}

// Sales must still be open by the time the event goes live, and open before they close.
export function assertSalesWindow({ startsAt, salesStartAt, salesCloseMinutes = 0 }) {
  const end = new Date(startsAt).getTime() - (salesCloseMinutes ?? 0) * 60_000;
  const fail = (field, message) => {
    throw AppError.badRequest(message, { code: 'VALIDATION_ERROR', details: [{ field, message }] });
  };
  if (end <= Date.now()) fail('salesCloseMinutes', 'Sales would already be closed. Close them later, or move the show.');
  if (salesStartAt && new Date(salesStartAt).getTime() >= end) fail('salesStartAt', 'Sales must open before they close');
}

// Blocked seats get no document, so they can never be held or sold.
export function buildSeats(event) {
  const priceOf = new Map(event.tiers.map((t) => [t.name.toLowerCase(), t]));
  return event.rows.flatMap((row) => {
    const tier = priceOf.get(row.tier.toLowerCase());
    const blocked = new Set(row.blocked ?? []);
    const accessible = new Set(row.accessible ?? []);
    return Array.from({ length: row.seats }, (_, i) => i + 1)
      .filter((n) => !blocked.has(n))
      .map((n) => ({
        event: event._id,
        row: row.label,
        number: n,
        label: `${row.label}${n}`,
        tier: tier.name,
        price: tier.price,
        accessible: accessible.has(n),
      }));
  });
}

// Publishing locks the layout and materialises one Seat document per seat.
// The draft->published transition is a conditional update so two concurrent
// publish requests can't both generate seats; the unique (event,label) index
// is the second line of defence.
export async function publishEvent(event) {
  if (event.startsAt <= new Date()) throw AppError.badRequest('Cannot publish an event that starts in the past');
  assertSalesWindow(event);

  const claimed = await Event.findOneAndUpdate(
    { _id: event._id, status: 'draft' },
    { status: 'published', publishedAt: new Date() },
    { returnDocument: 'after' },
  );
  if (!claimed) throw AppError.conflict('Only draft events can be published');

  try {
    await Seat.insertMany(buildSeats(claimed), { ordered: true });
  } catch (err) {
    // Roll back so the organizer can retry from a clean draft.
    await Seat.deleteMany({ event: claimed._id });
    await Event.updateOne({ _id: claimed._id }, { status: 'draft', $unset: { publishedAt: 1 } });
    throw err;
  }
  return claimed;
}

// Seat counts per event, with expired holds counted as available.
export async function availabilityFor(eventIds) {
  const now = new Date();
  const ids = eventIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const rows = await Seat.aggregate([
    { $match: { event: { $in: ids } } },
    {
      $group: {
        _id: '$event',
        total: { $sum: 1 },
        sold: { $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] } },
        held: {
          $sum: { $cond: [{ $and: [{ $eq: ['$status', 'held'] }, { $gt: ['$holdExpiresAt', now] }] }, 1, 0] },
        },
      },
    },
  ]);
  const map = new Map(rows.map((r) => [String(r._id), { total: r.total, sold: r.sold, held: r.held, available: r.total - r.sold - r.held }]));
  return (id) => map.get(String(id)) ?? null;
}

export async function seatMapFor(eventId, viewerHoldId = null) {
  const now = new Date();
  const seats = await Seat.find({ event: eventId }).sort({ row: 1, number: 1 }).lean();
  return seats.map((s) => {
    const status = effectiveStatus(s, now);
    return {
      id: s._id,
      label: s.label,
      row: s.row,
      number: s.number,
      tier: s.tier,
      price: s.price,
      accessible: Boolean(s.accessible),
      status,
      mine: status === 'held' && viewerHoldId != null && String(s.hold) === String(viewerHoldId),
    };
  });
}

export function minPrice(event) {
  return Math.min(...event.tiers.map((t) => t.price));
}

/**
 * Add another showtime of the same production. The new show copies the
 * layout, prices, description and add-on menu, gets its own seats and its
 * own stock, and joins the source's series. A published source produces a
 * published show; a draft produces a draft.
 */
export async function addShowtime(source, startsAt) {
  if (source.status === 'cancelled') throw AppError.conflict('Cancelled events can’t get new showtimes');
  if (startsAt <= new Date()) throw AppError.badRequest('Showtime must be in the future', { code: 'VALIDATION_ERROR', details: [{ field: 'startsAt', message: 'Must be in the future' }] });

  const key = source.seriesId ?? source._id;
  const clash = await Event.exists({
    $or: [{ _id: key }, { seriesId: key }],
    status: { $ne: 'cancelled' },
    startsAt: { $gt: new Date(startsAt.getTime() - 60_000), $lt: new Date(startsAt.getTime() + 60_000) },
  });
  if (clash) throw AppError.conflict('There is already a showtime at that time', { code: 'DUPLICATE' });
  if ((await Event.countDocuments({ seriesId: key })) >= 30) throw AppError.badRequest('A series can have at most 30 showtimes');

  if (!source.seriesId) await Event.updateOne({ _id: source._id }, { seriesId: source._id });

  // Sales for a new showtime open on publish and close the same way as the source's.
  const pick = (({ organizer, title, description, category, venue, durationMinutes, coverImageUrl, tiers, rows, maxPerOrder, salesCloseMinutes }) =>
    ({ organizer, title, description, category, venue, durationMinutes, coverImageUrl, tiers, rows, maxPerOrder, salesCloseMinutes }))(source.toObject());
  const show = await Event.create({ ...pick, startsAt, seriesId: key, status: 'draft' });

  const menu = await Addon.find({ event: source._id, active: true }).lean();
  if (menu.length) {
    await Addon.insertMany(menu.map(({ name, description, kind, price, stock, maxPerOrder }) => ({ event: show._id, name, description, kind, price, stock, maxPerOrder })));
  }

  return source.status === 'published' ? publishEvent(show) : show;
}
