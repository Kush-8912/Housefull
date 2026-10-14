import { Event } from '../models/Event.js';
import { Ticket } from '../models/Ticket.js';
import { avatarUrlFor } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { verifyQrPayload } from './ticketSigner.js';
import { emitCheckin } from '../realtime/bus.js';

// Doors are considered closed this long after the scheduled end.
const CHECKIN_GRACE_AFTER_END_MS = 6 * 3_600_000;

const invalid = () => AppError.badRequest('This QR code is not a valid SeatLock ticket', { code: 'INVALID_TICKET' });

function assertDoorsOpen(event) {
  if (event.status === 'cancelled') throw AppError.conflict('This event has been cancelled', { code: 'EVENT_CANCELLED' });
  const endsAt = event.startsAt.getTime() + event.durationMinutes * 60_000;
  if (Date.now() > endsAt + CHECKIN_GRACE_AFTER_END_MS) throw AppError.conflict('Check-in for this event has closed', { code: 'CHECKIN_CLOSED' });
}

/**
 * Validate a scanned QR code and admit the holder exactly once.
 * Each failure has its own code so the scanner UI can tell staff precisely
 * what is wrong (forged code vs. wrong event vs. already used).
 *
 * The usual case (a valid, unused ticket) costs one indexed write on _id plus
 * one lookup for the holder's name; the ticket is only read again to explain
 * a rejection.
 */
export async function checkInTicket({ event, qr, staff }) {
  assertDoorsOpen(event);
  const ticketId = verifyQrPayload(qr);
  if (!ticketId) throw invalid();
  return admit({ ticketId, event, staff });
}

/**
 * Check in from a scan link, where the event isn't known up front: the ticket
 * says which event it's for, and only that event's organizer may admit it.
 */
export async function checkInByCode({ qr, staff }) {
  const ticketId = verifyQrPayload(qr);
  if (!ticketId) throw invalid();
  const ticket = await Ticket.findById(ticketId, 'event').lean();
  if (!ticket) throw invalid();
  const event = await Event.findById(ticket.event, 'title organizer status startsAt durationMinutes venue');
  if (!event) throw invalid();
  if (!event.organizer.equals(staff._id)) throw new AppError(403, 'This ticket is for an event you don’t manage', { code: 'NOT_YOUR_EVENT' });
  assertDoorsOpen(event);
  const result = await admit({ ticketId, event, staff });
  return { ...result, event: { id: event._id, title: event.title, venue: event.venue?.name } };
}

async function admit({ ticketId, event, staff }) {
  // Conditional update: two scanners reading the same code at once can't both admit it.
  const admitted = await Ticket.findOneAndUpdate(
    { _id: ticketId, event: event._id, status: 'valid', checkedInAt: null },
    { $set: { checkedInAt: new Date(), checkedInBy: staff._id } },
    { returnDocument: 'after', projection: { label: 1, tier: 1, user: 1, checkedInAt: 1 } },
  ).populate('user', 'name email avatarUpdatedAt').lean();

  if (admitted) {
    const live = { ticketId: admitted._id, label: admitted.label, tier: admitted.tier, attendee: admitted.user?.name, checkedInAt: admitted.checkedInAt };
    // The live channel reaches the whole event room, so the email stays out of it.
    emitCheckin(event._id, live);
    return { ...live, attendeeEmail: admitted.user?.email ?? null, attendeeAvatarUrl: avatarUrlFor(admitted.user) };
  }

  // Rejected: read the ticket once to say why.
  const ticket = await Ticket.findById(ticketId, 'event status label checkedInAt user').populate('user', 'name').lean();
  if (!ticket) throw invalid();
  if (!ticket.event.equals(event._id)) throw AppError.conflict('This ticket is for a different event', { code: 'WRONG_EVENT' });
  if (ticket.status === 'cancelled') throw AppError.conflict(`Ticket ${ticket.label} was cancelled and refunded`, { code: 'TICKET_CANCELLED' });
  if (ticket.status === 'transferred') {
    throw AppError.conflict(`Ticket ${ticket.label} was transferred to someone else. This QR code no longer works.`, { code: 'TICKET_TRANSFERRED' });
  }
  throw AppError.conflict(`Ticket ${ticket.label} was already used`, {
    code: 'ALREADY_CHECKED_IN',
    details: { checkedInAt: ticket.checkedInAt, label: ticket.label, attendee: ticket.user?.name },
  });
}
