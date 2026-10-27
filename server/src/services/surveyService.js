import { Event, seriesKey } from '../models/Event.js';
import { Survey } from '../models/Survey.js';
import { SurveyResponse } from '../models/SurveyResponse.js';
import { Ticket } from '../models/Ticket.js';
import { AppError } from '../utils/AppError.js';

// Attendees can fill the form from the moment they're scanned in until this
// long after the show; after that the organizer's results are final.
export const RESPONSES_OPEN_DAYS = 30;
// "How everyone answered" stays hidden below this many responses, so a single
// person's answers can't be picked out.
export const MIN_SHARED_RESPONSES = 3;

const showsOf = (key) => Event.find({ $or: [{ _id: key }, { seriesId: key }] }, '_id startsAt durationMinutes').lean();

/**
 * The showtime of this production the user was scanned in at, or null. Only
 * people who actually came get the form (same rule as reviews).
 */
export async function attendedShowtime(user, key) {
  const shows = await showsOf(key);
  const ticket = await Ticket.findOne({ user: user._id, event: { $in: shows.map((s) => s._id) }, checkedInAt: { $ne: null } }, 'event').lean();
  return ticket ? shows.find((s) => String(s._id) === String(ticket.event)) : null;
}

const closesAt = (show) => new Date(new Date(show.startsAt).getTime() + (show.durationMinutes ?? 0) * 60_000 + RESPONSES_OPEN_DAYS * 86_400_000);

// Same questions in the same order with the same options: answers stay meaningful.
const sameShape = (a, b) => a.length === b.length && a.every((q, i) => q.kind === b[i].kind && JSON.stringify(q.options ?? []) === JSON.stringify(b[i].options ?? []));

/**
 * Create or update the form. Once anyone has answered, the questions' types
 * and options are locked (their wording can still be polished), otherwise
 * earlier answers would stop lining up with the questions.
 */
export async function saveSurvey(event, organizer, { title, intro, questions }) {
  const key = seriesKey(event);
  const existing = await Survey.findOne({ series: key });
  if (existing && (await SurveyResponse.exists({ survey: existing._id }))) {
    if (!sameShape(existing.questions, questions)) {
      throw AppError.conflict('People have already answered, so questions can’t be added, removed or changed type now. You can still reword them.', { code: 'QUESTIONS_LOCKED' });
    }
    existing.title = title;
    existing.intro = intro;
    existing.questions.forEach((q, i) => { q.label = questions[i].label; q.required = questions[i].required; });
    return existing.save();
  }
  return Survey.findOneAndUpdate(
    { series: key },
    { series: key, organizer: organizer._id, title, intro, questions, insights: null },
    { upsert: true, returnDocument: 'after', runValidators: true },
  );
}

// Checks every answer against its question; returns the cleaned answers.
function validateAnswers(survey, answers) {
  const given = new Map(answers.map((a) => [String(a.question), a.value]));
  const problems = [];
  const clean = [];
  for (const q of survey.questions) {
    let v = given.get(String(q._id));
    if (typeof v === 'string') v = v.trim();
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) {
      if (q.required) problems.push({ field: String(q._id), message: 'Please answer this one' });
      continue;
    }
    const bad = (message) => problems.push({ field: String(q._id), message });
    if (q.kind === 'rating' && !(Number.isInteger(v) && v >= 1 && v <= 5)) bad('Pick 1 to 5 stars');
    else if (q.kind === 'nps' && !(Number.isInteger(v) && v >= 0 && v <= 10)) bad('Pick a number from 0 to 10');
    else if (q.kind === 'choice' && !q.options.includes(v)) bad('Pick one of the options');
    else if (q.kind === 'multi' && !(Array.isArray(v) && v.every((x) => q.options.includes(x)))) bad('Pick from the options');
    else if (q.kind === 'text' && (typeof v !== 'string' || v.length > 1000)) bad('Keep it under 1000 characters');
    if (q.kind === 'multi' && Array.isArray(v)) v = [...new Set(v)];
    clean.push({ question: q._id, value: v });
  }
  if (problems.length) throw AppError.badRequest('Some answers need another look', { code: 'VALIDATION_ERROR', details: problems });
  return clean;
}

