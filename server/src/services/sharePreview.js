// Link previews (WhatsApp, Slack, iMessage, X) come from <meta> tags in the
// HTML. Crawlers don't run JavaScript, so for event pages the server writes
// the event's details into index.html before sending it.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const when = (d) => new Intl.DateTimeFormat('en-IN', {
  weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
}).format(new Date(d));

export function eventMeta(event, appUrl) {
  const url = `${appUrl}/events/${event._id}`;
  const title = `${event.title} · Housefull`;
  const description = `${when(event.startsAt)} IST at ${event.venue.name}, ${event.venue.city}. Pick your exact seat.`;
  const tags = [
    ['og:type', 'website'],
    ['og:site_name', 'Housefull'],
    ['og:title', title],
    ['og:description', description],
    ['og:url', url],
    ...(event.coverImageUrl ? [['og:image', event.coverImageUrl]] : []),
    ['twitter:card', event.coverImageUrl ? 'summary_large_image' : 'summary'],
  ].map(([k, v]) => `<meta ${k.startsWith('og:') ? 'property' : 'name'}="${k}" content="${esc(v)}" />`);
  return { title, description, url, tags: [`<link rel="canonical" href="${esc(url)}" />`, ...tags].join('\n    ') };
}

// Replace the generic title/description and add the share tags.
export function renderEventPage(template, event, appUrl) {
  const m = eventMeta(event, appUrl);
  return template
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(m.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(m.description)}" />`)
    .replace('</head>', `    ${m.tags}\n  </head>`);
}
