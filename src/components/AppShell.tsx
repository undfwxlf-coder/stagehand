import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import PlayerBar from "./PlayerBar";
import NowPlayingOverlay from "./NowPlayingOverlay";
import Logo from "./Logo";
import HeaderSearch from "./HeaderSearch";
import NotificationsBell from "./NotificationsBell";
import NotificationsBootstrap from "./NotificationsBootstrap";
import NotificationToasts from "./NotificationToasts";
import { usePlayer } from "../lib/player";
import { useProfileStore } from "../lib/profile";
import { useIsAdmin } from "../lib/admin";
import { useUploadStore, isActivePhase } from "../lib/uploads";

export default function AppShell() {
  const { user } = useAuth();
  const location = useLocation();
  const hasPlayer = usePlayer((s) => Boolean(s.current));
  const profile = useProfileStore((s) => s.profile);
  const loadProfile = useProfileStore((s) => s.load);
  const { isAdmin } = useIsAdmin();

  useEffect(() => {
    if (user) loadProfile(user.id);
  }, [user, loadProfile]);

  // Warn before unload while uploads are in flight. (Previously lived in
  // the floating UploadIndicator chip; we deleted that, so it moved up
  // here so it still runs globally.)
  const uploadingActive = useUploadStore((s) => s.jobs.some((j) => isActivePhase(j.phase)));
  useEffect(() => {
    if (!uploadingActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [uploadingActive]);

  const avatarUrl = profile?.avatar_url ?? null;
  const initial = (
    profile?.artist_name?.trim() ||
    (user?.user_metadata?.artist_name as string | undefined) ||
    user?.email ||
    "?"
  )
    .charAt(0)
    .toUpperCase();

  return (
    <div className={`min-h-screen flex flex-col ${hasPlayer ? "pb-32 sm:pb-32" : ""}`}>
      <header
        className="border-b border-edge bg-panel/60 backdrop-blur sticky top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center gap-2 sm:gap-4 justify-between">
          <Link to="/" aria-label="Stagehand home" className="hover:opacity-90 transition shrink-0 inline-flex items-center gap-2.5">
            <Logo size={24} />
            <span className="hidden sm:inline font-semibold tracking-tight text-white text-[1.05em] leading-none">
              Stagehand
            </span>
          </Link>
          <nav className="flex items-center gap-1 flex-1 sm:flex-none sm:justify-center justify-end min-w-0">
            <NavTab to="/" end>Library</NavTab>
            {isAdmin && <NavTab to="/admin">Admin</NavTab>}
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <HeaderSearch />
            <NotificationsBell />
            <Link
              to="/profile"
              aria-label="Your profile"
              title="Your profile"
              className="w-8 h-8 rounded-full overflow-hidden bg-panel2 border border-edge hover:border-muted/60 transition flex items-center justify-center"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-medium text-muted">{initial}</span>
              )}
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div key={location.pathname} className="animate-[pagein_180ms_ease-out]">
          <Outlet />
        </div>
      </main>
      <footer className="border-t border-edge mt-12 py-6 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-muted">
          <div className="flex items-center gap-2">
            <Logo size={16} />
            <span>Stagehand</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/terms" className="hover:text-white">Terms</Link>
            <Link to="/privacy" className="hover:text-white">Privacy</Link>
            <span className="text-muted/80 hidden sm:inline">Made for artists who haven't released it yet.</span>
          </div>
        </div>
      </footer>
      <PlayerBar />
      <NowPlayingOverlay />
      <NotificationsBootstrap />
      <NotificationToasts />
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
