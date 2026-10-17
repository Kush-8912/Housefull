import { Router } from 'express';
import { z } from 'zod';
import { Event } from '../models/Event.js';
import { Ticket, SEAT_ORDER } from '../models/Ticket.js';
import { User } from '../models/User.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { checkInTicket } from '../services/checkinService.js';
import { eventStats } from '../services/statsService.js';
import { eventReport } from '../services/reportService.js';
import { sendRemindersNow } from '../jobs/eventEmails.js';
import { PromoCode, PROMO_KINDS } from '../models/PromoCode.js';
import { normalizeCode, seriesEventIds } from '../services/promoService.js';
import { Addon } from '../models/Addon.js';

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

organizerEventRouter.post('/:id/checkin', owner, validate(z.object({ qr: z.string().trim().min(1, 'Scan or enter a ticket code').max(300) })), asyncHandler(async (req, res) => {
  const result = await checkInTicket({ event: req.event, qr: req.body.qr, staff: req.user });
  res.json({ checkin: result });
}));

organizerEventRouter.get('/:id/stats', owner, asyncHandler(async (req, res) => {
  res.json({ stats: await eventStats(req.event) });
}));

// Email every ticket holder who hasn't had a reminder yet, without waiting for
// the automatic one the day before.
organizerEventRouter.post('/:id/reminders', owner, asyncHandler(async (req, res) => {
  if (!req.event.isUpcoming()) throw AppError.conflict('Reminders can only be sent before the event starts', { code: 'NOT_UPCOMING' });
  res.json(await sendRemindersNow(req.event));
}));

// The after-show report: attendance, arrivals, sales and feedback.
organizerEventRouter.get('/:id/report', owner, asyncHandler(async (req, res) => {
  res.json({ report: await eventReport(req.event) });
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

// ---- Add-ons (food & merch) ----------------------------------------------

const stockSchema = z.number().int().min(1, 'Stock must be at least 1').max(100000).nullable();
const addonBody = z.object({
  name: z.string().trim().min(2, 'Name is required').max(60),
  description: z.string().trim().max(200).default(''),
  kind: z.enum(['food', 'merch']).default('food'),
  price: z.number('Enter a price').int('Use whole rupees').min(1, 'Price must be at least \u20b91').max(100000),
  stock: stockSchema.default(null),
  maxPerOrder: z.number().int().min(1).max(20).default(10),
});
const addonParams = z.object({ id: z.string(), addonId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id') });

organizerEventRouter.get('/:id/addons', owner, asyncHandler(async (req, res) => {
  res.json({ items: await Addon.find({ event: req.event._id }).sort({ createdAt: 1 }) });
}));

organizerEventRouter.post('/:id/addons', owner, validate(addonBody), asyncHandler(async (req, res) => {
  if (req.event.status === 'cancelled') throw AppError.conflict('This event has been cancelled');
  if ((await Addon.countDocuments({ event: req.event._id })) >= 20) throw AppError.badRequest('An event can have at most 20 add-ons');
  res.status(201).json({ addon: await Addon.create({ ...req.body, event: req.event._id }) });
}));

// Price is fixed once something has sold (past orders keep their snapshot,
// but changing it under buyers mid-checkout would be confusing).
organizerEventRouter.patch('/:id/addons/:addonId', owner, validate(addonParams, 'params'),
  validate(z.object({ active: z.boolean(), stock: stockSchema }).partial()), asyncHandler(async (req, res) => {
    const addon = await Addon.findOne({ _id: req.params.addonId, event: req.event._id });
    if (!addon) throw AppError.notFound('Add-on');
    if (req.body.stock != null && req.body.stock < addon.sold) {
      throw AppError.badRequest(`${addon.sold} already sold; stock can't be lower than that`, { code: 'VALIDATION_ERROR', details: [{ field: 'stock', message: `At least ${addon.sold}` }] });
    }
    Object.assign(addon, req.body);
    await addon.save();
    res.json({ addon });
  }));

organizerEventRouter.delete('/:id/addons/:addonId', owner, validate(addonParams, 'params'), asyncHandler(async (req, res) => {
  const addon = await Addon.findOne({ _id: req.params.addonId, event: req.event._id });
  if (!addon) throw AppError.notFound('Add-on');
  if (addon.sold > 0) throw AppError.conflict('This add-on has been sold. Switch it off instead.', { code: 'ADDON_IN_USE' });
  await addon.deleteOne();
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
  const tickets = await Ticket.find(filter, 'label tier price checkedInAt user order').populate('user', 'name email').sort({ label: 1 }).collation(SEAT_ORDER).limit(500);
  res.json({ items: tickets });
}));

// Spreadsheet apps execute cells that start with these characters as formulas.
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

organizerEventRouter.get('/:id/attendees.csv', owner, asyncHandler(async (req, res) => {
  const tickets = await Ticket.find({ event: req.event._id, status: 'valid' }, 'label tier price checkedInAt user order')
    .populate('user', 'name email').sort({ label: 1 }).collation(SEAT_ORDER).lean();
  const header = ['Seat', 'Tier', 'Price (INR)', 'Name', 'Email', 'Order', 'Checked in at (UTC)'];
  const lines = tickets.map((t) => [
    t.label, t.tier, t.price, t.user?.name, t.user?.email, String(t.order).slice(-8).toUpperCase(),
    t.checkedInAt ? t.checkedInAt.toISOString() : '',
  ].map(csvCell).join(','));
  const slug = req.event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'event';
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${slug}-guests.csv"`);
  // BOM so Excel reads names with non-ASCII characters correctly.
  res.send(`\uFEFF${[header.join(','), ...lines].join('\r\n')}\r\n`);
}));
