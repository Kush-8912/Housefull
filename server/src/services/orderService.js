import { Hold } from '../models/Hold.js';
import { Seat } from '../models/Seat.js';
import { Order } from '../models/Order.js';
import { Ticket, SEAT_ORDER } from '../models/Ticket.js';
import { Event } from '../models/Event.js';
import { AppError } from '../utils/AppError.js';
import { emitSeatChanges } from '../realtime/bus.js';
import * as payments from './paymentService.js';
import { releaseHold } from './holdService.js';
import { findUsablePromo, discountFor, redeemPromo, releasePromo } from './promoService.js';
import { notifyWaitlistLater } from './waitlistService.js';
import { resolveAddonLines, linesTotal, reserveAddons, releaseAddons } from './addonService.js';
import { bill } from './pricing.js';
import { sendMail } from './mailer.js';
import { orderConfirmationEmail, orderRefundedEmail } from './emails.js';
import { announceCancellation, ticketHolders } from './showChanges.js';
import { refundQuote } from './refundPolicy.js';
import { refundUnused } from './razorpay.js';

// Payment must not be cut short by the hold expiring mid-checkout.
const CHECKOUT_GRACE_MS = 2 * 60_000;

async function orderWithTickets(order) {
  // Only the buyer's own tickets: a ticket they've since transferred has a new
  // owner whose QR code must not be returned to them.
  const tickets = await Ticket.find({ order: order._id, user: order.user }).sort({ label: 1 }).collation(SEAT_ORDER);
  return { order, tickets };
}

/**
 * Turn a hold into a paid order with tickets.
 *
 *   hold: active --lock--> converting --pay ok--> converted
 *                              \--pay fails--> active (buyer may retry)
 *
 * Duplicate submissions are absorbed two ways: the same Idempotency-Key
 * returns the original order, and the active->converting lock means a second
 * concurrent checkout of the same hold is refused before any charge happens.
 */
/**
 * Pay for a hold and issue tickets. With Razorpay the buyer has already paid
 * in Razorpay's window by now, so if this checkout fails for any reason
 * (hold expired, price changed, seats clash) the payment is refunded rather
 * than kept for nothing. A request that loses a race to its own duplicate
 * (CHECKOUT_IN_PROGRESS) leaves the money alone: the other one is using it.
 */
export async function checkout(args) {
  try {
    return await checkoutOnce(args);
  } catch (err) {
    if (args.razorpay && err?.code !== 'CHECKOUT_IN_PROGRESS' && !err?.refunded) {
      await refundUnused(args.razorpay).catch((e) => console.error('[razorpay] could not refund an unused payment:', e.message));
    }
    throw err;
  }
}

