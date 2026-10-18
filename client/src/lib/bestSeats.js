// "Best available": the block of `count` side-by-side free seats closest to
// the front and the middle of the house. Rows come in the organizer's order,
// which starts at the stage. One row back costs as much as being two seats
// off-centre, so a centred seat in row C beats the far edge of row A.
const ROW_WEIGHT = 2;

// Seats in your own active hold count as free: picking again replaces that hold.
const isFree = (s) => s.status === 'available' || (s.status === 'held' && s.mine);

export function findBestSeats({ rows, seats, count, tier = null }) {
  if (!count || count < 1) return null;
  const byRow = Map.groupBy(seats, (s) => s.row);
  let best = null;

  rows.forEach((row, rowIndex) => {
    const inRow = (byRow.get(row.label) ?? []).toSorted((a, b) => a.number - b.number);
    if (inRow.length < count) return;
    const centre = (inRow[0].number + inRow.at(-1).number) / 2;

    for (let i = 0; i + count <= inRow.length; i += 1) {
      const block = inRow.slice(i, i + count);
      if (!block.every(isFree)) continue;
      if (tier && !block.every((s) => s.tier === tier)) continue;
      // Side by side means consecutive seat numbers, not just neighbours in the
      // list (blocked spots leave gaps), and no walkway in between.
      if (block.at(-1).number - block[0].number !== count - 1) continue;
      if (row.aisleAfter?.some((a) => a >= block[0].number && a < block.at(-1).number)) continue;

      const mid = (block[0].number + block.at(-1).number) / 2;
      const score = rowIndex * ROW_WEIGHT + Math.abs(mid - centre);
      if (!best || score < best.score) best = { score, seats: block };
    }
  });

  return best?.seats ?? null;
}
