// Populates a database with demo accounts and events.
// Usage: npm run seed            (refuses to run if users already exist)
//        npm run seed -- --reset (wipes SeatLock collections first)
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { User } from '../src/models/User.js';
import { Event } from '../src/models/Event.js';
import { Seat } from '../src/models/Seat.js';
import { Hold } from '../src/models/Hold.js';
import { Order } from '../src/models/Order.js';
import { Ticket } from '../src/models/Ticket.js';
import { PromoCode } from '../src/models/PromoCode.js';
import { WaitlistEntry } from '../src/models/WaitlistEntry.js';
import { Notification } from '../src/models/Notification.js';
import { Addon } from '../src/models/Addon.js';
import { Review } from '../src/models/Review.js';
import { Interest } from '../src/models/Interest.js';
import { publishEvent, addShowtime } from '../src/services/eventService.js';
import { checkInTicket } from '../src/services/checkinService.js';
import { qrPayloadFor } from '../src/services/ticketSigner.js';
import { createHold } from '../src/services/holdService.js';
import { checkout } from '../src/services/orderService.js';
import { backgroundIdle } from '../src/utils/background.js';

const DEMO_PASSWORD = 'demo1234';
const days = (n, hour = 19) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const rows = (spec) => spec.flatMap(([labels, seats, tier]) => [...labels].map((label) => ({ label, seats, tier })));

