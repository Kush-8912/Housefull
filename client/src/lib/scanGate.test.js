import { describe, it, expect } from 'vitest';
import { createScanGate } from './scanGate';

// Reads of `code` every 100 ms (a 10 fps camera) from `from` to `to`.
const hold = (gate, code, from, to) => {
  const passed = [];
  for (let t = from; t <= to; t += 100) if (gate(code, t)) passed.push(t);
  return passed;
};

describe('createScanGate', () => {
  it('counts a ticket held in front of the camera once, however long it stays there', () => {
    const gate = createScanGate(3000);
    expect(hold(gate, 'A', 0, 20_000)).toEqual([0]);
  });

  it('counts it again once it has been out of view for the gap', () => {
    const gate = createScanGate(3000);
    expect(hold(gate, 'A', 0, 2000)).toEqual([0]);
    expect(gate('A', 2000 + 1500)).toBe(false); // back after 1.5 s: same scan
    expect(gate('A', 3500 + 3000)).toBe(true); // back after 3 s away: a real rescan
  });

  it('lets the next ticket through straight away', () => {
    const gate = createScanGate(3000);
    expect(gate('A', 0)).toBe(true);
    expect(gate('B', 200)).toBe(true);
    expect(gate('A', 400)).toBe(true);
  });

  it('scans a ticket that was held up while the previous check-in was still running', () => {
    const gate = createScanGate(3000);
    expect(gate('A', 0)).toBe(true);
    expect(gate('B', 100, true)).toBe(false); // paused: not counted
    expect(gate('B', 200, true)).toBe(false);
    expect(gate('B', 300, false)).toBe(true); // resumed, B still in view
    expect(gate('B', 400, false)).toBe(false);
  });
});
