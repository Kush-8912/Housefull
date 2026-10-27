import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startDb, stopDb, clearDb, app, signUp, publishedEvent } from './helpers.js';
import { Event } from '../src/models/Event.js';
import { builtInInsights } from '../src/services/surveyAi.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const HOUR = 3_600_000;
const card = { number: '4242 4242 4242 4242', expMonth: 12, expYear: new Date().getFullYear() + 1, cvc: '123', name: 'Buyer' };
let n = 0;
async function buy(buyer, eventId, seat) {
  const { body } = await buyer.agent.post(`/api/events/${eventId}/holds`).send({ seatIds: [seat.id] });
  const res = await buyer.agent.post(`/api/holds/${body.hold._id}/checkout`).set('Idempotency-Key', `survey-${n++}`).send({ card });
  return res.body;
}
const scan = (org, eventId, ticket) => org.agent.post(`/api/events/${eventId}/checkin`).send({ qr: ticket.qr }).expect(200);

const FORM = {
  title: 'How was the night?',
  intro: 'Two minutes, promise.',
  questions: [
    { kind: 'rating', label: 'Overall, how was it?', required: true },
    { kind: 'nps', label: 'Would you recommend it?' },
    { kind: 'multi', label: 'What did you enjoy?', options: ['Music', 'Crowd', 'Venue'] },
    { kind: 'text', label: 'Anything to improve?' },
  ],
};

// An organizer with a show that has happened, a form, and `people` attendees who came.
async function pastShowWithForm(people = 3) {
  const org = await signUp('organizer');
  const { id, seats } = await publishedEvent(org, { title: 'Feedback Night' });
  const guests = [];
  for (let i = 0; i < people; i++) {
    const guest = await signUp();
    const { tickets } = await buy(guest, id, seats[i]);
    await scan(org, id, tickets[0]);
    guests.push(guest);
  }
  await Event.updateOne({ _id: id }, { startsAt: new Date(Date.now() - 3 * HOUR) });
  const { body } = await org.agent.put(`/api/events/${id}/survey`).send(FORM).expect(200);
  return { org, id, guests, questions: body.survey.questions };
}
const answer = (q, values) => ({ answers: q.map((x, i) => ({ question: x._id, value: values[i] })) });

