import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { startDb, stopDb, clearDb, signUp, publishedEvent } from './helpers.js';
import { env } from '../src/config/env.js';
import { Hold } from '../src/models/Hold.js';

// A stand-in for Razorpay's REST API: orders, payments, capture and refunds,
// kept in memory. Tests "pay" in the browser by calling pay().
const SECRET = 'test_secret_for_razorpay_tests';
let orders;
let payments;
let refunds;
const sign = (orderId, paymentId, secret = SECRET) => crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

function fakeRazorpay(url, init = {}) {
  const path = new URL(url).pathname.replace('/v1', '');
  const body = init.body ? JSON.parse(init.body) : {};
  const json = (status, data) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }));
  let m;
  if (init.method === 'POST' && path === '/orders') {
    const order = { id: `order_${crypto.randomBytes(6).toString('hex')}`, amount: body.amount, currency: body.currency, notes: body.notes, status: 'created' };
    orders.set(order.id, order);
    return json(200, order);
  }
  if ((m = path.match(/^\/orders\/(\w+)$/))) return orders.has(m[1]) ? json(200, orders.get(m[1])) : json(400, { error: { description: 'no such order' } });
  if ((m = path.match(/^\/payments\/(\w+)$/))) return payments.has(m[1]) ? json(200, payments.get(m[1])) : json(400, { error: { description: 'no such payment' } });
  if ((m = path.match(/^\/payments\/(\w+)\/capture$/))) { const p = payments.get(m[1]); p.status = 'captured'; return json(200, p); }
  if ((m = path.match(/^\/payments\/(\w+)\/refund$/))) {
    const p = payments.get(m[1]);
    const amount = body.amount ?? p.amount - (p.amount_refunded ?? 0);
    p.amount_refunded = (p.amount_refunded ?? 0) + amount;
    const r = { id: `rfnd_${crypto.randomBytes(5).toString('hex')}`, payment_id: p.id, amount };
    refunds.push(r);
    return json(200, r);
  }
  return json(404, { error: { description: `unhandled ${init.method} ${path}` } });
}

// What Razorpay's checkout does in the browser: take the money for an order.
function pay(order, { amount = order.amount, status = 'captured' } = {}) {
  const p = { id: `pay_${crypto.randomBytes(6).toString('hex')}`, order_id: order.orderId ?? order.id, amount, currency: 'INR', status, method: 'card', card: { last4: '1111' }, amount_refunded: 0 };
  payments.set(p.id, p);
  return { orderId: p.order_id, paymentId: p.id, signature: sign(p.order_id, p.id) };
}

beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await clearDb();
  orders = new Map();
  payments = new Map();
  refunds = [];
  env.RAZORPAY_KEY_ID = 'rzp_test_dummy';
  env.RAZORPAY_KEY_SECRET = SECRET;
  vi.stubGlobal('fetch', vi.fn(fakeRazorpay));
});
afterEach(() => {
  delete env.RAZORPAY_KEY_ID;
  delete env.RAZORPAY_KEY_SECRET;
  vi.unstubAllGlobals();
});

let n = 0;
async function holdFor(buyer, id, seats) {
  const { body } = await buyer.agent.post(`/api/events/${id}/holds`).send({ seatIds: seats.map((s) => s.id) }).expect(201);
  return body.hold._id;
}
const checkout = (buyer, holdId, razorpay) => buyer.agent.post(`/api/holds/${holdId}/checkout`).set('Idempotency-Key', `rzp-checkout-${n++}`).send({ razorpay });

describe('Razorpay checkout', () => {
  it('pays through Razorpay: order for the exact bill, verified signature, tickets issued', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org);
    const holdId = await holdFor(buyer, id, [seats[0]]); // VIP ₹2,000 (no fee in tests)

    const quote = await buyer.agent.get(`/api/holds/${holdId}`).expect(200);
    expect(quote.body.payments).toEqual({ provider: 'razorpay', keyId: 'rzp_test_dummy' });
    const rzOrder = (await buyer.agent.post(`/api/holds/${holdId}/razorpay-order`).expect(200)).body;
    expect(rzOrder).toMatchObject({ keyId: 'rzp_test_dummy', amount: 200000, currency: 'INR' });

    const res = await checkout(buyer, holdId, pay(rzOrder)).expect(201);
    expect(res.body.order).toMatchObject({ status: 'paid', amount: 2000, payment: { provider: 'razorpay', last4: '1111', method: 'card' } });
    expect(res.body.tickets).toHaveLength(1);

    // Cancelling refunds through Razorpay.
    await buyer.agent.post(`/api/orders/${res.body.order._id}/cancel`).expect(200);
    expect(refunds).toEqual([expect.objectContaining({ payment_id: res.body.order.payment.chargeId, amount: 200000 })]);
  });

  it('captures an authorized payment', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org);
    const holdId = await holdFor(buyer, id, [seats[0]]);
    const rzOrder = (await buyer.agent.post(`/api/holds/${holdId}/razorpay-order`).expect(200)).body;
    const proof = pay(rzOrder, { status: 'authorized' });
    await checkout(buyer, holdId, proof).expect(201);
    expect(payments.get(proof.paymentId).status).toBe('captured');
  });

  it('refuses a forged signature and keeps the hold', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org);
    const holdId = await holdFor(buyer, id, [seats[0]]);
    const rzOrder = (await buyer.agent.post(`/api/holds/${holdId}/razorpay-order`).expect(200)).body;
    const proof = pay(rzOrder);
    const res = await checkout(buyer, holdId, { ...proof, signature: sign(proof.orderId, proof.paymentId, 'not-the-secret') }).expect(402);
    expect(res.body.error.details.reason).toBe('invalid_signature');
    expect((await Hold.findById(holdId)).status).toBe('active');
  });

  it('refunds automatically when the amount paid doesn’t match the bill', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org);
    const holdId = await holdFor(buyer, id, [seats[0]]);
    const rzOrder = (await buyer.agent.post(`/api/holds/${holdId}/razorpay-order`).expect(200)).body;
    const proof = pay(rzOrder, { amount: 100 }); // ₹1 instead of ₹2,000
    const res = await checkout(buyer, holdId, proof).expect(402);
    expect(res.body.error.details.reason).toBe('amount_mismatch');
    expect(refunds.map((r) => r.payment_id)).toEqual([proof.paymentId]);
  });

  it('refunds when the hold expired while the buyer was paying', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org);
    const holdId = await holdFor(buyer, id, [seats[0]]);
    const rzOrder = (await buyer.agent.post(`/api/holds/${holdId}/razorpay-order`).expect(200)).body;
    const proof = pay(rzOrder);
    await Hold.updateOne({ _id: holdId }, { expiresAt: new Date(Date.now() - 1000) });
    await checkout(buyer, holdId, proof).expect(410);
    expect(refunds.map((r) => r.payment_id)).toEqual([proof.paymentId]);
  });

  it('won’t let one payment buy a second order, or another hold’s payment be used', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const other = await signUp();
    const { id, seats } = await publishedEvent(org);
    const holdA = await holdFor(buyer, id, [seats[0]]);
    const orderA = (await buyer.agent.post(`/api/holds/${holdA}/razorpay-order`).expect(200)).body;
    const proofA = pay(orderA);
    await checkout(buyer, holdA, proofA).expect(201);

    const holdB = await holdFor(other, id, [seats[1]]);
    const reuse = await checkout(other, holdB, proofA);
    expect([402, 409]).toContain(reuse.status); // belongs to another hold / already used
    expect(refunds).toHaveLength(0); // and the original buyer's payment is never refunded by it
  });
});
