import { PromoCode } from '../models/PromoCode.js';
import { Event, seriesKey } from '../models/Event.js';
import { AppError } from '../utils/AppError.js';

export const normalizeCode = (code) => String(code ?? '').trim().toUpperCase();

// Whole rupees, never more than the order is worth.
export function discountFor(promo, subtotal) {
  const raw = promo.kind === 'percent' ? Math.round((subtotal * promo.value) / 100) : promo.value;
  return Math.min(raw, subtotal);
}

// Codes apply to every showtime of a series, whichever show they were created on.
export async function seriesEventIds(eventId) {
  const event = await Event.findById(eventId, 'seriesId');
  if (!event) return [eventId];
  const key = seriesKey(event);
  const ids = await Event.find({ $or: [{ _id: key }, { seriesId: key }] }, '_id').lean();
  return ids.map((e) => e._id);
}

/** Check a code can be used right now, without redeeming it. */
export async function findUsablePromo(eventId, code, now = new Date()) {
  const promo = await PromoCode.findOne({ event: { $in: await seriesEventIds(eventId) }, code: normalizeCode(code) });
  if (!promo || !promo.active) throw AppError.badRequest('That promo code isn’t valid for this event', { code: 'PROMO_INVALID' });
  if (promo.expiresAt && promo.expiresAt <= now) throw AppError.badRequest('That promo code has expired', { code: 'PROMO_EXPIRED' });
  if (promo.maxUses != null && promo.uses >= promo.maxUses) {
    throw AppError.badRequest('That promo code has been fully redeemed', { code: 'PROMO_EXHAUSTED' });
  }
  return promo;
}

/**
 * Consume one use. The usage limit is part of the update's filter, so when
 * two buyers race for the last use exactly one of them gets it.
 */
export async function redeemPromo(promo, now = new Date()) {
  const redeemed = await PromoCode.findOneAndUpdate(
    {
      _id: promo._id,
      active: true,
      $and: [
        { $or: [{ maxUses: null }, { $expr: { $lt: ['$uses', '$maxUses'] } }] },
        { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
      ],
    },
    { $inc: { uses: 1 } },
    { returnDocument: 'after' },
  );
  if (!redeemed) throw AppError.conflict('That promo code was just used up. Remove it to pay full price.', { code: 'PROMO_EXHAUSTED' });
  return redeemed;
}

// Give a use back (failed payment, refunded order).
export async function releasePromo(promoId) {
  if (promoId) await PromoCode.updateOne({ _id: promoId, uses: { $gt: 0 } }, { $inc: { uses: -1 } });
}
