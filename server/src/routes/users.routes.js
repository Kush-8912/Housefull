import { Router } from 'express';
import { Avatar } from '../models/Avatar.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';

// Mounted at /api/users
export const usersRouter = Router();

// Profile photos are for signed-in people only (attendees see their own; door
// staff see the ticket holder's). The URL carries a version, so it can be cached for good.
usersRouter.get('/:id/avatar', requireAuth, asyncHandler(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw AppError.notFound('Photo');
  const avatar = await Avatar.findOne({ user: req.params.id }, 'data contentType').lean();
  if (!avatar) throw AppError.notFound('Photo');
  res.set({ 'Content-Type': avatar.contentType, 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Disposition': 'inline' });
  res.send(Buffer.from(avatar.data.buffer ?? avatar.data));
}));
