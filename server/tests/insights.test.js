import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, clearDb, app, signUp, publishedEvent } from './helpers.js';
import { Event } from '../src/models/Event.js';
import { Ticket } from '../src/models/Ticket.js';
import { testOutbox } from '../src/services/mailer.js';
import { backgroundIdle } from '../src/utils/background.js';
import { sendDueReminders, sendDueFeedbackRequests } from '../src/jobs/eventEmails.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await clearDb(); testOutbox.length = 0; });

const card = { number: '4242 4242 4242 4242', expMonth: 12, expYear: new Date().getFullYear() + 1, cvc: '123', name: 'Buyer' };
let n = 0;
const HOUR = 3_600_000;

async function buy(buyer, eventId, seats) {
  const { body } = await buyer.agent.post(`/api/events/${eventId}/holds`).send({ seatIds: seats.map((s) => s.id) }).expect(201);
  const res = await buyer.agent.post(`/api/holds/${body.hold._id}/checkout`).set('Idempotency-Key', `insights-${n++}-${Date.now()}`).send({ card });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body;
}
const scan = (org, id, ticket) => org.agent.post(`/api/events/${id}/checkin`).send({ qr: ticket.qr }).expect(200);
// Everything sent to one person except order confirmations, which every buyer gets.
const inOutbox = (to) => testOutbox.filter((m) => m.to === to && !m.subject.startsWith('Your tickets') && !m.subject.startsWith('Welcome'));

describe('detailed feedback', () => {
  it('keeps aspect ratings and the private note away from the public reviews', async () => {
    const org = await signUp('organizer');
    const fan = await signUp();
    const { id, seats } = await publishedEvent(org);
    const { tickets } = await buy(fan, id, [seats[0]]);
    await scan(org, id, tickets[0]);
    await Event.updateOne({ _id: id }, { startsAt: new Date(Date.now() - HOUR) });

    await fan.agent.put(`/api/events/${id}/reviews`).send({
      rating: 4, text: 'Great sound', aspects: { performance: 5, venue: 3, value: 4 }, recommend: true, privateNote: 'Queue at the bar was slow',
    }).expect(200);
    await fan.agent.put(`/api/events/${id}/reviews`).send({ rating: 4, aspects: { venue: 9 } }).expect(400);

    const pub = await request(app).get(`/api/events/${id}/reviews`).expect(200);
    expect(pub.body.reviews.items[0]).toMatchObject({ rating: 4, text: 'Great sound', recommend: true });
    expect(JSON.stringify(pub.body)).not.toContain('Queue at the bar');
    const mine = await fan.agent.get(`/api/events/${id}/reviews`).expect(200);
    expect(mine.body.reviews.mine.privateNote).toBe('Queue at the bar was slow');
  });
});

describe('event report', () => {
  it('reports attendance, arrivals, sales lead time and feedback', async () => {
    const org = await signUp('organizer');
    const a = await signUp();
    const b = await signUp();
    const { id, seats } = await publishedEvent(org); // A1-A4 VIP 2000, B1-B6 General 500
    const vip = seats.filter((s) => s.tier === 'VIP');
    const gen = seats.filter((s) => s.tier === 'General');
    const first = await buy(a, id, [vip[0], vip[1]]);
    const second = await buy(b, id, [gen[0], gen[1], gen[2]]);
    await scan(org, id, first.tickets[0]);
    await scan(org, id, first.tickets[1]);
    await scan(org, id, second.tickets[0]);

    // The show started an hour ago, and those three were scanned in 20 minutes before it.
    await Event.updateOne({ _id: id }, { startsAt: new Date(Date.now() - HOUR) });
    await Ticket.updateMany({ event: id, checkedInAt: { $ne: null } }, { checkedInAt: new Date(Date.now() - HOUR - 20 * 60_000) });

    await a.agent.put(`/api/events/${id}/reviews`).send({ rating: 5, aspects: { performance: 5, venue: 4 }, recommend: true, privateNote: 'More legroom please' }).expect(200);
    await b.agent.put(`/api/events/${id}/reviews`).send({ rating: 3, aspects: { performance: 3 }, recommend: false }).expect(200);

    const { body } = await org.agent.get(`/api/events/${id}/report`).expect(200);
    const r = body.report;
    expect(r.attendance).toMatchObject({ capacity: 10, sold: 5, came: 3, noShows: 2 });
    expect(r.attendance.turnout).toBeCloseTo(0.6);
    expect(r.attendance.tiers).toEqual([
      { tier: 'VIP', sold: 2, came: 2, turnout: 1 },
      { tier: 'General', sold: 3, came: 1, turnout: 1 / 3 },
    ]);
    const slot = r.attendance.arrivals.slots.find((s) => s.minutes === -30);
    expect(slot.count).toBe(3); // 20 minutes early falls in the -30..-15 slot
    expect(r.attendance.arrivals.peak).toEqual({ minutes: -30, count: 3 });
    expect(r.sales.orders).toBe(2);
    expect(r.sales.leadTime.reduce((s, x) => s + x.tickets, 0)).toBe(5);
    expect(r.feedback).toMatchObject({ count: 2, avg: 4, recommend: { yes: 1, answered: 2 } });
    expect(r.feedback.aspects).toEqual({ performance: 4, venue: 4, value: null });
    expect(r.feedback.privateNotes.map((x) => x.note)).toEqual(['More legroom please']);

    const rival = await signUp('organizer');
    await rival.agent.get(`/api/events/${id}/report`).expect(403);
  });
});

