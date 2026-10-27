import { useEffect, useLayoutEffect, useRef } from 'react';
import { toast } from 'sonner';
import { getSocket } from '../lib/socket';

/**
 * Calls `refresh` when one of the signed-in user's tickets is scanned at the
 * door, so it shows "checked in" without a reload. Also refreshes after the
 * socket reconnects, in case a scan happened while the phone was offline.
 */
export function useTicketCheckins(refresh) {
  const refreshRef = useRef(refresh);
  useLayoutEffect(() => { refreshRef.current = refresh; });

  useEffect(() => {
    const socket = getSocket();
    const onCheckin = (c) => {
      toast.success(`You're in! Seat ${c.label} is checked in`, { description: c.eventTitle });
      refreshRef.current();
    };
    const onReconnect = () => refreshRef.current();
    socket.on('ticket:checkin', onCheckin);
    socket.io.on('reconnect', onReconnect);
    return () => {
      socket.off('ticket:checkin', onCheckin);
      socket.io.off('reconnect', onReconnect);
    };
  }, []);
}
