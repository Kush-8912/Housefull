/**
 * Decides which camera reads count as a new scan. A camera reports the code in
 * view many times per second, so a code counts once for as long as it stays in
 * view: repeats are ignored until it has been out of sight for `gapMs`. Showing
 * the same ticket again after that is a real second scan (and the server says
 * it was already used). Reads while `paused` are dropped without being counted,
 * so a ticket held up during the previous check-in is still scanned after it.
 */
export function createScanGate(gapMs = 3000) {
  let last = { code: null, seenAt: -Infinity };
  return (code, now, paused = false) => {
    if (code === last.code && now - last.seenAt < gapMs) {
      last = { code, seenAt: now }; // still in view: the same scan
      return false;
    }
    if (paused) return false;
    last = { code, seenAt: now };
    return true;
  };
}
