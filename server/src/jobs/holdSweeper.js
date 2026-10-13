import { Hold } from '../models/Hold.js';
import { Order } from '../models/Order.js';
import { Seat } from '../models/Seat.js';
import { releaseHold } from '../services/holdService.js';
import { emitSeatChanges } from '../realtime/bus.js';
import { notifyWaitlistLater } from '../services/waitlistService.js';

const STUCK_CHECKOUT_MS = 10 * 60_000;

// Periodically returns expired holds' seats to the pool and broadcasts the
// change so open seat maps update. Reads already treat expired holds as
// available, so this job affects freshness of the UI, not correctness.
export async function sweepExpiredHolds(now = new Date()) {
  const expired = await Hold.find({ status: 'active', expiresAt: { $lte: now } }).limit(500);
  let released = 0;
  for (const hold of expired) {
    if (await releaseHold(hold, 'expired')) released += 1;
  }
  return released + (await recoverStuckCheckouts(now));
}

// A checkout that crashed after locking its hold would otherwise leave the
// hold in `converting` forever. If no paid order exists, give the seats back.
async function recoverStuckCheckouts(now) {
  const stuck = await Hold.find({ status: 'converting', updatedAt: { $lte: new Date(now - STUCK_CHECKOUT_MS) } }).limit(100);
  let recovered = 0;
  for (const hold of stuck) {
    const paid = await Order.exists({ hold: hold._id, status: 'paid' });
    const next = paid ? 'converted' : 'expired';
    const res = await Hold.updateOne({ _id: hold._id, status: 'converting' }, { status: next });
    if (!res.modifiedCount || paid) continue;
    const seats = await Seat.find({ hold: hold._id, status: 'held' }, { _id: 1 }).lean();
    await Seat.updateMany({ hold: hold._id, status: 'held' }, { status: 'available', hold: null, holdExpiresAt: null });
    emitSeatChanges(hold.event, seats.map((s) => ({ id: s._id, status: 'available' })));
    notifyWaitlistLater(hold.event);
    recovered += 1;
  }
  return recovered;
}

export function startHoldSweeper(intervalMs = 15_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // never overlap runs
    running = true;
    try {
      const n = await sweepExpiredHolds();
      if (n) console.log(`[sweeper] released ${n} expired hold(s)`);
    } catch (err) {
      console.error('[sweeper] failed:', err);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
