import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, MapPin } from 'lucide-react';
import { hasChosenCity, setCityPref, useCityPref } from '../lib/cityPref';

// The map outline is ~20 KB, so it only loads when the picker opens.
const CityMapDialog = lazy(() => import('./CityMapDialog').then((m) => ({ default: m.CityMapDialog })));

// Header button showing the chosen city; opens the full-screen city map.
// On a first visit to the home page the map opens by itself.
export function CityPicker() {
  const city = useCityPref();
  const { pathname } = useLocation();
  // Opens by itself when someone lands on the home page without having picked a city.
  const [open, setOpen] = useState(() => pathname === '/' && !hasChosenCity());
  const button = useRef(null);
  const navigate = useNavigate();

  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);

  const choose = useCallback((c) => {
    setCityPref(c);
    setOpen(false);
    // Show the result straight away: the home page reads the city from the URL.
    navigate(c ? `/?city=${encodeURIComponent(c)}` : '/', { replace: pathname === '/' });
  }, [navigate, pathname]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="flex items-center gap-1.5 px-2 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.12em] text-muted transition-colors hover:text-fg"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <MapPin className="h-3.5 w-3.5 text-signal" aria-hidden />
        <span className="max-w-[7rem] truncate">{city || 'All cities'}</span>
        <ChevronDown className="h-3 w-3" aria-hidden />
      </button>
      {open && (
        <Suspense fallback={null}>
          <CityMapDialog current={city} onChoose={choose} onClose={() => { if (!hasChosenCity()) setCityPref(''); close(); }} />
        </Suspense>
      )}
    </>
  );
}
