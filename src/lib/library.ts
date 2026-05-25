import { create } from "zustand";
import { supabase } from "./supabase";
import type { Album, CollabAlbum } from "./database.types";

interface LibraryState {
  albums: Album[];
  // Albums where the caller is a collaborator (via an invite share with
  // allow_editing). Owner-side album RLS hides these, so they live alongside
  // the owned list rather than mixing in.
  collabs: CollabAlbum[];
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
  collabs: [],
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
    const [albumsRes, collabsRes] = await Promise.all([
      supabase.from("albums").select("*").order("created_at", { ascending: false }),
      supabase.rpc("list_collaborating_albums"),
    ]);
    if (!albumsRes.error) {
      set({
        albums: albumsRes.data ?? [],
        collabs: (collabsRes.data as CollabAlbum[] | null) ?? [],
        loaded: true,
        refreshing: false,
      });
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

  clear: () => set({ albums: [], collabs: [], loaded: false, refreshing: false }),
}));