async function checkoutOnce({ user, holdId, idempotencyKey, card, razorpay }) {
  const existing = await Order.findOne({ user: user._id, idempotencyKey });
  if (existing) {
    if (existing.status === 'pending') throw AppError.conflict('This payment is still being processed', { code: 'CHECKOUT_IN_PROGRESS' });
    if (existing.status === 'failed') throw new AppError(402, existing.failureReason, { code: 'PAYMENT_FAILED' });
    return { ...(await orderWithTickets(existing)), replayed: true };
  }

  const hold = await Hold.findById(holdId);
  if (!hold || !hold.user.equals(user._id)) throw AppError.notFound('Hold');

  if (hold.status === 'converted') {
    const order = await Order.findOne({ hold: hold._id, status: { $in: ['paid', 'cancelled', 'refunded'] } });
    if (order) return { ...(await orderWithTickets(order)), replayed: true };
  }
  if (hold.status === 'converting') throw AppError.conflict('Checkout for these seats is already in progress', { code: 'CHECKOUT_IN_PROGRESS' });
  if (hold.status !== 'active' || hold.expiresAt <= new Date()) {
    if (hold.status === 'active') await releaseHold(hold, 'expired');
    throw AppError.gone('Your seat hold has expired. Please pick your seats again.', { code: 'HOLD_EXPIRED' });
  }

  const event = await Event.findById(hold.event);
  // The hold was granted while sales were open; it can be paid for until the show starts.
  if (!event?.isUpcoming()) {
    await releaseHold(hold, 'released');
    throw AppError.conflict('Tickets for this event are no longer on sale', { code: 'NOT_ON_SALE' });
  }

  // Lock the hold for this checkout.
  const now = new Date();
  const locked = await Hold.findOneAndUpdate(
    { _id: hold._id, status: 'active', expiresAt: { $gt: now } },
    { status: 'converting' },
    { returnDocument: 'after' },
  );
  if (!locked) throw AppError.conflict('Checkout for these seats is already in progress', { code: 'CHECKOUT_IN_PROGRESS' });

  const graceUntil = new Date(Math.max(locked.expiresAt.getTime(), now.getTime() + CHECKOUT_GRACE_MS));
  await Seat.updateMany({ hold: locked._id, status: 'held' }, { holdExpiresAt: graceUntil });
  const seats = await Seat.find({ _id: { $in: locked.seats }, hold: locked._id, status: 'held' }).sort({ row: 1, number: 1 });

  const unlock = (status) => Hold.updateOne({ _id: locked._id, status: 'converting' }, { status });
  // Back out of a checkout that didn't happen: the buyer keeps their hold, but
  // the grace period is not a free extension of it.
  const abandon = () => Promise.all([
    unlock('active'),
    Seat.updateMany({ hold: locked._id, status: 'held' }, { holdExpiresAt: locked.expiresAt }),
  ]);
  if (seats.length !== locked.seats.length) {
    await unlock('expired');
    await Seat.updateMany({ hold: locked._id, status: 'held' }, { status: 'available', hold: null, holdExpiresAt: null });
    notifyWaitlistLater(locked.event);
    throw AppError.gone('Some of your seats were released. Please pick your seats again.', { code: 'HOLD_EXPIRED' });
  }

  const subtotal = seats.reduce((sum, s) => sum + s.price, 0);
  let promo = null;
  if (locked.promoCode) {
    try {
      promo = await findUsablePromo(locked.event, locked.promoCode, now);
    } catch (err) {
      await abandon();
      throw err;
    }
  }
  const discount = promo ? discountFor(promo, subtotal) : 0;

  let addonLines;
  try {
    addonLines = await resolveAddonLines(locked.event, locked.addons);
  } catch (err) {
    await abandon();
    throw err;
  }
  const priced = bill({ ticketsSubtotal: subtotal, discount, addonsTotal: linesTotal(addonLines) });
  const amount = priced.total;

  let order;
  try {
    order = await Order.create({
      user: user._id,
      event: locked.event,
      hold: locked._id,
      items: seats.map((s) => ({ seat: s._id, label: s.label, tier: s.tier, price: s.price })),
      subtotal,
      discount,
      promo: promo ? { id: promo._id, code: promo.code } : undefined,
      addons: addonLines,
      addonsTotal: priced.addonsTotal,
      bookingFee: priced.bookingFee,
      gst: priced.gst,
      amount,
      idempotencyKey,
    });
  } catch (err) {
    await abandon();
    if (err?.code === 11000) throw AppError.conflict('This payment is still being processed', { code: 'CHECKOUT_IN_PROGRESS' });
    throw err;
  }
  const fail = (reason) => Order.updateOne({ _id: order._id }, { status: 'failed', failureReason: reason });

  if (amount > 0 && !card && !razorpay) {
    await Promise.all([abandon(), fail('Card details are required')]);
    throw AppError.badRequest('Card details are required', { code: 'CARD_REQUIRED' });
  }
  // One Razorpay payment can only ever pay for one order.
  if (razorpay && await Order.exists({ 'payment.chargeId': razorpay.paymentId })) {
    await Promise.all([abandon(), fail('That payment has already been used')]);
    throw Object.assign(AppError.conflict('That payment has already been used for another order', { code: 'PAYMENT_REUSED' }), { refunded: true });
  }

  // 1. Redeem the promo code and take add-on stock (after the order exists,
  //    so a retried request with the same idempotency key can't do it twice).
  if (promo) {
    try {
      await redeemPromo(promo, now);
    } catch (err) {
      await Promise.all([abandon(), fail(err.message)]);
      throw err;
    }
  }
  try {
    await reserveAddons(addonLines);
  } catch (err) {
    await Promise.all([abandon(), fail(err.message), releasePromo(promo?._id)]);
    throw err;
  }
  const giveBack = () => Promise.all([releasePromo(promo?._id), releaseAddons(addonLines)]);

  // 2. Take payment (free orders skip the processor).
  let paid = { chargeId: null, last4: null };
  if (amount > 0) {
    try {
      paid = await payments.charge({ amount, card, razorpay, holdId: locked._id, idempotencyKey: `${user._id}:${idempotencyKey}` });
    } catch (err) {
      const reason = err instanceof payments.PaymentError ? err.message : 'Payment could not be completed';
      await Promise.all([fail(reason), abandon(), giveBack()]);
      throw new AppError(402, reason, { code: 'PAYMENT_FAILED', details: { reason: err.code } });
    }
  }

  // 3. Mark seats sold — only if they are still ours.
  const sold = await Seat.updateMany(
    { _id: { $in: seats.map((s) => s._id) }, hold: locked._id, status: 'held' },
    { status: 'sold', order: order._id, hold: null, holdExpiresAt: null },
  );
  if (sold.modifiedCount !== seats.length) {
    // Should be unreachable thanks to the lock + grace window, but never keep
    // money for seats we can't deliver.
    await Seat.updateMany({ order: order._id, status: 'sold' }, { status: 'available', order: null });
    const refund = paid.chargeId ? await payments.refund({ chargeId: paid.chargeId, amount }) : {};
    await Promise.all([
      Order.updateOne({ _id: order._id }, { status: 'refunded', failureReason: 'Seats became unavailable', 'payment.refundId': refund.refundId, refundedAmount: amount }),
      unlock('expired'),
      giveBack(),
    ]);
    throw Object.assign(AppError.conflict('Your seats became unavailable during payment. You have been refunded.', { code: 'SEATS_UNAVAILABLE' }), { refunded: true });
  }

  // 4. Issue tickets and finalise.
  const tickets = await Ticket.insertMany(
    seats.map((s) => ({ order: order._id, event: locked.event, user: user._id, seat: s._id, label: s.label, tier: s.tier, price: s.price })),
  );
  order.status = 'paid';
  order.paidAt = new Date();
  order.payment = { provider: razorpay ? 'razorpay' : 'mock', chargeId: paid.chargeId, last4: paid.last4, method: paid.method ?? (paid.chargeId ? 'card' : null) };
  await order.save();
  await unlock('converted');

  emitSeatChanges(locked.event, seats.map((s) => ({ id: s._id, status: 'sold' })));
  sendMail(() => orderConfirmationEmail({ user, event, order, tickets }));
  return { order, tickets, replayed: false };
}

