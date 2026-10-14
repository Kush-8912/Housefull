import { env } from '../config/env.js';
import { Hold } from '../models/Hold.js';
import { Seat, claimableFilter } from '../models/Seat.js';
import { AppError } from '../utils/AppError.js';
import { emitSeatChanges } from '../realtime/bus.js';
import { notifyWaitlistLater } from './waitlistService.js';

const RELEASED_SEAT = { status: 'available', hold: null, holdExpiresAt: null };

/**
 * Reserve a set of seats for one user for HOLD_TTL_MINUTES.
 *
 * Concurrency model: every seat is claimed with its own conditional
 * findOneAndUpdate ("set held WHERE still claimable"). MongoDB applies each of
 * those atomically, so when two buyers race for the same seat exactly one
 * update matches. If only some of the requested seats could be claimed, the
 * ones we did get are handed back (all-or-nothing from the buyer's view).
 */
export async function createHold({ user, event, seatIds }) {
  if (!event.isOnSale()) {
    const notYet = event.status === 'published' && event.salesStartAt && new Date() < event.salesStartAt;
    throw AppError.conflict(notYet ? 'Ticket sales for this event haven’t opened yet' : 'Tickets for this event are no longer on sale', { code: notYet ? 'SALES_NOT_OPEN' : 'NOT_ON_SALE' });
  }

  const uniqueIds = [...new Set(seatIds.map(String))];
  if (uniqueIds.length === 0) throw AppError.badRequest('Select at least one seat');
  const limit = Math.min(event.maxPerOrder ?? env.MAX_SEATS_PER_HOLD, env.MAX_SEATS_PER_HOLD);
  if (uniqueIds.length > limit) {
    throw AppError.badRequest(`You can pick at most ${limit} seat${limit === 1 ? '' : 's'} per order for this event`, { code: 'TOO_MANY_SEATS' });
  }

  // Changing your selection replaces your previous hold for this event.
  const previous = await Hold.findOne({ user: user._id, event: event._id, status: 'active' });
  // The waitlist is checked after the new claim instead: if the buyer re-picks
  // the same seats nothing was really freed, and nobody should be alerted.
  if (previous) await releaseHold(previous, 'released', { notifyWaitlist: false });

  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.HOLD_TTL_MINUTES * 60_000);

  let hold;
  try {
    hold = await Hold.create({ user: user._id, event: event._id, seats: uniqueIds, expiresAt });
  } catch (err) {
    if (err?.code === 11000) throw AppError.conflict('You already have a hold being created for this event. Please retry.');
    throw err;
  }

  const results = await Promise.all(
    uniqueIds.map((id) =>
      Seat.findOneAndUpdate(
        { _id: id, event: event._id, ...claimableFilter(now) },
        { status: 'held', hold: hold._id, holdExpiresAt: expiresAt },
        { returnDocument: 'after', projection: { _id: 1, label: 1 } },
      ),
    ),
  );

  const failedIds = uniqueIds.filter((_, i) => !results[i]);
  if (failedIds.length > 0) {
    // Hand back what we did grab, then report exactly which seats were lost.
    const gotIds = results.filter(Boolean).map((s) => s._id);
    await Seat.updateMany({ _id: { $in: gotIds }, hold: hold._id }, RELEASED_SEAT);
    await Hold.updateOne({ _id: hold._id }, { status: 'released' });
    notifyWaitlistLater(event._id);

    const failed = await Seat.find({ _id: { $in: failedIds }, event: event._id }, { label: 1 }).lean();
    const unknown = failedIds.length - failed.length;
    if (unknown > 0) throw AppError.badRequest('Some selected seats do not belong to this event');
    throw AppError.conflict(`Sorry, ${failed.map((s) => s.label).join(', ')} ${failed.length === 1 ? 'was' : 'were'} just taken by someone else`, {
      code: 'SEATS_UNAVAILABLE',
      details: { seatIds: failed.map((s) => s._id), labels: failed.map((s) => s.label) },
    });
  }

  emitSeatChanges(event._id, uniqueIds.map((id) => ({ id, status: 'held' })));
  if (previous) notifyWaitlistLater(event._id);
  return hold;
}

/**
 * Give a hold's seats back. The status transition is conditional so a hold is
 * released at most once even if the user, the sweeper and checkout race.
 * Seats are matched by hold id, so a seat that has since been re-claimed by
 * someone else after expiry is never touched.
 */
export async function releaseHold(hold, reason = 'released', { notifyWaitlist = true } = {}) {
  const transitioned = await Hold.findOneAndUpdate({ _id: hold._id, status: 'active' }, { status: reason });
  if (!transitioned) return false;

  const seats = await Seat.find({ hold: hold._id, status: 'held' }, { _id: 1 }).lean();
  if (seats.length) {
    await Seat.updateMany({ _id: { $in: seats.map((s) => s._id) }, hold: hold._id, status: 'held' }, RELEASED_SEAT);
    emitSeatChanges(hold.event, seats.map((s) => ({ id: s._id, status: 'available' })));
    if (notifyWaitlist) notifyWaitlistLater(hold.event);
  }
  return true;
}

export async function loadOwnedHold(holdId, user) {
  const hold = await Hold.findById(holdId);
  if (!hold || !hold.user.equals(user._id)) throw AppError.notFound('Hold');
  return hold;
}
