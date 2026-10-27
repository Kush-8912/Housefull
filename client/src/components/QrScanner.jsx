import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff } from 'lucide-react';
import { Spinner } from './States';
import { createScanGate } from '../lib/scanGate';

// Why the camera didn't start, in words door staff can act on. Browsers report
// the reason as a DOMException name; html5-qrcode sometimes wraps it in a string.
function cameraProblem(err) {
  const raw = `${err?.name ?? ''} ${err?.message ?? err ?? ''}`;
  if (/NotAllowed|Permission|denied/i.test(raw)) {
    return 'Camera access is blocked for this site. Tap the icon next to the address bar, allow the camera, then tap Start camera again.';
  }
  if (/NotReadable|TrackStart|Could not start/i.test(raw)) {
    return 'The camera is busy. Close other apps or tabs using it (video calls, the camera app) and try again.';
  }
  if (/NotFound|Overconstrained|DevicesNotFound|no camera/i.test(raw)) {
    return 'No camera was found on this device. Enter ticket codes manually below.';
  }
  return `The camera couldn't start (${raw.trim().slice(0, 120) || 'unknown error'}). Enter ticket codes manually below.`;
}

/**
 * Camera QR scanner. The camera reports the same code many times per second,
 * so a code counts once for as long as it stays in view (see scanGate), and
 * reads are paused while the parent is still handling the previous one.
 */
export function QrScanner({ onScan, paused }) {
  const regionId = `qr-${useId().replace(/:/g, '')}`;
  const scannerRef = useRef(null);
  const gateRef = useRef(null);
  gateRef.current ??= createScanGate(3000);
  const pausedRef = useRef(paused);
  const onScanRef = useRef(onScan);
  useLayoutEffect(() => {
    pausedRef.current = paused;
    onScanRef.current = onScan;
  });
  const [state, setState] = useState('off'); // off | starting | on
  const [error, setError] = useState(null);

  const stop = async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    setState('off');
    if (s) {
      try { await s.stop(); s.clear(); } catch { /* already stopped */ }
    }
  };

  const onDecode = (text) => {
    if (gateRef.current(text, Date.now(), pausedRef.current)) onScanRef.current(text);
  };

  const start = async () => {
    if (state !== 'off') return;
    setError(null);
    // Browsers only offer the camera on secure pages (https, or localhost).
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser only allows the camera on a secure (https) page. Open Housefull over https, or enter ticket codes manually below.');
      return;
    }
    setState('starting');
    const scanner = new Html5Qrcode(regionId, { verbose: false });
    scannerRef.current = scanner;
    // A square scan box at 70% of the shorter side, whatever the screen size.
    const config = { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.7); return { width: s, height: s }; } };
    try {
      try {
        await scanner.start({ facingMode: 'environment' }, config, onDecode, () => {});
      } catch (first) {
        // Some phones and laptops reject "back camera"; fall back to any camera they list.
        if (/NotAllowed|Permission|denied/i.test(`${first?.name} ${first?.message ?? first}`)) throw first;
        const cameras = await Html5Qrcode.getCameras();
        if (!cameras.length) throw first;
        const back = cameras.find((c) => /back|rear|environment/i.test(c.label)) ?? cameras.at(-1);
        await scanner.start(back.id, config, onDecode, () => {});
      }
      setState('on');
    } catch (err) {
      console.error('[QrScanner] camera failed to start:', err);
      scannerRef.current = null;
      try { scanner.clear(); } catch { /* nothing rendered */ }
      setState('off');
      setError(cameraProblem(err));
    }
  };

  useEffect(() => () => { stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {/* The scanner draws into this box, so it stays laid out (never display:none) and the video gets its real width. */}
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-[4px] bg-black">
        <div id={regionId} className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
        {state !== 'on' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-ink text-faint">
            <span className="absolute left-6 top-6 h-8 w-8 border-l-2 border-t-2 border-line-strong" aria-hidden />
            <span className="absolute right-6 top-6 h-8 w-8 border-r-2 border-t-2 border-line-strong" aria-hidden />
            <span className="absolute bottom-6 left-6 h-8 w-8 border-b-2 border-l-2 border-line-strong" aria-hidden />
            <span className="absolute bottom-6 right-6 h-8 w-8 border-b-2 border-r-2 border-line-strong" aria-hidden />
            {state === 'starting' ? <Spinner className="h-8 w-8" /> : <Camera className="h-8 w-8" strokeWidth={1.5} aria-hidden />}
            <p className="eyebrow mt-3">{state === 'starting' ? 'Starting camera…' : 'Camera off'}</p>
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-center">
        {state === 'on' ? (
          <button type="button" className="btn-secondary" onClick={stop}><CameraOff className="h-4 w-4" aria-hidden /> Stop camera</button>
        ) : (
          <button type="button" className="btn-primary" onClick={start} disabled={state === 'starting'}><Camera className="h-4 w-4" aria-hidden /> Start camera</button>
        )}
      </div>
      {error && <p className="mt-4 border-l-2 border-warn bg-ink px-3 py-2 text-sm text-fg/90" role="alert">{error}</p>}
    </div>
  );
}
