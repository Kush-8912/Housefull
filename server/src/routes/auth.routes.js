import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User, ROLES } from '../models/User.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, signToken, setAuthCookie, clearAuthCookie } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';
import { profileSummary } from '../services/profileService.js';

export const authRouter = Router();

// Slow down credential stuffing / brute force on the auth endpoints only.
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, skip: () => env.NODE_ENV === 'test', standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { message: 'Too many attempts. Try again in a few minutes.', code: 'RATE_LIMITED' } } });

const nameField = z.string().trim().min(2, 'Name must be at least 2 characters').max(80, 'Name can be at most 80 characters');
// Same rules as the checklist under the password field (client/src/lib/passwordRules.js).
const newPasswordField = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password can be at most 128 characters')
  .regex(/[A-Z]/, 'Password needs at least one uppercase letter')
  .regex(/[^A-Za-z0-9\s]/, 'Password needs at least one special character, like ! @ # $');

const registerSchema = z.object({
  name: nameField,
  email: z.email('Enter a valid email').transform((e) => e.toLowerCase()),
  password: newPasswordField,
  role: z.enum(ROLES).default('attendee'),
});

const loginSchema = z.object({
  email: z.email('Enter a valid email').transform((e) => e.toLowerCase()),
  password: z.string().min(1, 'Password is required'),
});

authRouter.post('/register', authLimiter, validate(registerSchema), asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;
  if (await User.exists({ email })) throw AppError.conflict('An account with this email already exists');
  const user = await User.create({ name, email, role, passwordHash: await User.hashPassword(password) });
  setAuthCookie(res, signToken(user));
  res.status(201).json({ user });
}));

authRouter.post('/login', authLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email }).select('+passwordHash');
  // Same message for unknown email and wrong password: don't reveal which accounts exist.
  if (!user || !(await user.verifyPassword(req.body.password))) {
    throw new AppError(401, 'Incorrect email or password', { code: 'BAD_CREDENTIALS' });
  }
  setAuthCookie(res, signToken(user));
  res.json({ user });
}));

authRouter.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

authRouter.patch('/me', requireAuth, validate(z.object({ name: nameField })), asyncHandler(async (req, res) => {
  req.user.name = req.body.name;
  await req.user.save();
  res.json({ user: req.user });
}));

authRouter.get('/me/profile', requireAuth, asyncHandler(async (req, res) => {
  res.json(await profileSummary(req.user));
}));

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: newPasswordField,
}).refine((b) => b.currentPassword !== b.newPassword, { path: ['newPassword'], message: 'Choose a password different from your current one' });

// Signs out every other device; this one gets a fresh session.
authRouter.post('/password', authLimiter, requireAuth, validate(passwordSchema), asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!(await user.verifyPassword(req.body.currentPassword))) {
    throw new AppError(400, 'Your current password is incorrect', { code: 'WRONG_PASSWORD', details: [{ field: 'currentPassword', message: 'Incorrect password' }] });
  }
  user.passwordHash = await User.hashPassword(req.body.newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  setAuthCookie(res, signToken(user));
  res.status(204).end();
}));
