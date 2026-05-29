import { Link, useLocation } from "react-router-dom";
import { LibraryBig, Search, User, Shield } from "lucide-react";
import { useUiStore } from "../lib/ui";
import { useIsAdmin } from "../lib/admin";

// Mobile-only floating pill navigation. Desktop keeps the top header nav
// (AppShell hides the top nav on mobile so this is the single mobile nav).
// The player bar floats just above this (its mobile offset accounts for the
// tab-bar height).
export default function BottomTabBar() {
  const location = useLocation();
  const path = location.pathname;
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const searchOpen = useUiStore((s) => s.searchOpen);
  const { isAdmin } = useIsAdmin();

  // Library is "home" — also the active tab while drilled into an album/track.
  const libraryActive =
    path === "/" || path.startsWith("/album") || path.startsWith("/track");
  const profileActive = path === "/profile";
  const adminActive = path.startsWith("/admin");

  return (
    <nav
      className="sm:hidden fixed inset-x-0 z-30 px-3 pointer-events-none"
      style={{ bottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      aria-label="Primary"
    >
      <div className="pointer-events-auto glass-raised rounded-full mx-auto max-w-md flex items-stretch px-1.5 py-1.5">
        <TabLink to="/" active={libraryActive} icon={<LibraryBig size={20} />} label="Library" />
        <TabButton
          active={searchOpen}
          onClick={() => setSearchOpen(true)}
          icon={<Search size={20} />}
          label="Search"
        />
        <TabLink to="/profile" active={profileActive} icon={<User size={20} />} label="Profile" />
        {isAdmin && (
          <TabLink to="/admin" active={adminActive} icon={<Shield size={20} />} label="Admin" />
        )}
      </div>
    </nav>
  );
}

function tabClass(active: boolean): string {
  return `flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-full transition ${
    active ? "text-accent" : "text-white/55 hover:text-white"
  }`;
}

function TabLink({
  to,
  active,
  icon,
  label,
}: {
  to: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link to={to} className={tabClass(active)} aria-current={active ? "page" : undefined}>
      <span
        className={`flex items-center justify-center w-10 h-7 rounded-full transition ${
          active ? "bg-accent/15" : ""
        }`}
      >
        {icon}
      </span>
      <span className="text-[10px] tracking-wide">{label}</span>
    </Link>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button onClick={onClick} className={tabClass(active)}>
      <span
        className={`flex items-center justify-center w-10 h-7 rounded-full transition ${
          active ? "bg-accent/15" : ""
        }`}
      >
        {icon}
      </span>
      <span className="text-[10px] tracking-wide">{label}</span>
    </button>
  );
}