describe('event emails', () => {
  it('reminds each buyer once when the show is within a day, and not earlier', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const soon = await publishedEvent(org, { title: 'Soon Show', startsAt: new Date(Date.now() + 12 * HOUR).toISOString() });
    const later = await publishedEvent(org, { title: 'Later Show' });
    await buy(buyer, soon.id, [soon.seats[0], soon.seats[1]]);
    await buy(buyer, later.id, [later.seats[0]]);

    expect(await sendDueReminders()).toBe(1);
    await backgroundIdle();
    const [mail] = inOutbox(buyer.user.email);
    // No API key in tests: the built-in copy, which names the day relative to now.
    expect(mail.subject).toMatch(/^(Today|Tomorrow): Soon Show$/);
    expect(mail.html).toContain(soon.seats[0].label);
    expect(mail.text).toContain('Before you go');

    expect(await sendDueReminders()).toBe(0);
    await backgroundIdle();
    expect(inOutbox(buyer.user.email)).toHaveLength(1);
  });

  it('uses copy already written for the event, and the organizer can send reminders now', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org);
    await Event.updateOne({ _id: id }, { reminderCopy: { subject: 'It’s nearly showtime 🎶', preheader: 'p', headline: 'Almost here', intro: 'Get ready.', tips: ['Bring your ticket'] } });

    expect((await org.agent.post(`/api/events/${id}/reminders`).expect(200)).body).toEqual({ sent: 0, orders: 0 }); // nobody to remind yet
    await buy(buyer, id, [seats[0]]);
    const res = await org.agent.post(`/api/events/${id}/reminders`).expect(200);
    expect(res.body).toEqual({ sent: 1, orders: 1 });
    await backgroundIdle();
    expect(inOutbox(buyer.user.email)[0].subject).toBe('It’s nearly showtime 🎶');
    expect((await org.agent.post(`/api/events/${id}/reminders`).expect(200)).body.sent).toBe(0);
    await buyer.agent.post(`/api/events/${id}/reminders`).expect(403);
  });

  it('asks only people who came for feedback, a couple of hours after the show', async () => {
    const org = await signUp('organizer');
    const came = await signUp();
    const skipped = await signUp();
    const { id, seats } = await publishedEvent(org);
    const order = await buy(came, id, [seats[0]]);
    await buy(skipped, id, [seats[1]]);
    await scan(org, id, order.tickets[0]);

    await Event.updateOne({ _id: id }, { startsAt: new Date(Date.now() - HOUR), durationMinutes: 30 });
    expect(await sendDueFeedbackRequests()).toBe(0); // ended 30 minutes ago: too soon

    await Event.updateOne({ _id: id }, { startsAt: new Date(Date.now() - 4 * HOUR) });
    expect(await sendDueFeedbackRequests()).toBe(1);
    await backgroundIdle();
    expect(inOutbox(came.user.email)[0].subject).toMatch(/^How was/);
    expect(inOutbox(skipped.user.email)).toHaveLength(0);
    expect(await sendDueFeedbackRequests()).toBe(0);
  });
});

describe('reminder wording', () => {
  it('names the day correctly however early it is sent', async () => {
    const { fallbackCopy } = await import('../src/services/reminderCopy.js');
    const now = new Date('2026-10-06T06:30:00Z'); // Tue 6 Oct, 12:00 in India
    const at = (iso) => fallbackCopy({ title: 'X', startsAt: new Date(iso), venue: { name: 'Hall', city: 'Pune' } }, now);
    expect(at('2026-10-06T14:00:00Z').subject).toBe('Today: X');
    expect(at('2026-10-07T13:30:00Z').subject).toBe('Tomorrow: X');
    expect(at('2026-10-09T05:30:00Z')).toMatchObject({ subject: 'Friday: X', headline: 'See you on Friday' });
    expect(at('2026-10-18T13:30:00Z').subject).toBe('18 Oct: X');
  });
});
