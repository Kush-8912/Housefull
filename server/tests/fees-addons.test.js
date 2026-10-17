import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startDb, stopDb, clearDb, signUp, publishedEvent } from './helpers.js';
import { hold, pay } from './shared.js';
import { env } from '../src/config/env.js';
import { bill } from '../src/services/pricing.js';
import { Addon } from '../src/models/Addon.js';

beforeAll(async () => {
  await startDb();
  env.BOOKING_FEE_PERCENT = 6;
});
afterAll(async () => {
  env.BOOKING_FEE_PERCENT = 0;
  await stopDb();
});
beforeEach(clearDb);

async function setup() {
  const org = await signUp('organizer');
  const buyer = await signUp();
  const { id, seats } = await publishedEvent(org); // A1-A4 VIP 2000, B1-B6 General 500
  return { org, buyer, eventId: id, seats };
}
const addAddon = (org, eventId, body) => org.agent.post(`/api/events/${eventId}/addons`).send(body);

describe('bill', () => {
  it('charges the fee on tickets after discount, and 18% GST on the fee', () => {
    expect(bill({ ticketsSubtotal: 2000, discount: 400, addonsTotal: 300 })).toMatchObject({ bookingFee: 96, gst: 17, total: 1600 + 300 + 96 + 17 });
    expect(bill({ ticketsSubtotal: 0, addonsTotal: 0 })).toMatchObject({ bookingFee: 0, gst: 0, total: 0 });
  });
});

describe('booking fee and GST at checkout', () => {
  it('quotes and charges ticket price + fee + GST and stores the breakdown', async () => {
    const { buyer, eventId, seats } = await setup();
    const holdId = await hold(buyer.agent, eventId, [seats[0]]);
    const quote = await buyer.agent.get(`/api/holds/${holdId}`).expect(200);
    expect(quote.body).toMatchObject({ subtotal: 2000, bookingFee: 120, gst: 22, total: 2142, feePercent: 6 });
    const res = await pay(buyer.agent, holdId).expect(201);
    expect(res.body.order).toMatchObject({ subtotal: 2000, bookingFee: 120, gst: 22, amount: 2142 });
  });

  it('attendee cancellation refunds everything except the booking fee and GST', async () => {
    const { buyer, eventId, seats } = await setup();
    const { body } = await pay(buyer.agent, await hold(buyer.agent, eventId, [seats[0]])).expect(201);
    const res = await buyer.agent.post(`/api/orders/${body.order._id}/cancel`).expect(200);
    expect(res.body.order).toMatchObject({ status: 'refunded', refundedAmount: 2000 });
  });

  it('event cancellation refunds the full amount; organizer revenue never includes fees', async () => {
    const { org, buyer, eventId, seats } = await setup();
    const { body } = await pay(buyer.agent, await hold(buyer.agent, eventId, [seats[0]])).expect(201);
    const stats = await org.agent.get(`/api/events/${eventId}/stats`).expect(200);
    expect(stats.body.stats.revenue).toBe(2000);
    await org.agent.post(`/api/events/${eventId}/cancel`).expect(200);
    const order = await buyer.agent.get(`/api/orders/${body.order._id}`).expect(200);
    expect(order.body.order.refundedAmount).toBe(2142);
  });
});

