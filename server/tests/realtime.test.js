import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as connect } from 'socket.io-client';
import { initSocket } from '../src/realtime/socket.js';
import { emitToUser } from '../src/realtime/bus.js';
import { AUTH_COOKIE, signToken } from '../src/middleware/auth.js';

let server;
let url;
const sockets = [];

beforeAll(async () => {
  server = http.createServer();
  initSocket(server);
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  sockets.forEach((s) => s.close());
  await new Promise((r) => server.close(r));
});

function client(cookie) {
  const s = connect(url, { transports: ['websocket'], extraHeaders: cookie ? { cookie } : {}, forceNew: true });
  sockets.push(s);
  return new Promise((r) => s.on('connect', () => r(s)));
}

// Resolves with the first `name` message matching `pred`.
const next = (s, name, pred = () => true) => new Promise((resolve) => {
  const h = (msg) => { if (pred(msg)) { s.off(name, h); resolve(msg); } };
  s.on(name, h);
});

const EVENT = 'a'.repeat(24);

describe('live viewer count', () => {
  it('counts sockets viewing the event page and updates when they leave', async () => {
    const organizer = await client();
    const joined = next(organizer, 'viewers');
    organizer.emit('event:join', EVENT);
    expect((await joined).count).toBe(0); // the dashboard itself isn't a viewer

    const a = await client();
    const b = await client();
    let update = next(organizer, 'viewers', (m) => m.count === 2);
    a.emit('event:view', EVENT);
    b.emit('event:view', EVENT);
    expect((await update).count).toBe(2);

    update = next(organizer, 'viewers', (m) => m.count === 1);
    b.close();
    expect((await update).count).toBe(1);

    update = next(organizer, 'viewers', (m) => m.count === 0);
    a.emit('event:unview', EVENT);
    expect((await update).count).toBe(0);
  });
});

describe('private notification room', () => {
  it('delivers to the signed-in user only', async () => {
    const userId = 'b'.repeat(24);
    const cookie = `${AUTH_COOKIE}=${signToken({ id: userId, role: 'attendee' })}`;
    const me = await client(cookie);
    const stranger = await client();
    let strangerGot = false;
    stranger.on('notification', () => { strangerGot = true; });

    const got = next(me, 'notification');
    // The room is joined during connection; give the server a tick.
    await new Promise((r) => setTimeout(r, 50));
    emitToUser(userId, 'notification', { title: 'hello' });
    expect((await got).title).toBe('hello');
    await new Promise((r) => setTimeout(r, 50));
    expect(strangerGot).toBe(false);
  });
});
