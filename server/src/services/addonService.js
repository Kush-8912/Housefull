import { Addon } from '../models/Addon.js';
import { AppError } from '../utils/AppError.js';

/**
 * Turn a hold's add-on selection into priced lines, checking each item is
 * still on sale for this event. Stock is checked here for feedback and
 * enforced atomically by reserveAddons() at checkout.
 */
export async function resolveAddonLines(eventId, selection = []) {
  const wanted = selection.filter((s) => s.qty > 0);
  if (!wanted.length) return [];
  const docs = await Addon.find({ _id: { $in: wanted.map((s) => s.addon) }, event: eventId });
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return wanted.map((s) => {
    const a = byId.get(String(s.addon));
    if (!a || !a.active) throw AppError.badRequest('One of your add-ons is no longer available', { code: 'ADDON_UNAVAILABLE' });
    if (s.qty > a.maxPerOrder) throw AppError.badRequest(`You can add at most ${a.maxPerOrder} × ${a.name}`, { code: 'ADDON_LIMIT' });
    if (a.stock != null && a.sold + s.qty > a.stock) {
      const left = Math.max(0, a.stock - a.sold);
      throw AppError.conflict(left ? `Only ${left} × ${a.name} left` : `${a.name} is sold out`, { code: 'ADDON_SOLD_OUT' });
    }
    return { addon: a._id, name: a.name, price: a.price, qty: s.qty };
  });
}

export const linesTotal = (lines) => lines.reduce((sum, l) => sum + l.price * l.qty, 0);

export async function releaseAddons(lines = []) {
  await Promise.all(lines.map((l) => Addon.updateOne({ _id: l.addon, sold: { $gte: l.qty } }, { $inc: { sold: -l.qty } })));
}

/** Take stock for every line, all or nothing. */
export async function reserveAddons(lines) {
  const done = [];
  for (const line of lines) {
    const ok = await Addon.findOneAndUpdate(
      { _id: line.addon, active: true, $or: [{ stock: null }, { $expr: { $lte: [{ $add: ['$sold', line.qty] }, '$stock'] } }] },
      { $inc: { sold: line.qty } },
    );
    if (!ok) {
      await releaseAddons(done);
      throw AppError.conflict(`${line.name} just sold out. Remove it to continue.`, { code: 'ADDON_SOLD_OUT' });
    }
    done.push(line);
  }
}