describe('add-ons', () => {
  it('organizer manages the menu; buyer adds items; stock is taken at payment', async () => {
    const { org, buyer, eventId, seats } = await setup();
    const popcorn = (await addAddon(org, eventId, { name: 'Popcorn combo', price: 250, stock: 10, kind: 'food' }).expect(201)).body.addon;
    const tee = (await addAddon(org, eventId, { name: 'Tour T-shirt', price: 799, kind: 'merch' }).expect(201)).body.addon;

    const holdId = await hold(buyer.agent, eventId, [seats[4]]); // General 500
    const detail = await buyer.agent.get(`/api/holds/${holdId}`).expect(200);
    expect(detail.body.menu.map((m) => m.name)).toEqual(['Popcorn combo', 'Tour T-shirt']);

    const quote = await buyer.agent.put(`/api/holds/${holdId}/addons`).send({ items: [{ addon: popcorn._id, qty: 2 }, { addon: tee._id, qty: 1 }] }).expect(200);
    // tickets 500 + fee 30 + gst 5 + add-ons 1299 (no fee on add-ons)
    expect(quote.body).toMatchObject({ addonsTotal: 1299, bookingFee: 30, gst: 5, total: 1834 });

    const res = await pay(buyer.agent, holdId).expect(201);
    expect(res.body.order.addons).toEqual([
      { addon: popcorn._id, name: 'Popcorn combo', price: 250, qty: 2 },
      { addon: tee._id, name: 'Tour T-shirt', price: 799, qty: 1 },
    ]);
    expect((await Addon.findById(popcorn._id)).sold).toBe(2);
  });

  it('never oversells limited stock, and gives stock back on refund', async () => {
    const { org, buyer, eventId, seats } = await setup();
    const buyer2 = await signUp();
    const last = (await addAddon(org, eventId, { name: 'Signed poster', price: 500, stock: 1, kind: 'merch' }).expect(201)).body.addon;
    const h1 = await hold(buyer.agent, eventId, [seats[4]]);
    const h2 = await hold(buyer2.agent, eventId, [seats[5]]);
    await buyer.agent.put(`/api/holds/${h1}/addons`).send({ items: [{ addon: last._id, qty: 1 }] }).expect(200);
    await buyer2.agent.put(`/api/holds/${h2}/addons`).send({ items: [{ addon: last._id, qty: 1 }] }).expect(200);

    const [a, b] = await Promise.all([pay(buyer.agent, h1), pay(buyer2.agent, h2)]);
    expect([a.status, b.status].filter((st) => st === 201)).toHaveLength(1);
    const loser = a.status === 201 ? b : a;
    expect(loser.body.error.code).toBe('ADDON_SOLD_OUT');
    expect((await Addon.findById(last._id)).sold).toBe(1);

    const winner = a.status === 201 ? a : b;
    const winnerAgent = a.status === 201 ? buyer.agent : buyer2.agent;
    await winnerAgent.post(`/api/orders/${winner.body.order._id}/cancel`).expect(200);
    expect((await Addon.findById(last._id)).sold).toBe(0);
  });

  it('a declined card returns the stock; limits and other events’ items are refused', async () => {
    const { org, buyer, eventId, seats } = await setup();
    const item = (await addAddon(org, eventId, { name: 'Nachos', price: 200, stock: 5, maxPerOrder: 2 }).expect(201)).body.addon;
    const holdId = await hold(buyer.agent, eventId, [seats[4]]);
    const tooMany = await buyer.agent.put(`/api/holds/${holdId}/addons`).send({ items: [{ addon: item._id, qty: 3 }] });
    expect(tooMany.body.error.code).toBe('ADDON_LIMIT');

    const other = await publishedEvent(org, { title: 'Other show' });
    const foreign = (await addAddon(org, other.id, { name: 'Elsewhere', price: 100 }).expect(201)).body.addon;
    const wrong = await buyer.agent.put(`/api/holds/${holdId}/addons`).send({ items: [{ addon: foreign._id, qty: 1 }] });
    expect(wrong.body.error.code).toBe('ADDON_UNAVAILABLE');

    await buyer.agent.put(`/api/holds/${holdId}/addons`).send({ items: [{ addon: item._id, qty: 2 }] }).expect(200);
    await pay(buyer.agent, holdId, { c: { number: '4000000000000002', expMonth: 12, expYear: 2099, cvc: '123', name: 'X Y' } }).expect(402);
    expect((await Addon.findById(item._id)).sold).toBe(0);
  });

  it('sold add-ons can only be switched off, and stock can’t drop below sold', async () => {
    const { org, buyer, eventId, seats } = await setup();
    const item = (await addAddon(org, eventId, { name: 'Coffee', price: 150, stock: 5 }).expect(201)).body.addon;
    const holdId = await hold(buyer.agent, eventId, [seats[4]]);
    await buyer.agent.put(`/api/holds/${holdId}/addons`).send({ items: [{ addon: item._id, qty: 2 }] }).expect(200);
    await pay(buyer.agent, holdId).expect(201);

    expect((await org.agent.delete(`/api/events/${eventId}/addons/${item._id}`)).body.error.code).toBe('ADDON_IN_USE');
    await org.agent.patch(`/api/events/${eventId}/addons/${item._id}`).send({ stock: 1 }).expect(400);
    const off = await org.agent.patch(`/api/events/${eventId}/addons/${item._id}`).send({ active: false }).expect(200);
    expect(off.body.addon.active).toBe(false);
    const stats = await org.agent.get(`/api/events/${eventId}/stats`).expect(200);
    expect(stats.body.stats.addonsRevenue).toBe(300);
  });
});
