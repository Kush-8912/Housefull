import { Event } from '../models/Event.js';
import { Order } from '../models/Order.js';
import { Ticket } from '../models/Ticket.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { assertSalesWindow } from './eventService.js';
import { notify } from './notifyService.js';
import { eventCancelledEmail, eventRescheduledEmail } from './emails.js';

// Everyone holding a live ticket: buyers, and people tickets were sent to.
export const ticketHolders = (eventId) => Ticket.distinct('user', { event: eventId, status: 'valid' });

/**
 * Move an upcoming published show to a new time. Tickets and seats stay as
 * they are; reminders are re-armed for the new time, and every ticket holder
 * gets an inbox notice and an email with the old and new times.
 */
export async function rescheduleEvent(event, startsAt) {
  const notReschedulable = () => AppError.conflict('Only upcoming published events can be rescheduled', { code: 'NOT_RESCHEDULABLE' });
  if (event.status !== 'published' || event.startsAt <= new Date()) throw notReschedulable();
  if (startsAt.getTime() === event.startsAt.getTime()) throw AppError.badRequest('That’s the time it’s already at', { code: 'SAME_TIME' });
  assertSalesWindow({ startsAt, salesStartAt: event.salesStartAt, salesCloseMinutes: event.salesCloseMinutes });
  const previousStartsAt = event.startsAt;

  // Conditional on the time we read, so two reschedules can't both notify from a stale "before".
  const moved = await Event.findOneAndUpdate(
    { _id: event._id, status: 'published', startsAt: previousStartsAt },
    // The reminder copy names the day ("See you on Friday"), so it is written again.
    { startsAt, reminderCopy: null, rescheduledAt: new Date() },
    { returnDocument: 'after' },
  );
  if (!moved) throw notReschedulable();

  await Order.updateMany({ event: event._id, status: 'paid' }, { reminderSentAt: null, showdayReminderSentAt: null });
  const holders = await User.find({ _id: { $in: await ticketHolders(event._id) } }, 'name email').lean();
  for (const user of holders) {
    await notify({
      userId: user._id,
      type: 'event_rescheduled',
      title: `New time: ${moved.title}`,
      body: 'Your tickets stay the same. Tap to see the new date and time.',
      link: `/events/${moved._id}`,
      email: eventRescheduledEmail({ user, event: moved, previousStartsAt }),
    });
  }
  return { event: moved, notified: holders.length };
}

/**
 * After the organizer cancels: tell everyone who held a ticket. Buyers hear
 * how much came back to which card; people who were sent a ticket hear that
 * the refund went to the buyer.
 */
export async function announceCancellation(event, holderIds, refundedOrders) {
  const refundFor = new Map(refundedOrders.map((o) => [String(o.user), o]));
  const holders = await User.find({ _id: { $in: [...new Set([...holderIds.map(String), ...refundFor.keys()])] } }, 'name email').lean();
  for (const user of holders) {
    await notify({
      userId: user._id,
      type: 'event_cancelled',
      title: `Cancelled: ${event.title}`,
      body: refundFor.has(String(user._id)) ? 'You’ve been refunded in full, booking fee included.' : 'The refund goes to the person who bought the ticket.',
      link: '/tickets',
      email: eventCancelledEmail({ user, event, refund: refundFor.get(String(user._id)) ?? null }),
    });
  }
}
