import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Bell } from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuth } from '../context/AuthContext';

const ago = (d) => {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} hr ago`;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(d));
};

// Header inbox: waitlist alerts and received tickets. New items arrive live
// over the socket and also pop a toast.
export function NotificationBell() {
  const { user } = useAuth();
  const [data, setData] = useState({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const panel = useRef(null);
  const userId = user?._id;

  const load = useCallback(() => {
    api('/notifications').then(setData).catch(() => {});
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    load();
    const socket = getSocket();
    const onNew = (n) => {
      setData((d) => ({ items: [n, ...d.items.filter((x) => x._id !== n._id)].slice(0, 30), unread: d.unread + 1 }));
      toast(n.title, { description: n.body });
    };
    socket.on('notification', onNew);
    socket.on('connect', load); // catch up on anything sent while offline
    return () => {
      socket.off('notification', onNew);
      socket.off('connect', load);
    };
  }, [userId, load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!panel.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markRead = async (ids) => {
    try {
      const { unread } = await api('/notifications/read', { method: 'POST', body: ids ? { ids } : {} });
      const now = new Date().toISOString();
      setData((d) => ({ unread, items: d.items.map((n) => (!ids || ids.includes(n._id) ? { ...n, readAt: n.readAt ?? now } : n)) }));
    } catch { /* not critical */ }
  };

  if (!user) return null;
  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        className="btn-ghost relative px-2.5"
        onClick={() => setOpen((o) => !o)}
        aria-label={data.unread ? `Notifications, ${data.unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" aria-hidden />
        {data.unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal px-1 font-mono text-[9px] font-bold text-ink">
            {data.unread > 9 ? '9+' : data.unread}
          </span>
        )}
      </button>
      {open && (
        // Phones: span the screen under the header. The bell isn't at the
        // right edge there, so a panel anchored to it would run off the left.
        <div className="fixed inset-x-4 top-[4.25rem] z-40 border sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-3 sm:w-[22rem] border-line-strong bg-ink-900 shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="eyebrow text-fg">Notifications</p>
            {data.unread > 0 && <button type="button" className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal hover:underline" onClick={() => markRead()}>Mark all read</button>}
          </div>
          {data.items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">Nothing yet. Waitlist alerts and tickets sent to you show up here.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {data.items.map((n) => {
                const body = (
                  <>
                    <span className="flex items-start gap-2">
                      {!n.readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" aria-label="Unread" />}
                      <span className="text-sm font-medium text-fg">{n.title}</span>
                    </span>
                    {n.body && <span className="mt-0.5 block text-xs text-muted">{n.body}</span>}
                    <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-faint">{ago(n.createdAt)}</span>
                  </>
                );
                const cls = 'block px-4 py-3 transition-colors hover:bg-ink-850';
                return (
                  <li key={n._id}>
                    {n.link ? (
                      <Link to={n.link} className={cls} onClick={() => { setOpen(false); if (!n.readAt) markRead([n._id]); }}>{body}</Link>
                    ) : (
                      <div className={cls}>{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
