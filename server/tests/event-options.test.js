import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, clearDb, app, signUp, publishedEvent, eventPayload, futureDate } from './helpers.js';
import { Event } from '../src/models/Event.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const card = { number: '4242 4242 4242 4242', expMonth: 12, expYear: new Date().getFullYear() + 1, cvc: '123', name: 'Buyer' };
let n = 0;
const hold = (buyer, id, seats) => buyer.agent.post(`/api/events/${id}/holds`).send({ seatIds: seats.map((s) => s.id) });

describe('seat options: aisles, blocked and accessible seats', () => {
  const rows = [
    { label: 'A', seats: 6, tier: 'VIP', aisleAfter: [3], blocked: [6], accessible: [1, 2] },
    { label: 'B', seats: 6, tier: 'General' },
  ];

  it('never creates blocked seats and flags accessible ones', async () => {
    const org = await signUp('organizer');
    const { id, seats } = await publishedEvent(org, { rows });
    const labels = seats.map((s) => s.label);
    expect(labels).not.toContain('A6');
    expect(seats).toHaveLength(11);
    expect(seats.filter((s) => s.accessible).map((s) => s.label)).toEqual(['A1', 'A2']);

    const { body } = await request(app).get(`/api/events/${id}`).expect(200);
    expect(body.event.capacity).toBe(11);
    expect(body.event.rows[0]).toMatchObject({ aisleAfter: [3], blocked: [6], accessible: [1, 2] });
  });

  it('rejects options that point outside the row or contradict each other', async () => {
    const org = await signUp('organizer');
    const create = (row) => org.agent.post('/api/events').send(eventPayload({ rows: [row] }));
    const msg = async (row) => (await create(row).expect(400)).body.error.message;
    expect(await msg({ label: 'A', seats: 4, tier: 'VIP', aisleAfter: [4] })).toMatch(/aisle after seat 4/);
    expect(await msg({ label: 'A', seats: 4, tier: 'VIP', blocked: [5] })).toMatch(/blocked seat 5/);
    expect(await msg({ label: 'A', seats: 4, tier: 'VIP', blocked: [2], accessible: [2] })).toMatch(/both blocked and accessible/);
    expect(await msg({ label: 'A', seats: 2, tier: 'VIP', blocked: [1, 2] })).toMatch(/at least one seat for sale/);
  });

  it('keeps tier descriptions', async () => {
    const org = await signUp('organizer');
    const tiers = [{ name: 'VIP', price: 2000, description: 'Front rows, free drink' }, { name: 'General', price: 500 }];
    const { id } = await publishedEvent(org, { tiers });
    const { body } = await request(app).get(`/api/events/${id}`).expect(200);
    expect(body.event.tiers.map((t) => t.description)).toEqual(['Front rows, free drink', '']);
  });
});

