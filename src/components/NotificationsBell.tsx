import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { useNotifications } from "../lib/notifications";

export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const items = useNotifications((s) => s.items);
  const lastSeenAt = useNotifications((s) => s.lastSeenAt);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const unread = items.filter((n) => n.createdAt > lastSeenAt).length;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (next) markAllRead();
      return next;
    });
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        title="Notifications"
        className="relative w-8 h-8 rounded-full bg-panel2 border border-edge hover:border-muted/60 flex items-center justify-center text-muted hover:text-white transition"
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-accent text-white text-[10px] font-medium flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[92vw] bg-panel border border-edge rounded-lg shadow-xl overflow-hidden z-30">
          <div className="px-3 py-2 border-b border-edge flex items-center justify-between">
            <span className="text-sm text-white font-medium">Notifications</span>
            <span className="text-[11px] text-muted">{items.length} recent</span>
          </div>
          {items.length === 0 ? (
            <div className="px-3 py-6 text-sm text-muted text-center">
              No listens yet. Share a track to get notified when someone plays it.
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto divide-y divide-edge">
              {items.map((n) => {
                const name = n.listenerName?.trim() || "Someone";
                return (
                  <li key={n.id}>
                    <Link
                      to={`/track/${n.trackId}`}
                      onClick={() => setOpen(false)}
                      className="block px-3 py-2.5 hover:bg-panel2/60 transition"
                    >
                      <div className="text-sm text-white">
                        <span className="font-medium">{name}</span>
                        <span className="text-muted"> listened to </span>
                        <span className="font-medium">{n.trackTitle}</span>
                      </div>
                      <div className="text-[11px] text-muted mt-0.5">
                        {relativeTime(n.createdAt)}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
