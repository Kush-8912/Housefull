import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Razorpay (test or live mode, depending on the keys) behind the same small
 * contract as the demo processor in paymentService.js. Used when
 * RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set.
 *
 * The flow: the server creates a Razorpay order for the exact bill, the
 * browser pays it in Razorpay's own checkout (so card or UPI details never
 * touch our server), and the server then checks Razorpay's signature, that
 * the payment belongs to this hold's order and is for the full amount, and
 * captures it if needed.
 */
export class RazorpayError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const razorpayEnabled = () => Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
const API = 'https://api.razorpay.com/v1';
const paise = (rupees) => Math.round(rupees * 100);

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
        'content-type': 'application/json',
      },
      ...(body && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new RazorpayError('gateway_unreachable', 'The payment gateway could not be reached. You have not been charged.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new RazorpayError('gateway_error', data?.error?.description ?? `Razorpay error ${res.status}`);
  return data;
}

/** A Razorpay order for a hold's bill. `amount` is in whole rupees. */
export async function createOrder({ amount, holdId, userId }) {
  const order = await call('POST', '/orders', {
    amount: paise(amount),
    currency: 'INR',
    receipt: String(holdId),
    notes: { holdId: String(holdId), userId: String(userId) },
  });
  return { orderId: order.id, amount: order.amount, currency: order.currency };
}

// Razorpay signs order_id|payment_id with the key secret; compared in constant time.
export function signatureValid({ orderId, paymentId, signature }) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature.toLowerCase()));
}

/**
 * Confirm a payment made in Razorpay's checkout before giving out tickets.
 * Throws RazorpayError (and takes no money) unless the signature is genuine,
 * the payment is for this hold's order and for exactly `amount` rupees.
 */
export async function confirmPayment({ holdId, amount, proof }) {
  const { orderId, paymentId } = proof;
  if (!signatureValid(proof)) throw new RazorpayError('invalid_signature', 'We couldn’t verify that payment with Razorpay.');
  const [order, payment] = await Promise.all([call('GET', `/orders/${orderId}`), call('GET', `/payments/${paymentId}`)]);
  if (order.notes?.holdId !== String(holdId) || payment.order_id !== orderId) {
    throw new RazorpayError('order_mismatch', 'That payment is for a different booking. Any money taken is being refunded.');
  }
  if (payment.amount !== paise(amount) || payment.currency !== 'INR') {
    throw new RazorpayError('amount_mismatch', 'The price changed while you were paying, so your payment is being refunded. Please try again.');
  }
  let captured = payment;
  if (payment.status === 'authorized') {
    captured = await call('POST', `/payments/${paymentId}/capture`, { amount: payment.amount, currency: 'INR' });
  } else if (payment.status !== 'captured') {
    throw new RazorpayError('not_paid', 'That payment didn’t go through. You haven’t been charged.');
  }
  return { chargeId: paymentId, last4: captured.card?.last4 ?? null, method: captured.method ?? null };
}

/** Refund all or part of a captured payment. `amount` is in whole rupees. */
export async function refundPayment({ chargeId, amount }) {
  const refund = await call('POST', `/payments/${chargeId}/refund`, amount ? { amount: paise(amount) } : {});
  return { refundId: refund.id, chargeId, amount };
}

/**
 * After a checkout failed, give back money Razorpay already captured for it
 * (e.g. the hold expired while the buyer was in the payment window). Only
 * acts on a genuine, captured, not-yet-refunded payment.
 */
export async function refundUnused(proof) {
  if (!signatureValid(proof)) return null;
  const payment = await call('GET', `/payments/${proof.paymentId}`);
  if (payment.status !== 'captured' || (payment.amount_refunded ?? 0) >= payment.amount) return null;
  return refundPayment({ chargeId: proof.paymentId, amount: (payment.amount - (payment.amount_refunded ?? 0)) / 100 });
}
