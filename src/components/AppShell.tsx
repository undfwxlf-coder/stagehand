import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import PlayerBar from "./PlayerBar";
import Logo from "./Logo";
import { usePlayer } from "../lib/player";

export default function AppShell() {
  const { user, signOut } = useAuth();
  const hasPlayer = usePlayer((s) => Boolean(s.current));

  return (
    <div className={`min-h-screen flex flex-col ${hasPlayer ? "pb-28 sm:pb-24" : ""}`}>
      <header className="border-b border-edge bg-panel/60 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center gap-3 sm:gap-4 justify-between">
          <Link to="/" aria-label="Stagehand home" className="hover:opacity-90 transition shrink-0">
            <Logo size={24} withWordmark />
          </Link>
          <nav className="flex items-center gap-1 flex-1 sm:flex-none sm:justify-center justify-end">
            <NavTab to="/" end>Library</NavTab>
            <NavTab to="/saved">Saved</NavTab>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span className="text-xs text-muted hidden md:block max-w-[14rem] truncate">{user?.email}</span>
            <button
              onClick={signOut}
              aria-label="Sign out"
              title="Sign out"
              className="text-sm text-muted hover:text-white px-2.5 sm:px-3 py-1.5 rounded-md hover:bg-panel2 transition"
            >
              <span className="hidden sm:inline">Sign out</span>
              <span className="sm:hidden" aria-hidden>⎋</span>
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-edge mt-12 py-6 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-muted">
          <div className="flex items-center gap-2">
            <Logo size={16} />
            <span>Stagehand</span>
          </div>
          <span className="text-muted/80">Made for artists who haven't released it yet.</span>
        </div>
      </footer>
      <PlayerBar />
    </div>
  );
}

function NavTab({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `px-3 py-1.5 rounded-md text-sm transition ${
          isActive ? "text-white bg-panel2" : "text-muted hover:text-white"
        }`
      }
    >
      {children}
    </NavLink>
  );
}
