import mongoose from 'mongoose';
import { CANCELLATION_POLICIES, DEFAULT_POLICY } from '../services/refundPolicy.js';

export const CATEGORIES = ['music', 'comedy', 'theatre', 'sports', 'tech', 'workshop', 'other'];
export const EVENT_STATUS = ['draft', 'published', 'cancelled'];

const tierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 30 },
    price: { type: Number, required: true, min: 0 }, // whole INR
    color: { type: String, default: '#6366f1' },
    // What the tier includes, shown to buyers ("Front rows, free drink").
    description: { type: String, trim: true, maxlength: 120, default: '' },
  },
  { _id: false },
);

// A row of the seating chart. Seats are numbered 1..seats and all share a tier.
// Seat numbers listed in `blocked` are never sold (pillars, crew, house seats)
// and get no Seat document; `aisleAfter` puts a walkway after those seats;
// `accessible` marks wheelchair spaces.
const rowSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 3 },
    seats: { type: Number, required: true, min: 1, max: 60 },
    tier: { type: String, required: true },
    aisleAfter: { type: [Number], default: [] },
    blocked: { type: [Number], default: [] },
    accessible: { type: [Number], default: [] },
  },
  { _id: false },
);

const eventSchema = new mongoose.Schema(
  {
    organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 4000, default: '' },
    category: { type: String, enum: CATEGORIES, required: true },
    venue: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      city: { type: String, required: true, trim: true, maxlength: 60 },
    },
    startsAt: { type: Date, required: true },
    durationMinutes: { type: Number, min: 15, max: 24 * 60, default: 120 },
    coverImageUrl: { type: String, trim: true, default: '' },
    tiers: { type: [tierSchema], validate: (v) => v.length > 0 },
    rows: { type: [rowSchema], validate: (v) => v.length > 0 },
    status: { type: String, enum: EVENT_STATUS, default: 'draft' },
    // Booking rules. Null maxPerOrder means the server-wide limit; null
    // salesStartAt means sales open as soon as the event is published.
    maxPerOrder: { type: Number, min: 1, max: 20, default: null },
    salesStartAt: { type: Date, default: null },
    salesCloseMinutes: { type: Number, min: 0, max: 7 * 24 * 60, default: 0 },
    // How much attendees get back if they cancel; see refundPolicy.js. Locked once published.
    cancellationPolicy: { type: String, enum: Object.keys(CANCELLATION_POLICIES), default: DEFAULT_POLICY },
    // Set when the organizer moves a published show; earlier buyers may then cancel for a full refund.
    rescheduledAt: { type: Date, default: null },
    // Showtimes of the same production share a series id (the first show's
    // _id). A one-off event has none; see seriesKey().
    seriesId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    // Reminder email copy written by Claude, cached so it is generated once.
    reminderCopy: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
    publishedAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true },
);

eventSchema.index({ status: 1, startsAt: 1 });
eventSchema.index({ 'venue.city': 1 });

// Sellable seats only: blocked seats don't count.
export const rowCapacity = (r) => r.seats - (r.blocked?.length ?? 0);

eventSchema.virtual('capacity').get(function capacity() {
  return this.rows?.reduce((sum, r) => sum + rowCapacity(r), 0);
});

// When the organizer stops selling: at showtime, or N minutes before it.
eventSchema.virtual('salesEndAt').get(function salesEndAt() {
  return this.startsAt && new Date(this.startsAt.getTime() - (this.salesCloseMinutes ?? 0) * 60_000);
});

// Published and inside the organizer's sales window.
eventSchema.methods.isOnSale = function isOnSale(now = new Date()) {
  if (this.status !== 'published') return false;
  if (this.salesStartAt && now < this.salesStartAt) return false;
  return now < this.salesEndAt;
};

// Published and not started yet: tickets already sold can still change hands,
// and a hold granted while on sale can still be paid for.
eventSchema.methods.isUpcoming = function isUpcoming(now = new Date()) {
  return this.status === 'published' && this.startsAt > now;
};

// The id that groups this event's showtimes, interest and reviews. Stable:
// a one-off event's key is its own _id, which becomes the seriesId when a
// second showtime is added.
export const seriesKey = (event) => event.seriesId ?? event._id;

eventSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Event = mongoose.model('Event', eventSchema);
