import { io } from 'socket.io-client';

// One shared connection for the whole app (same origin; Vite proxies in dev).
let socket;
export function getSocket() {
  if (!socket) socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
  return socket;
}

// The server reads the auth cookie when the socket connects, so reconnect
// after logging in or out to join (or leave) the private notification room.
export function reconnectSocket() {
  if (socket?.connected) {
    socket.disconnect();
    socket.connect();
  }
}
