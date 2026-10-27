import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const client = new OAuth2Client();
const invalid = () => new AppError(401, 'Google sign-in didn’t go through. Please try again.', { code: 'GOOGLE_TOKEN_INVALID' });

/**
 * Checks the access token from our "Continue with Google" popup with Google
 * itself (tokeninfo). It has to be live and issued to *our* client ID, so a
 * token some other app was given can't be replayed here, and Google has to
 * have verified the email, since accounts are matched by email. The display
 * name comes from Google's userinfo endpoint with the same token.
 */
export async function verifyGoogleAccessToken(accessToken) {
  let info;
  try {
    info = await client.getTokenInfo(accessToken);
  } catch {
    throw invalid();
  }
  if (info.aud !== env.GOOGLE_CLIENT_ID || !info.sub) throw invalid();
  if (!info.email || String(info.email_verified) !== 'true') {
    throw new AppError(401, 'Your Google account’s email isn’t verified yet', { code: 'GOOGLE_EMAIL_UNVERIFIED' });
  }

  let name = info.email.split('@')[0];
  try {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) name = (await res.json()).name?.trim() || name;
  } catch { /* keep the name from the email address */ }

  return { googleId: info.sub, email: info.email.toLowerCase(), name };
}
