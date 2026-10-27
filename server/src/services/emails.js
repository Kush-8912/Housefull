import QRCode from 'qrcode';
import { env } from '../config/env.js';
import { qrUrlFor } from './ticketSigner.js';

// Transactional email templates. Table layout + inline styles because that is
// what email clients reliably render. Every interpolated value is escaped.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const money = (n) => inr.format(n);
// Emails can't use the reader's browser time zone, so state the zone used.
const when = (d) => `${new Intl.DateTimeFormat('en-IN', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
}).format(new Date(d))} IST`;
const url = (p) => `${env.APP_URL}${p}`;

// Only absolute http(s) images make it into an email; anything else is dropped.
const safeImage = (src) => (/^https?:\/\//i.test(src ?? '') ? src : null);

function layout({ preheader, heading, body, hero = null }) {
  const heroRow = safeImage(hero)
    ? `<tr><td style="padding:0;line-height:0"><img src="${esc(hero)}" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;max-height:260px;object-fit:cover"></td></tr>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f1ebe0;font-family:Helvetica,Arial,sans-serif;color:#1b1916">
<span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1ebe0;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #cfc6b6">
<tr><td style="background:#0c0b0a;padding:18px 24px;font-weight:800;font-size:20px;letter-spacing:-0.5px"><span style="color:#f1ece3">HOUSE</span><span style="color:#ff5321">FULL</span><span style="float:right;margin-top:6px;font-weight:400;font-size:12px;letter-spacing:0;color:#a39d93">Get in before it’s housefull.</span></td></tr>
${heroRow}
<tr><td style="padding:28px 24px 8px"><h1 style="margin:0;font-size:26px;line-height:1.15;text-transform:uppercase">${esc(heading)}</h1></td></tr>
<tr><td style="padding:8px 24px 28px;font-size:15px;line-height:1.55">${body}</td></tr>
<tr><td style="border-top:1px dashed #cfc6b6;padding:16px 24px;font-size:12px;color:#6f6a62">Demo payments only · no real money is charged. You're receiving this because of activity on your Housefull account.</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href, label) => `<a href="${esc(href)}" style="display:inline-block;margin-top:16px;background:#ff5321;color:#0c0b0a;font-weight:700;text-decoration:none;padding:12px 18px">${esc(label)}</a>`;

// Pieces of the event as printed on a ticket, in India time.
const ist = (d, opts) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...opts }).format(new Date(d));
const clock = (d) => ist(d, { hour: 'numeric', minute: '2-digit' }).toUpperCase();
const mapsUrl = (venue) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.name}, ${venue.city}`)}`;
const DOORS_BEFORE_MIN = 30;

/**
 * The event as a ticket: a dark stub with the date block on the left and the
 * time and venue on the right, the way the app's ticket cards look.
 * `extra` adds rows underneath (seats, a note).
 */
function eventPanel(event, extra = '') {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0c0b0a;color:#f1ece3;border-radius:6px">
<tr>
<td width="84" align="center" style="background:#ff5321;color:#0c0b0a;border-radius:6px 0 0 6px;padding:14px 8px;vertical-align:middle">
<div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase">${esc(ist(event.startsAt, { month: 'short' }))}</div>
<div style="font-size:38px;font-weight:800;line-height:1">${esc(ist(event.startsAt, { day: 'numeric' }))}</div>
<div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase">${esc(ist(event.startsAt, { weekday: 'short' }))}</div>
</td>
<td style="padding:14px 18px;vertical-align:middle">
<div style="font-size:19px;font-weight:800;text-transform:uppercase;line-height:1.15">${esc(event.title)}</div>
<div style="margin-top:6px;font-size:14px;color:#a39d93">${esc(clock(event.startsAt))} IST · Doors ${esc(clock(new Date(new Date(event.startsAt).getTime() - DOORS_BEFORE_MIN * 60_000)))}</div>
<div style="margin-top:2px;font-size:14px"><a href="${esc(mapsUrl(event.venue))}" style="color:#f1ece3;text-decoration:underline">${esc(event.venue.name)}, ${esc(event.venue.city)}</a></div>
${extra}
</td></tr></table>`;
}

