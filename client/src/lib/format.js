const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

// Ticket prices: 0 means a free seat.
export const money = (n) => (n === 0 ? 'Free' : inr.format(n));
// Amounts of money (revenue, totals): always a number.
export const amount = (n) => inr.format(n);

// plural(2, 'seat') -> '2 seats'; irregular words pass their plural: plural(2, 'person', 'people').
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export const dateTime = (d) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(d));

export const dateLong = (d) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d));

export const time = (d) => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(d));

export const dayMonth = (d) => {
  const date = new Date(d);
  return { day: date.getDate(), month: date.toLocaleString('en-IN', { month: 'short' }).toUpperCase() };
};

export const pct = (x) => `${Math.round(x * 100)}%`;

export const CATEGORY_LABELS = {
  music: 'Music', comedy: 'Comedy', theatre: 'Theatre', sports: 'Sports', tech: 'Tech', workshop: 'Workshop', other: 'Other',
};

export const weekday = (d) => new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(new Date(d));

export const shortDate = (d) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(d));

export const dateMedium = (d) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d));

// Seat labels in reading order: A2 before A10.
export const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true });

// Labels the server computes from real sales data (see discoveryService.badgesFor).
export const BADGES = {
  almost_full: { label: 'Almost full', hint: '10% or fewer seats left', tone: 'bg-warn text-ink' },
  filling_fast: { label: 'Filling fast', hint: 'Lots of tickets sold in the last 24 hours', tone: 'bg-signal text-ink' },
  new: { label: 'New', hint: 'Went on sale in the last 3 days', tone: 'bg-fg text-ink' },
};
