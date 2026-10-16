import { Router } from 'express';
import { env } from '../config/env.js';
import { canonicalCity } from '../utils/cities.js';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Event, CATEGORIES, seriesKey } from '../models/Event.js';
import { Interest } from '../models/Interest.js';
import { Seat } from '../models/Seat.js';
import { Hold } from '../models/Hold.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole, verifyToken, AUTH_COOKIE } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { cancelEvent } from '../services/orderService.js';
import { assertValidLayout, assertSalesWindow, publishEvent, availabilityFor, seatMapFor, addShowtime } from '../services/eventService.js';
import { listEvents, decorate, showsFor } from '../services/discoveryService.js';
import { reviewsFor, saveReview, deleteReview } from '../services/reviewService.js';
import { joinWaitlist, leaveWaitlist, waitlistStatus } from '../services/waitlistService.js';

export const eventsRouter = Router();

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const tier = z.object({
  name: z.string().trim().min(1, 'Tier name is required').max(30),
  price: z.number('Price must be a number').int('Price must be a whole number').min(0, 'Price cannot be negative').max(100000, 'Price can be at most ₹1,00,000'),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Color must be a hex code like #6366f1').optional(),
  description: z.string().trim().max(120, 'Tier description can be at most 120 characters').default(''),
});
const seatNumbers = z.array(z.number().int().min(1)).max(60).default([]);
const row = z.object({
  label: z.string().trim().min(1).max(3).regex(/^[A-Za-z0-9]+$/, 'Row labels are letters/numbers').transform((s) => s.toUpperCase()),
  seats: z.number('Seats must be a number').int().min(1, 'A row needs at least 1 seat').max(60, 'A row can have at most 60 seats'),
  tier: z.string().trim().min(1, 'Pick a tier for every row'),
  aisleAfter: seatNumbers,
  blocked: seatNumbers,
  accessible: seatNumbers,
});

const eventBody = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(120, 'Title must be 120 characters or fewer'),
  description: z.string().trim().max(4000).default(''),
  category: z.enum(CATEGORIES, 'Choose a category'),
  venue: z.object({
    name: z.string().trim().min(2, 'Venue name is required').max(120),
    city: z.string().trim().min(2, 'City is required').max(60).transform(canonicalCity),
  }),
  startsAt: z.coerce.date('Enter a valid start date and time').refine((d) => d > new Date(), 'Start time must be in the future'),
  durationMinutes: z.number('Duration must be a number').int().min(15, 'Duration must be at least 15 minutes').max(1440, 'Duration can be at most 24 hours').default(120),
  coverImageUrl: z.union([z.url('Cover image must be a valid URL'), z.literal('')], 'Cover image must be a valid URL').default(''),
  tiers: z.array(tier).min(1, 'Add at least one ticket tier').max(6, 'At most 6 tiers'),
  rows: z.array(row).min(1, 'Add at least one row').max(40, 'At most 40 rows'),
  maxPerOrder: z.number('Max tickets per order must be a number').int().min(1, 'Allow at least 1 ticket per order')
    .max(env.MAX_SEATS_PER_HOLD, `At most ${env.MAX_SEATS_PER_HOLD} tickets per order`).nullable().default(null),
  salesStartAt: z.coerce.date('Enter a valid sales start time').nullable().default(null),
  salesCloseMinutes: z.number().int().min(0).max(7 * 24 * 60, 'Sales can close at most 7 days before the show').default(0),
});

// Once published the layout and price are frozen: buyers have already seen them.
const publishedPatch = eventBody.pick({ description: true, coverImageUrl: true }).partial();

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(CATEGORIES).optional(),
  city: z.string().trim().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  sort: z.enum(['date', 'trending']).default('date'),
});

async function loadOwnedEvent(req) {
  const event = await Event.findById(req.params.id);
  if (!event) throw AppError.notFound('Event');
  if (!event.organizer.equals(req.user._id)) throw AppError.forbidden('You can only manage your own events');
  return event;
}

// Public browse/search: upcoming published events only.
eventsRouter.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const { q, category, city, from, to, page, limit, sort } = req.validatedQuery;
  const filter = { status: 'published', startsAt: { $gt: new Date() } };
  if (from && from > filter.startsAt.$gt) filter.startsAt.$gt = from;
  if (to) filter.startsAt.$lte = to;
  if (category) filter.category = category;
  if (city) filter['venue.city'] = new RegExp(`^${escapeRegex(canonicalCity(city))}$`, 'i');
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ title: rx }, { 'venue.name': rx }, { description: rx }];
  }

  res.json(await listEvents({ filter, page, limit, sort }));
}));

// Cities with something on sale, and how many upcoming shows each has (for the city map).
eventsRouter.get('/cities', asyncHandler(async (_req, res) => {
  const rows = await Event.aggregate([
    { $match: { status: 'published', startsAt: { $gt: new Date() } } },
    { $group: { _id: '$venue.city', events: { $sum: 1 } } },
  ]);
  // Older events may predate name normalisation: merge "bangalore" into "Bengaluru".
  const counts = {};
  for (const r of rows) counts[canonicalCity(r._id)] = (counts[canonicalCity(r._id)] ?? 0) + r.events;
  const cities = Object.keys(counts).sort();
  res.json({ cities, counts });
}));