const secondaryButton = (href, label) => `<a href="${esc(href)}" style="display:inline-block;margin:16px 0 0 8px;border:1px solid #1b1916;color:#1b1916;font-weight:700;text-decoration:none;padding:11px 16px">${esc(label)}</a>`;

export async function orderConfirmationEmail({ user, event, order, tickets }) {
  const attachments = await Promise.all(tickets.map(async (t) => ({
    filename: `ticket-${t.label}.png`,
    content: await QRCode.toBuffer(qrUrlFor(t._id), { width: 240, margin: 1 }),
    cid: `qr-${t._id}@housefull`,
  })));
  // One tear-off stub per seat: seat and tier on the left, its QR on the right.
  const stubs = tickets.map((t) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;background:#f1ebe0;border:1px dashed #cfc6b6;border-radius:6px">
<tr><td style="padding:14px 18px;vertical-align:middle">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6f6a62">Admit one · Seat</div>
<div style="font-size:44px;font-weight:800;line-height:1;margin-top:2px">${esc(t.label)}</div>
<div style="margin-top:6px;font-size:13px;color:#6f6a62">${esc(t.tier)} · ${money(t.price)}</div>
</td>
<td align="right" style="padding:10px 14px;vertical-align:middle"><img src="cid:qr-${t._id}@housefull" width="112" height="112" alt="QR code for seat ${esc(t.label)}" style="display:block;background:#fff;padding:4px"></td></tr></table>`).join('');
  const line = (label, value, muted = true) => `<tr><td style="padding-top:6px;${muted ? 'color:#6f6a62' : ''}">${label}</td><td align="right" style="padding-top:6px">${value}</td></tr>`;
  const bill = [
    line('Tickets', money(order.subtotal ?? order.amount)),
    order.discount ? line(`Promo ${esc(order.promo?.code)}`, `−${money(order.discount)}`) : '',
    ...(order.addons ?? []).map((a) => line(`${esc(a.name)} × ${a.qty}`, money(a.price * a.qty))),
    order.bookingFee ? line('Booking fee', money(order.bookingFee)) : '',
    order.gst ? line('GST on booking fee (18%)', money(order.gst)) : '',
  ].join('');
  const orderNo = String(order._id).slice(-8).toUpperCase();
  const addonNote = order.addons?.length ? `<p style="font-size:13px;color:#6f6a62;margin:12px 0 0">Collect your add-ons at the venue counter with order #${esc(orderNo)}.</p>` : '';
  const html = layout({
    preheader: `${tickets.length} ticket${tickets.length > 1 ? 's' : ''} for ${event.title}: ${tickets.map((t) => t.label).join(', ')}`,
    heading: 'You’re in.',
    hero: event.coverImageUrl,
    body: `<p style="margin:0 0 16px">Hi ${esc(user.name.split(' ')[0])}, you got in before it went housefull. Here are your tickets.</p>
${eventPanel(event)}
${stubs}
<p style="margin:10px 0 0;font-size:13px;color:#6f6a62">Show the QR code at the door (or open it in the app). Each code works once.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;font-size:14px;border-top:1px solid #eee">${bill}
<tr><td style="padding-top:10px;font-weight:700;font-size:16px">Total paid</td><td align="right" style="padding-top:10px;font-weight:700;font-size:16px">${money(order.amount)}</td></tr>
<tr><td colspan="2" style="padding-top:4px;font-size:12px;color:#6f6a62">Order #${esc(orderNo)}${order.payment?.last4 ? ` · card ••${esc(order.payment.last4)}` : ''}</td></tr></table>${addonNote}
${button(url('/tickets'), 'View my tickets')}${secondaryButton(mapsUrl(event.venue), 'Get directions')}`,
  });
  const text = `You're in: ${event.title}\n${when(event.startsAt)}\n${event.venue.name}, ${event.venue.city}\n\n${tickets.map((t) => `${t.label} (${t.tier}) ${money(t.price)}`).join('\n')}${(order.addons ?? []).map((a) => `\n${a.name} x ${a.qty}`).join('')}\nTotal paid: ${money(order.amount)}\nOrder #${orderNo}\n\nYour QR tickets: ${url('/tickets')}`;
  return { to: user.email, subject: `Your tickets: ${event.title}`, html, text, attachments };
}

// The morning-of nudge, a few hours before doors: time, seats, how to get there.
export function showdayReminderEmail({ user, event, tickets }) {
  const seats = tickets.map((t) => t.label).join(', ');
  const html = layout({
    preheader: `${event.title} starts at ${clock(event.startsAt)}. Your seats: ${seats}`,
    heading: 'It’s showtime today',
    hero: event.coverImageUrl,
    body: `<p style="margin:0 0 16px">Hi ${esc(user.name.split(' ')[0])}, today’s the day. Doors open ${DOORS_BEFORE_MIN} minutes before the start, so aim to be there early.</p>
${eventPanel(event, `<div style="margin-top:10px;font-size:14px"><strong>Your seat${tickets.length > 1 ? 's' : ''}:</strong> ${esc(seats)}</div>`)}
<ul style="margin:18px 0 0;padding-left:20px">
<li style="margin:0 0 6px">Have your QR code open and turn your screen brightness up at the door.</li>
<li style="margin:0 0 6px">Latecomers may have to wait for a suitable break to be seated.</li>
<li style="margin:0 0 6px">Each QR code works once, so keep it to yourself.</li>
</ul>
${button(url('/tickets'), 'Open my tickets')}${secondaryButton(mapsUrl(event.venue), 'Get directions')}`,
  });
  const text = `It's showtime today: ${event.title}\n${when(event.startsAt)} (doors ${DOORS_BEFORE_MIN} min earlier)\n${event.venue.name}, ${event.venue.city}\nYour seats: ${seats}\n\nTickets: ${url('/tickets')}\nDirections: ${mapsUrl(event.venue)}`;
  return { to: user.email, subject: `Today at ${clock(event.startsAt)}: ${event.title}`, html, text };
}

// Sent once, when an account is created (password sign-up or a first Google
// sign-in). Attendees get how booking works; organizers get how to start selling.
export function welcomeEmail({ user }) {
  const first = user.name.split(' ')[0];
  const organizer = user.role === 'organizer';
  const steps = organizer
    ? [
      ['Verify your identity', 'A quick PAN check on your profile. Tickets only go on sale from verified hosts.'],
      ['Build your seat map', 'Tiers, prices and a row-by-row layout, with a live preview as you go.'],
      ['Publish & scan', 'Tickets go on sale instantly. At the door, scan QR codes from your phone.'],
    ]
    : [
      ['Pick', 'Choose your exact seats on a live seat map, not just a section.'],
      ['Hold', 'Your seats are locked to you while you pay. Nobody else can grab them.'],
      ['Walk in', 'Show the QR ticket at the door. It’s in your email and under My tickets.'],
    ];
  const rows = steps.map(([title, text], i) => `<tr>
<td width="44" valign="top" style="padding:10px 0"><div style="width:32px;height:32px;line-height:32px;text-align:center;background:#ff5321;color:#0c0b0a;font-weight:800;border-radius:6px">${i + 1}</div></td>
<td valign="top" style="padding:10px 0"><div style="font-weight:700;font-size:16px">${esc(title)}</div><div style="color:#6f6a62;font-size:14px;margin-top:2px">${esc(text)}</div></td>
</tr>`).join('');
  const html = layout({
    preheader: organizer ? 'Three steps to your first sold-out show.' : 'Pick the seat, not the section. Here’s how it works.',
    heading: organizer ? `Welcome, ${first}. Let’s fill your house.` : `Welcome to Housefull, ${first}`,
    body: `<p style="margin:0 0 8px">${organizer
      ? 'Your organizer account is ready. Here’s how to get your first event on sale:'
      : 'Your account is ready. Booking on Housefull takes three steps:'}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0">${rows}</table>
${organizer ? button(url('/profile#verify'), 'Verify & create your first event') : button(url('/'), 'Find a show')}
<p style="margin:18px 0 0;font-size:13px;color:#6f6a62">You signed up with ${esc(user.email)}. If that wasn’t you, you can ignore this email.</p>`,
  });
  const text = `Welcome to Housefull, ${first}!\n\n${steps.map(([t, x], i) => `${i + 1}. ${t}: ${x}`).join('\n')}\n\n${organizer ? `Get started: ${url('/profile#verify')}` : `Find a show: ${url('/')}`}`;
  return { to: user.email, subject: organizer ? 'Welcome to Housefull: start selling tickets' : `Welcome to Housefull, ${first}`, html, text };
}

// The organizer moved the show. Tickets stay valid; the old time is struck through.
export function eventRescheduledEmail({ user, event, previousStartsAt }) {
  const html = layout({
    preheader: `New time for ${event.title}: ${when(event.startsAt)}`,
    heading: 'New date & time',
    hero: event.coverImageUrl,
    body: `<p style="margin:0 0 12px">Hi ${esc(user.name.split(' ')[0])}, the organizer has moved <strong>${esc(event.title)}</strong>.</p>
<p style="margin:0 0 16px;font-size:15px"><span style="color:#6f6a62;text-decoration:line-through">${esc(when(previousStartsAt))}</span><br><strong style="font-size:18px">${esc(when(event.startsAt))}</strong></p>
${eventPanel(event)}
<p style="margin:16px 0 0">Your tickets, seats and QR codes stay exactly the same. Can’t make the new time? Because the show moved, you can cancel from <em>My tickets</em> for a full refund of your tickets, up to a day before.</p>
${button(url('/tickets'), 'View my tickets')}`,
  });
  const text = `${event.title} has moved.\nWas: ${when(previousStartsAt)}\nNow: ${when(event.startsAt)}\n${event.venue.name}, ${event.venue.city}\n\nYour tickets stay the same. Can't make it? Cancel for a refund: ${url('/tickets')}`;
  return { to: user.email, subject: `New time: ${event.title}`, html, text };
}

// The organizer cancelled the show. `refund` is the buyer's refunded order
// (null for someone who was sent a ticket: the refund goes to whoever paid).
export function eventCancelledEmail({ user, event, refund }) {
  const money_ = refund?.refundedAmount ? money(refund.refundedAmount) : null;
  const refundLine = refund
    ? `<p style="margin:16px 0 0">${money_ ? `<strong>${money_}</strong> has been refunded to your card${refund.payment?.last4 ? ` ••${esc(refund.payment.last4)}` : ''}, booking fee included. It usually shows up within 5–7 working days.` : 'Your free tickets have been cancelled.'}</p>`
    : '<p style="margin:16px 0 0">The ticket you were sent has been cancelled; the refund goes to the person who bought it.</p>';
  const html = layout({
    preheader: `${event.title} has been cancelled${money_ ? `. ${money_} refunded.` : ''}`,
    heading: 'This show is cancelled',
    hero: event.coverImageUrl,
    body: `<p style="margin:0 0 16px">Hi ${esc(user.name.split(' ')[0])}, we’re sorry: the organizer has cancelled <strong>${esc(event.title)}</strong>.</p>
${eventPanel(event, '<div style="margin-top:10px;display:inline-block;border:2px solid #ff5d5d;color:#ff5d5d;font-size:12px;font-weight:800;letter-spacing:2px;padding:3px 8px;text-transform:uppercase">Cancelled</div>')}
${refundLine}
${button(url('/'), 'Find another show')}`,
  });
  const text = `${event.title} (${when(event.startsAt)}) has been cancelled by the organizer.${money_ ? ` ${money_} has been refunded to your card.` : ''}\nFind another show: ${url('/')}`;
  return { to: user.email, subject: `Cancelled: ${event.title}`, html, text };
}

// Receipt for an attendee cancelling their own order.
export function orderRefundedEmail({ user, event, order, percent = 100 }) {
  const fee = (order.bookingFee ?? 0) + (order.gst ?? 0);
  const charge = Math.max(0, order.amount - fee - (order.refundedAmount ?? 0)); // what the cancellation policy kept
  const orderNo = String(order._id).slice(-8).toUpperCase();
  const html = layout({
    preheader: `${money(order.refundedAmount ?? 0)} refunded for ${event.title}`,
    heading: 'Refund on its way',
    body: `<p style="margin:0 0 16px">Hi ${esc(user.name.split(' ')[0])}, you cancelled your order for <strong>${esc(event.title)}</strong> and your tickets are no longer valid.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;background:#f1ebe0;border:1px dashed #cfc6b6;border-radius:6px">
<tr><td style="padding:14px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="color:#6f6a62">Paid</td><td align="right">${money(order.amount)}</td></tr>
${fee ? `<tr><td style="color:#6f6a62;padding-top:4px">Booking fee + GST (not refundable)</td><td align="right" style="padding-top:4px">−${money(fee)}</td></tr>` : ''}
${charge ? `<tr><td style="color:#6f6a62;padding-top:4px">Cancellation charge (${100 - percent}% of tickets)</td><td align="right" style="padding-top:4px">−${money(charge)}</td></tr>` : ''}
<tr><td style="padding-top:8px;font-weight:700;font-size:16px">Refunded</td><td align="right" style="padding-top:8px;font-weight:700;font-size:16px">${money(order.refundedAmount ?? 0)}</td></tr>
</table>
<div style="margin-top:8px;font-size:12px;color:#6f6a62">Order #${esc(orderNo)}${order.payment?.last4 ? ` · to card ••${esc(order.payment.last4)}` : ''} · usually 5–7 working days</div>
</td></tr></table>
<p style="margin:16px 0 0">Your seats are back on sale for someone else.</p>
${button(url('/'), 'Find another show')}`,
  });
  const text = `You cancelled your order #${orderNo} for ${event.title}. Refunded: ${money(order.refundedAmount ?? 0)}${fee ? ` (booking fee ${money(fee)} not refundable)` : ''}${charge ? `; cancellation charge ${money(charge)}` : ''}.`;
  return { to: user.email, subject: `Refund confirmed: ${event.title}`, html, text };
}

export function ticketReceivedEmail({ recipient, sender, event, ticket }) {
  const html = layout({
    preheader: `${sender.name} sent you a ticket`,
    heading: 'A ticket for you',
    body: `<p style="margin:0">Hi ${esc(recipient.name)}, <strong>${esc(sender.name)}</strong> sent you seat <strong>${esc(ticket.label)}</strong> (${esc(ticket.tier)}) for <strong>${esc(event.title)}</strong>.</p>
<p style="color:#6f6a62">${esc(when(event.startsAt))}<br>${esc(event.venue.name)}, ${esc(event.venue.city)}</p>
<p>Your QR code is in your Housefull account.</p>${button(url('/tickets'), 'Open my tickets')}`,
  });
  const text = `${sender.name} sent you seat ${ticket.label} for ${event.title} (${when(event.startsAt)}). Your QR code: ${url('/tickets')}`;
  return { to: recipient.email, subject: `${sender.name} sent you a ticket for ${event.title}`, html, text };
}

export function waitlistAvailableEmail({ user, event, available }) {
  const html = layout({
    preheader: `Seats just opened up for ${event.title}`,
    heading: 'Seats just opened up',
    body: `<p style="margin:0">Hi ${esc(user.name)}, ${available === 1 ? 'a seat has' : `${available} seats have`} come back on sale for <strong>${esc(event.title)}</strong>.</p>
<p style="color:#6f6a62">Seats go to whoever books first, so be quick.</p>${button(url(`/events/${event._id}`), 'Pick your seat')}`,
  });
  const text = `Seats just opened up for ${event.title}. Book here: ${url(`/events/${event._id}`)}`;
  return { to: user.email, subject: `Seats available: ${event.title}`, html, text };
}

// The day-before email. `copy` comes from reminderCopy.js (Claude or the template).
export function eventReminderEmail({ user, event, copy, tickets }) {
  const seats = tickets.map((t) => t.label).join(', ');
  const tips = copy.tips.map((t) => `<li style="margin:0 0 6px">${esc(t)}</li>`).join('');
  const html = layout({
    preheader: copy.preheader,
    heading: copy.headline,
    hero: event.coverImageUrl,
    body: `<p style="margin:0 0 12px">Hi ${esc(user.name.split(' ')[0])},</p>
<p style="margin:0 0 16px">${esc(copy.intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1ebe0;border:1px dashed #cfc6b6">
<tr><td style="padding:14px 16px">
<p style="margin:0;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6f6a62">Admit ${tickets.length}</p>
<p style="margin:4px 0 0;font-size:20px;font-weight:800">${esc(event.title)}</p>
<p style="margin:6px 0 0">${esc(when(event.startsAt))}<br>${esc(event.venue.name)}, ${esc(event.venue.city)}</p>
<p style="margin:8px 0 0"><strong>Your seat${tickets.length > 1 ? 's' : ''}:</strong> ${esc(seats)}</p>
</td></tr></table>
<p style="margin:18px 0 6px;font-weight:700">Before you go</p>
<ul style="margin:0;padding-left:20px">${tips}</ul>
${button(url('/tickets'), 'Open my tickets')}
<p style="margin:14px 0 0;font-size:13px"><a href="${esc(url(`/events/${event._id}`))}" style="color:#6f6a62">Event details and add to calendar</a></p>`,
  });
  const text = `${copy.headline}\n\nHi ${user.name.split(' ')[0]},\n${copy.intro}\n\n${event.title}\n${when(event.startsAt)}\n${event.venue.name}, ${event.venue.city}\nYour seats: ${seats}\n\nBefore you go:\n${copy.tips.map((t) => `- ${t}`).join('\n')}\n\nYour QR tickets: ${url('/tickets')}`;
  return { to: user.email, subject: copy.subject, html, text };
}

// Sent a few hours after the show to people who were scanned in.
export function feedbackRequestEmail({ user, event, form = null }) {
  const reviewLink = url(`/events/${event._id}#reviews`);
  // With an organizer's form, the stars and button lead to it instead of the review box.
  const link = form ? url(`/events/${event._id}/feedback`) : reviewLink;
  const stars = [1, 2, 3, 4, 5].map((n) => `<a href="${esc(link)}" style="color:#f2b13c;text-decoration:none;font-size:30px" aria-label="${n} star${n > 1 ? 's' : ''}">&#9733;</a>`).join(' ');
  const ask = form
    ? `<p style="margin:0 0 8px">The organizer made a short feedback form (${form.questions} question${form.questions === 1 ? '' : 's'}, about two minutes). Once you’ve answered, you’ll see how everyone else rated it too.</p>`
    : '<p style="margin:0 0 8px">Rate the night and tell the organizer what worked and what didn’t. You can also leave a note only they will see.</p>';
  const html = layout({
    preheader: `Tell ${event.title} how it went. It takes a minute.`,
    heading: 'How was it?',
    hero: event.coverImageUrl,
    body: `<p style="margin:0 0 12px">Hi ${esc(user.name.split(' ')[0])}, thanks for coming to <strong>${esc(event.title)}</strong>.</p>
${ask}
<p style="margin:12px 0 4px">${stars}</p>
${button(link, form ? 'Answer the feedback form' : 'Leave feedback')}`,
  });
  const text = `Thanks for coming to ${event.title}. How was it? ${form ? 'Answer the feedback form' : 'Leave a rating and feedback'}: ${link}`;
  return { to: user.email, subject: `How was ${event.title}?`, html, text };
}
