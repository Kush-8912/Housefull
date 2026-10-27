import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { NotificationBell } from './NotificationBell';
import { Avatar } from './Avatar';
import { CityPicker } from './CityPicker';

const navClass = ({ isActive }) =>
  `relative px-3 py-2 font-mono text-[12px] font-medium uppercase tracking-[0.12em] transition-colors ${
    isActive ? 'text-fg after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:bg-signal' : 'text-muted hover:text-fg'
  }`;

// A seat as drawn on the seat map: rounded back, square base (5 units square).
const seatPath = (x, y) => `M${x} ${y + 5}V${y + 2}a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2V${y + 5}z`;
// In the order they fill: front row sides, back row, then yours in the middle.
const LOGO_SEATS = [[6.5, 23], [20.5, 23], [10, 16], [17, 16], [13.5, 23]];

/**
 * The mark is a theatre house with its seats. On load they fill up, front row
 * first, yours (cream) last, and then the light in the gable comes on:
 * housefull. Hovering the logo lifts the roof. `compact` hides the wordmark
 * on phones so the header fits on one line.
 */
export function Logo({ className = '', compact = false }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7 overflow-visible" aria-hidden>
        <path d="M3.5 14 16 4.5 28.5 14" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="stroke-signal transition-transform duration-300 group-hover:-translate-y-[2.5px]" />
        {LOGO_SEATS.map(([x, y], i) => (
          <path
            key={i}
            d={seatPath(x, y)}
            strokeWidth="1"
            strokeLinejoin="round"
            className={`animate-seat-fill ${i === LOGO_SEATS.length - 1 ? 'fill-fg stroke-fg' : 'fill-signal stroke-signal'}`}
            style={{ animationDelay: `${250 + i * 120}ms` }}
          />
        ))}
        <circle cx="16" cy="10.4" r="1.6" className="origin-center animate-pop fill-fg [animation-delay:950ms] [transform-box:fill-box]" />
      </svg>
      <span className={`display text-[26px] leading-none tracking-[-0.02em] ${compact ? 'hidden sm:inline' : ''}`}>
        House<span className="text-signal">full</span>
      </span>
    </span>
  );
}

// Navigating between pages should start at the top, like a normal website.
function useScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
}

// Each page fades in when you arrive. Keyed by the route's shape rather than
// the exact URL, so moving between showtimes of one event doesn't remount it.
const routeShape = (pathname) => pathname.replace(/[a-f0-9]{24}/g, ':id');

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useScrollReset();

  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-signal focus:px-3 focus:py-2 focus:text-ink">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-ink/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <Link to="/" aria-label="Housefull home" className="group shrink-0"><Logo compact /></Link>
            <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
            <CityPicker />
          </div>
          <nav className="flex items-center gap-1" aria-label="Main">
            <span className="hidden sm:contents"><NavLink to="/" end className={navClass}>Events</NavLink></span>
            {user?.role === 'organizer' && <span className="hidden sm:contents"><NavLink to="/organizer" className={navClass}>Dashboard</NavLink></span>}
            {user?.role === 'attendee' && <span className="hidden sm:contents"><NavLink to="/saved" className={navClass}>Saved</NavLink></span>}
            {user?.role === 'attendee' && <span className="hidden sm:contents"><NavLink to="/tickets" className={navClass}>Tickets</NavLink></span>}
            {user ? (
              <div className="flex items-center gap-1 sm:ml-2 sm:border-l sm:border-line sm:pl-3">
                <NotificationBell />
                <NavLink
                  to="/profile"
                  className={({ isActive }) => `flex shrink-0 rounded-full ring-2 transition ${isActive ? 'ring-signal' : 'ring-transparent hover:ring-line-strong'}`}
                  title={`${user.name} · Profile`}
                  aria-label="Your profile"
                >
                  <Avatar name={user.name} src={user.avatarUrl} />
                </NavLink>
                <button
                  type="button"
                  className="btn-ghost hidden px-2.5 sm:inline-flex"
                  onClick={async () => { await logout(); navigate('/'); }}
                  aria-label="Log out"
                  title="Log out"
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                </button>
                <MobileMenu user={user} onLogout={async () => { await logout(); navigate('/'); }} />
              </div>
            ) : (
              <>
                <NavLink to="/login" className={(a) => `${navClass(a)} whitespace-nowrap px-2 sm:px-3`}>Log in</NavLink>
                <Link to="/register" className="btn-primary ml-1 whitespace-nowrap px-3 py-2 sm:px-3.5">Sign up</Link>
              </>
            )}
          </nav>
        </div>
        <span className="scroll-progress absolute inset-x-0 -bottom-px h-0.5 bg-signal" aria-hidden />
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <div key={routeShape(pathname)} className="animate-page">
          <Outlet />
        </div>
      </main>

      <footer className="mt-16 border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <Logo className="text-fg" />
            <p className="display mt-4 text-3xl text-fg">Get in before it&apos;s <span className="text-signal">housefull.</span></p>
            <p className="mt-2 max-w-xs text-sm text-muted">Reserved seating for gigs, comedy, theatre and talks. Pick the seat, not the section.</p>
          </div>
          <div className="space-y-1 font-mono text-[11px] uppercase tracking-[0.12em] text-faint sm:text-right">
            <p>Demo payments only · no real money is charged</p>
            <p>Prices in INR · all times shown in your local time zone</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Phones: the page links live in a menu under the header instead of the bar.
function MobileMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const panel = useRef(null);
  const { pathname } = useLocation();
  const [openedAt, setOpenedAt] = useState(pathname);
  if (open && pathname !== openedAt) setOpen(false); // following a link closes it

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!panel.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const links = [
    ['/', 'Events', true],
    ...(user.role === 'organizer' ? [['/organizer', 'Dashboard']] : [['/tickets', 'My tickets'], ['/saved', 'Saved']]),
    ['/profile', 'Profile'],
  ];
  const item = ({ isActive }) => `flex items-center justify-between px-5 py-3.5 font-mono text-[13px] uppercase tracking-[0.12em] ${isActive ? 'bg-ink-850 text-fg' : 'text-muted'}`;

  return (
    <div ref={panel} className="sm:hidden">
      <button
        type="button"
        className="btn-ghost px-2.5"
        onClick={() => { setOpenedAt(pathname); setOpen((o) => !o); }}
        aria-expanded={open}
        aria-label={open ? 'Close menu' : 'Open menu'}
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
      </button>
      {open && (
        <nav className="absolute inset-x-0 top-full origin-top animate-[menu-drop_0.3s_cubic-bezier(0.2,0.7,0.2,1)] border-b border-line-strong bg-ink-900 shadow-2xl shadow-black/60" aria-label="Menu">
          {links.map(([to, label, end], i) => (
            <NavLink key={to} to={to} end={end} className={(a) => `${item(a)} animate-rise`} style={{ animationDelay: `${60 + i * 45}ms` }}>
              {label}
            </NavLink>
          ))}
          <button type="button" className="flex w-full items-center gap-2 border-t border-line px-5 py-3.5 text-left font-mono text-[13px] uppercase tracking-[0.12em] text-muted" onClick={() => { setOpen(false); onLogout(); }}>
            <LogOut className="h-4 w-4" aria-hidden /> Log out
          </button>
        </nav>
      )}
    </div>
  );
}