const EVENTS = [
  {
    title: 'Midnight Echoes — Acoustic Tour',
    category: 'music',
    venue: { name: 'Seaside Amphitheatre', city: 'Mumbai' },
    startsAt: days(12),
    description: 'An intimate acoustic evening with songs from the new album and fan favourites.',
    coverImageUrl: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1200&q=70',
    tiers: [{ name: 'Front Row', price: 4500, color: '#e11d48' }, { name: 'Premium', price: 2500, color: '#7c3aed' }, { name: 'Standard', price: 1200, color: '#0891b2' }],
    rows: rows([['AB', 14, 'Front Row'], ['CDE', 18, 'Premium'], ['FGHJ', 20, 'Standard']]),
  },
  {
    title: 'Stand-up Saturday: Open Mic Night',
    category: 'comedy',
    venue: { name: 'Laughter Loft', city: 'Mumbai' },
    startsAt: days(5, 21),
    description: 'Six comics, one mic, zero filters. 18+ only.',
    coverImageUrl: 'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?w=1200&q=70',
    tiers: [{ name: 'Table', price: 899, color: '#ea580c' }, { name: 'Gallery', price: 499, color: '#65a30d' }],
    rows: rows([['ABC', 10, 'Table'], ['DEF', 12, 'Gallery']]),
  },
  {
    title: 'Frontend Forward 2026',
    category: 'tech',
    venue: { name: 'Lakeside Convention Centre', city: 'Bengaluru' },
    startsAt: days(20, 9),
    durationMinutes: 480,
    description: 'A full day of talks on React Server Components, performance and the future of the web platform.',
    coverImageUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&q=70',
    tiers: [{ name: 'Early Bird', price: 1999, color: '#2563eb' }, { name: 'Regular', price: 2999, color: '#4f46e5' }],
    rows: rows([['ABCD', 16, 'Early Bird'], ['EFGHJK', 16, 'Regular']]),
  },
  {
    title: 'Hamlet — A Modern Retelling',
    category: 'theatre',
    venue: { name: 'Curtain Call Theatre', city: 'Mumbai' },
    startsAt: days(9, 19),
    durationMinutes: 150,
    description: 'Shakespeare’s tragedy reimagined in a 2020s corporate boardroom.',
    coverImageUrl: 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=1200&q=70',
    tiers: [{ name: 'Stalls', price: 1500, color: '#b45309' }, { name: 'Balcony', price: 750, color: '#0f766e' }],
    rows: rows([['ABCDE', 12, 'Stalls'], ['FGH', 14, 'Balcony']]),
  },
  {
    title: 'Pottery Basics Workshop',
    category: 'workshop',
    venue: { name: 'Clay Studio', city: 'Delhi' },
    startsAt: days(3, 11),
    durationMinutes: 180,
    description: 'Hands-on wheel throwing for complete beginners. All materials included.',
    coverImageUrl: 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=1200&q=70',
    tiers: [{ name: 'Seat', price: 1800, color: '#a16207' }],
    rows: rows([['AB', 6, 'Seat']]),
  },
  {
    title: 'Community Football Screening',
    category: 'sports',
    venue: { name: 'Goal Post Café', city: 'Delhi' },
    startsAt: days(7, 20),
    description: 'Big screen, free entry, seat reservation required.',
    coverImageUrl: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=1200&q=70',
    tiers: [{ name: 'Free', price: 0, color: '#16a34a' }],
    rows: rows([['ABCD', 10, 'Free']]),
  },
];

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  await mongoose.connection.syncIndexes();

  if (process.argv.includes('--reset')) {
    await Promise.all([User, Event, Seat, Hold, Order, Ticket, PromoCode, WaitlistEntry, Notification, Addon, Review, Interest].map((M) => M.deleteMany({})));
    console.log('Cleared existing data');
  } else if (await User.estimatedDocumentCount()) {
    console.log('Database already has users; run with --reset to wipe and reseed.');
    return;
  }

  const passwordHash = await User.hashPassword(DEMO_PASSWORD);
  const [organizer, , friend] = await User.create([
    { name: 'Riya Organiser', email: 'organizer@seatlock.dev', role: 'organizer', passwordHash },
    { name: 'Aarav Attendee', email: 'attendee@seatlock.dev', role: 'attendee', passwordHash },
    // A second attendee: someone to transfer tickets to, and the buyer who sold out the workshop.
    { name: 'Meera Friend', email: 'friend@seatlock.dev', role: 'attendee', passwordHash },
  ]);

  const published = {};
  for (const data of EVENTS) {
    const event = await Event.create({ ...data, organizer: organizer._id });
    published[data.title] = await publishEvent(event);
  }

  // Promo codes to try at checkout.
  await PromoCode.create([
    { event: published['Midnight Echoes — Acoustic Tour']._id, code: 'EARLY20', kind: 'percent', value: 20, maxUses: 50 },
    { event: published['Frontend Forward 2026']._id, code: 'STUDENT500', kind: 'flat', value: 500 },
  ]);

  // Sell out the pottery workshop so the waitlist can be demoed: join it as
  // attendee@, then cancel Meera's order to see the alert arrive.
  const workshop = published['Pottery Basics Workshop'];
  const seats = await Seat.find({ event: workshop._id }, '_id').sort({ row: 1, number: 1 });
  const card = { number: '4242424242424242', expMonth: 12, expYear: new Date().getFullYear() + 3, cvc: '123', name: friend.name };
  for (const [i, batch] of [seats.slice(0, 6), seats.slice(6)].entries()) { // one hold is capped at MAX_SEATS_PER_HOLD
    const hold = await createHold({ user: friend, event: workshop, seatIds: batch.map((x) => x._id) });
    await checkout({ user: friend, holdId: hold._id, idempotencyKey: `seed-sellout-${i}`, card });
  }
  // Add-on menus (copied automatically to new showtimes).
  const menu = {
    'Midnight Echoes — Acoustic Tour': [
      { name: 'Tour T-shirt', kind: 'merch', price: 799, stock: 40, description: 'Black cotton tee, tour dates on the back' },
      { name: 'Drink + snack combo', kind: 'food', price: 249 },
    ],
    'Stand-up Saturday: Open Mic Night': [{ name: 'Nachos & soft drink', kind: 'food', price: 249, stock: 60 }],
    'Hamlet — A Modern Retelling': [{ name: 'Interval coffee', kind: 'food', price: 120, description: 'Collect at the bar during the interval' }],
    'Community Football Screening': [{ name: 'Snack bucket', kind: 'food', price: 149, stock: 100 }],
  };
  for (const [title, items] of Object.entries(menu)) {
    await Addon.create(items.map((i) => ({ ...i, event: published[title]._id })));
  }

  // Hamlet runs three nights: two more showtimes in the same series.
  const hamlet = published['Hamlet — A Modern Retelling'];
  await addShowtime(hamlet, new Date(hamlet.startsAt.getTime() + 86_400_000));
  await addShowtime(hamlet, new Date(hamlet.startsAt.getTime() + 2 * 86_400_000 - 4 * 3_600_000)); // matinee

  // A show that already happened, so ratings & reviews can be demoed: both
  // attendees went and were scanned in; Meera left a review, Aarav hasn't yet.
  const attendee = await User.findOne({ email: 'attendee@seatlock.dev' });
  const brunch = await publishEvent(await Event.create({
    organizer: organizer._id,
    title: 'Sunday Jazz Brunch',
    description: 'A trio, a terrace and a long brunch menu.',
    category: 'music',
    venue: { name: 'The Terrace', city: 'Pune' },
    startsAt: days(1, 12),
    durationMinutes: 150,
    coverImageUrl: 'https://images.unsplash.com/photo-1511192336575-5a79af67a629?w=1200&q=70',
    tiers: [{ name: 'Table', price: 1200, color: '#b45309' }],
    rows: rows([['ABC', 8, 'Table']]),
  }));
  const brunchSeats = await Seat.find({ event: brunch._id }).sort({ row: 1, number: 1 });
  for (const [i, buyer] of [friend, attendee].entries()) {
    const h = await createHold({ user: buyer, event: brunch, seatIds: brunchSeats.slice(i * 2, i * 2 + 2).map((x) => x._id) });
    const { tickets } = await checkout({ user: buyer, holdId: h._id, idempotencyKey: `seed-brunch-${i}`, card });
    for (const t of tickets) await checkInTicket({ event: brunch, qr: qrPayloadFor(t._id), staff: organizer });
  }
  const threeDaysAgo = days(-3, 12);
  await Event.updateOne({ _id: brunch._id }, { startsAt: threeDaysAgo });
  await Order.updateMany({ event: brunch._id }, { paidAt: days(-6, 18) });
  await Review.create({ series: brunch._id, event: brunch._id, user: friend._id, rating: 5, text: 'Lovely set and the terrace was perfect. Book a table near the front.' });

  // Meera is interested in a couple of upcoming events.
  for (const title of ['Midnight Echoes — Acoustic Tour', 'Frontend Forward 2026']) {
    await Interest.create({ series: published[title]._id, user: friend._id });
  }

  await Event.create({
    ...EVENTS[0],
    title: 'Winter Jazz Festival (draft)',
    startsAt: days(45),
    organizer: organizer._id,
  });

  const [live, drafts] = await Promise.all([Event.countDocuments({ status: 'published' }), Event.countDocuments({ status: 'draft' })]);
  console.log(`Seeded ${live} published shows + ${drafts} draft.`);
  console.log('Promo codes: EARLY20 (Midnight Echoes), STUDENT500 (Frontend Forward). Pottery workshop is sold out.');
  console.log('Hamlet has 3 showtimes. Sunday Jazz Brunch already happened: log in as attendee@ to review it.');
  console.log(`Log in as organizer@, attendee@ or friend@seatlock.dev with password "${DEMO_PASSWORD}".`);
  await backgroundIdle();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
