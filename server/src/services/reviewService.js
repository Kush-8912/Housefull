import { Event, seriesKey } from '../models/Event.js';
import { Review } from '../models/Review.js';
import { Ticket } from '../models/Ticket.js';
import { AppError } from '../utils/AppError.js';

// Only people who were actually admitted at the door can review, and only
// once the show has started. One review per person per production.
async function attendedShow(user, key) {
  const shows = await Event.find({ $or: [{ _id: key }, { seriesId: key }], startsAt: { $lte: new Date() } }, '_id').lean();
  if (!shows.length) return null;
  const ticket = await Ticket.findOne({ user: user._id, event: { $in: shows.map((s) => s._id) }, checkedInAt: { $ne: null } }, 'event');
  return ticket?.event ?? null;
}

export async function reviewsFor({ event, viewer, page = 1, limit = 10 }) {
  const key = seriesKey(event);
  const [items, stats, mine, attended] = await Promise.all([
    Review.find({ series: key }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('user', 'name'),
    Review.aggregate([{ $match: { series: key } }, { $group: { _id: '$rating', n: { $sum: 1 } } }]),
    viewer ? Review.findOne({ series: key, user: viewer._id }) : null,
    viewer ? attendedShow(viewer, key) : null,
  ]);
  const distribution = Object.fromEntries([1, 2, 3, 4, 5].map((r) => [r, stats.find((s) => s._id === r)?.n ?? 0]));
  const count = stats.reduce((s, x) => s + x.n, 0);
  const avg = count ? Math.round((stats.reduce((s, x) => s + x._id * x.n, 0) / count) * 10) / 10 : null;
  return {
    avg, count, distribution, page, pages: Math.max(1, Math.ceil(count / limit)),
    items: items.map((r) => ({
      _id: r._id, rating: r.rating, text: r.text, recommend: r.recommend, createdAt: r.createdAt,
      author: r.user?.name?.split(' ')[0] ?? 'Attendee', mine: viewer ? r.user?._id?.equals(viewer._id) : false,
    })),
    // The private note belongs to the organizer; the author still sees their own.
    mine,
    canReview: Boolean(attended),
  };
}

export async function saveReview({ event, user, rating, text, aspects = {}, recommend = null, privateNote = '' }) {
  const key = seriesKey(event);
  const attended = await attendedShow(user, key);
  if (!attended) throw AppError.forbidden('Only people who attended can review this event');
  const review = await Review.findOneAndUpdate(
    { series: key, user: user._id },
    { $set: { rating, text, aspects, recommend, privateNote, event: attended }, $setOnInsert: { series: key, user: user._id } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  return review;
}

export async function deleteReview({ event, user }) {
  await Review.deleteOne({ series: seriesKey(event), user: user._id });
}
