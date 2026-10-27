import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { backgroundIdle } from '../src/utils/background.js';

let mongod;

export async function startDb() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await mongoose.connection.syncIndexes(); // unique indexes must exist before concurrency tests
}

export async function stopDb() {
  await backgroundIdle();
  await mongoose.disconnect();
  await mongod?.stop();
}

export async function clearDb() {
  await backgroundIdle(); // emails / waitlist alerts from the previous test
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
}

export const app = createApp();

// Meets the password rules: 8+ characters, an uppercase letter, a special character.
export const TEST_PASSWORD = 'Password123!';

let counter = 0;
// A PAN that passes the demo KYC check for the name 'Test Organiser'.
export const TEST_HOST = { legalName: 'Test Organiser', pan: 'ABCPO1234K' };

// Returns a supertest agent that keeps the auth cookie, plus the created user.
// Organizers are verified hosts (so they can publish) unless `verified: false`.
export async function signUp(role = 'attendee', { verified = true } = {}) {
  counter += 1;
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register')
    .send({ name: `${role} ${counter}`, email: `${role}${counter}@test.dev`, password: TEST_PASSWORD, role });
  if (res.status !== 201) throw new Error(`signup failed: ${JSON.stringify(res.body)}`);
  if (role === 'organizer' && verified) {
    const v = await agent.post('/api/auth/me/host-verification').send(TEST_HOST);
    if (v.status !== 200) throw new Error(`host verification failed: ${JSON.stringify(v.body)}`);
    return { agent, user: v.body.user };
  }
  return { agent, user: res.body.user };
}

export const futureDate = (days = 30) => new Date(Date.now() + days * 86_400_000).toISOString();

export function eventPayload(overrides = {}) {
  return {
    title: 'Test Concert',
    category: 'music',
    venue: { name: 'Test Hall', city: 'Pune' },
    startsAt: futureDate(),
    tiers: [{ name: 'VIP', price: 2000 }, { name: 'General', price: 500 }],
    rows: [{ label: 'A', seats: 4, tier: 'VIP' }, { label: 'B', seats: 6, tier: 'General' }],
    ...overrides,
  };
}

// Organizer creates and publishes an event; returns its id and seat map.
export async function publishedEvent(organizer, overrides) {
  const created = await organizer.agent.post('/api/events').send(eventPayload(overrides));
  if (created.status !== 201) throw new Error(JSON.stringify(created.body));
  const id = created.body.event.id;
  await organizer.agent.post(`/api/events/${id}/publish`).expect(200);
  const detail = await request(app).get(`/api/events/${id}`).expect(200);
  return { id, seats: detail.body.seats };
}
