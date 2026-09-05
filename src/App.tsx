import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import CardsPage from '@/features/cards/CardsPage';
import DecksPage from '@/features/decks/DecksPage';
import PlayPage from '@/features/game/ui/PlayPage';

const NAV = [
  { to: '/cards', label: 'Cards', icon: CardsIcon },
  { to: '/decks', label: 'Decks', icon: DecksIcon },
  { to: '/play', label: 'Play', icon: PlayIcon },
];

export default function App() {
  return (
    <div className="min-h-dvh bg-ink text-bright">
      <Header />

      {/* Bottom nav is fixed on mobile, so keep content clear of it. */}
      <main className="pb-20 sm:pb-8">
        <Routes>
          <Route path="/" element={<Navigate to="/cards" replace />} />
          <Route path="/cards" element={<CardsPage />} />
          <Route path="/decks" element={<DecksPage />} />
          <Route path="/play" element={<PlayPage />} />
          <Route path="*" element={<Navigate to="/cards" replace />} />
        </Routes>
      </main>

      <MobileNav />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <NavLink to="/cards" className="flex items-center gap-2">
          <Sigil />
          <span className="text-lg font-semibold tracking-tight">
            Rift<span className="text-accent">forge</span>
          </span>
        </NavLink>

        <nav className="ml-4 hidden gap-1 sm:flex">
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-surface-2 text-bright' : 'text-muted hover:bg-surface hover:text-bright'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}

function MobileNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur sm:hidden">
      <div className="flex">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
          >
            <Icon />
            {label}
          </NavLink>
        ))}
      </div>
      {/* Home-indicator inset on iOS. */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}

function Sigil() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 1.5 22.5 12 12 22.5 1.5 12Z" fill="var(--color-accent)" opacity="0.22" />
      <path
        d="M12 1.5 22.5 12 12 22.5 1.5 12Z"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.6"
      />
      <path d="M12 6.5 17.5 12 12 17.5 6.5 12Z" fill="var(--color-accent)" />
    </svg>
  );
}

function CardsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M17 7l3.2 1.1a1 1 0 0 1 .6 1.3L17 20" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function DecksIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 21h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 8.5 16 12l-6 3.5Z" fill="currentColor" />
    </svg>
  );
}
