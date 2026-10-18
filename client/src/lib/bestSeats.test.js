import { describe, it, expect } from 'vitest';
import { findBestSeats } from './bestSeats';

// rows: [['A', 10, 'VIP'], ...]; taken: ['A5', ...]
function house(spec, taken = [], held = []) {
  const rows = spec.map(([label]) => ({ label }));
  const seats = spec.flatMap(([label, n, tier]) => Array.from({ length: n }, (_, i) => {
    const l = `${label}${i + 1}`;
    return { id: l, row: label, number: i + 1, label: l, tier, status: taken.includes(l) ? 'sold' : held.includes(l) ? 'held' : 'available' };
  }));
  return { rows, seats };
}
const labels = (r) => r?.map((s) => s.label);

describe('findBestSeats', () => {
  it('picks the centre of the front row', () => {
    expect(labels(findBestSeats({ ...house([['A', 10, 'X'], ['B', 10, 'X']]), count: 2 }))).toEqual(['A5', 'A6']);
  });

  it('keeps the block together and skips taken seats', () => {
    const h = house([['A', 10, 'X'], ['B', 10, 'X']], ['A5', 'A6']);
    // A3-A4 / A7-A8 are 1.5 off centre; B5-B6 is a row back (cost 2). Front wins.
    expect(labels(findBestSeats({ ...h, count: 2 }))).toEqual(['A3', 'A4']);
  });

  it('moves back a row rather than to the far edge', () => {
    const h = house([['A', 10, 'X'], ['B', 10, 'X']], ['A3', 'A4', 'A5', 'A6', 'A7', 'A8']);
    expect(labels(findBestSeats({ ...h, count: 2 }))).toEqual(['B5', 'B6']);
  });

  it('respects the tier filter', () => {
    const h = house([['A', 6, 'VIP'], ['B', 6, 'General']]);
    expect(labels(findBestSeats({ ...h, count: 3, tier: 'General' }))).toEqual(['B2', 'B3', 'B4']);
  });

  it('treats seats held by someone else as taken, and your own hold as free', () => {
    const h = house([['A', 4, 'X']], [], ['A2', 'A3']);
    expect(findBestSeats({ ...h, count: 2 })).toEqual(null);
    h.seats.forEach((s) => { if (s.status === 'held') s.mine = true; });
    expect(labels(findBestSeats({ ...h, count: 2 }))).toEqual(['A2', 'A3']);
  });

  it('never puts a block across an aisle', () => {
    const h = house([['A', 6, 'X']]);
    h.rows[0].aisleAfter = [3]; // A1 A2 A3 | A4 A5 A6
    expect(labels(findBestSeats({ ...h, count: 3 }))).toEqual(['A1', 'A2', 'A3']);
    expect(findBestSeats({ ...h, count: 4 })).toBe(null);
  });

  it('skips blocked spots, which have no seat', () => {
    const h = house([['A', 5, 'X']]);
    h.seats = h.seats.filter((s) => s.label !== 'A3'); // A3 is a pillar
    expect(labels(findBestSeats({ ...h, count: 2 }))).toEqual(['A1', 'A2']);
  });

  it('returns null when no block that size exists', () => {
    const h = house([['A', 5, 'X']], ['A3']);
    expect(findBestSeats({ ...h, count: 3 })).toBe(null);
    expect(findBestSeats({ ...h, count: 0 })).toBe(null);
  });
});
