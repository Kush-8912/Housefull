import { Router } from 'express';
import { z } from 'zod';
import { Notification } from '../models/Notification.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Mounted at /api/notifications
export const notificationsRouter = Router();

notificationsRouter.get('/', requireAuth, asyncHandler(async (req, res) => {
  const [items, unread] = await Promise.all([
    Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(30),
    Notification.countDocuments({ user: req.user._id, readAt: null }),
  ]);
  res.json({ items, unread });
}));

// Mark specific notifications (or, with no ids, all of them) as read.
notificationsRouter.post('/read', requireAuth, validate(z.object({ ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(100).optional() })), asyncHandler(async (req, res) => {
  const filter = { user: req.user._id, readAt: null };
  if (req.body.ids) filter._id = { $in: req.body.ids };
  await Notification.updateMany(filter, { readAt: new Date() });
  res.json({ unread: await Notification.countDocuments({ user: req.user._id, readAt: null }) });
}));
