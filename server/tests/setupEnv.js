// Runs before any app module is imported so config validation passes.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ??= 'mongodb://set-by-tests';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
process.env.TICKET_SIGNING_SECRET = 'test-ticket-secret-that-is-at-least-32-characters';
process.env.HOLD_TTL_MINUTES = '8';
process.env.MAX_SEATS_PER_HOLD = '6';
// Older tests assert exact ticket totals; fees.test.js turns the fee on.
process.env.BOOKING_FEE_PERCENT = '0';
// Turns on "Continue with Google"; google.test.js stubs out the token check.
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
