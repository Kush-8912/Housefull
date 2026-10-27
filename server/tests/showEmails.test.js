import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startDb, stopDb, clearDb, signUp, publishedEvent } from './helpers.js';
import { Event } from '../src/models/Event.js';
import { Order } from '../src/models/Order.js';
import { Notification } from '../src/models/Notification.js';
import { testOutbox } from '../src/services/mailer.js';
import { backgroundIdle } from '../src/utils/background.js';
import { sendDueReminders, sendDueShowdayReminders } from '../src/jobs/eventEmails.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await clearDb();
  testOutbox.length = 0;
});

const HOUR = 3_600_000;
const card = { number: '4242 4242 4242 4242', expMonth: 12, expYear: new Date().getFullYear() + 1, cvc: '123', name: 'Buyer' };
let n = 0;
async function buy(buyer, eventId, seats) {
  const { body } = await buyer.agent.post(`/api/events/${eventId}/holds`).send({ seatIds: seats.map((s) => s.id) });
  const res = await buyer.agent.post(`/api/holds/${body.hold._id}/checkout`).set('Idempotency-Key', `show-emails-${n++}`).send({ card });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body;
}
const mailTo = async (to, subject) => {
  await backgroundIdle();
  return testOutbox.filter((m) => m.to === to && m.subject.startsWith(subject));
};

describe('booking confirmation', () => {
  it('is a ticket-style email with the poster, a QR stub per seat and directions', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org, { title: 'Poster Show', coverImageUrl: 'https://img.example/poster.jpg' });
    const { tickets } = await buy(buyer, id, [seats[0], seats[1]]);

    const [mail] = await mailTo(buyer.user.email, 'Your tickets: Poster Show');
    expect(mail.html).toContain('src="https://img.example/poster.jpg"');
    for (const t of tickets) expect(mail.html).toContain(`cid:qr-${t._id}@housefull`);
    expect(mail.attachments).toHaveLength(2);
    expect(mail.html).toContain('https://www.google.com/maps/search/?api=1&amp;query=Test%20Hall%2C%20Pune');
  });
});

describe('showday reminder', () => {
  it('goes out once a few hours before, instead of (not as well as) the day-before one', async () => {
    const org = await signUp('organizer');
    const early = await signUp();
    const late = await signUp();
    const { id, seats } = await publishedEvent(org, { title: 'Tonight', startsAt: new Date(Date.now() + 2 * HOUR).toISOString() });
    const earlyOrder = await buy(early, id, [seats[0]]);
    await buy(late, id, [seats[1]]);
    // The early buyer booked days ago; the late one just now (their confirmation is enough).
    await Order.updateOne({ _id: earlyOrder.order._id }, { paidAt: new Date(Date.now() - 3 * 24 * HOUR) });

    expect(await sendDueReminders()).toBe(0);
    expect(await sendDueShowdayReminders()).toBe(1);
    const [mail] = await mailTo(early.user.email, 'Today at ');
    expect(mail.subject).toMatch(/^Today at \d{1,2}:\d{2} [AP]M: Tonight$/);
    expect(mail.html).toContain(seats[0].label);
    expect(await mailTo(late.user.email, 'Today at ')).toHaveLength(0);
    expect(await sendDueShowdayReminders()).toBe(0);
  });
});

describe('rescheduling', () => {
  it('moves the show, emails every ticket holder the old and new time, and re-arms reminders', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const friend = await signUp();
    const { id, seats } = await publishedEvent(org, { title: 'Moving Show' });
    const { tickets, order } = await buy(buyer, id, [seats[0], seats[1]]);
    await buyer.agent.post(`/api/tickets/${tickets[1]._id}/transfer`).send({ email: friend.user.email }).expect(200);
    await Order.updateOne({ _id: order._id }, { reminderSentAt: new Date() });

    const when = new Date(Date.now() + 40 * 24 * HOUR);
    const res = await org.agent.post(`/api/events/${id}/reschedule`).send({ startsAt: when.toISOString() }).expect(200);
    expect(res.body.notified).toBe(2);
    expect(new Date((await Event.findById(id)).startsAt).getTime()).toBe(when.getTime());
    expect((await Order.findById(order._id)).reminderSentAt).toBeNull();

    for (const who of [buyer, friend]) {
      const [mail] = await mailTo(who.user.email, 'New time: Moving Show');
      expect(mail.html).toContain('line-through');
    }
    expect(await Notification.countDocuments({ type: 'event_rescheduled' })).toBe(2);
  });

  it('refuses a past or unchanged time, and other organizers', async () => {
    const org = await signUp('organizer');
    const { id } = await publishedEvent(org);
    const current = (await Event.findById(id)).startsAt;
    await org.agent.post(`/api/events/${id}/reschedule`).send({ startsAt: new Date(Date.now() - HOUR).toISOString() }).expect(400);
    expect((await org.agent.post(`/api/events/${id}/reschedule`).send({ startsAt: current.toISOString() }).expect(400)).body.error.code).toBe('SAME_TIME');
    const rival = await signUp('organizer');
    await rival.agent.post(`/api/events/${id}/reschedule`).send({ startsAt: new Date(Date.now() + 50 * 24 * HOUR).toISOString() }).expect(403);
  });
});

describe('cancellations and refunds', () => {
  it('tells buyers what was refunded, and ticket recipients where the refund went', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const friend = await signUp();
    const { id, seats } = await publishedEvent(org, { title: 'Called Off' });
    const { tickets, order } = await buy(buyer, id, [seats[0], seats[1]]);
    await buyer.agent.post(`/api/tickets/${tickets[1]._id}/transfer`).send({ email: friend.user.email }).expect(200);

    await org.agent.post(`/api/events/${id}/cancel`).expect(200);
    const [toBuyer] = await mailTo(buyer.user.email, 'Cancelled: Called Off');
    expect(toBuyer.html).toContain('refunded to your card');
    expect(toBuyer.html).toContain(`••${order.payment.last4}`);
    const [toFriend] = await mailTo(friend.user.email, 'Cancelled: Called Off');
    expect(toFriend.html).toContain('the refund goes to the person who bought it');
    expect(await Notification.countDocuments({ type: 'event_cancelled' })).toBe(2);
  });

  it('sends a refund receipt when attendees cancel their own order', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org, { title: 'Changed Plans' });
    const { order } = await buy(buyer, id, [seats[0]]);
    await buyer.agent.post(`/api/orders/${order._id}/cancel`).expect(200);
    const [mail] = await mailTo(buyer.user.email, 'Refund confirmed: Changed Plans');
    expect(mail.html).toContain('Refunded');
    expect(mail.text).toContain(String(order._id).slice(-8).toUpperCase());
  });
});
