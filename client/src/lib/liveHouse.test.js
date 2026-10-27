import { describe, it, expect } from 'vitest';
import { bookingOrder, houseLayout } from './liveHouse';

const perRow = (house) => Array.from({ length: house.rows }, (_, r) => house.seats.filter((s) => s.r === r));

describe('houseLayout', () => {
  it('fans out from a narrow front row to a wide back row', () => {
    const rows = perRow(houseLayout(1400));
    expect(rows).toHaveLength(12);
    for (let r = 1; r < rows.length; r++) {
      expect(rows[r].length).toBeGreaterThanOrEqual(rows[r - 1].length);
      expect(rows[r][0].s).toBeGreaterThan(rows[r - 1][0].s); // seats get bigger toward you
      expect(rows[r][0].y).toBeGreaterThan(rows[r - 1][0].y);
    }
    expect(rows.at(-1).length).toBe(32);
  });

  it('uses fewer rows and seats on a phone, and stays inside the width', () => {
    const house = houseLayout(375);
    expect(house.rows).toBe(9);
    for (const s of house.seats) {
      expect(s.x - s.s / 2).toBeGreaterThanOrEqual(0);
      expect(s.x + s.s / 2).toBeLessThanOrEqual(375);
      expect(s.y + s.s / 2).toBeLessThanOrEqual(house.height);
    }
  });
});

describe('bookingOrder', () => {
  const w = 1400;
  const house = houseLayout(w);
  const { order, yours } = bookingOrder(house, w);

  it('books every seat exactly once', () => {
    expect(order).toHaveLength(house.seats.length);
    expect(new Set(order).size).toBe(house.seats.length);
  });

  it('sells your seat last: the most central one, near the front', () => {
    expect(order.at(-1)).toBe(yours);
    const row = house.seats.filter((s) => s.r === house.seats[yours].r);
    const offCentre = (s) => Math.abs(s.x - w / 2);
    expect(Math.min(...row.map(offCentre))).toBe(offCentre(house.seats[yours]));
    expect(house.seats[yours].r).toBeLessThan(house.rows / 2);
  });

  it('fills the front row before the back row', () => {
    const at = new Map(order.map((seat, i) => [seat, i]));
    const front = house.seats.map((s, i) => i).filter((i) => house.seats[i].r === 0 && i !== yours);
    const back = house.seats.map((s, i) => i).filter((i) => house.seats[i].r === house.rows - 1);
    expect(Math.max(...front.map((i) => at.get(i)))).toBeLessThan(Math.min(...back.map((i) => at.get(i))));
  });
});
