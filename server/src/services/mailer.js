import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { env, isProd } from '../config/env.js';
import { runInBackground } from '../utils/background.js';

const OUTBOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.mail-outbox');
const isTest = env.NODE_ENV === 'test';

// Gmail API (HTTPS) when its keys are set; it beats SMTP_URL because it also
// works on hosts that block SMTP ports.
const gmailClientId = () => env.GMAIL_CLIENT_ID || env.GOOGLE_CLIENT_ID;
export const gmailEnabled = () => Boolean(gmailClientId() && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);
const configured = () => gmailEnabled() || Boolean(env.SMTP_URL);

// The full MIME message (HTML, text, inline QR codes) is built by nodemailer either way.
const mime = nodemailer.createTransport({ streamTransport: true, buffer: true });

let gmailToken = null; // { value, expiresAt, refreshToken }
async function gmailAccessToken() {
  const fresh = gmailToken?.refreshToken === env.GMAIL_REFRESH_TOKEN && gmailToken.expiresAt > Date.now() + 60_000;
  if (fresh) return gmailToken.value;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: gmailClientId(),
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${data.error_description ?? data.error ?? res.status}`);
  gmailToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000, refreshToken: env.GMAIL_REFRESH_TOKEN };
  return gmailToken.value;
}

async function sendWithGmail(message) {
  const { message: raw } = await mime.sendMail(message);
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${await gmailAccessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: raw.toString('base64url') }),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) gmailToken = null; // revoked or expired early: fetch a new one next time
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Gmail API ${res.status}: ${data.error?.message ?? 'send failed'}`);
  }
}

let transport;
function getTransport() {
  if (!transport) {
    if (env.SMTP_URL) transport = nodemailer.createTransport(env.SMTP_URL);
    else if (isTest) transport = nodemailer.createTransport({ jsonTransport: true });
    else transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  }
  return transport;
}

// Messages "sent" during tests, for assertions.
export const testOutbox = [];

async function deliver(message) {
  if (isProd && !configured()) {
    // No provider configured: don't pile .eml files onto a server's disk.
    console.warn(`[mail] no mail provider (GMAIL_* or SMTP_URL) is set; skipped "${message.subject}" to ${message.to}`);
    return;
  }
  if (gmailEnabled()) {
    await sendWithGmail({ from: env.MAIL_FROM, ...message });
    if (isTest) testOutbox.push(message);
    return;
  }
  const info = await getTransport().sendMail({ from: env.MAIL_FROM, ...message });
  if (isTest) {
    testOutbox.push(message);
  } else if (!env.SMTP_URL) {
    await fs.mkdir(OUTBOX, { recursive: true });
    const slug = message.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const file = path.join(OUTBOX, `${Date.now()}-${slug}.eml`);
    await fs.writeFile(file, info.message);
    console.log(`[mail] ${message.to} · "${message.subject}" saved to ${path.relative(process.cwd(), file)}`);
  }
}

/**
 * Send an email in the background. Email is a side channel: a slow or broken
 * mail server must never fail or delay the request that triggered it.
 * Accepts the message or an async function that builds it.
 */
export function sendMail(message) {
  runInBackground('mail', async () => {
    const m = typeof message === 'function' ? await message() : message;
    try {
      await deliver(m);
    } catch (err) {
      throw new Error(`failed to send "${m.subject}" to ${m.to}: ${err.message}`);
    }
  });
}
