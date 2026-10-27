import mongoose from 'mongoose';

// One attendee's answers to a feedback form. `value` is a number (rating,
// nps), a string (choice, text) or an array of strings (multi).
const surveyResponseSchema = new mongoose.Schema(
  {
    survey: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey', required: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true }, // the showtime they went to
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    answers: [{ _id: false, question: { type: mongoose.Schema.Types.ObjectId, required: true }, value: mongoose.Schema.Types.Mixed }],
  },
  { timestamps: true, versionKey: false },
);

surveyResponseSchema.index({ survey: 1, user: 1 }, { unique: true });

export const SurveyResponse = mongoose.model('SurveyResponse', surveyResponseSchema);
