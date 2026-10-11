import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { env, isProd } from '../config/env.js';
import { runInBackground } from '../utils/background.js';

const OUTBOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.mail-outbox');
const isTest = env.NODE_ENV === 'test';

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
  if (isProd && !env.SMTP_URL) {
    // No provider configured: don't pile .eml files onto a server's disk.
    console.warn(`[mail] SMTP_URL is not set; skipped "${message.subject}" to ${message.to}`);
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
