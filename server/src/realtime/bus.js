// Thin indirection so services can publish real-time updates without
// depending on socket.io (and stay silent in tests where no server exists).
let io = null;

export function attachIO(instance) {
  io = instance;
}

export const eventRoom = (eventId) => `event:${eventId}`;

// seats: [{ id, status }] — clients merge these into their local seat map.
export function emitSeatChanges(eventId, seats) {
  if (!io || seats.length === 0) return;
  io.to(eventRoom(eventId)).emit('seats:update', { eventId: String(eventId), seats });
}

export function emitCheckin(eventId, checkin) {
  io?.to(eventRoom(eventId)).emit('checkin', { eventId: String(eventId), ...checkin });
}

export const userRoom = (userId) => `user:${userId}`;
// People currently looking at an event's public page.
export const viewersRoom = (eventId) => `viewers:${eventId}`;

export function emitToUser(userId, name, payload) {
  io?.to(userRoom(userId)).emit(name, payload);
}
