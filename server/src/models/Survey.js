import mongoose from 'mongoose';

export const QUESTION_KINDS = ['rating', 'nps', 'choice', 'multi', 'text'];

const questionSchema = new mongoose.Schema({
  kind: { type: String, enum: QUESTION_KINDS, required: true },
  label: { type: String, required: true, maxlength: 140 },
  options: { type: [String], default: [] }, // choice / multi only
  required: { type: Boolean, default: false },
});

// The organizer's feedback form for a production: all showtimes share one,
// like reviews do. `insights` caches the last AI (or built-in) summary along
// with how many responses it covered, so it is only rewritten when asked.
const surveySchema = new mongoose.Schema(
  {
    series: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, maxlength: 100 },
    intro: { type: String, default: '', maxlength: 300 },
    questions: { type: [questionSchema], default: [] },
    insights: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, versionKey: false },
);

export const Survey = mongoose.model('Survey', surveySchema);