describe('feedback forms', () => {
  it('only lets people who were checked in answer, and validates answers', async () => {
    const { id, guests, questions } = await pastShowWithForm(1);
    const stranger = await signUp();
    await stranger.agent.post(`/api/events/${id}/survey/responses`).send(answer(questions, [5])).expect(403);
    const { body: view } = await stranger.agent.get(`/api/events/${id}/survey`).expect(200);
    expect(view).toMatchObject({ attended: false, canRespond: false });

    const bad = await guests[0].agent.post(`/api/events/${id}/survey/responses`).send(answer(questions, [7, 11, ['Lasers']])).expect(400);
    expect(bad.body.error.details.map((d) => d.message)).toEqual(['Pick 1 to 5 stars', 'Pick a number from 0 to 10', 'Pick from the options']);
    const missing = await guests[0].agent.post(`/api/events/${id}/survey/responses`).send(answer(questions, [null, 9])).expect(400);
    expect(missing.body.error.details[0].message).toBe('Please answer this one');
  });

  it('shows attendees how everyone answered once enough people have, never the written answers', async () => {
    const { id, guests, questions } = await pastShowWithForm(3);
    const first = await guests[0].agent.post(`/api/events/${id}/survey/responses`).send(answer(questions, [5, 10, ['Music'], 'Louder please'])).expect(200);
    expect(first.body.myAnswers).toHaveLength(4);
    expect(first.body.everyone).toMatchObject({ hidden: true, responses: 1 });

    await guests[1].agent.post(`/api/events/${id}/survey/responses`).send(answer(questions, [4, 8, ['Music', 'Crowd']])).expect(200);
    const third = await guests[2].agent.post(`/api/events/${id}/survey/responses`).send(answer(questions, [2, 3, ['Venue'], 'Seats were cramped'])).expect(200);
    const [overall, nps, enjoyed, text] = third.body.everyone.questions;
    expect(overall).toMatchObject({ average: 3.7, counts: [0, 1, 0, 1, 1] });
    expect(nps).toMatchObject({ score: 0, promoters: 1, passives: 1, detractors: 1 });
    expect(enjoyed.options).toEqual([{ option: 'Music', count: 2 }, { option: 'Crowd', count: 1 }, { option: 'Venue', count: 1 }]);
    expect(text.answers).toBeUndefined();

    // Answering again replaces your answers rather than counting twice.
    await guests[2].agent.post(`/api/events/${id}/survey/responses`).send(answer(questions, [3])).expect(200);
    const again = await guests[2].agent.get(`/api/events/${id}/survey`).expect(200);
    expect(again.body.everyone.responses).toBe(3);
  });

  it('gives the organizer the written answers and a summary, and locks question types once answered', async () => {
    const { org, id, guests, questions } = await pastShowWithForm(2);
    await guests[0].agent.post(`/api/events/${id}/survey/responses`).send(answer(questions, [5, 10, ['Music'], 'Best gig of the year, the encore was unreal'])).expect(200);
    await guests[1].agent.post(`/api/events/${id}/survey/responses`).send(answer(questions, [3, 6, ['Venue'], 'The queue to get in took forever'])).expect(200);

    const { body } = await org.agent.post(`/api/events/${id}/survey/insights`).expect(200);
    expect(body.results).toMatchObject({ responses: 2, attendees: 2 });
    expect(body.results.questions[3].answers).toContain('The queue to get in took forever');
    expect(body.survey.insights).toMatchObject({ source: 'built-in', responses: 2 });
    expect(body.survey.insights.quotes).toContain('Best gig of the year, the encore was unreal');

    const reworded = { ...FORM, questions: FORM.questions.map((q, i) => (i === 0 ? { ...q, label: 'Overall, how was the gig?' } : q)) };
    await org.agent.put(`/api/events/${id}/survey`).send(reworded).expect(200);
    const changed = await org.agent.put(`/api/events/${id}/survey`).send({ ...FORM, questions: FORM.questions.slice(1) }).expect(409);
    expect(changed.body.error.code).toBe('QUESTIONS_LOCKED');

    const rival = await signUp('organizer');
    await rival.agent.get(`/api/events/${id}/survey/manage`).expect(403);
    await guests[0].agent.post(`/api/events/${id}/survey/insights`).expect(403);
  });

  it('suggests a starter form for the event, and My tickets says which shows have one', async () => {
    const { org, id, guests } = await pastShowWithForm(1);
    const { body } = await org.agent.post(`/api/events/${id}/survey/suggest`).expect(200);
    expect(body.source).toBe('template');
    expect(body.questions[0]).toMatchObject({ kind: 'rating', required: true });
    expect(body.questions.find((q) => q.kind === 'multi').options).toContain('The music and the band');

    const { body: orders } = await guests[0].agent.get('/api/orders').expect(200);
    expect(orders.items[0].feedback).toEqual({ form: true, answered: false });
  });
});

describe('built-in insights', () => {
  it('reads the strongest and weakest scores and the NPS', () => {
    const out = builtInInsights({
      responses: 4,
      attendees: 20,
      questions: [
        { kind: 'rating', label: 'Overall', answered: 4, average: 4.5, counts: [] },
        { kind: 'rating', label: 'Sound', answered: 4, average: 2.8, counts: [] },
        { kind: 'nps', label: 'Recommend', answered: 4, score: 50, promoters: 3, passives: 0, detractors: 1, counts: [] },
        { kind: 'text', label: 'Improve', answered: 1, answers: ['The sound at the back was muddy all night'] },
      ],
    });
    expect(out.sentiment).toBe('mixed');
    expect(out.loved).toContain('“Overall” averaged 4.5/5.');
    expect(out.improve[0]).toMatch(/“Sound” averaged only 2.8\/5/);
    expect(out.actions.join(' ')).toMatch(/Fewer than a third/);
    expect(out.quotes).toEqual(['The sound at the back was muddy all night']);
    expect(out.improve).toContain('1 of 1 written answer brings up the sound.');
    expect(out.actions.join(' ')).toMatch(/Check the sound before the next show/);
  });
});
