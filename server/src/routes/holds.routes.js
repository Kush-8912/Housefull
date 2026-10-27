import { Router } from 'express';
import { z } from 'zod';
import { Event } from '../models/Event.js';
import { Seat } from '../models/Seat.js';
import { Hold } from '../models/Hold.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { createHold, releaseHold, loadOwnedHold } from '../services/holdService.js';
import { findUsablePromo, normalizeCode } from '../services/promoService.js';
import { resolveAddonLines } from '../services/addonService.js';
import { quoteHold } from '../services/quoteService.js';
import { Addon } from '../models/Addon.js';

const seatsOf = (hold) => Seat.find({ _id: { $in: hold.seats } }, 'label tier price row number').sort({ row: 1, number: 1 }).lean();

// Add-ons a buyer can still choose for this show.
async function addonMenu(eventId) {
  const items = await Addon.find({ event: eventId, active: true }).sort({ kind: 1, price: 1 }).lean();
  return items.map((a) => ({
    _id: a._id, name: a.name, description: a.description, kind: a.kind, price: a.price, maxPerOrder: a.maxPerOrder,
    remaining: a.stock == null ? null : Math.max(0, a.stock - a.sold),
  }));
}

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

// Mounted at /api/events/:id/holds
export const eventHoldsRouter = Router({ mergeParams: true });

eventHoldsRouter.post('/', requireAuth, validate(z.object({ seatIds: z.array(objectId).min(1) })), asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event || event.status === 'draft') throw AppError.notFound('Event');
  if (event.organizer.equals(req.user._id)) throw AppError.forbidden('Organizers cannot buy tickets to their own event');
  const hold = await createHold({ user: req.user, event, seatIds: req.body.seatIds });
  res.status(201).json({ hold });
}));

// Mounted at /api/holds
export const holdsRouter = Router();

holdsRouter.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const hold = await loadOwnedHold(req.params.id, req.user);
  const [event, seats, menu] = await Promise.all([
    Event.findById(hold.event, 'title venue startsAt tiers status cancellationPolicy'),
    seatsOf(hold),
    addonMenu(hold.event),
  ]);
  const quote = await quoteHold(hold, seats);
  res.json({ hold: { ...hold.toJSON(), live: hold.isLive() }, event, seats, menu, ...quote });
}));

// Apply a promo code to a hold. It is checked now for instant feedback and
// again (and redeemed) at checkout, since it could run out in between.
holdsRouter.post('/:id/promo', requireAuth, validate(z.object({ code: z.string().trim().min(1, 'Enter a promo code').max(24) })), asyncHandler(async (req, res) => {
  const hold = await loadOwnedHold(req.params.id, req.user);
  if (!hold.isLive()) throw AppError.gone('Your seat hold has expired. Please pick your seats again.', { code: 'HOLD_EXPIRED' });
  const promo = await findUsablePromo(hold.event, normalizeCode(req.body.code));
  const updated = await Hold.findOneAndUpdate({ _id: hold._id, status: 'active' }, { promoCode: promo.code }, { returnDocument: 'after' });
  if (!updated) throw AppError.conflict('Checkout for these seats is already in progress', { code: 'CHECKOUT_IN_PROGRESS' });
  res.json(await quoteHold(updated, await seatsOf(updated)));
}));

// Choose add-ons (replaces the previous selection). Stock is reserved at checkout.
const addonsBody = z.object({
  items: z.array(z.object({ addon: objectId, qty: z.number().int().min(0).max(20) })).max(20),
});
holdsRouter.put('/:id/addons', requireAuth, validate(addonsBody), asyncHandler(async (req, res) => {
  const hold = await loadOwnedHold(req.params.id, req.user);
  if (!hold.isLive()) throw AppError.gone('Your seat hold has expired. Please pick your seats again.', { code: 'HOLD_EXPIRED' });
  const items = req.body.items.filter((i) => i.qty > 0);
  if (new Set(items.map((i) => i.addon)).size !== items.length) throw AppError.badRequest('Each add-on can only be listed once');
  await resolveAddonLines(hold.event, items); // validates availability and limits
  const updated = await Hold.findOneAndUpdate({ _id: hold._id, status: 'active' }, { addons: items }, { returnDocument: 'after' });
  if (!updated) throw AppError.conflict('Checkout for these seats is already in progress', { code: 'CHECKOUT_IN_PROGRESS' });
  res.json(await quoteHold(updated, await seatsOf(updated)));
}));

holdsRouter.delete('/:id/promo', requireAuth, asyncHandler(async (req, res) => {
  const hold = await loadOwnedHold(req.params.id, req.user);
  await Hold.updateOne({ _id: hold._id, status: 'active' }, { promoCode: null });
  res.status(204).end();
}));

holdsRouter.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const hold = await loadOwnedHold(req.params.id, req.user);
  await releaseHold(hold, 'released');
  res.status(204).end();
}));
