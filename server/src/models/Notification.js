import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = ['waitlist_available', 'ticket_received', 'event_rescheduled', 'event_cancelled'];

// In-app inbox item. Delivered live over the user's socket room when they are
// online, and listed from the database when they next open the app.
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, maxlength: 500, default: '' },
    link: { type: String, default: null }, // in-app path, e.g. /events/:id
    readAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, readAt: 1 });

export const Notification = mongoose.model('Notification', notificationSchema);
