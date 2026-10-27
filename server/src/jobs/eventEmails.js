import { Event } from '../models/Event.js';
import { Order } from '../models/Order.js';
import { Ticket } from '../models/Ticket.js';
import { User } from '../models/User.js';
import { sendMail } from '../services/mailer.js';
import { eventReminderEmail, feedbackRequestEmail, showdayReminderEmail } from '../services/emails.js';
import { reminderCopyFor } from '../services/reminderCopy.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const EVERY = 10 * MIN;

export const REMINDER_LEAD = DAY; // reminders go out once the show is within a day...
export const SHOWDAY_LEAD = 3 * HOUR; // ...and "it's showtime today" a few hours before
export const FEEDBACK_AFTER = 2 * HOUR; // feedback is asked for 2 hours after the show ends...
export const FEEDBACK_UNTIL = 3 * DAY; // ...and not at all once it's this old

// Mark the order first, then send: two job runs (or a run and the organizer's
// "send now" button) can never both email the same buyer.
async function claim(orderId, field) {
  return Order.findOneAndUpdate({ _id: orderId, [field]: null }, { [field]: new Date() }, { returnDocument: 'after' });
}

// Reminders for one event's paid orders that haven't had one. The buyer's
// tickets from the order that are still theirs (not transferred or refunded).
async function remindEvent(event) {
  const orders = await Order.find({ event: event._id, status: 'paid', reminderSentAt: null }, '_id user').lean();
  if (!orders.length) return 0;
  const copy = await reminderCopyFor(event);
  let sent = 0;
  for (const o of orders) {
    const tickets = await Ticket.find({ order: o._id, user: o.user, status: 'valid' }, 'label').lean();
    if (!tickets.length || !(await claim(o._id, 'reminderSentAt'))) continue;
    const user = await User.findById(o.user, 'name email').lean();
    if (!user) continue;
    sendMail(eventReminderEmail({ user, event, copy, tickets }));
    sent += 1;
  }
  return sent;
}

// The day-before reminder covers the window up to the last few hours; inside
// those the showday email takes over, so nobody gets both at once.
export async function sendDueReminders(now = new Date()) {
  const events = await Event.find({
    status: 'published',
    startsAt: { $gt: new Date(now.getTime() + SHOWDAY_LEAD), $lte: new Date(now.getTime() + REMINDER_LEAD) },
  }).select('+reminderCopy');
  let sent = 0;
  for (const event of events) sent += await remindEvent(event);
  return sent;
}

// "It's showtime today", a few hours before. Skips orders placed inside that
// window: their confirmation email went out minutes ago.
export async function sendDueShowdayReminders(now = new Date()) {
  const events = await Event.find({ status: 'published', startsAt: { $gt: now, $lte: new Date(now.getTime() + SHOWDAY_LEAD) } });
  let sent = 0;
  for (const event of events) {
    const bookedBefore = new Date(event.startsAt.getTime() - SHOWDAY_LEAD);
    const orders = await Order.find({ event: event._id, status: 'paid', showdayReminderSentAt: null, paidAt: { $lt: bookedBefore } }, '_id user').lean();
    for (const o of orders) {
      const tickets = await Ticket.find({ order: o._id, user: o.user, status: 'valid' }, 'label').lean();
      if (!tickets.length || !(await claim(o._id, 'showdayReminderSentAt'))) continue;
      const user = await User.findById(o.user, 'name email').lean();
      if (!user) continue;
      sendMail(showdayReminderEmail({ user, event, tickets }));
      sent += 1;
    }
  }
  return sent;
}

// Organizer's "send reminders now": same email, any time before the show.
// Also says how many paid orders exist, so "0 sent" can be explained.
export async function sendRemindersNow(event) {
  const withCopy = await Event.findById(event._id).select('+reminderCopy');
  const [sent, orders] = [await remindEvent(withCopy), await Order.countDocuments({ event: event._id, status: 'paid' })];
  return { sent, orders };
}

// Feedback requests go to buyers who were actually scanned in.
export async function sendDueFeedbackRequests(now = new Date()) {
  const longest = 24 * HOUR; // events last at most a day, so this bounds the start-time search
  const events = await Event.find({
    status: 'published',
    startsAt: { $gte: new Date(now.getTime() - FEEDBACK_UNTIL - longest), $lte: new Date(now.getTime() - FEEDBACK_AFTER) },
  });
  let sent = 0;
  for (const event of events) {
    const ended = event.startsAt.getTime() + event.durationMinutes * MIN;
    if (now.getTime() - ended < FEEDBACK_AFTER || now.getTime() - ended > FEEDBACK_UNTIL) continue;
    const orders = await Order.find({ event: event._id, status: 'paid', feedbackRequestedAt: null }, '_id user').lean();
    for (const o of orders) {
      const came = await Ticket.exists({ order: o._id, user: o.user, checkedInAt: { $ne: null } });
      if (!came || !(await claim(o._id, 'feedbackRequestedAt'))) continue;
      const user = await User.findById(o.user, 'name email').lean();
      if (!user) continue;
      sendMail(feedbackRequestEmail({ user, event }));
      sent += 1;
    }
  }
  return sent;
}

export function startEventEmailJob() {
  let running = false;
  const tick = async () => {
    if (running) return; // a slow run (AI copy, many orders) mustn't overlap the next
    running = true;
    try {
      const [reminders, showday, feedback] = await Promise.all([sendDueReminders(), sendDueShowdayReminders(), sendDueFeedbackRequests()]);
      if (reminders || showday || feedback) {
        console.log(`[event emails] ${reminders} reminder(s), ${showday} showday reminder(s), ${feedback} feedback request(s) sent`);
      }
    } catch (err) {
      console.error('[event emails] run failed:', err?.message ?? err);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 15_000);
  const timer = setInterval(tick, EVERY);
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
