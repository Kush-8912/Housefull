// The kinds of question an organizer can put on a feedback form (mirrors
// QUESTION_KINDS in server/src/models/Survey.js).
export const QUESTION_KINDS = {
  rating: { label: 'Star rating', hint: '1 to 5 stars' },
  nps: { label: 'Would recommend', hint: '0 to 10' },
  choice: { label: 'Pick one', hint: 'One option' },
  multi: { label: 'Pick several', hint: 'Any options' },
  text: { label: 'Written answer', hint: 'Free text' },
};