/**
 * What an attendee sees: the form, their own answers if they've sent them,
 * whether they can (still) answer, and once they have, how everyone answered.
 */
export async function surveyForAttendee(event, user) {
  const survey = await Survey.findOne({ series: seriesKey(event) }).lean();
  if (!survey) return { survey: null };
  const show = user ? await attendedShowtime(user, seriesKey(event)) : null;
  const mine = user ? await SurveyResponse.findOne({ survey: survey._id, user: user._id }).lean() : null;
  const open = Boolean(show) && Date.now() < closesAt(show).getTime();
  return {
    survey: { _id: survey._id, title: survey.title, intro: survey.intro, questions: survey.questions },
    attended: Boolean(show),
    canRespond: open,
    closesAt: show ? closesAt(show) : null,
    myAnswers: mine?.answers ?? null,
    everyone: mine ? await sharedResults(survey) : null,
  };
}

export async function submitResponse(event, user, answers) {
  const survey = await Survey.findOne({ series: seriesKey(event) });
  if (!survey) throw AppError.notFound('Feedback form');
  const show = await attendedShowtime(user, seriesKey(event));
  if (!show) throw AppError.forbidden('Only people who were checked in at the show can fill in its feedback form');
  if (Date.now() >= closesAt(show).getTime()) throw AppError.conflict('This feedback form has closed', { code: 'SURVEY_CLOSED' });
  const clean = validateAnswers(survey, answers);
  // Answering again just updates your answers.
  await SurveyResponse.findOneAndUpdate(
    { survey: survey._id, user: user._id },
    { survey: survey._id, event: show._id, user: user._id, answers: clean },
    { upsert: true },
  );
  return surveyForAttendee(event, user);
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Per-question numbers for a set of responses. Text answers are only included
 * when `withText` is set (the organizer's view), never in what attendees see.
 */
export function aggregate(survey, responses, { withText = false } = {}) {
  const byQuestion = new Map(survey.questions.map((q) => [String(q._id), []]));
  for (const r of responses) for (const a of r.answers) byQuestion.get(String(a.question))?.push(a.value);
  return survey.questions.map((q) => {
    const values = byQuestion.get(String(q._id));
    const base = { _id: q._id, kind: q.kind, label: q.label, answered: values.length };
    if (q.kind === 'rating') {
      const counts = [1, 2, 3, 4, 5].map((n) => values.filter((v) => v === n).length);
      return { ...base, average: values.length ? round1(values.reduce((s, v) => s + v, 0) / values.length) : null, counts };
    }
    if (q.kind === 'nps') {
      const promoters = values.filter((v) => v >= 9).length;
      const detractors = values.filter((v) => v <= 6).length;
      const counts = Array.from({ length: 11 }, (_, n) => values.filter((v) => v === n).length);
      return { ...base, score: values.length ? Math.round(((promoters - detractors) / values.length) * 100) : null, promoters, passives: values.length - promoters - detractors, detractors, counts };
    }
    if (q.kind === 'choice' || q.kind === 'multi') {
      return { ...base, options: q.options.map((o) => ({ option: o, count: values.filter((v) => (Array.isArray(v) ? v.includes(o) : v === o)).length })) };
    }
    return withText ? { ...base, answers: values.slice(-100).reverse() } : base;
  });
}

async function sharedResults(survey) {
  const responses = await SurveyResponse.find({ survey: survey._id }, 'answers').lean();
  if (responses.length < MIN_SHARED_RESPONSES) return { responses: responses.length, hidden: true, minimum: MIN_SHARED_RESPONSES };
  return { responses: responses.length, questions: aggregate(survey, responses) };
}

/** The organizer's full results: every number, the written answers and who could have answered. */
export async function surveyResults(survey) {
  const responses = await SurveyResponse.find({ survey: survey._id }, 'answers createdAt').lean();
  const shows = await showsOf(survey.series);
  const attendees = (await Ticket.distinct('user', { event: { $in: shows.map((s) => s._id) }, checkedInAt: { $ne: null } })).length;
  return { responses: responses.length, attendees, questions: aggregate(survey, responses, { withText: true }) };
}
