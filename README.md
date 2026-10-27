<img src="client/public/favicon.svg" alt="Housefull logo: a theatre house full of seats" width="72" />

# Housefull

> *Get in before it's housefull.*

**Reserved-seat event ticketing where two people can never buy the same seat.**

Pick your exact seat on a live map, hold it for a few minutes while you pay, and walk in with a signed QR ticket. Organizers design the seating layout, watch sales live, and check guests in by scanning QR codes at the door.

| | |
|---|---|
| **Live app** | **https://housefull-4eq8.onrender.com** (free tier: the first visit after a quiet spell takes ~30 s to wake up) |
| **Demo video** | _add link_ |
| **Demo logins** | `attendee@housefull.dev`, `friend@housefull.dev` (a second attendee to transfer tickets to), `organizer@housefull.dev`; password `demo1234`. Promo codes `EARLY20` and `STUDENT500`; the pottery workshop is seeded sold out (waitlist), Hamlet has three showtimes, several events have add-on menus, and *Sunday Jazz Brunch* already happened so `attendee@` can review it |
| **Test card** | `4242 4242 4242 4242`, any future expiry, any CVC ([more](#test-cards)) |

---

## Problem Statement

Small and mid-sized venues (comedy clubs, college auditoriums, indie gigs, theatre groups, workshops) sell reserved seating through spreadsheets, WhatsApp, or general-admission ticket tools that don't understand seats. This leads to:

- **Double-booking.** Two buyers pay for seat B7 because the "is it free?" check and the "sell it" step aren't atomic.
- **Phantom availability.** Someone starts paying, abandons the payment, and the seat stays locked forever (or is never locked at all).
- **Duplicate charges.** A slow network makes the buyer click "Pay" twice.
- **Ticket fraud at the door.** Screenshots of a ticket get shared, or someone edits a ticket ID, and staff have no reliable way to tell.

## Target Users

- **Attendees** who want to choose exactly where they sit and need confidence that the seat they paid for is theirs.
- **Organizers** (small venues, college clubs, independent promoters) who need a seat-aware box office, live sales numbers, and a fast door check-in without buying hardware.

## Solution

Housefull models each seat as its own record and treats a purchase as a short **state machine** rather than a single form submit:

```
 available ──hold (atomic)──▶ held ──checkout──▶ sold ──cancel/refund──▶ available
     ▲                          │
     └──── expires / released ──┘
```

- A **hold** reserves seats for 8 minutes. Claims are atomic per seat, so exactly one of any number of simultaneous buyers wins.
- **Checkout** locks the hold, charges once (idempotently), then converts the seats to sold and issues tickets.
- Every seat state change is **pushed live** to everyone viewing that event.
- **Tickets** carry an HMAC-signed QR code that is verified and burned once at the door.

## Key Features (core workflows)

1. **Discover events.** Search by text, filter by category, city and date, with pagination. Filters live in the URL, so searches can be shared and survive a refresh.
2. **Choose and hold seats.** The interactive seat map updates live over WebSockets as other people hold or buy seats. If a seat you selected is taken, you're told immediately. Holds are all-or-nothing and expire automatically.
   - **Best available:** pick a number of seats (and optionally a tier) and Housefull selects the side-by-side block closest to the front and centre.
   - **Live viewer count:** the event page shows how many people are looking at it right now.
   - **Waitlist:** on a sold-out event, attendees can join a waitlist. When seats come back (a refund, an expired hold), everyone waiting gets an in-app notification and an email at the same time, then it's first come, first served.
   - **Add to calendar:** download an `.ics` file that works with Google Calendar, Apple Calendar and Outlook.
   - **Showtimes:** one production can run several dates/times (e.g. three nights of a play). Each showtime has its own seat map and add-on stock; buyers switch between them on the event page, and the listing shows the production once with "+2 more shows".
   - **Discovery:** pick your city once in the header (remembered in the browser); sort by soonest or **trending** (most tickets sold in the last 7 days). Cards carry labels computed from real data: *Filling fast* (≥5% of seats sold in 24 h), *Almost full* (≤10% left), *New* (on sale < 3 days).
   - **Interested & Saved:** mark events you're interested in (public count) and find them under Saved.
   - **Share:** native share sheet on phones, copy-link on desktop; in production, event links unfurl in WhatsApp/Slack with the title, date and cover image (meta tags are rendered server-side).
3. **Pay and receive tickets.** A countdown shows how long the hold has left. Payment goes through a mock card processor with realistic declines. Retries are idempotent, and a declined card keeps your hold so you can try another card. You receive one QR ticket per seat, plus a confirmation email with the QR codes attached.
   - **Emails along the way:** a ticket-style confirmation (event poster, a QR stub per seat, the bill, directions), a reminder the day before, an *It's showtime today* email a few hours before doors, a *New date & time* email if the organizer reschedules, a *Cancelled* email saying what was refunded to which card, and a refund receipt when you cancel your own order. Each automatic email goes out at most once per order, and every change is also an in-app notification.
   - **Bill like BookMyShow:** tickets, promo discount, add-ons, a booking fee (`BOOKING_FEE_PERCENT`, default 5% of the ticket amount after discounts) and 18% GST on that fee. Organizer revenue excludes the fee and GST. If an attendee cancels, they get back what the event's cancellation policy allows (never the booking fee); if the organizer cancels the event, everything is refunded.
   - **Food & merch add-ons:** organizers set up a menu per showtime (price, stock, per-order limit); buyers add items at checkout. Stock is taken atomically at payment, so limited items can't be oversold, and comes back on a declined card or refund.
   - **Promo codes:** apply a code at checkout for a percentage or flat discount (on ticket prices; codes work across all showtimes). Usage limits are enforced atomically, so a code with one use left can't be redeemed twice by racing buyers; a declined card or a refund gives the use back.
4. **Manage and refund orders.** "My tickets" lists upcoming and past orders. Cancelling puts the seats straight back on sale and refunds according to the event's **cancellation policy**, which the organizer picks when creating it, as on BookMyShow or District:

   | Policy | Refund of the ticket price |
   |---|---|
   | Flexible | 100% up to 24 hours before |
   | Standard (default) | 100% up to 7 days before, 75% up to 2 days, 50% up to 1 day |
   | No cancellations | none |

   There are never cancellations on the day of the show, and the booking fee and its GST are never refunded. If the organizer reschedules, people who booked before the change can cancel for the full ticket price up to a day before. The server works out the exact refund ([`refundPolicy.js`](server/src/services/refundPolicy.js)); "My tickets" shows it on the cancel button, along with when it will drop, and the policy is shown on the event page and at checkout.
   - **Ticket transfer:** send a ticket to another attendee by email. Your QR code stops working and they get a new one (plus a notification and an email). If the organizer cancels the event, the refund still goes to whoever paid.
5. **Organizer tools:**
   - **Host verification:** before their events can go on sale, organizers verify their identity with their PAN (see [Test PANs](#test-pans)). Drafts work straight away; publishing is blocked server-side until the host is verified, and buyers see a *Verified host* badge on the event page.
   - **Event builder:** tiers, prices, and a row-by-row seating layout with a live preview. Draft, then publish, which locks the layout.
   - **Live dashboard:** revenue, sell-through, per-tier sales, daily sales chart and check-in rate.
   - **Door check-in:** camera QR scanner or a pasted code, with clear admit / do-not-admit results (already used, wrong event, refunded, forged).
   - **Reschedule** a published show: tickets and seats stay valid, every ticket holder is emailed the old and new time, and reminders follow the new time.
   - **Guest list search** with **CSV export** (spreadsheet-formula injection is neutralised), and **event cancellation**, which refunds every buyer automatically.
   - **Promo codes:** create, limit, expire, switch off; the dashboard shows discounts given, the waitlist size and how many people are on the event page right now.
6. **Feedback forms with insights:** the organizer builds a short form for a production (star ratings, a 0–10 "would you recommend" with Net Promoter Score, single and multiple choice, written answers). **Suggest questions** drafts one for the event: written by Claude when `ANTHROPIC_API_KEY` is set, otherwise a template for the category. Only people who were scanned in at the door can answer, from *My tickets* or the post-show email. After answering, they see **how everyone answered** (anonymous totals with their own picks marked, shown once at least 3 people have replied, and never the written answers). The organizer gets live results and **Insights**: Claude reads every answer and writes what people loved, what to fix, real quotes and next steps (quotes are checked to be verbatim). Without an API key, a built-in analyser reads the scores and spots recurring themes in the written answers (sound, queues, food, seating…). Question types lock once anyone has answered, so earlier answers stay meaningful.
7. **Ratings & reviews:** after a show, people who were actually scanned in at the door can rate it (1–5 stars + text), once per production, editable. The event page shows the average, the distribution and the reviews; cards show the rating.
8. **Notifications:** a bell in the header lists waitlist alerts and received tickets, delivered live over a private per-user WebSocket room.

## Look and feel

The UI is themed as a dark auditorium with paper tickets, and the motion follows the same story of a house filling up:

- **The logo** is a theatre "house" whose seats fill on load, front row first, with yours (cream) last; then the light in the gable comes on.
- **Home:** a velvet-curtain intro on a visitor's first page of the session, follow-spots sweeping the hero, a headline that drifts apart as you scroll, and a *live house* canvas where seats sell out faster and faster until a HOUSEFULL sign stamps on.
- **Navigation:** each new page opens out of a circle from where you clicked (the View Transitions API); headings settle like a departures board.
- **Buying:** seats fill in as a wave from the stage, a picked seat jumps with a burst of its tier colour, and a seat someone else grabs flashes red live. Checkout digits tick over and the timer's heartbeat starts under a minute. After paying, confetti fires and the tickets print out one by one.

How it's built, so it stays fast and accessible:

- **No animation library.** Keyframes and Tailwind utilities, CSS scroll-driven animations behind `@supports`, the View Transitions API and one Canvas 2D component. The canvas pauses when it's off screen or the tab is hidden.
- **Pointer effects write CSS variables** (tilt, glare, spotlights) instead of React state, so moving the mouse never re-renders the page.
- **Respectful by default.** `prefers-reduced-motion` turns all of it off (CSS and JS). Cursor, tilt and magnetic effects only run on a mouse or trackpad. Screen readers get the real text of animated headings, and the curtain intro never plays on deep links such as a door-scan QR code.

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React 19, React Router 7, Vite 8, Tailwind CSS 4 | Component model suits the stateful seat map; Vite for fast dev and code-splitting |
| Realtime | Socket.IO | Room-per-event broadcast with automatic reconnect and polling fallback |
| Backend | Node.js, Express 5 | Native async error handling; simple REST surface |
| Database | MongoDB with Mongoose | Atomic single-document conditional updates are exactly what seat claiming needs |
| Validation | Zod (server) | One schema both validates and coerces input; field-level errors flow to the UI |
| Auth | JWT in an httpOnly cookie, bcrypt, Google Identity Services + google-auth-library | No token in JS-readable storage; same-origin deployment means no cross-site cookie issues; Google tokens are checked with Google server-side |
| Security | Helmet (CSP), express-rate-limit, CORS | Sensible defaults plus brute-force protection on login/register |
| Charts / QR | Recharts, qrcode.react, html5-qrcode | Dashboard chart, ticket QR rendering, camera scanning |
| Motion | CSS keyframes and scroll-driven animations, View Transitions API, Canvas 2D | No animation library to ship; everything degrades gracefully and honours reduced motion |
| Testing | Vitest, Supertest, mongodb-memory-server | Real HTTP and database integration tests, including concurrency races |
| Hosting | Render (web service) + MongoDB Atlas | One service serves API + client |

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[React SPA]
    WS[Socket.IO client]
  end
  subgraph "Node.js (single Render service)"
    ST[Static client build]
    API[Express REST API]
    IO[Socket.IO server]
    SW[Hold sweeper job]
    SVC[Services: holds, orders, check-in, stats]
    PAY[Payment adapter: mock]
  end
  DB[(MongoDB Atlas)]

  UI -- "HTTPS /api (cookie auth)" --> API
  WS <-- "event rooms: seats:update, checkin" --> IO
  UI -. loads .-> ST
  API --> SVC --> DB
  SVC --> PAY
  SVC -- emit --> IO
  SW -- every 15s --> SVC
```

**Request flow for a purchase**

```
POST /api/events/:id/holds        claim each seat: findOneAndUpdate({_id, status claimable}) ─▶ broadcast "held"
POST /api/holds/:id/checkout      Idempotency-Key header
   ├─ replay? same key ─────────▶ return original order (200)
   ├─ lock hold: active ─▶ converting   (second concurrent checkout ─▶ 409)
   ├─ create pending order
   ├─ charge card ──fail──▶ order failed, hold back to active, 402
   ├─ seats held ─▶ sold (only if still ours)
   └─ issue tickets, order paid, hold converted ─▶ broadcast "sold"
```

### Main components

| Path | Responsibility |
|---|---|
| `server/src/services/holdService.js` | Atomic seat claiming, all-or-nothing rollback, release |
| `server/src/services/orderService.js` | Checkout state machine, idempotency, refunds, event cancellation |
| `server/src/services/checkinService.js` | QR verification and exactly-once admission |
| `server/src/services/statsService.js` | Aggregation pipelines for the organizer dashboard |
| `server/src/services/ticketSigner.js` | HMAC-signed QR payloads (`SL1.<ticketId>.<sig>`) |
| `server/src/services/paymentService.js` | Mock gateway with the same contract as a real one (charge with idempotency key, refund) |
| `server/src/jobs/holdSweeper.js` | Releases expired holds; recovers checkouts that crashed mid-way |
| `server/src/realtime/` | Socket.IO rooms and a small emit bus used by services |
| `client/src/components/SeatMap.jsx` | Seat map rendering (buy mode and editor preview) |
| `client/src/hooks/useEventChannel.js` | Joins event rooms, re-syncs after reconnect |
| `client/src/lib/api.js` | Fetch wrapper that turns every failure into a typed `ApiError` |

### Data model

```
User      { name, email (unique), passwordHash, role: attendee|organizer }
Event     { organizer, title, category, venue{name,city}, startsAt, durationMinutes,
            tiers[{name, price, color}], rows[{label, seats, tier}], status: draft|published|cancelled }
Seat      { event, row, number, label, tier, price, status: available|held|sold,
            hold, holdExpiresAt, order }                      unique(event, label)
Hold      { user, event, seats[], expiresAt, status: active|converting|converted|released|expired }
                                                              unique(user, event) where status = active
Hold.promoCode                                                applied code, re-validated and redeemed at checkout
Order     { user, event, hold, items[{seat,label,tier,price}], subtotal, discount, promo{id,code}, amount,
            status: pending|paid|failed|cancelled|refunded, idempotencyKey, payment{chargeId,last4,refundId} }
                                                              unique(user, idempotencyKey)
Ticket    { order, event, user, seat, label, tier, status: valid|cancelled|transferred, checkedInAt, checkedInBy,
            transferredFrom, transferredTo, transferredAt }
Event.seriesId                                                links showtimes of one production
Order    += addons[{addon,name,price,qty}], addonsTotal, bookingFee, gst, refundedAmount
Addon     { event, name, kind: food|merch, price, stock, sold, maxPerOrder, active }
Review    { series, event, user, rating 1-5, text }                          unique(series, user)
Interest  { series, user }                                                   unique(series, user)
PromoCode { event, code, kind: percent|flat, value, maxUses, uses, expiresAt, active }   unique(event, code)
WaitlistEntry { event, user, status: waiting|notified, joinedAt, notifiedAt }          unique(event, user)
Notification  { user, type, title, body, link, readAt }
```

### Key engineering decisions

- **One document per seat instead of an array inside the event.** MongoDB updates to a single document are atomic, so `findOneAndUpdate({ _id, status: 'available' }, { status: 'held' })` is a race-free compare-and-set. No transactions or replica set are needed, so the app runs on the Atlas free tier and in a plain local `mongod`.
- **All-or-nothing holds without transactions.** Seats are claimed in parallel. If any claim fails, the seats already claimed are handed back (a compensating action), and the buyer learns exactly which seats were lost.
- **Expiry is correct even if the background job is down.** A held seat whose `holdExpiresAt` has passed counts as available on every read and claim. The sweeper only makes the UI fresher; correctness doesn't depend on it.
- **Two layers against double charging.** A client-generated `Idempotency-Key` replays the original order. Separately, the `active → converting` lock on the hold refuses a second concurrent checkout *before* any money moves. The client reuses the key after network errors and generates a new one after a definitive decline.
- **Never keep money for undeliverable seats.** If seats somehow can't be marked sold after a successful charge, the order is refunded automatically.
- **Signed, single-use tickets.** QR payloads are HMAC-signed, so editing a ticket ID is detected without a database lookup. Admission is a conditional update on `checkedInAt: null`, so two scanners reading the same code admit it exactly once.
- **Single origin in production.** Express serves the built React app, which removes CORS and third-party-cookie issues and lets the auth cookie be `httpOnly; SameSite=Lax`. In development, Vite's proxy recreates the same setup.
- **Numbers are aggregated, never stored as counters.** Dashboard stats come from aggregation pipelines over the source data, so they can't drift.

### Error handling

| Situation | What happens |
|---|---|
| Seat taken between viewing and holding | `409 SEATS_UNAVAILABLE` naming the seats; UI greys them out and keeps the rest of the selection |
| Hold expires during checkout | `410 HOLD_EXPIRED`; UI shows an expired screen with a link back to the seat map |
| Card declined / gateway down | `402 PAYMENT_FAILED`; hold stays active so the buyer can retry with another card |
| Double-click / retry of "Pay" | Same key: original order returned. Different key: `409 CHECKOUT_IN_PROGRESS` |
| Ticket scanned twice / forged / wrong event / refunded | Distinct codes (`ALREADY_CHECKED_IN`, `INVALID_TICKET`, `WRONG_EVENT`, `TICKET_CANCELLED`) shown as "Do not admit" |
| Invalid input | `400 VALIDATION_ERROR` with per-field messages rendered under each input |
| Not logged in / wrong role / not the owner | 401 / 403; private resources owned by others return 404 to avoid revealing they exist |
| Network offline | Client shows "Can't reach Housefull"; the socket reconnects and re-syncs the seat map |
| Unexpected server error | Logged server-side; client gets a generic message (no stack traces leaked) |
| Bad config at boot | Server refuses to start and lists the missing or invalid environment variables |

## Local Setup

**Prerequisites:** Node.js 20+ and MongoDB, either running locally (`brew services start mongodb-community`) or as a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster.

```bash
git clone <your-repo-url> housefull && cd housefull
npm run install:all                     # installs server and client dependencies

cp server/.env.example server/.env      # then fill in the secrets (see below)
npm run seed                            # demo users and events (add -- --reset to wipe)

# terminal 1: API on http://localhost:4000
npm run dev --prefix server
# terminal 2: React app on http://localhost:5173 (proxies /api and websockets)
npm run dev --prefix client
```

Open <http://localhost:5173> and log in with one of the demo accounts. To try the real-time behaviour, open the same event in two browsers (or one normal and one private window) logged in as different users.

**Tests:**

```bash
npm test     # 24 integration tests: holds, races, checkout, refunds, check-in, stats
```

Tests start their own in-memory MongoDB, so they need no database or `.env`.

## Environment Variables

All variables live in `server/.env` (template: [`server/.env.example`](server/.env.example)). They're validated at startup.

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGODB_URI` | yes | — | MongoDB connection string |
| `JWT_SECRET` | yes | — | ≥ 32 chars; signs session tokens |
| `TICKET_SIGNING_SECRET` | yes | — | ≥ 32 chars; signs ticket QR codes (keep different from `JWT_SECRET`) |
| `NODE_ENV` | no | `development` | `production` enables secure cookies, CSP and static client serving |
| `PORT` | no | `4000` | HTTP port |
| `HOLD_TTL_MINUTES` | no | `8` | How long seats stay held during checkout |
| `MAX_SEATS_PER_HOLD` | no | `8` | Seat limit per order |
| `CLIENT_ORIGIN` | no | `http://localhost:5173` | Only needed if the client is served from a different origin |
| `APP_URL` | no | Render's URL, else `CLIENT_ORIGIN` | Public URL of the app, used for links in emails and share previews. On Render it defaults to the service's own URL (`RENDER_EXTERNAL_URL`) |
| `SMTP_URL` | no | — | e.g. `smtps://user:pass@smtp.example.com:465`. Without it, development writes each email to `server/.mail-outbox/*.eml` (open with any mail app) instead of sending |
| `BOOKING_FEE_PERCENT` | no | `5` | Booking fee on tickets (after discounts); 18% GST is added on the fee. `0` turns it off |
| `MAIL_FROM` | no | `Housefull <tickets@housefull.dev>` | Sender address for emails |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | no | — | Turns on Razorpay checkout (see [Payments](#payments-razorpay-or-the-demo-processor)). Without them the demo card processor is used |
| `GOOGLE_CLIENT_ID` | no | — | Turns on **Continue with Google** (see [Google sign-in](#google-sign-in)). Without it the button is hidden |

Generate a secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. `.env` is git-ignored; no secrets are committed.

## Deployment

The app deploys as **one Render web service** (API + client) backed by **MongoDB Atlas**.

1. **Atlas:** create a free M0 cluster, add a database user, allow network access from `0.0.0.0/0` (Render's free tier has no fixed IPs), and copy the connection string, e.g. `mongodb+srv://user:pass@cluster.mongodb.net/housefull`.
2. **Render:** *New → Blueprint*, then select this repository. [`render.yaml`](render.yaml) configures the build (`npm run install:all && npm run build`), the start command, the health check and auto-generated secrets.
3. When prompted, set `MONGODB_URI` to your Atlas string.
4. After the first deploy, seed the demo data from your machine: `MONGODB_URI="<atlas uri>" npm run seed`.
5. Put the live URL at the top of this README. This deployment: **https://housefull-4eq8.onrender.com**

### Google sign-in

1. In [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type *Web application* (set up the OAuth consent screen first if asked).
2. Under **Authorized JavaScript origins** add `http://localhost:5173`, `https://localhost:5173` and your Render URL. Google doesn't accept bare IP addresses, so the button won't work on a phone opened via a LAN IP.
3. Set `GOOGLE_CLIENT_ID` in `server/.env` (and in Render). There's no client secret: our own button opens Google's sign-in popup (Google Identity Services), the browser gets a short-lived access token, and the server asks Google (tokeninfo) whether it's live, was issued to *this* client ID (so a token given to another app can't be replayed) and belongs to a verified email before signing anyone in.

A first Google sign-in creates an account (with the role picked on the sign-up page). If a password account already uses that verified email, Google is linked to it.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the server test suite, then the client lint and build on every push.

> Render's free tier sleeps after inactivity, so the first request can take around 30 seconds.

## Payments: Razorpay or the demo processor

With `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` set (test keys, `rzp_test_…`), checkout goes through **Razorpay**:

1. The server creates a Razorpay order for the exact bill (tickets, promo, add-ons, fee, GST).
2. The buyer pays in Razorpay's own window (card, UPI, netbanking, wallet), so payment details never touch Housefull.
3. The server verifies Razorpay's HMAC signature, checks the payment belongs to *this* hold's order and is for the full amount, captures it if needed, and only then issues tickets ([`razorpay.js`](server/src/services/razorpay.js)).
4. If anything fails after Razorpay took the money (the hold expired mid-payment, the price changed, seats clashed), the payment is refunded automatically. One payment can never pay for two orders. Cancellations and cancelled shows refund through Razorpay's API.

Razorpay test mode: card `4386 2894 0766 0153` (any future expiry, CVV and OTP) or UPI `success@razorpay`. Without Razorpay keys, the demo processor below is used, with the same seat-locking, idempotency and refund behaviour.

## Test cards

The payment processor is a **mock**: no real money moves and no payment provider is contacted. Only the last 4 digits are stored.

| Card number | Result |
|---|---|
| `4242 4242 4242 4242` | Success |
| `4000 0000 0000 0002` | Declined |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0000 0000 0119` | Gateway error |

Use any future expiry and any 3-digit CVC. Free events skip payment entirely.

## Test PANs

Host verification uses a **mock KYC provider** ([`kycService.js`](server/src/services/kycService.js)) with the same contract as a real one (PAN and name in; verified, not found, name mismatch or unavailable out), so going live only swaps that file for a licensed KYC provider or DigiLocker. No real PAN is checked, and only the last 4 characters are stored.

It applies the checks that work offline: the PAN format, a valid holder type (4th letter: `P` person, `C` company, `F` firm, ...), and that the 5th letter is the first letter of the surname (for a person) or of the name (otherwise).

| PAN | Name | Result |
|---|---|---|
| `ABCPO1234K` | Riya Organiser | Verified (the seeded organizer already is) |
| `ABCPK1234K` | Riya Organiser | Name mismatch |
| `AAAPZ0000Z` | anyone | Not found |
| `AAAPZ9999Z` | anyone | Provider unavailable |

Why not Aadhaar? Checking an Aadhaar number needs a UIDAI licence (or a licensed KYC agency), and storing Aadhaar data carries strict legal obligations. Ticketing platforms that pay organizers verify PAN (plus a bank account) instead.

## Project Structure

```
housefull/
├── server/
│   ├── src/
│   │   ├── config/        env validation, db connection
│   │   ├── models/        User, Event, Seat, Hold, Order, Ticket
│   │   ├── services/      business logic (holds, orders, check-in, stats, payments, signing)
│   │   ├── routes/        thin HTTP layer: validation → service → response
│   │   ├── middleware/    auth, validation, error handling
│   │   ├── realtime/      Socket.IO server and emit bus
│   │   ├── jobs/          hold sweeper
│   │   ├── app.js         Express app (exported for tests)
│   │   └── server.js      process entry: DB, HTTP, sockets, jobs, graceful shutdown
│   ├── scripts/seed.js
│   └── tests/             Vitest + Supertest integration tests
├── client/
│   └── src/
│       ├── pages/         Home, Event, Checkout, Tickets, Auth, organizer/*
│       ├── components/    SeatMap, QrScanner, TicketCard, LiveHouse, Logo, dialogs, motion
│       ├── hooks/         live event channel, countdown, debounce, pointer effects, page transitions
│       ├── context/       auth
│       └── lib/           API client, socket, formatting, best seats, confetti
├── render.yaml
└── .github/workflows/ci.yml
```

## Known limitations and next steps

- **Razorpay without webhooks.** Payments are confirmed when the browser returns from Razorpay's window; if a buyer closes the tab in that exact moment, the payment is captured without an order. Production would add Razorpay's `payment.captured` webhook to reconcile or refund those.
- **Single-instance realtime.** Running several server instances would need the Socket.IO Redis adapter so broadcasts reach every instance.
- **Email needs an SMTP provider in production.** Without `SMTP_URL`, emails are written to local `.eml` files. Sending is fire-and-forget (a mail outage never blocks a checkout), so there are no retries yet; a queue would add those.
- **One organizer account per event.** There's no separate door-staff role yet; the organizer scans tickets.
