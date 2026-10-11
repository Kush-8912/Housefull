import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Crosshair, Globe2, MapPin, Search, X } from 'lucide-react';
import { api } from '../lib/api';
import { CITIES, findCity, nearestCity } from '../lib/cities';
import { INDIA_PATH, MAP_HEIGHT, MAP_WIDTH, project } from '../lib/indiaMap';
import { plural } from '../lib/format';
import { Spinner } from './States';

/**
 * Full-screen city picker: a map of India with a pin for every city that has
 * shows on sale (and faint dots for the rest), plus search, "detect my
 * location" and a list. `onChoose('')` means all cities.
 */
export function CityMapDialog({ current, onChoose, onClose }) {
  const [counts, setCounts] = useState(null);
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState(null);
  const [locating, setLocating] = useState(false);
  const searchRef = useRef(null);
  const mapRef = useRef(null);
  // Labels are drawn in map units, so they shrink with the map. On a phone
  // the map is a third of its desktop size; scale the labels back up.
  const [k, setK] = useState(1);
  useEffect(() => {
    const svg = mapRef.current;
    if (!svg) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      // Map units per screen pixel, at the size the map is actually drawn.
      const { width, height } = entry.contentRect;
      const unitsPerPx = Math.max((MAP_WIDTH + 80) / width, (MAP_HEIGHT + 40) / height);
      if (Number.isFinite(unitsPerPx)) setK(Math.min(1.6, Math.max(1, unitsPerPx / 2.2)));
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    api('/events/cities').then((d) => setCounts(d.counts ?? Object.fromEntries(d.cities.map((c) => [c, 1])))).catch(() => setCounts({}));
  }, []);

  // Escape closes; the page behind doesn't scroll while the picker is open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    searchRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const live = useMemo(() => new Set(Object.keys(counts ?? {})), [counts]);
  const total = Object.values(counts ?? {}).reduce((s, n) => s + n, 0);

  // Every city we know of, those with shows first.
  const everyCity = useMemo(() => {
    const names = new Set([...live, ...CITIES.map((c) => c.name)]);
    return [...names].sort((a, b) => (counts?.[b] ?? 0) - (counts?.[a] ?? 0) || a.localeCompare(b));
  }, [live, counts]);

  const q = query.trim().toLowerCase();
  const matches = q ? everyCity.filter((n) => n.toLowerCase().includes(q)) : null;

  const detect = () => {
    if (!navigator.geolocation) { toast.error('This browser can’t share your location. Pick your city instead.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        const { city, km } = nearestCity({ lat: coords.latitude, lon: coords.longitude }, live);
        toast.success(`${city.name} it is`, { description: live.has(city.name) ? `About ${Math.round(km)} km from you.` : 'No shows there yet. Showing it anyway; pick another city any time.' });
        onChoose(city.name);
      },
      (err) => {
        setLocating(false);
        toast.error(err.code === err.PERMISSION_DENIED ? 'Location access was blocked. Pick your city on the map instead.' : 'Couldn’t find your location. Pick your city on the map instead.');
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  };

  const pins = CITIES.map((c) => ({ ...c, ...project(c.lat, c.lon), events: counts?.[c.name] ?? 0 }));
  const unmapped = [...live].filter((n) => !findCity(n));

  const listItem = (name) => {
    const n = counts?.[name] ?? 0;
    const selected = current === name;
    return (
      <li key={name}>
        <button
          type="button"
          onClick={() => onChoose(name)}
          onMouseEnter={() => setHover(name)}
          onMouseLeave={() => setHover(null)}
          className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${selected ? 'bg-signal text-ink' : 'text-fg hover:bg-ink-850'}`}
        >
          <span className="flex items-center gap-2">
            <MapPin className={`h-3.5 w-3.5 ${selected ? 'text-ink' : n ? 'text-signal' : 'text-faint'}`} aria-hidden />
            {name}
          </span>
          <span className={`font-mono text-[11px] ${selected ? 'text-ink' : n ? 'text-muted' : 'text-faint'}`}>{n ? plural(n, 'show') : 'No shows yet'}</span>
        </button>
      </li>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="city-title" className="flex w-full max-w-6xl flex-col overflow-hidden border-line-strong bg-ink-900 sm:max-h-[92vh] sm:border">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-7">
          <div>
            <p className="eyebrow">Shows near you</p>
            <h2 id="city-title" className="display mt-1 text-4xl sm:text-5xl">Select your city</h2>
          </div>
          <button type="button" className="btn-ghost px-2.5" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        {/* Phones: search, map, list in one scrolling column. Desktop: search and list on the left, map on the right. */}
        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[22rem_1fr] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
          <div className="space-y-3 border-b border-line p-5 lg:col-start-1 lg:row-start-1 lg:border-r">
            <label className="relative block">
              <span className="sr-only">Search for your city</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && matches?.length) onChoose(matches[0]); }}
                placeholder="Search for your city"
                className="input pl-9"
              />
            </label>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1 py-2" onClick={detect} disabled={locating}>
                {locating ? <Spinner className="h-4 w-4" /> : <Crosshair className="h-4 w-4 text-signal" aria-hidden />} Detect my location
              </button>
              <button type="button" className={`btn-secondary py-2 ${current === '' ? 'border-signal text-fg' : ''}`} onClick={() => onChoose('')}>
                <Globe2 className="h-4 w-4" aria-hidden /> All
              </button>
            </div>
          </div>
          {/* The map */}
          <div className="relative flex items-center justify-center bg-ink p-3 sm:p-8 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <svg ref={mapRef} viewBox={`-40 -20 ${MAP_WIDTH + 80} ${MAP_HEIGHT + 40}`} className="h-auto max-h-[55vh] w-full lg:h-full lg:max-h-[78vh]" role="group" aria-label="Map of India with cities that have shows">
              <defs>
                <radialGradient id="pin-glow">
                  <stop offset="0" stopColor="#ff5321" stopOpacity="0.55" />
                  <stop offset="1" stopColor="#ff5321" stopOpacity="0" />
                </radialGradient>
              </defs>
              <path d={INDIA_PATH} fill="#1a1917" stroke="#403c37" strokeWidth="2" strokeLinejoin="round" />
              {pins.filter((p) => !p.events).map((p) => (
                <g key={p.name} className="cursor-pointer" onClick={() => onChoose(p.name)} onMouseEnter={() => setHover(p.name)} onMouseLeave={() => setHover(null)}>
                  <title>{p.name}: no shows yet</title>
                  <circle cx={p.x} cy={p.y} r="16" fill="transparent" />
                  <circle cx={p.x} cy={p.y} r={hover === p.name ? 7 : 5} fill={hover === p.name ? '#a39d93' : '#6f6a62'} />
                  {hover === p.name && <text x={p.x + 14 * k} y={p.y + 7 * k} fill="#a39d93" fontSize={26 * k} fontFamily="IBM Plex Mono">{p.name}</text>}
                </g>
              ))}
              {pins.filter((p) => p.events).map((p) => {
                const active = current === p.name || hover === p.name;
                return (
                  <g
                    key={p.name}
                    role="button"
                    tabIndex={0}
                    aria-label={`${p.name}, ${plural(p.events, 'show')}`}
                    className="cursor-pointer outline-none"
                    onClick={() => onChoose(p.name)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChoose(p.name); } }}
                    onMouseEnter={() => setHover(p.name)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(p.name)}
                    onBlur={() => setHover(null)}
                  >
                    <circle cx={p.x} cy={p.y} r={active ? 70 : 50} fill="url(#pin-glow)" className="transition-all" />
                    <circle cx={p.x} cy={p.y} r="12" fill="#ff5321" className="animate-pulse-dot" />
                    <circle cx={p.x} cy={p.y} r={active ? 22 : 18} fill="none" stroke={current === p.name ? '#f1ece3' : '#ff5321'} strokeWidth="3" />
                    <text x={p.x + 30 * k} y={p.y - 4 * k} fill="#f1ece3" fontSize={(active ? 36 : 32) * k} fontWeight="700" fontFamily="Archivo Variable, sans-serif">{p.name}</text>
                    <text x={p.x + 30 * k} y={p.y + 28 * k} fill="#a39d93" fontSize={22 * k} fontFamily="IBM Plex Mono">{plural(p.events, 'show')}</text>
                  </g>
                );
              })}
            </svg>
            {unmapped.length > 0 && (
              <p className="absolute bottom-3 left-4 right-4 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                Also on sale: {unmapped.map((n) => `${n} (${counts[n]})`).join(' · ')}. Pick them from the list.
              </p>
            )}
          </div>

          <div className="p-2 lg:col-start-1 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-line">
            {counts === null ? (
              <p className="flex items-center gap-2 px-3 py-4 text-sm text-muted"><Spinner className="h-4 w-4" /> Loading cities</p>
            ) : matches ? (
              matches.length ? <ul>{matches.map(listItem)}</ul> : <p className="px-3 py-4 text-sm text-muted">No city called &ldquo;{query.trim()}&rdquo; yet.</p>
            ) : (
              <>
                <p className="eyebrow px-3 pb-1 pt-2">{total ? `${plural(total, 'show')} on sale` : 'Cities'}</p>
                <ul>{everyCity.filter((n) => live.has(n)).map(listItem)}</ul>
                <p className="eyebrow px-3 pb-1 pt-4">Popular cities</p>
                <ul>{CITIES.filter((c) => c.popular && !live.has(c.name)).map((c) => listItem(c.name))}</ul>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