// Refund an order, void its tickets and (optionally) put seats back on sale.
// An attendee's own cancellation refunds what their event's policy allows
// (`amount`); an organizer cancelling the event refunds everything.
async function refundOrder(order, { by, reopenSeats, amount = order.amount }) {
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, status: 'paid' },
    { status: 'cancelled', cancelledAt: new Date(), cancelledBy: by },
    { returnDocument: 'after' },
  );
  if (!claimed) return null;

  const refundAmount = Math.min(amount, claimed.amount);
  if (claimed.payment?.chargeId && refundAmount > 0) {
    const { refundId } = await payments.refund({ chargeId: claimed.payment.chargeId, amount: refundAmount });
    claimed.payment.refundId = refundId;
    claimed.refundedAmount = refundAmount;
    claimed.status = 'refunded';
    await claimed.save();
  }
  await Ticket.updateMany({ order: claimed._id, status: 'valid' }, { status: 'cancelled' });
  await Promise.all([releasePromo(claimed.promo?.id), releaseAddons(claimed.addons)]);

  if (reopenSeats) {
    const seatIds = claimed.items.map((i) => i.seat);
    await Seat.updateMany({ _id: { $in: seatIds }, order: claimed._id, status: 'sold' }, { status: 'available', order: null });
    emitSeatChanges(claimed.event, seatIds.map((id) => ({ id, status: 'available' })));
    notifyWaitlistLater(claimed.event);
  }
  return claimed;
}

