// Builds an iCalendar (.ics) file for an event (RFC 5545), which Google
// Calendar, Apple Calendar and Outlook can all import.

const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// TEXT values escape backslash, semicolon, comma and newlines.
const text = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines longer than 75 octets are folded: CRLF followed by a space. Never
// split inside a multi-byte character.
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + n > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function eventToIcs({ id, title, startsAt, durationMinutes, venue, description = '', url = '' }, now = new Date()) {
  const end = new Date(new Date(startsAt).getTime() + (durationMinutes || 120) * 60_000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Housefull//Tickets//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${id}@housefull`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(startsAt)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${text(title)}`,
    `LOCATION:${text(`${venue.name}, ${venue.city}`)}`,
    `DESCRIPTION:${text([description, url && `Tickets: ${url}`].filter(Boolean).join('\n\n'))}`,
    url && `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function downloadIcs(event) {
  const ics = eventToIcs({ ...event, url: `${window.location.origin}/events/${event.id ?? event._id}`, id: event.id ?? event._id });
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href,
    download: `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event'}.ics`,
  });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
