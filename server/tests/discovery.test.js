import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, clearDb, signUp, publishedEvent, futureDate, app } from './helpers.js';
import { buy } from './shared.js';
import { Event } from '../src/models/Event.js';
import { Seat } from '../src/models/Seat.js';
import { badgesFor } from '../src/services/discoveryService.js';
import { renderEventPage } from '../src/services/sharePreview.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const addShow = (org, id, days) => org.agent.post(`/api/events/${id}/showtimes`).send({ startsAt: futureDate(days) });

describe('showtimes', () => {
  it('adds a published show with its own seats and add-ons, linked as a series', async () => {
    const org = await signUp('organizer');
    const { id } = await publishedEvent(org, { title: 'Hamlet' });
    await org.agent.post(`/api/events/${id}/addons`).send({ name: 'Interval coffee', price: 120, stock: 50 }).expect(201);
    const res = await addShow(org, id, 31).expect(201);
    const showId = res.body.event._id;

    expect(res.body.event).toMatchObject({ status: 'published', seriesId: id, title: 'Hamlet' });
    expect(await Seat.countDocuments({ event: showId })).toBe(10);
    const addons = await org.agent.get(`/api/events/${showId}/addons`).expect(200);
    expect(addons.body.items).toMatchObject([{ name: 'Interval coffee', stock: 50, sold: 0 }]);

    const detail = await request(app).get(`/api/events/${id}`).expect(200);
    expect(detail.body.shows.map((s) => s.id)).toEqual([id, showId]);
    expect(detail.body.event.showCount).toBe(1); // counts come from the listing
  });

  it('refuses past times and a second show at the same time', async () => {
    const org = await signUp('organizer');
    const { id } = await publishedEvent(org);
    const event = await Event.findById(id);
    await org.agent.post(`/api/events/${id}/showtimes`).send({ startsAt: new Date(Date.now() - 1000).toISOString() }).expect(400);
    const clash = await org.agent.post(`/api/events/${id}/showtimes`).send({ startsAt: event.startsAt.toISOString() });
    expect(clash.body.error.code).toBe('DUPLICATE');
  });

  it('the listing shows a series once, with the next show and how many shows there are', async () => {
    const org = await signUp('organizer');
    const { id } = await publishedEvent(org, { title: 'Series', startsAt: futureDate(20) });
    await addShow(org, id, 10).expect(201);
    await addShow(org, id, 30).expect(201);
    await publishedEvent(org, { title: 'One-off', startsAt: futureDate(15) });

    const list = await request(app).get('/api/events').expect(200);
    expect(list.body.total).toBe(2);
    expect(list.body.items.map((e) => [e.title, e.showCount])).toEqual([['Series', 3], ['One-off', 1]]);
    expect(new Date(list.body.items[0].startsAt).getTime()).toBeLessThan(new Date(futureDate(11)).getTime());
  });

  it('a promo code created on one show works on every show of the series', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const { id } = await publishedEvent(org);
    const show = (await addShow(org, id, 31).expect(201)).body.event;
    await org.agent.post(`/api/events/${id}/promos`).send({ code: 'ALLSHOWS', kind: 'percent', value: 10 }).expect(201);
    const dup = await org.agent.post(`/api/events/${show._id}/promos`).send({ code: 'ALLSHOWS', kind: 'flat', value: 50 });
    expect(dup.status).toBe(409);

    const seat = (await request(app).get(`/api/events/${show._id}`)).body.seats[0];
    const h = await buyer.agent.post(`/api/events/${show._id}/holds`).send({ seatIds: [seat.id] }).expect(201);
    const q = await buyer.agent.post(`/api/holds/${h.body.hold._id}/promo`).send({ code: 'ALLSHOWS' }).expect(200);
    expect(q.body.discount).toBe(200);
  });
});

describe('interested & saved', () => {
  it('counts interest per series and lists saved events', async () => {
    const org = await signUp('organizer');
    const fan = await signUp();
    const fan2 = await signUp();
    const { id } = await publishedEvent(org, { title: 'Indie Night' });
    const show = (await addShow(org, id, 40).expect(201)).body.event;

    const a = await fan.agent.post(`/api/events/${id}/interest`).expect(200);
    expect(a.body.interest).toEqual({ count: 1, mine: true });
    await fan.agent.post(`/api/events/${show._id}/interest`).expect(200); // same series: still one
    await fan2.agent.post(`/api/events/${show._id}/interest`).expect(200);

    const detail = await fan.agent.get(`/api/events/${show._id}`).expect(200);
    expect(detail.body.event).toMatchObject({ interested: 2, interestedByMe: true });

    const saved = await fan.agent.get('/api/events/saved').expect(200);
    expect(saved.body.items.map((e) => e.title)).toEqual(['Indie Night']);

    const off = await fan.agent.delete(`/api/events/${id}/interest`).expect(200);
    expect(off.body.interest).toEqual({ count: 1, mine: false });
    await request(app).post(`/api/events/${id}/interest`).expect(401);
  });
});

