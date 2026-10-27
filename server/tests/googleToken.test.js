import { describe, it, expect, beforeEach, vi } from 'vitest';
import { verifyGoogleAccessToken } from '../src/services/googleToken.js';

// Stand-ins for Google's tokeninfo (via google-auth-library) and userinfo endpoints.
const { getTokenInfo } = vi.hoisted(() => ({ getTokenInfo: vi.fn() }));
vi.mock('google-auth-library', () => ({ OAuth2Client: class { getTokenInfo = getTokenInfo; } }));

const OURS = 'test-client.apps.googleusercontent.com'; // GOOGLE_CLIENT_ID in setupEnv.js
const tokenInfo = (extra) => ({ aud: OURS, azp: OURS, sub: '1098', email: 'Meera@Gmail.com', email_verified: 'true', scopes: ['openid'], ...extra });
const code = async (promise) => (await promise.catch((e) => e)).code;

beforeEach(() => {
  getTokenInfo.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ name: 'Meera K' }) })));
});

describe('verifyGoogleAccessToken', () => {
  it('returns the Google profile for a live token issued to this app', async () => {
    getTokenInfo.mockResolvedValue(tokenInfo());
    expect(await verifyGoogleAccessToken('t')).toEqual({ googleId: '1098', email: 'meera@gmail.com', name: 'Meera K' });
  });

  it('refuses a token Google issued to a different app', async () => {
    getTokenInfo.mockResolvedValue(tokenInfo({ aud: 'someone-else.apps.googleusercontent.com' }));
    expect(await code(verifyGoogleAccessToken('t'))).toBe('GOOGLE_TOKEN_INVALID');
  });

  it('refuses tokens Google rejects (expired, revoked, made up)', async () => {
    getTokenInfo.mockRejectedValue(new Error('invalid_token'));
    expect(await code(verifyGoogleAccessToken('t'))).toBe('GOOGLE_TOKEN_INVALID');
  });

  it('refuses an account whose email Google hasn’t verified', async () => {
    getTokenInfo.mockResolvedValue(tokenInfo({ email_verified: 'false' }));
    expect(await code(verifyGoogleAccessToken('t'))).toBe('GOOGLE_EMAIL_UNVERIFIED');
  });

  it('falls back to the email address for a name when userinfo is down', async () => {
    getTokenInfo.mockResolvedValue(tokenInfo());
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect((await verifyGoogleAccessToken('t')).name).toBe('Meera');
  });
});
