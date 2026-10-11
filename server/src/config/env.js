import { z } from 'zod';

// Fail fast on boot if configuration is missing or malformed, instead of
// discovering it on the first request that needs it.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  TICKET_SIGNING_SECRET: z.string().min(32, 'TICKET_SIGNING_SECRET must be at least 32 characters'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  HOLD_TTL_MINUTES: z.coerce.number().positive().max(30).default(8),
  MAX_SEATS_PER_HOLD: z.coerce.number().int().positive().max(20).default(8),
  // Convenience fee on tickets (after discounts), as a percentage. GST at
  // 18% is charged on the fee, as Indian ticketing platforms do.
  BOOKING_FEE_PERCENT: z.coerce.number().min(0).max(30).default(5),
  // Outgoing email. Without SMTP_URL, development writes each email to
  // server/.mail-outbox/*.eml instead of sending it.
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('SeatLock <tickets@seatlock.dev>'),
  // Public URL of the app, used for links inside emails.
  APP_URL: z.string().optional(),
  // Optional: lets Claude write the copy for event reminder emails. Without it
  // reminders use a built-in template.
  ANTHROPIC_API_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = { ...parsed.data, APP_URL: (parsed.data.APP_URL ?? parsed.data.CLIENT_ORIGIN).replace(/\/$/, '') };
export const isProd = env.NODE_ENV === 'production';
