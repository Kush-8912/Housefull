import mongoose from 'mongoose';

// transferred: handed to another attendee; a new ticket (new QR) replaces it.
export const TICKET_STATUS = ['valid', 'cancelled', 'transferred'];

const ticketSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    seat: { type: mongoose.Schema.Types.ObjectId, ref: 'Seat', required: true },
    label: { type: String, required: true },
    tier: String,
    price: Number,
    status: { type: String, enum: TICKET_STATUS, default: 'valid' },
    checkedInAt: { type: Date, default: null },
    checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    transferredFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null },
    transferredTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    transferredAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

ticketSchema.index({ event: 1, status: 1, checkedInAt: 1 });
ticketSchema.index({ seat: 1, status: 1 });

// Sort seat labels the way people read them: A2 before A10.
export const SEAT_ORDER = { locale: 'en', numericOrdering: true };

// Guest list and CSV export: one event's valid tickets in seat order. The
// collation must match the queries' for MongoDB to use the index for the sort.
ticketSchema.index({ event: 1, status: 1, label: 1 }, { collation: SEAT_ORDER });

export const Ticket = mongoose.model('Ticket', ticketSchema);
