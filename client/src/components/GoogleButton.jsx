import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Spinner } from './States';

// Both are fetched once per page load and shared by every button.
let clientIdPromise;
const googleClientId = () => {
  clientIdPromise ??= api('/auth/providers').then((d) => d.google).catch(() => null);
  return clientIdPromise;
};

let scriptPromise;
const loadGoogleScript = () => {
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => { scriptPromise = null; reject(new Error('Google sign-in could not load')); };
    document.head.append(s);
  });
  return scriptPromise;
};

// Google's "G", in its own colours (as the branding guidelines ask).
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="h-[18px] w-[18px] shrink-0" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * Our own "Continue with Google" button. It opens Google's sign-in popup
 * (Google Identity Services token client) and hands `onToken` the access
 * token, which the server checks with Google before signing anyone in.
 * Renders nothing when the server has no Google client ID configured.
 */
export function GoogleButton({ onToken }) {
  const [clientId, setClientId] = useState(undefined); // undefined while asking the server
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const tokenClient = useRef(null);
  const handler = useRef(onToken);
  useEffect(() => { handler.current = onToken; });

  useEffect(() => { googleClientId().then(setClientId); }, []);

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    loadGoogleScript().then((google) => {
      if (cancelled) return;
      tokenClient.current = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'openid email profile',
        prompt: 'select_account',
        callback: async (res) => {
          if (res.access_token) await handler.current(res.access_token);
          setBusy(false);
        },
        error_callback: () => setBusy(false), // popup closed or blocked
      });
      setReady(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [clientId]);

  if (clientId === null) return null;
  return (
    <div>
      <div className="my-6 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-faint" aria-hidden>
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <button
        type="button"
        className="google-btn"
        disabled={!ready || busy}
        // The popup has to open straight from the click, or browsers block it.
        onClick={() => { setBusy(true); tokenClient.current.requestAccessToken(); }}
      >
        {busy ? <Spinner className="h-[18px] w-[18px]" /> : <GoogleG />}
        {busy ? 'Waiting for Google…' : 'Continue with Google'}
      </button>
    </div>
  );
}
