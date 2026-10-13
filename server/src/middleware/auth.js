import jwt from 'jsonwebtoken';
import { env, isProd } from '../config/env.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';

export const AUTH_COOKIE = 'seatlock_token';
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

// httpOnly keeps the token out of reach of injected scripts; sameSite=lax
// blocks it from being sent on cross-site POSTs (CSRF).
export function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch {
    return null;
  }
}

// Re-reads the user on every request so a deleted account or changed role
// takes effect immediately rather than when the token expires.
export async function requireAuth(req, _res, next) {
  const payload = verifyToken(req.cookies?.[AUTH_COOKIE]);
  if (!payload) return next(AppError.unauthorized());
  const user = await User.findById(payload.sub).select('+passwordChangedAt');
  const revoked = user?.passwordChangedAt && payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000);
  if (!user || revoked) return next(AppError.unauthorized('Your session is no longer valid. Please log in again.'));
  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(AppError.unauthorized());
  if (!roles.includes(req.user.role)) return next(AppError.forbidden(`This action requires a ${roles.join(' or ')} account`));
  next();
};
