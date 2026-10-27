import { Router } from 'express';
import { z } from 'zod';
import { Order } from '../models/Order.js';
import { Ticket, SEAT_ORDER } from '../models/Ticket.js';
import { seriesKey } from '../models/Event.js';
import { Survey } from '../models/Survey.js';
import { SurveyResponse } from '../models/SurveyResponse.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { checkout, cancelOrderByAttendee, cancellationFor } from '../services/orderService.js';
import { qrPayloadFor, qrUrlFor } from '../services/ticketSigner.js';

const cardSchema = z.object({
  number: z.string().trim().regex(/^[\d ]{13,23}$/, 'Card number must be 13–19 digits'),
  expMonth: z.coerce.number().int().min(1, 'Invalid month').max(12, 'Invalid month'),
  expYear: z.coerce.number().int().min(2000).max(2100),
  cvc: z.string().regex(/^\d{3,4}$/, 'CVC must be 3 or 4 digits'),
  name: z.string().trim().min(2, 'Name on card is required').max(80),
});

// Mounted at /api/holds/:id/checkout
export const checkoutRouter = Router({ mergeParams: true });

// What Razorpay's checkout hands the browser after a successful payment.
const razorpaySchema = z.object({
  orderId: z.string().regex(/^order_\w+$/, 'Invalid Razorpay order'),
  paymentId: z.string().regex(/^pay_\w+$/, 'Invalid Razorpay payment'),
  signature: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid Razorpay signature'),
});

checkoutRouter.post('/', requireAuth, validate(z.object({ card: cardSchema.optional(), razorpay: razorpaySchema.optional() })), asyncHandler(async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (!key || !/^[\w-]{8,100}$/.test(key)) throw AppError.badRequest('A valid Idempotency-Key header is required');
  const { order, tickets, replayed } = await checkout({ user: req.user, holdId: req.params.id, idempotencyKey: key, card: req.body.card, razorpay: req.body.razorpay });
  res.status(replayed ? 200 : 201).json({ order, tickets: tickets.map(withQr), replayed });
}));

// qr is the bare signed code (for copying); qrUrl is what the printed QR encodes.
const withQr = (t) => {
  const valid = t.status === 'valid';
  return { ...(t.toJSON?.() ?? t), qr: valid ? qrPayloadFor(t._id) : null, qrUrl: valid ? qrUrlFor(t._id) : null };
};

// Mounted at /api/orders
export const ordersRouter = Router();

ordersRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id, status: { $in: ['paid', 'cancelled', 'refunded'] } })
    .sort({ createdAt: -1 })
    .populate('event', 'title venue startsAt durationMinutes description status category coverImageUrl cancellationPolicy rescheduledAt seriesId');
  // Only tickets this user holds: after a transfer the recipient's new ticket
  // shares the order, and its QR code must never be shown to the sender.
  const tickets = await Ticket.find({ order: { $in: orders.map((o) => o._id) }, user: req.user._id })
    .sort({ label: 1 }).collation(SEAT_ORDER)
    .populate('transferredTo', 'name');
  const byOrder = Map.groupBy(tickets, (t) => String(t.order));

  // Tickets other people sent to this user, grouped by event.
  const received = await Ticket.find({ user: req.user._id, transferredFrom: { $ne: null }, order: { $nin: orders.map((o) => o._id) } })
    .sort({ label: 1 }).collation(SEAT_ORDER)
    .populate('event', 'title venue startsAt durationMinutes description status category coverImageUrl')
    .populate({ path: 'transferredFrom', select: 'user', populate: { path: 'user', select: 'name' } });
  const receivedByEvent = [...Map.groupBy(received, (t) => String(t.event._id)).values()].map((ts) => ({
    event: ts[0].event,
    tickets: ts.map((t) => ({ ...withQr(t), event: undefined, transferredFrom: undefined, from: t.transferredFrom?.user?.name ?? null })),
  }));

  // Which of these shows have an organizer's feedback form, and which this user has answered.
  const surveys = await Survey.find({ series: { $in: orders.map((o) => seriesKey(o.event)) } }, 'series').lean();
  const answered = new Set((await SurveyResponse.find({ survey: { $in: surveys.map((s) => s._id) }, user: req.user._id }, 'survey').lean()).map((r) => String(r.survey)));
  const surveyBySeries = new Map(surveys.map((s) => [String(s.series), s]));
  const feedbackFor = (event) => {
    const s = surveyBySeries.get(String(seriesKey(event)));
    return s ? { form: true, answered: answered.has(String(s._id)) } : { form: false, answered: false };
  };

  res.json({
    items: orders.map((o) => {
      const mine = byOrder.get(String(o._id)) ?? [];
      return { ...o.toJSON(), tickets: mine.map(withQr), cancellation: cancellationFor(o, o.event, mine), feedback: feedbackFor(o.event) };
    }),
    received: receivedByEvent,
  });
}));

ordersRouter.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('event', 'title venue startsAt status');
  if (!order || !order.user.equals(req.user._id)) throw AppError.notFound('Order');
  const tickets = await Ticket.find({ order: order._id, user: req.user._id }).sort({ label: 1 }).collation(SEAT_ORDER).populate('transferredTo', 'name');
  res.json({ order, tickets: tickets.map(withQr) });
}));

ordersRouter.post('/:id/cancel', requireAuth, asyncHandler(async (req, res) => {
  const order = await cancelOrderByAttendee({ user: req.user, orderId: req.params.id });
  res.json({ order });
}));
