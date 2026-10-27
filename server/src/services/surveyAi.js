import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { env } from '../config/env.js';

// The two AI helpers behind feedback forms: drafting questions for an event,
// and turning the answers into a summary the organizer can act on. Both use
// Claude when ANTHROPIC_API_KEY is set and fall back to built-in versions
// otherwise (or if the call fails), like the reminder emails do.

const MODEL = 'claude-opus-5-5';
let client;
const getClient = () => (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 2 }));

async function ask({ system, prompt, schema, maxTokens = 3000 }) {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) throw new Error(`no usable output (stop_reason: ${response.stop_reason})`);
  return { output: response.parsed_output, model: response.model };
}

// ---- Suggested questions ------------------------------------------------------

const WHAT_WORKED = {
  music: ['The music and the band', 'Sound quality', 'The crowd and atmosphere', 'The venue'],
  comedy: ['The headliner', 'The opening acts', 'The crowd and atmosphere', 'The venue'],
  theatre: ['The acting', 'The story', 'Sets, costumes and lighting', 'The venue'],
  sports: ['The match itself', 'The view from my seat', 'The atmosphere', 'Food and drinks'],
  tech: ['The talks', 'Meeting people', 'The workshops', 'The venue and food'],
  workshop: ['What I learnt', 'The instructor', 'Materials and setup', 'Pace of the session'],
  other: ['The main event', 'The atmosphere', 'The venue', 'Value for money'],
};

/** A sensible starter form for this kind of event. */
export function templateQuestions(event) {
  return [
    { kind: 'rating', label: 'Overall, how was the show?', options: [], required: true },
    { kind: 'nps', label: 'How likely are you to recommend this to a friend?', options: [], required: true },
    { kind: 'multi', label: 'What did you enjoy most?', options: WHAT_WORKED[event.category] ?? WHAT_WORKED.other, required: false },
    { kind: 'rating', label: 'How was the venue (seating, sound, getting in)?', options: [], required: false },
    { kind: 'choice', label: 'Would you come to our next show?', options: ['Definitely', 'Maybe', 'Probably not'], required: false },
    { kind: 'text', label: 'What should we do better next time?', options: [], required: false },
  ];
}

const QuestionsSchema = z.object({
  questions: z.array(z.object({
    kind: z.enum(['rating', 'nps', 'choice', 'multi', 'text']),
    label: z.string().describe('The question, under 120 characters, plain and friendly'),
    options: z.array(z.string()).describe('2 to 6 short options for choice/multi questions; empty for the other kinds'),
    required: z.boolean(),
  })).describe('5 or 6 questions'),
});

export async function suggestQuestions(event) {
  if (!env.ANTHROPIC_API_KEY) return { questions: templateQuestions(event), source: 'template' };
  try {
    const { output, model } = await ask({
      system: `You design short post-event feedback forms for a ticketing app's organizers. Questions are answered on a phone in under two minutes by people who just attended.
Use a mix of kinds: rating (1-5 stars), nps (0-10 likelihood to recommend, at most one), choice (pick one), multi (pick several) and text (free answer, at most two). Start with an overall rating and make it required; make at most two others required.
Make the questions specific to this event's category and details, but never invent facts (performer names, sessions, food) that aren't in the details.`,
      prompt: `Draft a feedback form for this event.\nTitle: ${event.title}\nCategory: ${event.category}\nVenue: ${event.venue.name}, ${event.venue.city}${event.description ? `\nDescription: ${event.description}` : ''}`,
      schema: QuestionsSchema,
    });
    const questions = output.questions.slice(0, 8).map((q) => ({
      kind: q.kind,
      label: q.label.trim().slice(0, 140),
      options: ['choice', 'multi'].includes(q.kind) ? q.options.map((o) => o.trim().slice(0, 60)).filter(Boolean).slice(0, 8) : [],
      required: Boolean(q.required),
    })).filter((q) => !['choice', 'multi'].includes(q.kind) || q.options.length >= 2);
    if (questions.length < 3) throw new Error('too few usable questions');
    return { questions, source: model };
  } catch (err) {
    console.error('[feedback] Claude suggestions failed, using the template:', err?.message ?? err);
    return { questions: templateQuestions(event), source: 'template' };
  }
}