// Organizer's own events, every status.
eventsRouter.get('/mine', requireAuth, requireRole('organizer'), asyncHandler(async (req, res) => {
  const events = await Event.find({ organizer: req.user._id }).sort({ startsAt: -1 });
  const avail = await availabilityFor(events.map((e) => e._id));
  res.json({ items: events.map((e) => ({ ...e.toJSON(), availability: avail(e._id) })) });
}));

// Events the signed-in user marked "interested", next upcoming show first.
eventsRouter.get('/saved', requireAuth, asyncHandler(async (req, res) => {
  const marks = await Interest.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
  const keys = marks.map((m) => m.series);
  const events = await Event.find({ $or: [{ _id: { $in: keys } }, { seriesId: { $in: keys } }], status: { $ne: 'draft' } })
    .sort({ startsAt: 1 }).populate('organizer', 'name');
  // One entry per series: the next upcoming show, else the latest past one.
  const now = new Date();
  const bySeries = new Map();
  for (const e of events) {
    const k = String(seriesKey(e));
    const cur = bySeries.get(k);
    if (!cur || (cur.startsAt <= now && e.startsAt > now) || (cur.startsAt <= now && e.startsAt > cur.startsAt)) bySeries.set(k, e);
  }
  const ordered = keys.map((k) => bySeries.get(String(k))).filter(Boolean);
  const items = await decorate(ordered);
  res.json({ items: items.map((e) => ({ ...e, past: new Date(e.startsAt) <= now })) });
}));

// Event detail + live seat map. Auth is optional here: a logged-in viewer gets
// their own held seats flagged as `mine`, and owners can preview drafts.
eventsRouter.get('/:id', validate(z.object({ id: objectId }), 'params'), asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id).populate('organizer', 'name');
  if (!event) throw AppError.notFound('Event');

  const viewer = verifyToken(req.cookies?.[AUTH_COOKIE]);
  const isOwner = viewer && String(event.organizer._id) === viewer.sub;
  if (event.status === 'draft' && !isOwner) throw AppError.notFound('Event');

  const hold = viewer
    ? await Hold.findOne({ user: viewer.sub, event: event._id, status: 'active', expiresAt: { $gt: new Date() } })
    : null;
  const [seats, [extra], shows, mine] = await Promise.all([
    event.status === 'draft' ? [] : seatMapFor(event._id, hold?._id),
    decorate([event]),
    showsFor(event, { includeDrafts: Boolean(isOwner) }),
    viewer ? Interest.exists({ series: seriesKey(event), user: viewer.sub }) : null,
  ]);
  res.json({
    event: {
      ...extra,
      rows: event.rows,
      onSale: event.isOnSale(),
      // The limit the hold endpoint will enforce, so the seat picker can match it.
      maxPerOrder: Math.min(event.maxPerOrder ?? env.MAX_SEATS_PER_HOLD, env.MAX_SEATS_PER_HOLD),
      isOwner: Boolean(isOwner),
      interestedByMe: Boolean(mine),
    },
    shows,
    seats,
    hold,
  });
}));

eventsRouter.post('/', requireAuth, requireRole('organizer'), validate(eventBody), asyncHandler(async (req, res) => {
  assertValidLayout(req.body);
  assertSalesWindow(req.body);
  const event = await Event.create({ ...req.body, organizer: req.user._id });
  res.status(201).json({ event });
}));

eventsRouter.patch('/:id', requireAuth, requireRole('organizer'), asyncHandler(async (req, res) => {
  const event = await loadOwnedEvent(req);
  if (event.status === 'cancelled') throw AppError.conflict('Cancelled events cannot be edited');

  const schema = event.status === 'draft' ? eventBody.partial() : publishedPatch.strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    const message = event.status === 'published' ? 'Only the description and cover image can change after publishing' : 'Some fields are invalid';
    throw AppError.badRequest(message, { code: 'VALIDATION_ERROR', details });
  }
  // Zod fills in defaults for missing keys; an edit must only touch what was sent.
  const changes = Object.fromEntries(Object.entries(parsed.data).filter(([key]) => Object.hasOwn(req.body, key)));
  Object.assign(event, changes);
  if (event.status === 'draft') {
    assertValidLayout(event);
    assertSalesWindow(event);
  }
  await event.save();
  // Description and cover are shared by every showtime of a published series.
  if (event.status === 'published' && event.seriesId) {
    await Event.updateMany({ seriesId: event.seriesId, _id: { $ne: event._id }, status: { $ne: 'draft' } }, changes);
  }
  res.json({ event });
}));

