import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startDb, stopDb, clearDb, signUp, publishedEvent } from './helpers.js';
import { pay, hold, buy } from './shared.js';
import { PromoCode } from '../src/models/PromoCode.js';
import { Hold } from '../src/models/Hold.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

async function setup(promo = { code: 'save20', kind: 'percent', value: 20 }) {
  const org = await signUp('organizer');
  const buyer = await signUp();
  const { id, seats } = await publishedEvent(org);
  const res = await org.agent.post(`/api/events/${id}/promos`).send(promo);
  expect(res.status).toBe(201);
  return { org, buyer, eventId: id, seats, promo: res.body.promo };
}

describe('promo codes', () => {
  it('organizer creates a code (normalised to upper case) and duplicates are refused', async () => {
    const { org, eventId, promo } = await setup();
    expect(promo.code).toBe('SAVE20');
    const dup = await org.agent.post(`/api/events/${eventId}/promos`).send({ code: 'Save20', kind: 'flat', value: 100 });
    expect(dup.status).toBe(409);
    const list = await org.agent.get(`/api/events/${eventId}/promos`).expect(200);
    expect(list.body.items).toHaveLength(1);
  });

  it('validates percent and flat limits', async () => {
    const { org, eventId } = await setup();
    const bad = await org.agent.post(`/api/events/${eventId}/promos`).send({ code: 'HALFPLUS', kind: 'percent', value: 150 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].field).toBe('value');
  });

  it('only the event owner can manage codes', async () => {
    const { eventId } = await setup();
    const other = await signUp('organizer');
    await other.agent.get(`/api/events/${eventId}/promos`).expect(403);
  });

  it('applies a percentage discount at checkout and counts the use', async () => {
    const { buyer, eventId, seats, promo } = await setup();
    const holdId = await hold(buyer.agent, eventId, [seats[0]]); // VIP 2000
    const quote = await buyer.agent.post(`/api/holds/${holdId}/promo`).send({ code: 'save20' }).expect(200);
    expect(quote.body).toMatchObject({ subtotal: 2000, discount: 400, total: 1600 });

    const detail = await buyer.agent.get(`/api/holds/${holdId}`).expect(200);
    expect(detail.body.total).toBe(1600);

    const res = await pay(buyer.agent, holdId);
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ subtotal: 2000, discount: 400, amount: 1600, promo: { code: 'SAVE20' } });
    expect((await PromoCode.findById(promo._id)).uses).toBe(1);
  });

  it('a flat discount larger than the order makes it free, with no card needed', async () => {
    const { buyer, eventId, seats } = await setup({ code: 'COMP', kind: 'flat', value: 5000 });
    const holdId = await hold(buyer.agent, eventId, [seats[0]]);
    await buyer.agent.post(`/api/holds/${holdId}/promo`).send({ code: 'comp' }).expect(200);
    const res = await buyer.agent.post(`/api/holds/${holdId}/checkout`).set('Idempotency-Key', 'free-key-123').send({});
    expect(res.status).toBe(201);
    expect(res.body.order.amount).toBe(0);
    expect(res.body.order.payment.chargeId).toBeFalsy();
  });

  it('rejects unknown, switched-off and expired codes', async () => {
    const { org, buyer, eventId, seats, promo } = await setup();
    const holdId = await hold(buyer.agent, eventId, [seats[0]]);

    const unknown = await buyer.agent.post(`/api/holds/${holdId}/promo`).send({ code: 'NOPE' });
    expect(unknown.body.error.code).toBe('PROMO_INVALID');

    await org.agent.patch(`/api/events/${eventId}/promos/${promo._id}`).send({ active: false }).expect(200);
    const off = await buyer.agent.post(`/api/holds/${holdId}/promo`).send({ code: 'SAVE20' });
    expect(off.body.error.code).toBe('PROMO_INVALID');

    await PromoCode.create({ event: eventId, code: 'OLD', kind: 'flat', value: 100, expiresAt: new Date(Date.now() - 1000) });
    const expired = await buyer.agent.post(`/api/holds/${holdId}/promo`).send({ code: 'old' });
    expect(expired.body.error.code).toBe('PROMO_EXPIRED');
  });

  it('a single-use code can only be redeemed once, even by racing checkouts', async () => {
    const { buyer, eventId, seats } = await setup({ code: 'ONCE', kind: 'flat', value: 100, maxUses: 1 });
    const buyer2 = await signUp();
    const h1 = await hold(buyer.agent, eventId, [seats[0]]);
    const h2 = await hold(buyer2.agent, eventId, [seats[1]]);
    await buyer.agent.post(`/api/holds/${h1}/promo`).send({ code: 'ONCE' }).expect(200);
    await buyer2.agent.post(`/api/holds/${h2}/promo`).send({ code: 'ONCE' }).expect(200);

    const [a, b] = await Promise.all([pay(buyer.agent, h1), pay(buyer2.agent, h2)]);
    expect([a.status, b.status].filter((st) => st === 201)).toHaveLength(1);
    const loser = a.status === 201 ? b : a;
    // Refused either up front (already used) or at redemption (lost the race).
    expect([400, 409]).toContain(loser.status);
    expect(loser.body.error.code).toBe('PROMO_EXHAUSTED');
    expect((await PromoCode.findOne({ code: 'ONCE' })).uses).toBe(1);
    // The loser keeps their seats and can pay full price.
    expect((await Hold.findById(a.status === 201 ? h2 : h1)).status).toBe('active');
  });

  it('gives the use back when the card is declined', async () => {
    const { buyer, eventId, seats, promo } = await setup();
    const holdId = await hold(buyer.agent, eventId, [seats[0]]);
    await buyer.agent.post(`/api/holds/${holdId}/promo`).send({ code: 'SAVE20' }).expect(200);
    const res = await pay(buyer.agent, holdId, { c: { number: '4000000000000002', expMonth: 12, expYear: 2099, cvc: '123', name: 'X Y' } });
    expect(res.status).toBe(402);
    expect((await PromoCode.findById(promo._id)).uses).toBe(0);
  });

  it('a used code cannot be deleted, only switched off; stats report the discount', async () => {
    const { org, buyer, eventId, seats, promo } = await setup();
    const holdId = await hold(buyer.agent, eventId, [seats[0]]);
    await buyer.agent.post(`/api/holds/${holdId}/promo`).send({ code: 'SAVE20' }).expect(200);
    await pay(buyer.agent, holdId).expect(201);

    const del = await org.agent.delete(`/api/events/${eventId}/promos/${promo._id}`);
    expect(del.body.error.code).toBe('PROMO_IN_USE');
    const stats = await org.agent.get(`/api/events/${eventId}/stats`).expect(200);
    expect(stats.body.stats).toMatchObject({ revenue: 1600, discounts: 400 });
  });

  it('refunding an order returns the use', async () => {
    const { buyer, eventId, seats, promo } = await setup({ code: 'ONEOFF', kind: 'flat', value: 50, maxUses: 1 });
    const holdId = await hold(buyer.agent, eventId, [seats[0]]);
    await buyer.agent.post(`/api/holds/${holdId}/promo`).send({ code: 'ONEOFF' }).expect(200);
    const { body } = await pay(buyer.agent, holdId).expect(201);
    await buyer.agent.post(`/api/orders/${body.order._id}/cancel`).expect(200);
    expect((await PromoCode.findById(promo._id)).uses).toBe(0);
  });

  it('orders without a code are unaffected', async () => {
    const { buyer, eventId, seats } = await setup();
    const body = await buy(buyer.agent, eventId, [seats[0]]);
    expect(body.order).toMatchObject({ subtotal: 2000, discount: 0, amount: 2000 });
  });
});
