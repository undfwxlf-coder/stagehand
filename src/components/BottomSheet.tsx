import { useEffect } from "react";
import { X } from "lucide-react";

interface Props {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  compact?: boolean;
}

export default function BottomSheet({ children, onClose, title, compact = false }: Props) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-xl"
        aria-hidden
      />
      <div
        className={`relative w-full sm:max-w-lg bg-panel border border-edge rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col ${
          compact ? "max-h-[60vh]" : "max-h-[80vh] sm:max-h-[75vh]"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between px-4 sm:px-5 pt-3 pb-2 shrink-0">
          <div className="w-10 h-1 bg-edge rounded-full mx-auto absolute left-1/2 -translate-x-1/2 top-2 sm:hidden" />
          <h2 className="text-sm font-medium text-white tracking-tight truncate pt-1">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full text-muted hover:text-white hover:bg-panel2 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}
