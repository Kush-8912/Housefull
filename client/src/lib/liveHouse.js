// Geometry and booking order for the home page's live house (LiveHouse.jsx).

// Rows of seats in perspective: narrow and small near the stage (top), wide
// and big at the back (bottom). The canvas height follows from the width.
export function houseLayout(w) {
  const phone = w < 640;
  const rows = phone ? 9 : 12;
  const back = Math.max(14, Math.min(32, Math.round(w / 42)));
  const front = Math.round(back * 0.5);
  const stageH = phone ? 48 : 76;
  const seats = [];
  let y = stageH;
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    // Size seats from the unrounded count so they grow smoothly row to row,
    // then centre however many whole seats that row gets.
    const exact = front + (back - front) * t;
    const n = Math.round(exact);
    const pitch = (w * (0.34 + 0.62 * t)) / exact;
    const size = pitch * 0.74;
    const x0 = w / 2 - ((n - 1) * pitch) / 2;
    for (let i = 0; i < n; i++) seats.push({ x: x0 + i * pitch, y: y + size / 2, s: size, r, at: -1 });
    y += size * 1.32;
  }
  return { seats, rows, stageH, height: Math.ceil(y + 18) };
}

// Best seats go first: front rows fill before the back, with some scatter.
// Yours, a good one near the front in the middle, is the very last seat sold.
export function bookingOrder({ seats, rows }, w) {
  const yourRow = Math.floor(rows * 0.3);
  const offCentre = (i) => Math.abs(seats[i].x - w / 2);
  const yours = seats
    .map((s, i) => i)
    .filter((i) => seats[i].r === yourRow)
    .reduce((best, i) => (offCentre(i) < offCentre(best) ? i : best));
  const order = seats
    .map((s, i) => [i, s.r + Math.random() * rows * 0.4])
    .filter(([i]) => i !== yours)
    .sort((a, b) => a[1] - b[1])
    .map(([i]) => i);
  return { order: [...order, yours], yours };
}
