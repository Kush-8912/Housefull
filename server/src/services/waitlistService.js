import { Event } from '../models/Event.js';
import { Seat, claimableFilter } from '../models/Seat.js';
import { WaitlistEntry } from '../models/WaitlistEntry.js';
import { AppError } from '../utils/AppError.js';
import { runInBackground } from '../utils/background.js';
import { notify } from './notifyService.js';
import { waitlistAvailableEmail } from './emails.js';

export const claimableCount = (eventId, now = new Date()) => Seat.countDocuments({ event: eventId, ...claimableFilter(now) });

export async function waitlistStatus({ user, event }) {
  const [entry, waiting] = await Promise.all([
    user ? WaitlistEntry.findOne({ event: event._id, user: user._id }) : null,
    WaitlistEntry.countDocuments({ event: event._id, status: 'waiting' }),
  ]);
  return { joined: entry?.status === 'waiting', notifiedAt: entry?.notifiedAt ?? null, waiting };
}

export async function joinWaitlist({ user, event }) {
  if (!event.isOnSale()) throw AppError.conflict('Tickets for this event are no longer on sale', { code: 'NOT_ON_SALE' });
  if (await claimableCount(event._id)) {
    throw AppError.conflict('Seats are available right now. Pick one on the map.', { code: 'SEATS_AVAILABLE' });
  }
  // Re-joining after a notification puts you back in the queue as new.
  await WaitlistEntry.findOneAndUpdate(
    { event: event._id, user: user._id },
    { status: 'waiting', notifiedAt: null, joinedAt: new Date() },
    { upsert: true, setDefaultsOnInsert: true },
  );
  return waitlistStatus({ user, event });
}

export async function leaveWaitlist({ user, event }) {
  await WaitlistEntry.deleteOne({ event: event._id, user: user._id });
  return waitlistStatus({ user, event });
}

/**
 * Seats came back (hold expired, order refunded): tell everyone waiting.
 * Each entry flips waiting -> notified with a conditional update, so two
 * overlapping runs never notify the same person twice.
 */
export async function notifyWaitlist(eventId) {
  const event = await Event.findById(eventId);
  if (!event?.isOnSale()) return 0;
  const available = await claimableCount(event._id);
  if (!available) return 0;

  const entries = await WaitlistEntry.find({ event: event._id, status: 'waiting' }).sort({ joinedAt: 1 }).limit(500).populate('user', 'name email');
  let sent = 0;
  for (const entry of entries) {
    const claimed = await WaitlistEntry.updateOne({ _id: entry._id, status: 'waiting' }, { status: 'notified', notifiedAt: new Date() });
    if (!claimed.modifiedCount || !entry.user) continue;
    await notify({
      userId: entry.user._id,
      type: 'waitlist_available',
      title: `Seats opened up: ${event.title}`,
      body: `${available === 1 ? '1 seat is' : `${available} seats are`} back on sale. First come, first served.`,
      link: `/events/${event._id}`,
      email: () => waitlistAvailableEmail({ user: entry.user, event, available }),
    });
    sent += 1;
  }
  return sent;
}

export const notifyWaitlistLater = (eventId) => runInBackground('waitlist', () => notifyWaitlist(eventId));
