import mongoose from 'mongoose';
import { AppError } from '../utils/AppError.js';

export function notFoundHandler(req, _res, next) {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = err.status ?? 500;
  let body = { error: { message: err.message, code: err.code, details: err.details } };

  if (err instanceof mongoose.Error.CastError) {
    status = 400;
    body = { error: { message: `Invalid ${err.path}`, code: 'INVALID_ID' } };
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    body = { error: { message: 'Some fields are invalid', code: 'VALIDATION_ERROR', details } };
  } else if (err?.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyPattern ?? {})[0] ?? 'value';
    body = { error: { message: `That ${field} is already in use`, code: 'DUPLICATE' } };
  } else if (err.type === 'entity.too.large') {
    status = 413;
    body = { error: { message: 'That file is too large', code: 'TOO_LARGE' } };
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    body = { error: { message: 'Malformed JSON body', code: 'BAD_JSON' } };
  } else if (!(err instanceof AppError) && status === 500) {
    // Never leak internals for unexpected failures.
    console.error(`[${req.method} ${req.originalUrl}]`, err);
    body = { error: { message: 'Something went wrong on our side. Please try again.', code: 'INTERNAL' } };
  }

  res.status(status).json(body);
}
