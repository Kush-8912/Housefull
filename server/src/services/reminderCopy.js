import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { env } from '../config/env.js';
import { Event } from '../models/Event.js';

// The words in an event's reminder email. Claude writes them once per event
// when ANTHROPIC_API_KEY is set; otherwise (or if the call fails) a hand-written
// version is used, so reminders never depend on the AI being available.

const MODEL = 'claude-opus-5-5';

const CopySchema = z.object({
  subject: z.string().describe('Email subject line, under 60 characters, may include one emoji'),
  preheader: z.string().describe('Inbox preview text, under 90 characters'),
  headline: z.string().describe('Big headline at the top of the email, 2 to 6 words'),
  intro: z.string().describe('2 or 3 sentences building excitement for this specific event'),
  tips: z.array(z.string()).describe('2 or 3 short, practical "before you go" tips'),
});

const SYSTEM = `You write the reminder email a ticketing app sends the day before an event.
Tone: warm, energetic and specific to this event, like a friend who's excited for you. Plain English, no hype words like "unforgettable" or "magical", at most one emoji in total.
Only use facts given in the event details. Never invent performers, set times, prices, parking, dress codes or anything else not stated.
Tips must be practical and true for any event of this kind (arrive a little early, have the QR ticket ready on your phone, check the venue's location), adapted to the category.
Do not greet the reader by name and do not mention seats; the app adds those.
Do not say "tomorrow", "tonight", "this weekend" or any other relative day: the email can arrive several days before the event. Refer to the date if you need to.`;

const when = (d) => new Intl.DateTimeFormat('en-IN', {
  weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
}).format(new Date(d));

// Calendar days from now until the event, counted in India time.
const istDay = (d) => Math.floor((new Date(d).getTime() + 5.5 * 3_600_000) / 86_400_000);
const weekday = (d) => new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(new Date(d));
const dayMonth = (d) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(d));

// "Today" / "Tomorrow" / "Friday" / "18 Oct", depending on how far away it is.
function relativeDay(startsAt, now = new Date()) {
  const days = istDay(startsAt) - istDay(now);
  if (days <= 0) return { label: 'Today', phrase: 'today' };
  if (days === 1) return { label: 'Tomorrow', phrase: 'tomorrow' };
  if (days < 7) return { label: weekday(startsAt), phrase: `on ${weekday(startsAt)}` };
  return { label: dayMonth(startsAt), phrase: `on ${dayMonth(startsAt)}` };
}

export function fallbackCopy(event, now = new Date()) {
  const day = relativeDay(event.startsAt, now);
  return {
    subject: `${day.label}: ${event.title}`.slice(0, 70),
    preheader: `${when(event.startsAt)} at ${event.venue.name}. Your tickets are ready.`,
    headline: `See you ${day.phrase}`,
    intro: `${event.title} is almost here. Doors are at ${event.venue.name}, ${event.venue.city}, and your seats are waiting.`,
    tips: [
      'Arrive 20 minutes early so you’re in your seat before it starts.',
      'Keep your QR ticket open on your phone (turn the brightness up) for a quick scan at the door.',
      `Check the way to ${event.venue.name} before you leave.`,
    ],
    source: 'template',
  };
}

let client;
const getClient = () => (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 2 }));

async function writeWithClaude(event) {
  const details = [
    `Title: ${event.title}`,
    `Category: ${event.category}`,
    `When: ${when(event.startsAt)} (India time), about ${event.durationMinutes} minutes`,
    `Venue: ${event.venue.name}, ${event.venue.city}`,
    event.description && `Description from the organizer: ${event.description}`,
  ].filter(Boolean).join('\n');

  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(CopySchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Write the reminder email for this event.\n\n${details}` }],
  });

  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new Error(`no usable copy (stop_reason: ${response.stop_reason})`);
  }
  const copy = response.parsed_output;
  return {
    subject: copy.subject.trim().slice(0, 90),
    preheader: copy.preheader.trim().slice(0, 140),
    headline: copy.headline.trim().slice(0, 60),
    intro: copy.intro.trim().slice(0, 600),
    tips: copy.tips.map((t) => t.trim()).filter(Boolean).slice(0, 3),
    source: response.model,
  };
}

/**
 * The reminder copy for an event. Claude's version is generated once and
 * stored on the event, so every attendee gets the same email and the API is
 * called once per event. The template is rebuilt each time instead of stored,
 * so adding an API key later still upgrades events that haven't started.
 */
export async function reminderCopyFor(event) {
  if (event.reminderCopy?.subject) return event.reminderCopy;
  if (!env.ANTHROPIC_API_KEY) return fallbackCopy(event);
  try {
    const copy = { ...(await writeWithClaude(event)), generatedAt: new Date() };
    await Event.updateOne({ _id: event._id }, { reminderCopy: copy });
    return copy;
  } catch (err) {
    console.error(`[reminders] Claude copy failed for "${event.title}", using the template:`, err?.message ?? err);
    return fallbackCopy(event);
  }
}
