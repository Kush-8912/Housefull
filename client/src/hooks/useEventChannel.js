import { useEffect, useLayoutEffect, useRef } from 'react';
import { getSocket } from '../lib/socket';

/**
 * Subscribe to live updates for one event. Re-joins the room after a
 * reconnect and calls onReconnect so the caller can refetch anything missed
 * while offline (socket.io does not replay messages).
 *
 * With `view: true` this page also counts towards the event's live
 * "people viewing" number (the public event page uses it; dashboards don't).
 */
export function useEventChannel(eventId, handlers, { view = false } = {}) {
  const ref = useRef(handlers);
  useLayoutEffect(() => { ref.current = handlers; });

  useEffect(() => {
    if (!eventId) return undefined;
    const socket = getSocket();
    let connectedBefore = socket.connected;

    const enter = () => {
      socket.emit('event:join', eventId);
      if (view) socket.emit('event:view', eventId);
    };
    const join = () => {
      enter();
      if (connectedBefore) ref.current.onReconnect?.();
      connectedBefore = true;
    };
    const onSeats = (msg) => msg.eventId === eventId && ref.current.onSeats?.(msg.seats);
    const onCheckin = (msg) => msg.eventId === eventId && ref.current.onCheckin?.(msg);
    const onViewers = (msg) => msg.eventId === eventId && ref.current.onViewers?.(msg.count);

    if (socket.connected) enter();
    socket.on('connect', join);
    socket.on('seats:update', onSeats);
    socket.on('checkin', onCheckin);
    socket.on('viewers', onViewers);
    return () => {
      if (view) socket.emit('event:unview', eventId);
      socket.emit('event:leave', eventId);
      socket.off('connect', join);
      socket.off('seats:update', onSeats);
      socket.off('checkin', onCheckin);
      socket.off('viewers', onViewers);
    };
  }, [eventId, view]);
}
