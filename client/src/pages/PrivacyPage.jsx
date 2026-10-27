// What Housefull stores and why. Linked from the footer, and the privacy
// policy URL Google asks for on the OAuth consent screen.
const SECTIONS = [
  ['What we store', [
    'Your account: name, email address, and a hashed password (never the password itself). With “Continue with Google”, your Google account ID, name and email instead of a password.',
    'Your bookings: seats, orders, tickets, refunds, check-ins and any feedback you choose to give.',
    'For hosts: the legal name, holder type and last four characters of the PAN used to verify identity. The full PAN is not stored.',
    'A profile photo, if you upload one.',
  ]],
  ['Payments', [
    'Payments are taken by Razorpay in its own window, or by a built-in demo processor. Housefull never sees or stores your full card or UPI details; we keep the payment reference and, for cards, the last four digits.',
  ]],
  ['Emails', [
    'We email you about your own account and bookings: welcome, receipts with tickets, show-day reminders, schedule changes, cancellations, refunds and feedback requests. No marketing, and your address is never sold or shared.',
  ]],
  ['Cookies and storage', [
    'One sign-in cookie keeps you logged in. Your chosen city is remembered in your browser. There are no advertising or tracking cookies.',
  ]],
  ['Who else sees your data', [
    'Hosts see the names of their ticket holders and their check-ins. Feedback is shown to hosts; written answers are never shown to other attendees.',
    'Services that help run the site: MongoDB Atlas (database), Render (hosting), Razorpay (payments), Google (sign-in and sending email) and, for hosts who use it, Anthropic’s Claude (writing reminder emails, feedback questions and feedback summaries; it gets event details and answers, never names or emails).',
  ]],
  ['Your choices', [
    'You can edit your profile at any time. To have your account and data deleted, write to housefull.tickets@gmail.com.',
  ]],
];

export function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl">
      <p className="eyebrow">Housefull · Privacy</p>
      <h1 className="display mt-3 text-6xl sm:text-7xl">Privacy policy.</h1>
      <p className="mt-4 text-muted">Housefull is a student project. This page explains, in plain words, what it keeps about you and why.</p>
      {SECTIONS.map(([title, paras]) => (
        <section key={title} className="mt-10">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-fg">{title}</h2>
          {paras.map((p) => <p key={p.slice(0, 24)} className="mt-3 leading-relaxed text-muted">{p}</p>)}
        </section>
      ))}
      <p className="mt-12 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Last updated 27 October 2026</p>
    </article>
  );
}
