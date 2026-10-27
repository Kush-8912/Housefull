import { Event } from '../models/Event.js';
import { Ticket } from '../models/Ticket.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { notify } from './notifyService.js';
import { ticketReceivedEmail } from './emails.js';

/**
 * Hand a ticket to another attendee. The old ticket is retired (its QR stops
 * working at the door) and the recipient gets a new ticket with a new QR for
 * the same seat. The new ticket keeps the original order, so if the organizer
 * cancels the event the refund still goes to whoever paid.
 */
export async function transferTicket({ user, ticketId, email }) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket || !ticket.user.equals(user._id)) throw AppError.notFound('Ticket');
  if (ticket.status !== 'valid') throw AppError.conflict(`This ticket is ${ticket.status} and can't be transferred`, { code: 'NOT_TRANSFERABLE' });
  if (ticket.checkedInAt) throw AppError.conflict('This ticket has already been used at the door', { code: 'NOT_TRANSFERABLE' });

  const event = await Event.findById(ticket.event);
  if (!event?.isUpcoming()) throw AppError.conflict('Tickets can only be transferred before the event starts', { code: 'NOT_TRANSFERABLE' });

  const recipient = await User.findOne({ email: email.trim().toLowerCase() });
  if (!recipient) {
    throw AppError.badRequest('There’s no Housefull account with that email. Ask them to sign up first.', { code: 'RECIPIENT_NOT_FOUND' });
  }
  if (recipient._id.equals(user._id)) throw AppError.badRequest('This ticket is already yours', { code: 'RECIPIENT_INVALID' });
  if (recipient.role !== 'attendee') throw AppError.badRequest('Tickets can only be sent to attendee accounts', { code: 'RECIPIENT_INVALID' });

  const now = new Date();
  // Conditional: a ticket being scanned or transferred at the same moment can't be handed out twice.
  const retired = await Ticket.findOneAndUpdate(
    { _id: ticket._id, user: user._id, status: 'valid', checkedInAt: null },
    { status: 'transferred', transferredTo: recipient._id, transferredAt: now },
    { returnDocument: 'after' },
  );
  if (!retired) throw AppError.conflict('This ticket changed while you were sending it. Refresh and try again.', { code: 'NOT_TRANSFERABLE' });

  const fresh = await Ticket.create({
    order: ticket.order, event: ticket.event, user: recipient._id, seat: ticket.seat,
    label: ticket.label, tier: ticket.tier, price: ticket.price, transferredFrom: ticket._id,
  });

  await notify({
    userId: recipient._id,
    type: 'ticket_received',
    title: `${user.name} sent you a ticket`,
    body: `Seat ${fresh.label} for ${event.title}.`,
    link: '/tickets',
    email: () => ticketReceivedEmail({ recipient, sender: user, event, ticket: fresh }),
  });

  return { ticket: retired, recipient: { name: recipient.name, email: recipient.email } };
}
