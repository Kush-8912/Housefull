// How each cancellation policy reads in the app. The refund rules themselves
// live on the server (server/src/services/refundPolicy.js), which also works
// out the exact amount for every order.
export const CANCELLATION_POLICIES = {
  flexible: { label: 'Flexible', summary: 'Full refund of the ticket price up to 24 hours before the show.' },
  standard: { label: 'Standard', summary: '100% back up to 7 days before, 75% up to 2 days before, 50% up to a day before.' },
  none: { label: 'No cancellations', summary: 'Tickets can’t be cancelled or refunded, unless the organizer moves or cancels the show.' },
};

export const policyOf = (event) => CANCELLATION_POLICIES[event?.cancellationPolicy] ?? CANCELLATION_POLICIES.standard;

export const POLICY_SMALL_PRINT = 'No cancellations on the day of the show. The booking fee isn’t refundable.';
