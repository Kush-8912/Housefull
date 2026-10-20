import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ScanLine } from 'lucide-react';
import { api } from '../../lib/api';
import { PageLoader } from '../../components/States';
import { CHECKIN_MESSAGES, CheckinResult } from '../../components/CheckinResult';

// Where a ticket's QR link lands when a guard scans it with their phone camera.
// The check-in runs on arrival, so the guard only has to point and look.
export function ScanPage() {
  const { code } = useParams();
  const [result, setResult] = useState(null);
  // Check-in is not repeatable: a second request for the same code would come
  // back "already used", so send it once per code even if the effect re-runs.
  const sent = useRef(null);

  useEffect(() => {
    if (sent.current === code) return;
    sent.current = code;
    setResult(null);
    api('/tickets/checkin', { method: 'POST', body: { qr: code } })
      .then(({ checkin }) => setResult({ ok: true, at: Date.now(), ...checkin }))
      .catch((err) => setResult({ ok: false, at: Date.now(), title: CHECKIN_MESSAGES[err.code] ?? 'Could not check in', message: err.message, details: err.details }));
  }, [code]);

  if (!result) return <PageLoader label="Checking ticket" />;

  return (
    <div className="mx-auto max-w-md">
      <CheckinResult result={result} className="min-h-[60vh] animate-rise rounded-[4px]" />
      <div className="mt-6 flex justify-center gap-3">
        {result.ok && result.event && (
          <Link to={`/organizer/events/${result.event.id}`} className="btn-secondary"><ScanLine className="h-4 w-4" aria-hidden /> Event dashboard</Link>
        )}
        <Link to="/organizer" className="btn-secondary">My events</Link>
      </div>
      <p className="mt-4 text-center text-xs text-faint">Point your camera at the next ticket. For a long queue, the Check-in tab on the event dashboard scans back to back.</p>
    </div>
  );
}
