import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startDb, stopDb, clearDb, signUp, publishedEvent } from './helpers.js';
import { buy } from './shared.js';
import { User } from '../src/models/User.js';
import { testOutbox } from '../src/services/mailer.js';
import { backgroundIdle } from '../src/utils/background.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await clearDb();
  testOutbox.length = 0;
});

describe('guest list CSV export', () => {
  it('exports valid tickets with check-in times, owner only', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org, { title: 'CSV Night' });
    const { tickets } = await buy(buyer.agent, id, seats.slice(0, 2));
    await org.agent.post(`/api/events/${id}/checkin`).send({ qr: tickets[0].qr }).expect(200);

    const res = await org.agent.get(`/api/events/${id}/attendees.csv`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('csv-night-guests.csv');
    const lines = res.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Seat,Tier,Price (INR),Name,Email,Order,Checked in at (UTC)');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(buyer.user.email);
    expect(lines[1]).toMatch(/\d{4}-\d{2}-\d{2}T/); // first ticket was checked in

    const other = await signUp('organizer');
    await other.agent.get(`/api/events/${id}/attendees.csv`).expect(403);
  });

  it('neutralises spreadsheet formulas in names', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    await User.updateOne({ _id: buyer.user._id }, { name: '=HYPERLINK("http://evil")' });
    const { id, seats } = await publishedEvent(org);
    await buy(buyer.agent, id, [seats[0]]);
    const res = await org.agent.get(`/api/events/${id}/attendees.csv`).expect(200);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

describe('order confirmation email', () => {
  it('is sent after payment with one QR image per ticket', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id, seats } = await publishedEvent(org, { title: 'Email Fest' });
    await buy(buyer.agent, id, seats.slice(0, 2));
    await backgroundIdle();

    const mail = testOutbox.find((m) => m.to === buyer.user.email && m.subject.startsWith('Your tickets'));
    expect(mail.subject).toBe('Your tickets: Email Fest');
    expect(mail.attachments).toHaveLength(2);
    expect(mail.html).toContain(`cid:${mail.attachments[0].cid}`);
    expect(mail.text).toContain(seats[0].label);
  });

  it('escapes user-controlled text in the HTML', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    await User.updateOne({ _id: buyer.user._id }, { name: '<script>x</script>' });
    const { id, seats } = await publishedEvent(org);
    await buy(buyer.agent, id, [seats[0]]);
    await backgroundIdle();
    const mail = testOutbox.find((m) => m.to === buyer.user.email && m.subject.startsWith('Your tickets'));
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});
