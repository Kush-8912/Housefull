import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { AUTH_COOKIE, verifyToken } from '../middleware/auth.js';
import { attachIO, eventRoom, userRoom, viewersRoom } from './bus.js';

const isObjectId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);

function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * Viewers join one room per event page they have open and receive seat
 * status changes for that event only. Signed-in users also join a private
 * room for their notifications. The channel is read-only: all writes go
 * through the authenticated REST API.
 */
export function initSocket(httpServer) {
  const io = new Server(httpServer, { cors: { origin: env.CLIENT_ORIGIN, credentials: true } });

  const viewerCount = (eventId) => io.sockets.adapter.rooms.get(viewersRoom(eventId))?.size ?? 0;
  const broadcastViewers = (eventId) => io.to(eventRoom(eventId)).emit('viewers', { eventId, count: viewerCount(eventId) });

  io.on('connection', (socket) => {
    const auth = verifyToken(readCookie(socket.handshake.headers.cookie, AUTH_COOKIE));
    if (auth?.sub) socket.join(userRoom(auth.sub));

    socket.on('event:join', (eventId) => {
      if (!isObjectId(eventId)) return;
      socket.join(eventRoom(eventId));
      socket.emit('viewers', { eventId, count: viewerCount(eventId) });
    });
    socket.on('event:leave', (eventId) => {
      if (isObjectId(eventId)) socket.leave(eventRoom(eventId));
    });

    // Only the public event page counts as "viewing" (not the organizer dashboard).
    socket.on('event:view', (eventId) => {
      if (!isObjectId(eventId)) return;
      socket.join(viewersRoom(eventId));
      broadcastViewers(eventId);
    });
    socket.on('event:unview', (eventId) => {
      if (!isObjectId(eventId)) return;
      socket.leave(viewersRoom(eventId));
      broadcastViewers(eventId);
    });
    socket.on('disconnecting', () => {
      const viewing = [...socket.rooms].filter((r) => r.startsWith('viewers:')).map((r) => r.slice('viewers:'.length));
      // Rooms are left after this handler returns; recount on the next tick.
      if (viewing.length) setImmediate(() => viewing.forEach(broadcastViewers));
    });
  });

  attachIO(io);
  return io;
}