describe('reviews', () => {
  async function attended() {
    const org = await signUp('organizer');
    const fan = await signUp();
    const { id, seats } = await publishedEvent(org);
    const { tickets } = await buy(fan.agent, id, [seats[0]]);
    await org.agent.post(`/api/events/${id}/checkin`).send({ qr: tickets[0].qr }).expect(200);
    await Event.updateOne({ _id: id }, { startsAt: new Date(Date.now() - 3_600_000) }); // the show has happened
    return { org, fan, id };
  }

  it('only people checked in at a show that has started can review; one review each, editable', async () => {
    const { fan, id } = await attended();
    const stranger = await signUp();
    expect((await stranger.agent.put(`/api/events/${id}/reviews`).send({ rating: 5 })).status).toBe(403);

    const before = await fan.agent.get(`/api/events/${id}/reviews`).expect(200);
    expect(before.body.reviews.canReview).toBe(true);

    await fan.agent.put(`/api/events/${id}/reviews`).send({ rating: 4, text: 'Great sound' }).expect(200);
    await fan.agent.put(`/api/events/${id}/reviews`).send({ rating: 5, text: 'Even better on reflection' }).expect(200);
    const after = await request(app).get(`/api/events/${id}/reviews`).expect(200);
    expect(after.body.reviews).toMatchObject({ avg: 5, count: 1, distribution: { 5: 1, 4: 0 } });
    expect(after.body.reviews.items[0].text).toBe('Even better on reflection');

    const bad = await fan.agent.put(`/api/events/${id}/reviews`).send({ rating: 6 });
    expect(bad.status).toBe(400);
  });

  it('a ticket that was not scanned at the door does not count', async () => {
    const org = await signUp('organizer');
    const fan = await signUp();
    const { id, seats } = await publishedEvent(org);
    await buy(fan.agent, id, [seats[0]]);
    await Event.updateOne({ _id: id }, { startsAt: new Date(Date.now() - 3_600_000) });
    expect((await fan.agent.put(`/api/events/${id}/reviews`).send({ rating: 3 })).status).toBe(403);
  });
});

describe('badges and trending', () => {
  it('derives labels from real numbers', () => {
    const now = new Date();
    const fresh = { publishedAt: new Date(now - 3_600_000) };
    expect(badgesFor({ event: fresh, availability: { total: 100, available: 8 }, soldLastDay: 6, now })).toEqual(['almost_full', 'filling_fast', 'new']);
    expect(badgesFor({ event: { publishedAt: new Date(now - 10 * 86_400_000) }, availability: { total: 100, available: 50 }, soldLastDay: 4, now })).toEqual([]);
    expect(badgesFor({ event: fresh, availability: { total: 100, available: 0 }, soldLastDay: 50, now })).toEqual(['new']); // sold out isn't "filling fast"
  });

  it('sort=trending orders by tickets sold in the last 7 days', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    await publishedEvent(org, { title: 'Quiet', startsAt: futureDate(5) });
    const hot = await publishedEvent(org, { title: 'Hot', startsAt: futureDate(25) });
    await buy(buyer.agent, hot.id, hot.seats.slice(0, 3));

    const byDate = await request(app).get('/api/events').expect(200);
    expect(byDate.body.items.map((e) => e.title)).toEqual(['Quiet', 'Hot']);
    const trending = await request(app).get('/api/events?sort=trending').expect(200);
    expect(trending.body.items.map((e) => e.title)).toEqual(['Hot', 'Quiet']);
  });
});

describe('share previews', () => {
  it('writes escaped event meta tags into the page', () => {
    const html = '<html><head><meta name="description" content="generic" />\n<title>SeatLock</title>\n</head><body></body></html>';
    const out = renderEventPage(html, {
      _id: 'abc', title: 'Rock & "Roll" <Live>', startsAt: '2026-11-17T13:30:00Z', venue: { name: 'Hall', city: 'Pune' }, coverImageUrl: 'https://img.example/x.jpg',
    }, 'https://seatlock.example');
    expect(out).toContain('<title>Rock &amp; &quot;Roll&quot; &lt;Live&gt; · SeatLock</title>');
    expect(out).toContain('<meta property="og:image" content="https://img.example/x.jpg" />');
    expect(out).toContain('<meta property="og:url" content="https://seatlock.example/events/abc" />');
    expect(out).toContain('Tue, 17 Nov, 7:00 pm IST at Hall, Pune');
    expect(out).not.toContain('content="generic"');
  });
});
