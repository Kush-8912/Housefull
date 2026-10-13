import { findUsablePromo, discountFor } from './promoService.js';
import { resolveAddonLines, linesTotal } from './addonService.js';
import { bill } from './pricing.js';

/**
 * What the buyer will pay for a hold, for display before checkout. Problems
 * with the promo code or add-ons are reported instead of thrown, so the
 * checkout page can still render and let the buyer fix them.
 */
export async function quoteHold(hold, seats) {
  const ticketsSubtotal = seats.reduce((s, x) => s + x.price, 0);

  let discount = 0;
  let promo = null;
  if (hold.promoCode) {
    try {
      const p = await findUsablePromo(hold.event, hold.promoCode);
      discount = discountFor(p, ticketsSubtotal);
      promo = { code: p.code, kind: p.kind, value: p.value };
    } catch (err) {
      promo = { code: hold.promoCode, error: err.message };
    }
  }

  let addons = [];
  let addonsError = null;
  try {
    addons = await resolveAddonLines(hold.event, hold.addons);
  } catch (err) {
    addonsError = err.message;
  }

  return { ...bill({ ticketsSubtotal, discount, addonsTotal: linesTotal(addons) }), promo, addons, addonsError };
}
