import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';

/**
 * Signs in with a verified Google profile. Returning Google users are found by
 * their Google ID; someone who already has a password account with the same
 * (Google-verified) email gets Google linked to it; anyone else gets a new
 * account with the role they picked. Returns { user, created }.
 */
export async function signInWithGoogle({ googleId, email, name }, role) {
  const known = await User.findOne({ googleId });
  if (known) return { user: known, created: false };

  const linked = await User.findOneAndUpdate({ email, googleId: null }, { googleId }, { returnDocument: 'after' });
  if (linked) return { user: linked, created: false };

  try {
    const user = await User.create({ name: name.slice(0, 80), email, role, googleId, hasPassword: false });
    return { user, created: true };
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Two first sign-ins raced; the other one created the account.
    const user = await User.findOne({ email }).select('+googleId');
    if (user?.googleId === googleId) return { user, created: false };
    throw AppError.conflict('This email is already linked to a different Google account', { code: 'GOOGLE_ACCOUNT_MISMATCH' });
  }
}
