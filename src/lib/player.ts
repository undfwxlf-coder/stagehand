import { create } from "zustand";

export interface PlayerTrack {
  trackId: string;
  versionId: string;
  title: string;
  albumTitle: string;
  audioUrl: string;
  peaks?: number[] | null;
  duration?: number | null;
  artistName?: string | null;
  artworkUrl?: string | null;
}

interface PlayerState {
  current: PlayerTrack | null;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  queue: PlayerTrack[];
  volume: number; // 0..1
  muted: boolean;
  play: (t: PlayerTrack) => void;
  toggle: () => void;
  setPlaying: (p: boolean) => void;
  setPosition: (s: number) => void;
  setDuration: (s: number) => void;
  setQueue: (q: PlayerTrack[]) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  next: () => void;
  prev: () => void;
}

const VOL_KEY = "stagehand:volume";
const MUTE_KEY = "stagehand:muted";
const initialVolume = (() => {
  try {
    const v = parseFloat(localStorage.getItem(VOL_KEY) ?? "");
    return isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  } catch {
    return 1;
  }
})();
const initialMuted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();

export const usePlayer = create<PlayerState>((set, get) => ({
  current: null,
  isPlaying: false,
  positionSec: 0,
  durationSec: 0,
  queue: [],
  volume: initialVolume,
  muted: initialMuted,
  play: (t) => set({ current: t, isPlaying: true, positionSec: 0 }),
  toggle: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setPlaying: (p) => set({ isPlaying: p }),
  setPosition: (s) => set({ positionSec: s }),
  setDuration: (s) => set({ durationSec: s }),
  setQueue: (q) => set({ queue: q }),
  setVolume: (v) => {
    const clamped = Math.min(1, Math.max(0, v));
    try { localStorage.setItem(VOL_KEY, String(clamped)); } catch { /* ignore */ }
    // unmuting when user adjusts up from 0
    set((s) => ({ volume: clamped, muted: clamped > 0 ? false : s.muted }));
  },
  toggleMute: () => {
    set((s) => {
      const next = !s.muted;
      try { localStorage.setItem(MUTE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return { muted: next };
    });
  },
  next: () => {
    const { queue, current } = get();
    if (!current) return;
    const idx = queue.findIndex((t) => t.versionId === current.versionId);
    const nxt = queue[idx + 1];
    if (nxt) set({ current: nxt, isPlaying: true, positionSec: 0 });
    else set({ isPlaying: false });
  },
  prev: () => {
    const { queue, current, positionSec } = get();
    if (!current) return;
    if (positionSec > 3) return set({ positionSec: 0 });
    const idx = queue.findIndex((t) => t.versionId === current.versionId);
    const prv = queue[idx - 1];
    if (prv) set({ current: prv, isPlaying: true, positionSec: 0 });
  },
}));
