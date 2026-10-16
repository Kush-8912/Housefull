import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, clearDb, app, signUp, publishedEvent, eventPayload, TEST_PASSWORD } from './helpers.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const card = { number: '4242 4242 4242 4242', expMonth: 12, expYear: new Date().getFullYear() + 1, cvc: '123', name: 'Buyer' };
let n = 0;

async function buy(buyer, eventId, seats) {
  const { body } = await buyer.agent.post(`/api/events/${eventId}/holds`).send({ seatIds: seats.map((s) => s.id) });
  const res = await buyer.agent.post(`/api/holds/${body.hold._id}/checkout`).set('Idempotency-Key', `profile-${n++}-${Date.now()}`).send({ card });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body;
}

describe('password rules', () => {
  const register = (password) => request(app).post('/api/auth/register').send({ name: 'Rule Tester', email: `rules${Math.random()}@test.dev`, password });
  const problem = async (password) => (await register(password).expect(400)).body.error.details.map((d) => d.message);

  it('rejects passwords that are short, have no uppercase letter or no special character', async () => {
    expect(await problem('Ab1!')).toContain('Password must be at least 8 characters');
    expect(await problem('lowercase123!')).toContain('Password needs at least one uppercase letter');
    expect(await problem('NoSpecial123')).toContain('Password needs at least one special character, like ! @ # $');
    expect(await problem('Has Space Only')).toContain('Password needs at least one special character, like ! @ # $');
    await register('Good-Pass1').expect(201);
  });

  it('applies to password changes too', async () => {
    const me = await signUp();
    const res = await me.agent.post('/api/auth/password').send({ currentPassword: TEST_PASSWORD, newPassword: 'alllowercase!' }).expect(400);
    expect(res.body.error.details[0].field).toBe('newPassword');
  });
});

describe('profile', () => {
  it('renames the account and validates the name', async () => {
    const me = await signUp();
    const res = await me.agent.patch('/api/auth/me').send({ name: '  Asha Rao  ' }).expect(200);
    expect(res.body.user.name).toBe('Asha Rao');
    expect(res.body.user.passwordHash).toBeUndefined();
    expect((await me.agent.get('/api/auth/me')).body.user.name).toBe('Asha Rao');
    await me.agent.patch('/api/auth/me').send({ name: 'A' }).expect(400);
    await request(app).patch('/api/auth/me').send({ name: 'Nobody' }).expect(401);
  });

  it('changes the password and signs out other devices', async () => {
    const me = await signUp();
    const otherDevice = request.agent(app);
    await otherDevice.post('/api/auth/login').send({ email: me.user.email, password: TEST_PASSWORD }).expect(200);
    // JWT iat has one-second resolution: make the change land in a later second.
    await new Promise((r) => setTimeout(r, 1100));

    const wrong = await me.agent.post('/api/auth/password').send({ currentPassword: 'nope', newPassword: 'Brand-New-Pass1' }).expect(400);
    expect(wrong.body.error.code).toBe('WRONG_PASSWORD');
    await me.agent.post('/api/auth/password').send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD }).expect(400);

    await me.agent.post('/api/auth/password').send({ currentPassword: TEST_PASSWORD, newPassword: 'Brand-New-Pass1' }).expect(204);
    await me.agent.get('/api/auth/me').expect(200); // this device got a fresh session
    await otherDevice.get('/api/auth/me').expect(401);
    await request(app).post('/api/auth/login').send({ email: me.user.email, password: TEST_PASSWORD }).expect(401);
    await request(app).post('/api/auth/login').send({ email: me.user.email, password: 'Brand-New-Pass1' }).expect(200);

    // Saving the account later must not undo the sign-out.
    await me.agent.patch('/api/auth/me').send({ name: 'Still Signed Out Elsewhere' }).expect(200);
    await otherDevice.get('/api/auth/me').expect(401);
  });

  it('summarises an attendee: attended shows with seats, upcoming, reviews', async () => {
    const org = await signUp('organizer');
    const me = await signUp();
    const a = await publishedEvent(org, { title: 'Show A' });
    const b = await publishedEvent(org, { title: 'Show B' });
    const { tickets } = await buy(me, a.id, [a.seats[1], a.seats[0]]);
    await buy(me, b.id, [b.seats[0]]);
    for (const t of tickets) await org.agent.post(`/api/events/${a.id}/checkin`).send({ qr: t.qr }).expect(200);

    const { body } = await me.agent.get('/api/auth/me/profile').expect(200);
    expect(body.stats).toEqual({ attended: 1, upcoming: 2, reviews: 0 });
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({ title: 'Show A', seats: [a.seats[0].label, a.seats[1].label] });
  });

  it('summarises an organizer: events, tickets sold and checked in', async () => {
    const org = await signUp('organizer');
    const buyer = await signUp();
    const a = await publishedEvent(org);
    await org.agent.post('/api/events').send(eventPayload({ title: 'Unpublished draft' })).expect(201); // drafts don't count
    const { tickets } = await buy(buyer, a.id, a.seats.slice(0, 3));
    await org.agent.post(`/api/events/${a.id}/checkin`).send({ qr: tickets[0].qr }).expect(200);

    const { body } = await org.agent.get('/api/auth/me/profile').expect(200);
    expect(body.stats).toEqual({ hosted: 1, upcoming: 1, sold: 3, checkedIn: 1 });
  });
});
