import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { api } from '../lib/api';
import { EventCard } from '../components/EventCard';
import { EmptyState, ErrorState, PageLoader } from '../components/States';

// Events the attendee tapped "Interested" on.
export function SavedPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    api('/events/saved').then((d) => { setItems(d.items); setError(null); }).catch(setError);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!items) return <PageLoader label="Loading saved events" />;
  const upcoming = items.filter((e) => !e.past);
  const past = items.filter((e) => e.past);

  return (
    <div>
      <p className="eyebrow">Your list</p>
      <h1 className="display mt-3 text-6xl sm:text-7xl">Saved</h1>
      <p className="mt-4 max-w-lg text-sm text-muted">Events you marked as interested. Organizers see how many people are interested, not who.</p>
      {items.length === 0 ? (
        <div className="mt-10">
          <EmptyState icon={Heart} title="Nothing saved yet" action={<Link to="/" className="btn-primary">Browse events</Link>}>
            Tap &ldquo;Interested&rdquo; on any event to keep it here.
          </EmptyState>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className="mt-10 grid gap-5 min-[540px]:grid-cols-2 lg:grid-cols-3">
              {upcoming.map((e, i) => <EventCard key={e.id} event={e} index={i} />)}
            </div>
          )}
          {past.length > 0 && (
            <section className="mt-12">
              <h2 className="eyebrow mb-4 flex items-center gap-3">Ended <span className="h-px flex-1 bg-line" /></h2>
              <div className="grid gap-5 opacity-60 sm:grid-cols-2 lg:grid-cols-3">
                {past.map((e, i) => <EventCard key={e.id} event={e} index={i} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