eventsRouter.post('/:id/publish', requireAuth, requireRole('organizer'), asyncHandler(async (req, res) => {
  const event = await loadOwnedEvent(req);
  const published = await publishEvent(event);
  res.json({ event: published });
}));

eventsRouter.delete('/:id', requireAuth, requireRole('organizer'), asyncHandler(async (req, res) => {
  const event = await loadOwnedEvent(req);
  if (event.status !== 'draft') throw AppError.conflict('Only drafts can be deleted. Cancel a published event instead.');
  await Promise.all([event.deleteOne(), Seat.deleteMany({ event: event._id })]);
  res.status(204).end();
}));

// Cancels sales, releases holds and refunds every paid order.
eventsRouter.post('/:id/cancel', requireAuth, requireRole('organizer'), asyncHandler(async (req, res) => {
  const event = await loadOwnedEvent(req);
  const { event: cancelled, refunded } = await cancelEvent(event);
  res.json({ event: cancelled, refunded });
}));

// ---- Waitlist for sold-out events ------------------------------------------

async function loadPublicEvent(req) {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw AppError.badRequest('Invalid id');
  const event = await Event.findById(req.params.id);
  if (!event || event.status === 'draft') throw AppError.notFound('Event');
  return event;
}

eventsRouter.get('/:id/waitlist', asyncHandler(async (req, res) => {
  const event = await loadPublicEvent(req);
  const viewer = verifyToken(req.cookies?.[AUTH_COOKIE]);
  res.json({ waitlist: await waitlistStatus({ user: viewer ? { _id: viewer.sub } : null, event }) });
}));

eventsRouter.post('/:id/waitlist', requireAuth, requireRole('attendee'), asyncHandler(async (req, res) => {
  const event = await loadPublicEvent(req);
  res.status(201).json({ waitlist: await joinWaitlist({ user: req.user, event }) });
}));

eventsRouter.delete('/:id/waitlist', requireAuth, asyncHandler(async (req, res) => {
  const event = await loadPublicEvent(req);
  res.json({ waitlist: await leaveWaitlist({ user: req.user, event }) });
}));

// ---- Showtimes -------------------------------------------------------------

eventsRouter.post('/:id/showtimes', requireAuth, requireRole('organizer'),
  validate(z.object({ startsAt: z.coerce.date('Enter a valid date and time') })), asyncHandler(async (req, res) => {
    const source = await loadOwnedEvent(req);
    const show = await addShowtime(source, req.body.startsAt);
    res.status(201).json({ event: show });
  }));

// ---- Interested --------------------------------------------------------------

const interestState = async (event, userId) => ({
  count: await Interest.countDocuments({ series: seriesKey(event) }),
  mine: Boolean(userId && (await Interest.exists({ series: seriesKey(event), user: userId }))),
});

eventsRouter.post('/:id/interest', requireAuth, asyncHandler(async (req, res) => {
  const event = await loadPublicEvent(req);
  await Interest.updateOne({ series: seriesKey(event), user: req.user._id }, { $setOnInsert: { series: seriesKey(event), user: req.user._id } }, { upsert: true });
  res.json({ interest: await interestState(event, req.user._id) });
}));

eventsRouter.delete('/:id/interest', requireAuth, asyncHandler(async (req, res) => {
  const event = await loadPublicEvent(req);
  await Interest.deleteOne({ series: seriesKey(event), user: req.user._id });
  res.json({ interest: await interestState(event, req.user._id) });
}));

// ---- Reviews -----------------------------------------------------------------

eventsRouter.get('/:id/reviews', validate(z.object({ page: z.coerce.number().int().min(1).default(1) }), 'query'), asyncHandler(async (req, res) => {
  const event = await loadPublicEvent(req);
  const viewer = verifyToken(req.cookies?.[AUTH_COOKIE]);
  res.json({ reviews: await reviewsFor({ event, viewer: viewer ? { _id: new mongoose.Types.ObjectId(viewer.sub) } : null, page: req.validatedQuery.page }) });
}));

eventsRouter.put('/:id/reviews', requireAuth, validate(z.object({
  rating: z.number('Pick a rating').int().min(1, 'Pick 1 to 5 stars').max(5, 'Pick 1 to 5 stars'),
  text: z.string().trim().max(1000, 'Keep it under 1000 characters').default(''),
  aspects: z.object({
    performance: z.number().int().min(1).max(5).optional(),
    venue: z.number().int().min(1).max(5).optional(),
    value: z.number().int().min(1).max(5).optional(),
  }).default({}),
  recommend: z.boolean().nullable().default(null),
  privateNote: z.string().trim().max(1000, 'Keep the note to the organizer under 1000 characters').default(''),
})), asyncHandler(async (req, res) => {
  const event = await loadPublicEvent(req);
  const review = await saveReview({ event, user: req.user, ...req.body });
  res.json({ review });
}));

eventsRouter.delete('/:id/reviews', requireAuth, asyncHandler(async (req, res) => {
  const event = await loadPublicEvent(req);
  await deleteReview({ event, user: req.user });
  res.status(204).end();
}));