// ---- Insights -------------------------------------------------------------------

const InsightsSchema = z.object({
  headline: z.string().describe('One line, under 80 characters, that sums up how the show landed'),
  sentiment: z.enum(['positive', 'mixed', 'negative']),
  summary: z.string().describe('2 or 3 sentences for the organizer, citing the numbers that matter'),
  loved: z.array(z.string()).describe('Up to 4 things attendees clearly liked, each one short sentence grounded in the data'),
  improve: z.array(z.string()).describe('Up to 4 things to fix, most important first, each grounded in the data'),
  quotes: z.array(z.string()).describe('Up to 3 short quotes copied exactly, word for word, from the written answers'),
  actions: z.array(z.string()).describe('Up to 3 concrete next steps for the next show'),
});

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

// The results as plain text for the prompt.
function describe(results) {
  const lines = [`Responses: ${results.responses} of ${results.attendees} people who were checked in.`];
  for (const q of results.questions) {
    if (q.kind === 'rating') lines.push(`[rating] ${q.label}: average ${q.average ?? '-'}/5 from ${q.answered} answers (1★..5★: ${q.counts.join(', ')})`);
    else if (q.kind === 'nps') lines.push(`[nps] ${q.label}: NPS ${q.score ?? '-'} (${q.promoters} promoters, ${q.passives} passives, ${q.detractors} detractors)`);
    else if (q.kind === 'choice' || q.kind === 'multi') lines.push(`[${q.kind}] ${q.label}: ${q.options.map((o) => `${o.option} ${o.count}`).join('; ')} (${q.answered} answered)`);
    else lines.push(`[text] ${q.label}:\n${(q.answers ?? []).slice(0, 60).map((a) => `- ${a.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n') || '(no answers)'}`);
  }
  return lines.join('\n');
}

// Things people commonly write about after a show, for spotting recurring
// themes in written answers without AI.
const THEMES = [
  ['the sound', /\b(sound|audio|hear|heard|loud|quiet|mic|speakers?)\b/i],
  ['getting in (queues at the door)', /\b(queues?|lines?|entry|entrance|doors?|waited|waiting|security)\b/i],
  ['food and drinks', /\b(food|drinks?|bar|menu|snacks?|service)\b/i],
  ['seating and the view', /\b(seats?|seating|chairs?|tables?|view|cramped|legroom)\b/i],
  ['timing', /\b(late|delay(ed)?|started|start time|too long|too short|overran)\b/i],
  ['price', /\b(price|pricey|expensive|cost|value)\b/i],
];

// How many written answers bring up each theme, most mentioned first.
export function themesIn(texts) {
  return THEMES.map(([label, re]) => ({ label, count: texts.filter((t) => re.test(t)).length }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * The numbers read out without AI: best and worst rated questions, the NPS,
 * the most picked options, themes that keep coming up in the written answers,
 * and the longest written answers as quotes.
 */
export function builtInInsights(results) {
  const ratings = results.questions.filter((q) => q.kind === 'rating' && q.average != null).sort((a, b) => b.average - a.average);
  const nps = results.questions.find((q) => q.kind === 'nps' && q.score != null);
  const overall = ratings.length ? ratings.reduce((s, q) => s + q.average, 0) / ratings.length : null;
  const sentiment = overall == null ? (nps ? (nps.score >= 30 ? 'positive' : nps.score >= 0 ? 'mixed' : 'negative') : 'mixed')
    : overall >= 4.2 ? 'positive' : overall >= 3.4 ? 'mixed' : 'negative';
  const loved = [];
  const improve = [];
  for (const q of ratings) {
    if (q.average >= 4) loved.push(`“${q.label}” averaged ${q.average}/5.`);
    else if (q.average < 3.6) improve.push(`“${q.label}” averaged only ${q.average}/5 — the weakest score.`);
  }
  for (const q of results.questions.filter((x) => (x.kind === 'choice' || x.kind === 'multi') && x.answered)) {
    const top = [...q.options].sort((a, b) => b.count - a.count)[0];
    if (top?.count) loved.push(`For “${q.label}”, ${pct(top.count, q.answered)}% picked “${top.option}”.`);
  }
  if (nps) (nps.score >= 30 ? loved : improve).push(`Net Promoter Score is ${nps.score} (${nps.promoters} would recommend, ${nps.detractors} wouldn’t).`);
  const texts = results.questions.filter((q) => q.kind === 'text').flatMap((q) => q.answers ?? []);
  const themes = themesIn(texts).slice(0, 3);
  for (const t of themes) improve.push(`${t.count} of ${texts.length} written answer${texts.length === 1 ? '' : 's'} ${t.count === 1 ? 'brings' : 'bring'} up ${t.label}.`);
  const quotes = texts
    .filter((a) => a.length >= 20).sort((a, b) => b.length - a.length).slice(0, 3).map((a) => (a.length > 180 ? `${a.slice(0, 177)}…` : a));
  const weakest = ratings.at(-1);
  const actions = [
    weakest && weakest.average < 4 && `Look into “${weakest.label}” first; it scored lowest at ${weakest.average}/5.`,
    themes[0] && `Check ${themes[0].label} before the next show: ${themes[0].count === 1 ? 'someone' : `${themes[0].count} people`} brought it up.`,
    results.attendees && pct(results.responses, results.attendees) < 30 && 'Fewer than a third of attendees answered: mention the form at the end of the show next time.',
    nps && nps.detractors > 0 && `Follow up on why ${nps.detractors} ${nps.detractors === 1 ? 'person' : 'people'} wouldn’t recommend it (see the written answers).`,
  ].filter(Boolean);
  const headline = { positive: 'Your audience loved it', mixed: 'A good night with a few rough edges', negative: 'This one didn’t land well' }[sentiment];
  const summary = [
    `${results.responses} of ${results.attendees} attendees answered (${pct(results.responses, results.attendees)}%).`,
    overall != null && `Ratings averaged ${Math.round(overall * 10) / 10}/5 across ${ratings.length} question${ratings.length > 1 ? 's' : ''}.`,
    nps && `NPS is ${nps.score}.`,
  ].filter(Boolean).join(' ');
  return { headline, sentiment, summary, loved: loved.slice(0, 4), improve: improve.slice(0, 4), quotes, actions: actions.slice(0, 3) };
}

/** Claude's read of the results, or the built-in one. Quotes are checked to be real. */
export async function writeInsights(event, results) {
  const base = { responses: results.responses, generatedAt: new Date() };
  if (!results.responses) return { ...base, ...builtInInsights(results), source: 'built-in' };
  if (!env.ANTHROPIC_API_KEY) return { ...base, ...builtInInsights(results), source: 'built-in' };
  try {
    const { output, model } = await ask({
      system: `You analyse the answers to an event's feedback form for its organizer. Be direct and practical, like a sharp producer debriefing after the show.
Ground every point in the numbers or written answers given; never invent facts, names or numbers. If there are few responses, say the picture is early.
Quotes must be copied exactly from the written answers. Do not include anything that could identify a person.`,
      prompt: `Event: ${event.title} (${event.category}) at ${event.venue.name}, ${event.venue.city}.\n\n${describe(results)}`,
      schema: InsightsSchema,
    });
    const said = results.questions.filter((q) => q.kind === 'text').flatMap((q) => q.answers ?? []).join('\n').replace(/\s+/g, ' ');
    return {
      ...base,
      headline: output.headline.trim().slice(0, 120),
      sentiment: output.sentiment,
      summary: output.summary.trim().slice(0, 600),
      loved: output.loved.map((s) => s.trim()).filter(Boolean).slice(0, 4),
      improve: output.improve.map((s) => s.trim()).filter(Boolean).slice(0, 4),
      quotes: output.quotes.map((s) => s.trim().replace(/^["“]|["”]$/g, '')).filter((q) => q && said.includes(q.replace(/\s+/g, ' '))).slice(0, 3),
      actions: output.actions.map((s) => s.trim()).filter(Boolean).slice(0, 3),
      source: model,
    };
  } catch (err) {
    console.error(`[feedback] Claude insights failed for "${event.title}", using the built-in summary:`, err?.message ?? err);
    return { ...base, ...builtInInsights(results), source: 'built-in' };
  }
}
