import { describe, it, expect } from 'vitest';
import { eventToIcs } from './calendar';

const event = {
  id: 'abc123', title: 'Jazz, Blues; and \\ more', startsAt: '2026-11-17T13:30:00.000Z', durationMinutes: 150,
  venue: { name: 'Seaside Amphitheatre', city: 'Mumbai' }, description: 'Line one\nLine two', url: 'https://housefull.dev/events/abc123',
};

describe('eventToIcs', () => {
  const ics = eventToIcs(event, new Date('2026-10-01T00:00:00Z'));
  const lines = ics.split('\r\n');

  it('uses CRLF line endings and wraps the event in a calendar', () => {
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
  });

  it('writes UTC start and end from the duration', () => {
    expect(ics).toContain('DTSTART:20261117T133000Z');
    expect(ics).toContain('DTEND:20261117T160000Z');
    expect(ics).toContain('UID:abc123@housefull');
  });

  it('escapes special characters', () => {
    expect(ics).toContain('SUMMARY:Jazz\\, Blues\; and \\\\ more');
    expect(ics).toContain('LOCATION:Seaside Amphitheatre\\, Mumbai');
  });

  it('folds long lines at 75 octets', () => {
    const long = eventToIcs({ ...event, description: 'é'.repeat(100) });
    for (const line of long.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(long).toContain('\r\n ');
  });
});
