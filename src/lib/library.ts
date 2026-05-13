import { create } from "zustand";
import { supabase } from "./supabase";
import type { Album } from "./database.types";

interface LibraryState {
  albums: Album[];
  loaded: boolean;
  refreshing: boolean;
  load: (opts?: { force?: boolean }) => Promise<void>;
  prepend: (album: Album) => void;
  update: (id: string, patch: Partial<Album>) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  albums: [],
  loaded: false,
  refreshing: false,

  load: async ({ force = false } = {}) => {
    const { loaded, refreshing } = get();
    if (refreshing) return;
    if (loaded && !force) {
      // Background refresh — don't flip `loaded` off, just refetch.
      set({ refreshing: true });
    } else {
      set({ refreshing: true });
    }
    const { data, error } = await supabase
      .from("albums")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) {
      set({ albums: data ?? [], loaded: true, refreshing: false });
    } else {
      set({ refreshing: false });
    }
  },

  prepend: (album) => set((s) => ({ albums: [album, ...s.albums] })),

  update: (id, patch) =>
    set((s) => ({
      albums: s.albums.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),

  remove: (id) =>
    set((s) => ({ albums: s.albums.filter((a) => a.id !== id) })),

  clear: () => set({ albums: [], loaded: false, refreshing: false }),
}));