describe('booking rules', () => {
  it('limits tickets per order to the organizer’s number', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org, { maxPerOrder: 2 });
    expect((await request(app).get(`/api/events/${id}`)).body.event.maxPerOrder).toBe(2);

    const res = await hold(buyer, id, seats.slice(0, 3)).expect(400);
    expect(res.body.error.code).toBe('TOO_MANY_SEATS');
    await hold(buyer, id, seats.slice(0, 2)).expect(201);

    await org.agent.post('/api/events').send(eventPayload({ maxPerOrder: 50 })).expect(400);
  });

  it('does not sell before the sales start time', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org, { salesStartAt: futureDate(5) });
    const { body } = await request(app).get(`/api/events/${id}`).expect(200);
    expect(body.event.onSale).toBe(false);
    expect(new Date(body.event.salesStartAt) > new Date()).toBe(true);
    expect((await hold(buyer, id, seats.slice(0, 1)).expect(409)).body.error.code).toBe('SALES_NOT_OPEN');
  });

  it('rejects a sales window that is already over or opens after it closes', async () => {
    const org = await signUp('organizer');
    const soon = new Date(Date.now() + 30 * 60_000).toISOString();
    const late = await org.agent.post('/api/events').send(eventPayload({ startsAt: soon, salesCloseMinutes: 60 })).expect(400);
    expect(late.body.error.details[0].field).toBe('salesCloseMinutes');
    const backwards = await org.agent.post('/api/events').send(eventPayload({ startsAt: futureDate(10), salesStartAt: futureDate(20) })).expect(400);
    expect(backwards.body.error.details[0].field).toBe('salesStartAt');
  });

  it('closing sales early stops new holds but not transfers of sold tickets', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const friend = await signUp();
    const { id, seats } = await publishedEvent(org);
    const { body: h } = await hold(buyer, id, seats.slice(0, 1)).expect(201);
    const { body: order } = await buyer.agent.post(`/api/holds/${h.hold._id}/checkout`).set('Idempotency-Key', `options-${n++}-${Date.now()}`).send({ card }).expect(201);

    // Organizer closes sales well before the show (as if the cut-off has passed).
    await Event.updateOne({ _id: id }, { salesCloseMinutes: 60 * 24 * 60 });
    expect((await hold(friend, id, seats.slice(1, 2)).expect(409)).body.error.code).toBe('NOT_ON_SALE');
    await buyer.agent.post(`/api/tickets/${order.tickets[0]._id}/transfer`).send({ email: friend.user.email }).expect(200);
  });

  it('new showtimes copy the layout options and booking limits', async () => {
    const org = await signUp('organizer');
    const rows = [{ label: 'A', seats: 4, tier: 'VIP', blocked: [4], aisleAfter: [2] }];
    const { id } = await publishedEvent(org, { rows, maxPerOrder: 3, salesCloseMinutes: 30 });
    const res = await org.agent.post(`/api/events/${id}/showtimes`).send({ startsAt: futureDate(40) }).expect(201);
    const show = await Event.findById(res.body.event.id ?? res.body.event._id);
    expect(show.maxPerOrder).toBe(3);
    expect(show.salesCloseMinutes).toBe(30);
    expect(show.rows[0].blocked).toEqual([4]);
  });
});

describe('editing', () => {
  it('only changes the fields that were sent', async () => {
    const org = await signUp('organizer');
    const created = await org.agent.post('/api/events').send(eventPayload({ durationMinutes: 90, description: 'Keep me', maxPerOrder: 4, salesCloseMinutes: 60 })).expect(201);
    const id = created.body.event.id;
    const { body } = await org.agent.patch(`/api/events/${id}`).send({ title: 'Renamed draft' }).expect(200);
    expect(body.event).toMatchObject({ title: 'Renamed draft', durationMinutes: 90, description: 'Keep me', maxPerOrder: 4, salesCloseMinutes: 60 });

    await org.agent.post(`/api/events/${id}/publish`).expect(200);
    const after = await org.agent.patch(`/api/events/${id}`).send({ coverImageUrl: 'https://example.com/a.jpg' }).expect(200);
    expect(after.body.event.description).toBe('Keep me');
  });
});

describe('cities', () => {
  it('stores the usual name for a city and finds it by any of its names', async () => {
    const org = await signUp('organizer');
    await publishedEvent(org, { title: 'Blr Show', venue: { name: 'Hall', city: '  bangalore ' } });
    await publishedEvent(org, { title: 'Mum Show 1', venue: { name: 'Hall', city: 'Mumbai' } });
    await publishedEvent(org, { title: 'Mum Show 2', venue: { name: 'Hall', city: 'bombay' } });
    await publishedEvent(org, { title: 'Navi', venue: { name: 'Hall', city: 'navi mumbai' } });

    const { body } = await request(app).get('/api/events/cities').expect(200);
    expect(body.counts).toEqual({ Bengaluru: 1, Mumbai: 2, 'Navi Mumbai': 1 });
    expect(body.cities).toEqual(['Bengaluru', 'Mumbai', 'Navi Mumbai']);

    const byAlias = await request(app).get('/api/events').query({ city: 'Bangalore' }).expect(200);
    expect(byAlias.body.items.map((e) => e.title)).toEqual(['Blr Show']);
    expect(byAlias.body.items[0].venue.city).toBe('Bengaluru');
    const mumbai = await request(app).get('/api/events').query({ city: 'mumbai' }).expect(200);
    expect(mumbai.body.items.map((e) => e.title).sort()).toEqual(['Mum Show 1', 'Mum Show 2']);
  });
});
