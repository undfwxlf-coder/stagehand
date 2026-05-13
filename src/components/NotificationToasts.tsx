import { Link } from "react-router-dom";
import { X, Bell } from "lucide-react";
import { useToasts } from "../lib/notifications";

export default function NotificationToasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 right-3 sm:right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => {
        const name = t.listenerName?.trim() || "Someone";
        return (
          <div
            key={t.id}
            className="pointer-events-auto w-[300px] max-w-[90vw] bg-panel border border-edge rounded-lg shadow-xl px-3 py-2.5 flex items-start gap-2 animate-[slidein_180ms_ease-out]"
          >
            <Bell size={14} className="text-accent mt-0.5 shrink-0" />
            <Link
              to={`/track/${t.trackId}`}
              onClick={() => dismiss(t.id)}
              className="flex-1 min-w-0 text-sm text-white"
            >
              <span className="font-medium">{name}</span>
              <span className="text-muted"> listened to </span>
              <span className="font-medium">{t.trackTitle}</span>
            </Link>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="text-muted hover:text-white shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
