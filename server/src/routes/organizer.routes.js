import { Router } from 'express';
import { z } from 'zod';
import { Event } from '../models/Event.js';
import { Ticket } from '../models/Ticket.js';
import { User } from '../models/User.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { checkInTicket } from '../services/checkinService.js';
import { eventStats } from '../services/statsService.js';
import { PromoCode, PROMO_KINDS } from '../models/PromoCode.js';
import { normalizeCode, seriesEventIds } from '../services/promoService.js';

// Mounted at /api/events — organizer-only operations on one event. Guards are
// attached per route (not router.use) so public /events/:id stays public.
export const organizerEventRouter = Router();

const loadOwnedEvent = asyncHandler(async (req, _res, next) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw AppError.badRequest('Invalid id');
  const event = await Event.findById(req.params.id);
  if (!event) throw AppError.notFound('Event');
  if (!event.organizer.equals(req.user._id)) throw AppError.forbidden('You can only manage your own events');
  req.event = event;
  next();
});
const owner = [requireAuth, requireRole('organizer'), loadOwnedEvent];

organizerEventRouter.post('/:id/checkin', owner, validate(z.object({ qr: z.string().trim().min(1, 'Scan or enter a ticket code').max(200) })), asyncHandler(async (req, res) => {
  const result = await checkInTicket({ event: req.event, qr: req.body.qr, staff: req.user });
  res.json({ checkin: result });
}));

organizerEventRouter.get('/:id/stats', owner, asyncHandler(async (req, res) => {
  res.json({ stats: await eventStats(req.event) });
}));

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- Promo codes ----------------------------------------------------------

const promoBody = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,24}$/, 'Use 3\u201324 letters, numbers, dashes or underscores').transform(normalizeCode),
  kind: z.enum(PROMO_KINDS, 'Choose percent or flat'),
  value: z.number('Enter a discount').int('Use a whole number').min(1, 'Discount must be at least 1'),
  maxUses: z.number().int().min(1, 'Limit must be at least 1').max(100000).nullable().default(null),
  expiresAt: z.coerce.date('Enter a valid date').nullable().default(null),
}).superRefine((p, ctx) => {
  if (p.kind === 'percent' && p.value > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percentage can be at most 100' });
  if (p.kind === 'flat' && p.value > 100000) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Flat discount can be at most \u20b91,00,000' });
  if (p.expiresAt && p.expiresAt <= new Date()) ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Expiry must be in the future' });
});

// Promo codes belong to the whole series: one code works for every showtime.
organizerEventRouter.get('/:id/promos', owner, asyncHandler(async (req, res) => {
  const items = await PromoCode.find({ event: { $in: await seriesEventIds(req.event._id) } }).sort({ createdAt: -1 });
  res.json({ items });
}));

organizerEventRouter.post('/:id/promos', owner, validate(promoBody), asyncHandler(async (req, res) => {
  if (req.event.status === 'cancelled') throw AppError.conflict('This event has been cancelled');
  if (await PromoCode.exists({ event: { $in: await seriesEventIds(req.event._id) }, code: req.body.code })) {
    throw AppError.conflict(`${req.body.code} already exists for this event`, { code: 'DUPLICATE' });
  }
  const promo = await PromoCode.create({ ...req.body, event: req.event._id });
  res.status(201).json({ promo });
}));

const promoParams = z.object({ id: z.string(), promoId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id') });

organizerEventRouter.patch('/:id/promos/:promoId', owner, validate(promoParams, 'params'), validate(z.object({ active: z.boolean() })), asyncHandler(async (req, res) => {
  const promo = await PromoCode.findOneAndUpdate({ _id: req.params.promoId, event: { $in: await seriesEventIds(req.event._id) } }, { active: req.body.active }, { returnDocument: 'after' });
  if (!promo) throw AppError.notFound('Promo code');
  res.json({ promo });
}));

// Codes that have been used are switched off instead, so past orders keep their history.
organizerEventRouter.delete('/:id/promos/:promoId', owner, validate(promoParams, 'params'), asyncHandler(async (req, res) => {
  const promo = await PromoCode.findOne({ _id: req.params.promoId, event: { $in: await seriesEventIds(req.event._id) } });
  if (!promo) throw AppError.notFound('Promo code');
  if (promo.uses > 0) throw AppError.conflict('This code has been used. Switch it off instead of deleting it.', { code: 'PROMO_IN_USE' });
  await promo.deleteOne();
  res.status(204).end();
}));

// ---- Guest list -----------------------------------------------------------

// Guest list with search by attendee name/email or seat, for manual lookup at the door.
organizerEventRouter.get('/:id/attendees', owner, validate(z.object({ q: z.string().trim().max(80).optional() }), 'query'), asyncHandler(async (req, res) => {
  const { q } = req.validatedQuery;
  const filter = { event: req.event._id, status: 'valid' };
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const users = await User.find({ $or: [{ name: rx }, { email: rx }] }, '_id').limit(200);
    filter.$or = [{ label: new RegExp(`^${escapeRegex(q)}`, 'i') }, { user: { $in: users.map((u) => u._id) } }];
  }
  const tickets = await Ticket.find(filter, 'label tier price checkedInAt user order').populate('user', 'name email').sort({ label: 1 }).limit(500);
  res.json({ items: tickets });
}));
