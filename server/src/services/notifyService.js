import { Notification } from '../models/Notification.js';
import { emitToUser } from '../realtime/bus.js';
import { sendMail } from './mailer.js';

/**
 * Tell one user about something: an inbox item (pushed live if they're
 * online) and, optionally, an email. Failures here are logged, never thrown,
 * because a notification must not undo the action that caused it.
 */
export async function notify({ userId, type, title, body = '', link = null, email = null }) {
  try {
    const n = await Notification.create({ user: userId, type, title, body, link });
    emitToUser(userId, 'notification', n.toJSON());
  } catch (err) {
    console.error('[notify] could not store notification:', err.message);
  }
  if (email) sendMail(email);
}
