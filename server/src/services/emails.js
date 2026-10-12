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
  return `<!doctype html><html><body style="margin:0;background:#f1ebe0;font-family:Helvetica,Arial,sans-serif;color:#1b1916">
<span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1ebe0;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #cfc6b6">
<tr><td style="background:#0c0b0a;padding:18px 24px;color:#ff5321;font-weight:800;font-size:20px;letter-spacing:-0.5px">SEATLOCK</td></tr>
${heroRow}
<tr><td style="padding:28px 24px 8px"><h1 style="margin:0;font-size:26px;line-height:1.15;text-transform:uppercase">${esc(heading)}</h1></td></tr>
<tr><td style="padding:8px 24px 28px;font-size:15px;line-height:1.55">${body}</td></tr>
<tr><td style="border-top:1px dashed #cfc6b6;padding:16px 24px;font-size:12px;color:#6f6a62">Demo payments only · no real money is charged. You're receiving this because of activity on your SeatLock account.</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href, label) => `<a href="${esc(href)}" style="display:inline-block;margin-top:16px;background:#ff5321;color:#0c0b0a;font-weight:700;text-decoration:none;padding:12px 18px">${esc(label)}</a>`;

export async function orderConfirmationEmail({ user, event, order, tickets }) {
  const attachments = await Promise.all(tickets.map(async (t) => ({
    filename: `ticket-${t.label}.png`,
    content: await QRCode.toBuffer(qrUrlFor(t._id), { width: 240, margin: 1 }),
    cid: `qr-${t._id}@seatlock`,
  })));
  const rows = tickets.map((t) => `<tr>
    <td style="padding:12px 0;border-bottom:1px solid #eee;vertical-align:top"><strong style="font-size:22px">${esc(t.label)}</strong><br><span style="color:#6f6a62;font-size:13px">${esc(t.tier)} · ${money(t.price)}</span></td>
    <td align="right" style="padding:12px 0;border-bottom:1px solid #eee"><img src="cid:qr-${t._id}@seatlock" width="120" height="120" alt="QR code for seat ${esc(t.label)}"></td>
  </tr>`).join('');
  const line = (label, value, muted = true) => `<tr><td style="padding-top:6px;${muted ? 'color:#6f6a62' : ''}">${label}</td><td align="right" style="padding-top:6px">${value}</td></tr>`;
  const discount = [
    line('Tickets', money(order.subtotal ?? order.amount)),
    order.discount ? line(`Promo ${esc(order.promo?.code)}`, `\u2212${money(order.discount)}`) : '',
    ...(order.addons ?? []).map((a) => line(`${esc(a.name)} \u00d7 ${a.qty}`, money(a.price * a.qty))),
    order.bookingFee ? line('Booking fee', money(order.bookingFee)) : '',
    order.gst ? line('GST on booking fee (18%)', money(order.gst)) : '',
  ].join('');
  const addonNote = order.addons?.length ? '<p style="font-size:13px;color:#6f6a62">Collect your add-ons at the venue counter by showing this order number.</p>' : '';
  const html = layout({
    preheader: `Your tickets for ${event.title}`,
    heading: `You're in: ${event.title}`,
    body: `<p style="margin:0 0 4px">Hi ${esc(user.name)}, your order is confirmed.</p>
<p style="margin:0;color:#6f6a62">${esc(when(event.startsAt))}<br>${esc(event.venue.name)}, ${esc(event.venue.city)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px">${rows}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;font-size:14px">${discount}
<tr><td style="padding-top:8px;font-weight:700">Total paid</td><td align="right" style="padding-top:8px;font-weight:700">${money(order.amount)}</td></tr></table>
<p style="font-size:13px;color:#6f6a62">Show each QR code at the door. Order #${esc(String(order._id).slice(-8).toUpperCase())}.</p>${addonNote}
${button(url('/tickets'), 'View my tickets')}`,
  });
  const text = `You're in: ${event.title}\n${when(event.startsAt)}\n${event.venue.name}, ${event.venue.city}\n\n${tickets.map((t) => `${t.label} (${t.tier}) ${money(t.price)}`).join('\n')}${(order.addons ?? []).map((a) => `\n${a.name} x ${a.qty}`).join('')}\nTotal paid: ${money(order.amount)}\n\nYour QR tickets: ${url('/tickets')}`;
  return { to: user.email, subject: `Your tickets: ${event.title}`, html, text, attachments };
}

export function ticketReceivedEmail({ recipient, sender, event, ticket }) {
  const html = layout({
    preheader: `${sender.name} sent you a ticket`,
    heading: 'A ticket for you',
    body: `<p style="margin:0">Hi ${esc(recipient.name)}, <strong>${esc(sender.name)}</strong> sent you seat <strong>${esc(ticket.label)}</strong> (${esc(ticket.tier)}) for <strong>${esc(event.title)}</strong>.</p>
<p style="color:#6f6a62">${esc(when(event.startsAt))}<br>${esc(event.venue.name)}, ${esc(event.venue.city)}</p>
<p>Your QR code is in your SeatLock account.</p>${button(url('/tickets'), 'Open my tickets')}`,
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
export function feedbackRequestEmail({ user, event }) {
  const link = url(`/events/${event._id}#reviews`);
  const stars = [1, 2, 3, 4, 5].map((n) => `<a href="${esc(link)}" style="color:#f2b13c;text-decoration:none;font-size:30px" aria-label="${n} star${n > 1 ? 's' : ''}">&#9733;</a>`).join(' ');
  const html = layout({
    preheader: `Tell ${event.title} how it went. It takes a minute.`,
    heading: 'How was it?',
    hero: event.coverImageUrl,
    body: `<p style="margin:0 0 12px">Hi ${esc(user.name.split(' ')[0])}, thanks for coming to <strong>${esc(event.title)}</strong>.</p>
<p style="margin:0 0 8px">Rate the night and tell the organizer what worked and what didn't. You can also leave a note only they will see.</p>
<p style="margin:12px 0 4px">${stars}</p>
${button(link, 'Leave feedback')}`,
  });
  const text = `Thanks for coming to ${event.title}. How was it? Leave a rating and feedback: ${link}`;
  return { to: user.email, subject: `How was ${event.title}?`, html, text };
}
