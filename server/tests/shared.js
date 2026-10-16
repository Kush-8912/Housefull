// Small helpers shared by the feature test files.
export const card = (number = '4242424242424242') => ({ number, expMonth: 12, expYear: new Date().getFullYear() + 2, cvc: '123', name: 'Test Buyer' });
let keySeq = 0;
export const key = () => `test-key-${Date.now()}-${keySeq++}`;

export const pay = (agent, holdId, { k = key(), c = card() } = {}) =>
  agent.post(`/api/holds/${holdId}/checkout`).set('Idempotency-Key', k).send({ card: c });

export async function hold(agent, eventId, seats) {
  const res = await agent.post(`/api/events/${eventId}/holds`).send({ seatIds: seats.map((s) => s.id) });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.hold._id;
}

// Hold and pay; returns the checkout response body.
export async function buy(agent, eventId, seats) {
  const res = await pay(agent, await hold(agent, eventId, seats));
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body;
}