/**
 * Can this order be cancelled now, and for how much? What My tickets shows
 * next to the cancel button. Checked-in and transferred tickets rule it out,
 * as cancelOrderByAttendee enforces.
 */
export function cancellationFor(order, event, tickets) {
  if (order.status !== 'paid' || event.status !== 'published') return { allowed: false, reason: 'NOT_ACTIVE' };
  if (tickets.some((t) => t.checkedInAt)) return { allowed: false, reason: 'CHECKED_IN' };
  if (tickets.some((t) => t.status === 'transferred')) return { allowed: false, reason: 'TRANSFERRED' };
  return refundQuote(event, order);
}

export async function cancelOrderByAttendee({ user, orderId }) {
  const order = await Order.findById(orderId);
  if (!order || !order.user.equals(user._id)) throw AppError.notFound('Order');
  if (order.status !== 'paid') throw AppError.conflict(`This order is ${order.status} and cannot be cancelled`);

  const event = await Event.findById(order.event, 'title startsAt venue cancellationPolicy rescheduledAt');
  const quote = refundQuote(event, order);
  if (!quote.allowed) {
    throw AppError.conflict(quote.reason === 'NO_REFUNDS'
      ? 'This event doesn’t allow cancellations'
      : 'Cancellations for this event have closed', { code: 'CANCELLATION_CLOSED' });
  }
  if (await Ticket.exists({ order: order._id, checkedInAt: { $ne: null } })) {
    throw AppError.conflict('Tickets that have been checked in cannot be refunded');
  }
  if (await Ticket.exists({ order: order._id, status: 'transferred' })) {
    throw AppError.conflict('Orders with transferred tickets can\u2019t be cancelled', { code: 'HAS_TRANSFERS' });
  }

  const refunded = await refundOrder(order, { by: 'attendee', reopenSeats: true, amount: quote.refund });
  if (!refunded) throw AppError.conflict('This order was already cancelled');
  sendMail(orderRefundedEmail({ user, event, order: refunded, percent: quote.percent }));
  return refunded;
}

// Organizer cancels the whole event: stop sales, release holds, refund everyone.
export async function cancelEvent(event) {
  const claimed = await Event.findOneAndUpdate(
    { _id: event._id, status: 'published', startsAt: { $gt: new Date() } },
    { status: 'cancelled', cancelledAt: new Date() },
    { returnDocument: 'after' },
  );
  if (!claimed) throw AppError.conflict('Only upcoming published events can be cancelled');

  const holds = await Hold.find({ event: event._id, status: 'active' });
  for (const h of holds) await releaseHold(h, 'released');

  // Who to tell, read before refunding voids the tickets.
  const holders = await ticketHolders(event._id);
  const refundedOrders = [];
  for await (const order of Order.find({ event: event._id, status: 'paid' }).cursor()) {
    const done = await refundOrder(order, { by: 'organizer', reopenSeats: false });
    if (done) refundedOrders.push(done);
  }
  await announceCancellation(claimed, holders, refundedOrders);
  return { event: claimed, refunded: refundedOrders.length };
}
