import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, clearDb, app, signUp, publishedEvent } from './helpers.js';
import { qrPayloadFor } from '../src/services/ticketSigner.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const card = { number: '4242 4242 4242 4242', expMonth: 12, expYear: new Date().getFullYear() + 1, cvc: '123', name: 'Buyer' };
let n = 0;

async function buyTickets(buyer, eventId, seats) {
  const { body } = await buyer.agent.post(`/api/events/${eventId}/holds`).send({ seatIds: seats.map((s) => s.id) });
  const res = await buyer.agent.post(`/api/holds/${body.hold._id}/checkout`).set('Idempotency-Key', `checkin-${n++}-${Date.now()}`).send({ card });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body;
}

describe('check-in', () => {
  it('admits a valid ticket once and rejects the second scan', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org);
    const { tickets } = await buyTickets(buyer, id, seats.slice(0, 1));

    const first = await org.agent.post(`/api/events/${id}/checkin`).send({ qr: tickets[0].qr });
    expect(first.status).toBe(200);
    expect(first.body.checkin.label).toBe(seats[0].label);
    expect(first.body.checkin.attendee).toBe(buyer.user.name);

    const again = await org.agent.post(`/api/events/${id}/checkin`).send({ qr: tickets[0].qr });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_CHECKED_IN');
    expect(again.body.error.details.checkedInAt).toBeTruthy();
  });

  it('admits only once when two scanners read the same code simultaneously', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org);
    const { tickets } = await buyTickets(buyer, id, seats.slice(0, 1));

    const scans = await Promise.all(Array.from({ length: 5 }, () => org.agent.post(`/api/events/${id}/checkin`).send({ qr: tickets[0].qr })));
    expect(scans.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('rejects forged, tampered, cancelled and wrong-event tickets', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org);
    const other = await publishedEvent(org, { title: 'Other Show' });
    const { tickets, order } = await buyTickets(buyer, id, seats.slice(0, 2));
    const otherTickets = await buyTickets(buyer, other.id, other.seats.slice(0, 1));

    const scan = (qr) => org.agent.post(`/api/events/${id}/checkin`).send({ qr });
    const [, ticketId, sig] = tickets[0].qr.split('.');
    const forgedId = ticketId.replace(/.$/, (c) => (c === '0' ? '1' : '0'));

    expect((await scan('hello')).body.error.code).toBe('INVALID_TICKET');
    expect((await scan(`SL1.${forgedId}.${sig}`)).body.error.code).toBe('INVALID_TICKET');
    expect((await scan(qrPayloadFor('0123456789abcdef01234567'))).body.error.code).toBe('INVALID_TICKET');
    expect((await scan(otherTickets.tickets[0].qr)).body.error.code).toBe('WRONG_EVENT');

    await buyer.agent.post(`/api/orders/${order._id}/cancel`).expect(200);
    expect((await scan(tickets[1].qr)).body.error.code).toBe('TICKET_CANCELLED');
  });

  it('only lets the owning organizer scan', async () => {
    const org = await signUp('organizer');
    const rival = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org);
    const { tickets } = await buyTickets(buyer, id, seats.slice(0, 1));

    await rival.agent.post(`/api/events/${id}/checkin`).send({ qr: tickets[0].qr }).expect(403);
    await buyer.agent.post(`/api/events/${id}/checkin`).send({ qr: tickets[0].qr }).expect(403);
    await request(app).post(`/api/events/${id}/checkin`).send({ qr: tickets[0].qr }).expect(401);
    // the public event page must stay public
    await request(app).get(`/api/events/${id}`).expect(200);
  });
});

describe('scan links', () => {
  it('admits from the printed scan link and names the account holder', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org);
    const { tickets } = await buyTickets(buyer, id, seats.slice(0, 1));
    expect(tickets[0].qrUrl).toMatch(new RegExp(`/scan/${tickets[0].qr.replace(/\./g, '\\.')}$`));

    const res = await org.agent.post('/api/tickets/checkin').send({ qr: tickets[0].qrUrl }).expect(200);
    expect(res.body.checkin).toMatchObject({ label: seats[0].label, attendee: buyer.user.name, attendeeEmail: buyer.user.email });
    expect(res.body.checkin.event.id).toBe(id);

    const again = await org.agent.post('/api/tickets/checkin').send({ qr: tickets[0].qr }).expect(409);
    expect(again.body.error.code).toBe('ALREADY_CHECKED_IN');
  });

  it('the in-event scanner also accepts scan links', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org);
    const { tickets } = await buyTickets(buyer, id, seats.slice(0, 1));
    await org.agent.post(`/api/events/${id}/checkin`).send({ qr: tickets[0].qrUrl }).expect(200);
  });

  it('only the event’s organizer can use a scan link', async () => {
    const org = await signUp('organizer');
    const rival = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org);
    const { tickets } = await buyTickets(buyer, id, seats.slice(0, 1));

    const res = await rival.agent.post('/api/tickets/checkin').send({ qr: tickets[0].qrUrl }).expect(403);
    expect(res.body.error.code).toBe('NOT_YOUR_EVENT');
    await buyer.agent.post('/api/tickets/checkin').send({ qr: tickets[0].qrUrl }).expect(403);
    await request(app).post('/api/tickets/checkin').send({ qr: tickets[0].qrUrl }).expect(401);
    expect((await org.agent.post('/api/tickets/checkin').send({ qr: 'https://evil.example/scan/nope' })).body.error.code).toBe('INVALID_TICKET');
  });
});

describe('organizer stats', () => {
  it('reports sales, revenue per tier, refunds and check-ins', async () => {
    const org = await signUp('organizer');
    const a = await signUp();
    const b = await signUp();
    const { id, seats } = await publishedEvent(org); // A1-A4 VIP 2000, B1-B6 General 500
    const vip = seats.filter((s) => s.tier === 'VIP');
    const gen = seats.filter((s) => s.tier === 'General');

    const first = await buyTickets(a, id, [vip[0], vip[1]]);
    const second = await buyTickets(b, id, [gen[0]]);
    await b.agent.post(`/api/orders/${second.order._id}/cancel`).expect(200);
    await buyTickets(b, id, [gen[1], gen[2]]);
    await org.agent.post(`/api/events/${id}/checkin`).send({ qr: first.tickets[0].qr }).expect(200);

    const { body } = await org.agent.get(`/api/events/${id}/stats`).expect(200);
    const s = body.stats;
    expect(s.capacity).toBe(10);
    expect(s.sold).toBe(4);
    expect(s.revenue).toBe(2 * 2000 + 2 * 500);
    expect(s.refunds).toEqual({ count: 1, amount: 500 });
    expect(s.tiers.map((t) => [t.tier, t.sold, t.revenue])).toEqual([['VIP', 2, 4000], ['General', 2, 1000]]);
    expect(s.checkins).toEqual({ issued: 4, checkedIn: 1 });
    expect(s.salesByDay[0].tickets).toBe(4);

    const guests = await org.agent.get(`/api/events/${id}/attendees`).query({ q: a.user.name }).expect(200);
    expect(guests.body.items).toHaveLength(2);
  });
});
