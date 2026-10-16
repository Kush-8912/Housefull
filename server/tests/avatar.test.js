import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, clearDb, app, signUp, publishedEvent } from './helpers.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

// A real 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upload = (agent, body, type = 'image/png') => agent.put('/api/auth/me/avatar').set('Content-Type', type).send(body);

describe('profile photos', () => {
  it('uploads, serves to signed-in people only, and removes a photo', async () => {
    const me = await signUp();
    const other = await signUp();
    const res = await upload(me.agent, PNG).expect(200);
    const url = res.body.user.avatarUrl;
    expect(url).toMatch(new RegExp(`^/api/users/${me.user._id}/avatar\\?v=\\d+$`));
    expect((await me.agent.get('/api/auth/me')).body.user.avatarUrl).toBe(url);

    const img = await other.agent.get(url).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(img.body, PNG)).toBe(0);
    await request(app).get(url).expect(401);

    // A new upload gets a new URL, so cached copies aren't reused.
    await new Promise((r) => setTimeout(r, 5));
    const again = await upload(me.agent, PNG).expect(200);
    expect(again.body.user.avatarUrl).not.toBe(url);

    const removed = await me.agent.delete('/api/auth/me/avatar').expect(200);
    expect(removed.body.user.avatarUrl).toBe(null);
    await other.agent.get(url).expect(404);
  });

  it('rejects files that are not really images, and files that are too big', async () => {
    const me = await signUp();
    const fake = Buffer.from('<svg onload="alert(1)"></svg>');
    expect((await upload(me.agent, fake).expect(400)).body.error.code).toBe('BAD_IMAGE');
    expect((await upload(me.agent, fake, 'image/svg+xml').expect(400)).body.error.code).toBe('BAD_IMAGE');
    const huge = Buffer.concat([PNG, Buffer.alloc(400 * 1024)]);
    expect((await upload(me.agent, huge).expect(413)).body.error.code).toBe('TOO_LARGE');
    await request(app).put('/api/auth/me/avatar').set('Content-Type', 'image/png').send(PNG).expect(401);
  });

  it('shows the ticket holder’s photo to door staff on check-in', async () => {
    const org = await signUp('organizer');
    const fan = await signUp();
    const { body } = await upload(fan.agent, PNG).expect(200);
    const { id, seats } = await publishedEvent(org);
    const { body: h } = await fan.agent.post(`/api/events/${id}/holds`).send({ seatIds: [seats[0].id] });
    const card = { number: '4242 4242 4242 4242', expMonth: 12, expYear: new Date().getFullYear() + 1, cvc: '123', name: 'Fan' };
    const { body: order } = await fan.agent.post(`/api/holds/${h.hold._id}/checkout`).set('Idempotency-Key', `avatar-${Date.now()}`).send({ card }).expect(201);
    const res = await org.agent.post(`/api/events/${id}/checkin`).send({ qr: order.tickets[0].qr }).expect(200);
    expect(res.body.checkin.attendeeAvatarUrl).toBe(body.user.avatarUrl);
  });
});
