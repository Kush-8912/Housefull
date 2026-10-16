import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, clearDb, signUp, publishedEvent, app } from './helpers.js';
import { buy, hold, pay, key } from './shared.js';
import { Ticket } from '../src/models/Ticket.js';
import { testOutbox } from '../src/services/mailer.js';
import { backgroundIdle } from '../src/utils/background.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await clearDb();
  testOutbox.length = 0;
});

async function setup() {
  const org = await signUp('organizer');
  const sender = await signUp();
  const friend = await signUp();
  const { id, seats } = await publishedEvent(org);
  const { order, tickets } = await buy(sender.agent, id, seats.slice(0, 2));
  return { org, sender, friend, eventId: id, order, tickets };
}

const send = (agent, ticketId, email) => agent.post(`/api/tickets/${ticketId}/transfer`).send({ email });

describe('ticket transfer', () => {
  it('moves the seat to the recipient with a new QR; the old QR stops working', async () => {
    const { org, sender, friend, eventId, tickets } = await setup();
    const res = await send(sender.agent, tickets[0]._id, friend.user.email.toUpperCase());
    expect(res.status).toBe(200);
    expect(res.body.ticket.status).toBe('transferred');
    expect(res.body.recipient.name).toBe(friend.user.name);

    // The sender sees the ticket as transferred, with no QR code.
    const mine = await sender.agent.get('/api/orders').expect(200);
    const sent = mine.body.items[0].tickets.find((t) => t._id === tickets[0]._id);
    expect(sent).toMatchObject({ status: 'transferred', qr: null, transferredTo: { name: friend.user.name } });
    expect(mine.body.items[0].tickets).toHaveLength(2); // never the recipient's copy

    // The recipient has it under "received" with a fresh QR.
    const theirs = await friend.agent.get('/api/orders').expect(200);
    expect(theirs.body.items).toHaveLength(0);
    expect(theirs.body.received).toHaveLength(1);
    const got = theirs.body.received[0].tickets[0];
    expect(got).toMatchObject({ label: tickets[0].label, status: 'valid', from: sender.user.name });
    expect(got.qr).not.toBe(tickets[0].qr);

    // Door: old code refused, new code admitted.
    const old = await org.agent.post(`/api/events/${eventId}/checkin`).send({ qr: tickets[0].qr });
    expect(old.body.error.code).toBe('TICKET_TRANSFERRED');
    await org.agent.post(`/api/events/${eventId}/checkin`).send({ qr: got.qr }).expect(200);

    await backgroundIdle();
    const inbox = await friend.agent.get('/api/notifications').expect(200);
    expect(inbox.body.items[0].type).toBe('ticket_received');
    expect(testOutbox.some((m) => m.to === friend.user.email && m.subject.includes('sent you a ticket'))).toBe(true);
  });

  it('refuses unknown emails, yourself, organizers and other people’s tickets', async () => {
    const { org, sender, friend, tickets } = await setup();
    expect((await send(sender.agent, tickets[0]._id, 'nobody@test.dev')).body.error.code).toBe('RECIPIENT_NOT_FOUND');
    expect((await send(sender.agent, tickets[0]._id, sender.user.email)).body.error.code).toBe('RECIPIENT_INVALID');
    expect((await send(sender.agent, tickets[0]._id, org.user.email)).body.error.code).toBe('RECIPIENT_INVALID');
    await send(friend.agent, tickets[0]._id, friend.user.email).expect(404);
  });

  it('a ticket can only be sent once, and used tickets cannot be sent', async () => {
    const { org, sender, friend, eventId, tickets } = await setup();
    const third = await signUp();
    const [a, b] = await Promise.all([send(sender.agent, tickets[0]._id, friend.user.email), send(sender.agent, tickets[0]._id, third.user.email)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await Ticket.countDocuments({ label: tickets[0].label, status: 'valid' })).toBe(1);

    await org.agent.post(`/api/events/${eventId}/checkin`).send({ qr: tickets[1].qr }).expect(200);
    expect((await send(sender.agent, tickets[1]._id, friend.user.email)).body.error.code).toBe('NOT_TRANSFERABLE');
  });

  it('an order with a transferred ticket cannot be cancelled by the buyer, but event cancellation refunds the buyer and voids both', async () => {
    const { org, sender, friend, eventId, order, tickets } = await setup();
    await send(sender.agent, tickets[0]._id, friend.user.email).expect(200);

    const cancel = await sender.agent.post(`/api/orders/${order._id}/cancel`);
    expect(cancel.body.error.code).toBe('HAS_TRANSFERS');

    await org.agent.post(`/api/events/${eventId}/cancel`).expect(200);
    const theirs = await friend.agent.get('/api/orders').expect(200);
    expect(theirs.body.received[0].tickets[0]).toMatchObject({ status: 'cancelled', qr: null });
    const mine = await sender.agent.get(`/api/orders/${order._id}`).expect(200);
    expect(mine.body.order.status).toBe('refunded');
  });

  it('replaying the original checkout never reveals the recipient\u2019s new QR', async () => {
    const org = await signUp('organizer');
    const sender = await signUp();
    const friend = await signUp();
    const { id, seats } = await publishedEvent(org);
    const holdId = await hold(sender.agent, id, [seats[0]]);
    const k = key();
    const first = await pay(sender.agent, holdId, { k }).expect(201);
    await send(sender.agent, first.body.tickets[0]._id, friend.user.email).expect(200);

    const replay = await pay(sender.agent, holdId, { k }).expect(200);
    expect(replay.body.tickets).toHaveLength(1);
    expect(replay.body.tickets[0]).toMatchObject({ status: 'transferred', qr: null });
  });

  it('requires login', async () => {
    const { tickets } = await setup();
    await request(app).post(`/api/tickets/${tickets[0]._id}/transfer`).send({ email: 'a@b.dev' }).expect(401);
  });
});
