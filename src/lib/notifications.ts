import { create } from "zustand";

export interface PlayNotification {
  id: string;
  trackId: string;
  trackTitle: string;
  listenerName: string | null;
  createdAt: string;
}

const LAST_SEEN_KEY = "stagehand:notifications:lastSeenAt";

function loadLastSeen(): string {
  if (typeof window === "undefined") return new Date(0).toISOString();
  return localStorage.getItem(LAST_SEEN_KEY) ?? new Date(0).toISOString();
}

function saveLastSeen(iso: string) {
  if (typeof window !== "undefined") localStorage.setItem(LAST_SEEN_KEY, iso);
}

interface NotificationsState {
  items: PlayNotification[];
  lastSeenAt: string;
  setInitial: (items: PlayNotification[]) => void;
  push: (item: PlayNotification) => void;
  markAllRead: () => void;
  clear: () => void;
  unreadCount: () => number;
}

export const useNotifications = create<NotificationsState>((set, get) => ({
  items: [],
  lastSeenAt: loadLastSeen(),

  setInitial: (items) => {
    const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    set({ items: sorted.slice(0, 50) });
  },

  push: (item) => {
    set((state) => {
      if (state.items.some((n) => n.id === item.id)) return state;
      return { items: [item, ...state.items].slice(0, 50) };
    });
  },

  markAllRead: () => {
    const now = new Date().toISOString();
    saveLastSeen(now);
    set({ lastSeenAt: now });
  },

  clear: () => {
    saveLastSeen(new Date().toISOString());
    set({ items: [], lastSeenAt: new Date().toISOString() });
  },

  unreadCount: () => {
    const { items, lastSeenAt } = get();
    return items.filter((n) => n.createdAt > lastSeenAt).length;
  },
}));

interface ToastState {
  toasts: PlayNotification[];
  show: (item: PlayNotification) => void;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  show: (item) => {
    set((s) => ({ toasts: [...s.toasts, item] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== item.id) }));
    }, 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
