import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startDb, stopDb, clearDb, signUp, publishedEvent } from './helpers.js';
import { hold, buy } from './shared.js';
import { WaitlistEntry } from '../src/models/WaitlistEntry.js';
import { Notification } from '../src/models/Notification.js';
import { testOutbox } from '../src/services/mailer.js';
import { backgroundIdle } from '../src/utils/background.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await clearDb();
  testOutbox.length = 0;
});

// A two-seat event, sold out by one buyer.
async function soldOut() {
  const org = await signUp('organizer');
  const buyer = await signUp();
  const waiter = await signUp();
  const { id, seats } = await publishedEvent(org, { tiers: [{ name: 'Seat', price: 1000 }], rows: [{ label: 'A', seats: 2, tier: 'Seat' }] });
  const purchase = await buy(buyer.agent, id, seats);
  return { org, buyer, waiter, eventId: id, seats, order: purchase.order };
}

describe('waitlist', () => {
  it('can only be joined when nothing is available', async () => {
    const org = await signUp('organizer');
    const waiter = await signUp();
    const { id } = await publishedEvent(org);
    const res = await waiter.agent.post(`/api/events/${id}/waitlist`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEATS_AVAILABLE');
  });

  it('attendees join and leave a sold-out event; organizers cannot join', async () => {
    const { org, waiter, eventId } = await soldOut();
    const joined = await waiter.agent.post(`/api/events/${eventId}/waitlist`).expect(201);
    expect(joined.body.waitlist).toMatchObject({ joined: true, waiting: 1 });

    const status = await waiter.agent.get(`/api/events/${eventId}/waitlist`).expect(200);
    expect(status.body.waitlist.joined).toBe(true);

    await org.agent.post(`/api/events/${eventId}/waitlist`).expect(403);

    const left = await waiter.agent.delete(`/api/events/${eventId}/waitlist`).expect(200);
    expect(left.body.waitlist).toMatchObject({ joined: false, waiting: 0 });
  });

  it('notifies everyone waiting (in-app and email) when a refund frees seats', async () => {
    const { buyer, waiter, eventId, order } = await soldOut();
    const waiter2 = await signUp();
    await waiter.agent.post(`/api/events/${eventId}/waitlist`).expect(201);
    await waiter2.agent.post(`/api/events/${eventId}/waitlist`).expect(201);

    await buyer.agent.post(`/api/orders/${order._id}/cancel`).expect(200);
    await backgroundIdle();

    expect(await WaitlistEntry.countDocuments({ status: 'notified' })).toBe(2);
    const inbox = await waiter.agent.get('/api/notifications').expect(200);
    expect(inbox.body.unread).toBe(1);
    expect(inbox.body.items[0]).toMatchObject({ type: 'waitlist_available', link: `/events/${eventId}` });
    expect(testOutbox.filter((m) => m.subject.startsWith('Seats available'))).toHaveLength(2);
  });

  it('notifies when a hold is released, but not when a buyer just re-picks the same seats', async () => {
    const org = await signUp('organizer');
    const holder = await signUp();
    const waiter = await signUp();
    const { id, seats } = await publishedEvent(org, { tiers: [{ name: 'Seat', price: 1000 }], rows: [{ label: 'A', seats: 2, tier: 'Seat' }] });
    await hold(holder.agent, id, seats);
    await waiter.agent.post(`/api/events/${id}/waitlist`).expect(201);

    const h2 = await hold(holder.agent, id, seats); // same seats again
    await backgroundIdle();
    expect(await Notification.countDocuments()).toBe(0);

    await holder.agent.delete(`/api/holds/${h2}`).expect(204);
    await backgroundIdle();
    expect(await Notification.countDocuments({ type: 'waitlist_available' })).toBe(1);
  });

  it('each person is notified once until they re-join', async () => {
    const { buyer, waiter, eventId, order } = await soldOut();
    await waiter.agent.post(`/api/events/${eventId}/waitlist`).expect(201);
    await buyer.agent.post(`/api/orders/${order._id}/cancel`).expect(200);
    await backgroundIdle();
    const status = await waiter.agent.get(`/api/events/${eventId}/waitlist`).expect(200);
    expect(status.body.waitlist.joined).toBe(false);
    expect(status.body.waitlist.notifiedAt).toBeTruthy();
    expect(await Notification.countDocuments()).toBe(1);
  });

  it('notifications can be marked read', async () => {
    const { buyer, waiter, eventId, order } = await soldOut();
    await waiter.agent.post(`/api/events/${eventId}/waitlist`).expect(201);
    await buyer.agent.post(`/api/orders/${order._id}/cancel`).expect(200);
    await backgroundIdle();
    const read = await waiter.agent.post('/api/notifications/read').send({}).expect(200);
    expect(read.body.unread).toBe(0);
  });
});
