import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { HomePage } from './pages/HomePage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { EventPage } from './pages/EventPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OrderPage, TicketsPage } from './pages/TicketsPage';
import { SavedPage } from './pages/SavedPage';
import { ProfilePage } from './pages/ProfilePage';
import { FeedbackPage } from './pages/FeedbackPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { PageLoader } from './components/States';

// Organizer screens pull in charts and the camera scanner; buyers never need them.
const OrganizerHome = lazy(() => import('./pages/organizer/OrganizerHome').then((m) => ({ default: m.OrganizerHome })));
const EventEditor = lazy(() => import('./pages/organizer/EventEditor').then((m) => ({ default: m.EventEditor })));
const ScanPage = lazy(() => import('./pages/organizer/ScanPage').then((m) => ({ default: m.ScanPage })));
const ManageEvent = lazy(() => import('./pages/organizer/ManageEvent').then((m) => ({ default: m.ManageEvent })));

const organizer = (page) => <RequireAuth role="organizer"><Suspense fallback={<PageLoader />}>{page}</Suspense></RequireAuth>;

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="events/:id" element={<EventPage />} />
        <Route path="events/:id/feedback" element={<RequireAuth><FeedbackPage /></RequireAuth>} />

        <Route path="checkout/:holdId" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
        <Route path="orders/:id" element={<RequireAuth><OrderPage /></RequireAuth>} />
        <Route path="tickets" element={<RequireAuth><TicketsPage /></RequireAuth>} />
        <Route path="saved" element={<RequireAuth><SavedPage /></RequireAuth>} />
        <Route path="profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />

        <Route path="organizer" element={organizer(<OrganizerHome />)} />
        <Route path="organizer/events/new" element={organizer(<EventEditor />)} />
        <Route path="organizer/events/:id/edit" element={organizer(<EventEditor />)} />
        <Route path="organizer/events/:id" element={organizer(<ManageEvent />)} />
        <Route path="scan/:code" element={organizer(<ScanPage />)} />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="py-16">
      <p className="eyebrow">Error 404 · row ?, seat ?</p>
      <h1 className="display mt-4 text-[clamp(4rem,14vw,10rem)] text-fg">
        No such<br /><span className="animate-flicker text-signal">seat.</span>
      </h1>
      <p className="mt-6 max-w-md text-muted">The page you&apos;re looking for doesn&apos;t exist, or it moved.</p>
      <Link to="/" className="btn-primary mt-8">Back to events</Link>
    </div>
  );
}
