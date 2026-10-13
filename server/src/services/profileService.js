import { Event } from '../models/Event.js';
import { Review } from '../models/Review.js';
import { Ticket } from '../models/Ticket.js';

const HISTORY_LIMIT = 12;

/**
 * What the profile page shows: a few headline numbers, plus (for attendees)
 * the shows they were actually checked in at, newest first, one entry per
 * event with every seat they sat in.
 */
export async function profileSummary(user) {
  return user.role === 'organizer' ? organizerSummary(user) : attendeeSummary(user);
}

async function attendeeSummary(user) {
  const now = new Date();
  const [eventIds, reviews, history] = await Promise.all([
    Ticket.distinct('event', { user: user._id, status: 'valid' }),
    Review.countDocuments({ user: user._id }),
    Ticket.aggregate([
      { $match: { user: user._id, checkedInAt: { $ne: null } } },
      { $group: { _id: '$event', seats: { $push: '$label' }, checkedInAt: { $max: '$checkedInAt' } } },
      { $sort: { checkedInAt: -1 } },
      { $limit: HISTORY_LIMIT },
      { $lookup: { from: 'events', localField: '_id', foreignField: '_id', as: 'event', pipeline: [{ $project: { title: 1, startsAt: 1, venue: 1, category: 1 } }] } },
      { $unwind: '$event' },
    ]),
  ]);
  const [upcoming, attended] = await Promise.all([
    Event.countDocuments({ _id: { $in: eventIds }, status: 'published', startsAt: { $gt: now } }),
    Ticket.distinct('event', { user: user._id, checkedInAt: { $ne: null } }).then((ids) => ids.length),
  ]);

  return {
    stats: { attended, upcoming, reviews },
    history: history.map((h) => ({
      eventId: h._id,
      title: h.event.title,
      startsAt: h.event.startsAt,
      venue: h.event.venue,
      category: h.event.category,
      seats: h.seats.toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    })),
  };
}

async function organizerSummary(user) {
  const now = new Date();
  const events = await Event.find({ organizer: user._id, status: { $ne: 'draft' } }, '_id startsAt status').lean();
  const ids = events.map((e) => e._id);
  const [tickets] = await Ticket.aggregate([
    { $match: { event: { $in: ids }, status: 'valid' } },
    { $group: { _id: null, sold: { $sum: 1 }, checkedIn: { $sum: { $cond: [{ $ne: ['$checkedInAt', null] }, 1, 0] } } } },
  ]);
  return {
    stats: {
      hosted: events.length,
      upcoming: events.filter((e) => e.status === 'published' && e.startsAt > now).length,
      sold: tickets?.sold ?? 0,
      checkedIn: tickets?.checkedIn ?? 0,
    },
    history: [],
  };
}
