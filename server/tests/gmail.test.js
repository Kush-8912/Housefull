import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { sendMail, gmailEnabled } from '../src/services/mailer.js';
import { backgroundIdle } from '../src/utils/background.js';

// Stand-ins for Google's token endpoint and the Gmail API's messages.send.
let calls;
let sent;
let tokenGrants;
function fakeGoogle(url, init = {}) {
  const json = (status, data) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }));
  calls.push(url);
  if (url === 'https://oauth2.googleapis.com/token') {
    const form = new URLSearchParams(init.body);
    if (form.get('refresh_token') !== 'good-refresh-token') return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    tokenGrants += 1;
    return json(200, { access_token: `access-${tokenGrants}`, expires_in: 3599, token_type: 'Bearer' });
  }
  if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
    sent.push({ auth: init.headers.authorization, raw: Buffer.from(JSON.parse(init.body).raw, 'base64url').toString('utf8') });
    return json(200, { id: `msg-${sent.length}`, labelIds: ['SENT'] });
  }
  return json(404, {});
}

beforeEach(() => {
  calls = [];
  sent = [];
  tokenGrants = 0;
  env.GMAIL_CLIENT_ID = 'client.apps.googleusercontent.com';
  env.GMAIL_CLIENT_SECRET = 'client-secret';
  env.GMAIL_REFRESH_TOKEN = 'good-refresh-token';
  vi.stubGlobal('fetch', vi.fn(fakeGoogle));
});
afterEach(() => {
  delete env.GMAIL_CLIENT_ID;
  delete env.GMAIL_CLIENT_SECRET;
  delete env.GMAIL_REFRESH_TOKEN;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const message = (n) => ({
  to: 'buyer@example.com',
  subject: `New time: Show ${n} — ₹899`,
  html: '<p>Your show has moved.</p>',
  text: 'Your show has moved.',
  attachments: [{ filename: 'qr.png', content: Buffer.from('png-bytes'), cid: 'qr-1@housefull' }],
});

describe('Gmail API mailer', () => {
  it('sends the full MIME message over HTTPS, reusing the access token', async () => {
    expect(gmailEnabled()).toBe(true);
    sendMail(message(1));
    await backgroundIdle();
    sendMail(message(2));
    await backgroundIdle();

    expect(sent).toHaveLength(2);
    expect(tokenGrants).toBe(1); // the second email reused the cached token
    expect(sent[0].auth).toBe('Bearer access-1');
    expect(sent[0].raw).toMatch(/^To: buyer@example\.com/m);
    expect(sent[0].raw).toMatch(/^From: Housefull/m);
    expect(sent[0].raw).toMatch(/Content-Type: text\/html/);
    expect(sent[0].raw).toMatch(/Content-ID: <qr-1@housefull>/);
  });

  it('logs a clear error (and never throws) when the refresh token is revoked', async () => {
    env.GMAIL_REFRESH_TOKEN = 'revoked-token';
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendMail(message(3));
    await backgroundIdle();
    expect(sent).toHaveLength(0);
    expect(log).toHaveBeenCalledWith('[mail]', expect.stringContaining('Gmail token refresh failed: Token has been expired or revoked.'));
  });

  it('is off without a refresh token', () => {
    delete env.GMAIL_REFRESH_TOKEN;
    expect(gmailEnabled()).toBe(false);
  });
});
