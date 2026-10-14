import crypto from 'node:crypto';

/**
 * Mock card processor standing in for a real gateway (Stripe/Razorpay).
 * It keeps the same contract a real integration would have — charge with an
 * idempotency key, refund by charge id, typed decline errors — so swapping in
 * a real provider only touches this file. Only the last 4 digits are kept.
 *
 * Test cards:
 *   4242 4242 4242 4242  succeeds
 *   4000 0000 0000 0002  declined
 *   4000 0000 0000 9995  insufficient funds
 *   4000 0000 0000 0119  processor error (gateway outage)
 */
export class PaymentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const charges = new Map(); // idempotencyKey -> charge (provider-side dedupe)
const LATENCY_MS = process.env.NODE_ENV === 'test' ? 0 : 600;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function luhnValid(number) {
  let sum = 0;
  for (let i = 0; i < number.length; i += 1) {
    let d = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

export async function charge({ amount, card, idempotencyKey }) {
  if (charges.has(idempotencyKey)) return charges.get(idempotencyKey);
  await sleep(LATENCY_MS);

  const number = String(card.number).replace(/\s+/g, '');
  if (!/^\d{13,19}$/.test(number) || !luhnValid(number)) throw new PaymentError('invalid_number', 'That card number is not valid');

  const now = new Date();
  const expiry = new Date(card.expYear, card.expMonth, 1); // first day after the expiry month
  if (expiry <= now) throw new PaymentError('expired_card', 'This card has expired');

  if (number === '4000000000000002') throw new PaymentError('card_declined', 'Your card was declined');
  if (number === '4000000000009995') throw new PaymentError('insufficient_funds', 'Your card has insufficient funds');
  if (number === '4000000000000119') throw new PaymentError('processing_error', 'The payment processor is unavailable. You have not been charged.');

  const result = { chargeId: `ch_${crypto.randomBytes(10).toString('hex')}`, last4: number.slice(-4), amount };
  charges.set(idempotencyKey, result);
  return result;
}

// Full or partial refund; `amount` defaults to the whole charge, like a real gateway.
export async function refund({ chargeId, amount }) {
  await sleep(LATENCY_MS / 2);
  return { refundId: `re_${crypto.randomBytes(10).toString('hex')}`, chargeId, amount };
}
