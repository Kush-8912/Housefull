import { env } from '../config/env.js';

// GST on convenience fees (SAC 9985) is 18%.
export const GST_PERCENT = 18;

/**
 * The bill for an order, in whole rupees. Promo discounts come off ticket
 * prices only. The booking fee is a percentage of what's paid for tickets,
 * and GST is charged on the fee, not on the tickets.
 */
export function bill({ ticketsSubtotal, discount = 0, addonsTotal = 0 }) {
  const ticketsNet = Math.max(0, ticketsSubtotal - discount);
  const bookingFee = Math.round((ticketsNet * env.BOOKING_FEE_PERCENT) / 100);
  const gst = Math.round((bookingFee * GST_PERCENT) / 100);
  return {
    subtotal: ticketsSubtotal,
    discount,
    addonsTotal,
    bookingFee,
    gst,
    total: ticketsNet + addonsTotal + bookingFee + gst,
    feePercent: env.BOOKING_FEE_PERCENT,
  };
}

// What an attendee gets back when they cancel: everything except the booking
// fee and its GST, which cover a service already delivered.
export const attendeeRefundFor = (order) => order.amount - (order.bookingFee ?? 0) - (order.gst ?? 0);
