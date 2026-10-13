import mongoose from 'mongoose';

export const SEAT_STATUS = ['available', 'held', 'sold'];

// One document per physical seat per event. Keeping seats as individual
// documents (rather than an array inside Event) lets every claim be a single
// atomic conditional update on exactly one document, which is what makes
// double-selling impossible without multi-document transactions.
const seatSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    row: { type: String, required: true },
    number: { type: Number, required: true },
    label: { type: String, required: true }, // e.g. "B12"
    tier: { type: String, required: true },
    price: { type: Number, required: true },
    accessible: { type: Boolean, default: false }, // wheelchair space
    status: { type: String, enum: SEAT_STATUS, default: 'available' },
    hold: { type: mongoose.Schema.Types.ObjectId, ref: 'Hold', default: null },
    holdExpiresAt: { type: Date, default: null },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  },
  { versionKey: false },
);

seatSchema.index({ event: 1, label: 1 }, { unique: true });
seatSchema.index({ event: 1, status: 1 });
seatSchema.index({ status: 1, holdExpiresAt: 1 }); // used by the hold sweeper

// A hold that has passed its expiry is treated as available even before the
// background sweeper has cleaned it up, so correctness never depends on the job.
export function effectiveStatus(seat, now = new Date()) {
  if (seat.status === 'held' && seat.holdExpiresAt && seat.holdExpiresAt <= now) return 'available';
  return seat.status;
}

// Query fragment matching seats that can be claimed right now.
export function claimableFilter(now = new Date()) {
  return { $or: [{ status: 'available' }, { status: 'held', holdExpiresAt: { $lte: now } }] };
}

export const Seat = mongoose.model('Seat', seatSchema);
