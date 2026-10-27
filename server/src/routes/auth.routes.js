import express, { Router } from 'express';
import { Avatar } from '../models/Avatar.js';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User, ROLES } from '../models/User.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole, signToken, setAuthCookie, clearAuthCookie } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';
import { profileSummary } from '../services/profileService.js';
import { verifyGoogleAccessToken } from '../services/googleToken.js';
import { signInWithGoogle } from '../services/googleAuth.js';
import { KycError, verifyPan } from '../services/kycService.js';

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

// Which sign-in options this deployment offers. A Google client ID is public
// by design (it is embedded in every page that shows the button).
authRouter.get('/providers', (_req, res) => res.json({ google: env.GOOGLE_CLIENT_ID ?? null }));

const googleSchema = z.object({
  accessToken: z.string().min(1, 'Missing Google token').max(4096),
  role: z.enum(ROLES).default('attendee'), // only used when this creates the account
});

authRouter.post('/google', authLimiter, validate(googleSchema), asyncHandler(async (req, res) => {
  if (!env.GOOGLE_CLIENT_ID) throw new AppError(404, 'Google sign-in isn’t set up on this server', { code: 'GOOGLE_DISABLED' });
  const profile = await verifyGoogleAccessToken(req.body.accessToken);
  const { user, created } = await signInWithGoogle(profile, req.body.role);
  setAuthCookie(res, signToken(user));
  res.status(created ? 201 : 200).json({ user, created });
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
  if (!user.passwordHash) {
    throw AppError.badRequest('This account signs in with Google, so there’s no password to change', { code: 'NO_PASSWORD' });
  }
  if (!(await user.verifyPassword(req.body.currentPassword))) {
    throw new AppError(400, 'Your current password is incorrect', { code: 'WRONG_PASSWORD', details: [{ field: 'currentPassword', message: 'Incorrect password' }] });
  }
  user.passwordHash = await User.hashPassword(req.body.newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  setAuthCookie(res, signToken(user));
  res.status(204).end();
}));

const hostVerificationSchema = z.object({
  legalName: z.string().trim().min(3, 'Enter your name as it is on your PAN card').max(100),
  pan: z.string().trim().toUpperCase().length(10, 'A PAN has 10 characters'),
});
const KYC_STATUS = { PAN_INVALID: 400, PAN_NOT_FOUND: 422, PAN_NAME_MISMATCH: 422, KYC_UNAVAILABLE: 503 };

// Organizer identity check. Publishing is blocked until this succeeds.
authRouter.post('/me/host-verification', authLimiter, requireAuth, requireRole('organizer'), validate(hostVerificationSchema), asyncHandler(async (req, res) => {
  if (req.user.hostVerification?.verifiedAt) throw AppError.conflict('You’re already a verified host', { code: 'ALREADY_VERIFIED' });
  let result;
  try {
    result = await verifyPan(req.body);
  } catch (err) {
    if (!(err instanceof KycError)) throw err;
    const field = err.code === 'PAN_NAME_MISMATCH' ? 'legalName' : 'pan';
    const details = err.code === 'KYC_UNAVAILABLE' ? undefined : [{ field, message: err.message }];
    throw new AppError(KYC_STATUS[err.code], err.message, { code: err.code, details });
  }
  req.user.hostVerification = { legalName: req.body.legalName, ...result, verifiedAt: new Date() };
  await req.user.save();
  res.json({ user: req.user });
}));

// Real image files start with these bytes; checking them means a renamed
// script or SVG can't be stored and served back as a "photo".
const IMAGE_SIGNATURES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};
const MAX_AVATAR_BYTES = 300 * 1024;

// The body is the image itself (Content-Type: image/jpeg|png|webp), already
// cropped and resized by the browser.
authRouter.put('/me/avatar', requireAuth, express.raw({ type: Object.keys(IMAGE_SIGNATURES), limit: MAX_AVATAR_BYTES }), asyncHandler(async (req, res) => {
  const type = req.get('content-type')?.split(';')[0].trim().toLowerCase();
  const data = req.body;
  if (!Buffer.isBuffer(data) || !data.length || !IMAGE_SIGNATURES[type]?.(data)) {
    throw AppError.badRequest('Upload a JPEG, PNG or WebP image', { code: 'BAD_IMAGE' });
  }
  await Avatar.findOneAndUpdate({ user: req.user._id }, { data, contentType: type }, { upsert: true });
  req.user.avatarUpdatedAt = new Date();
  await req.user.save();
  res.json({ user: req.user });
}));

authRouter.delete('/me/avatar', requireAuth, asyncHandler(async (req, res) => {
  await Avatar.deleteOne({ user: req.user._id });
  req.user.avatarUpdatedAt = null;
  await req.user.save();
  res.json({ user: req.user });
}));
