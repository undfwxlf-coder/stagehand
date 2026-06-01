import { create } from "zustand";
import { getSignedAudioUrl } from "./audio";

export interface PlayerTrack {
  trackId: string;
  versionId: string;
  title: string;
  albumTitle: string;
  // One of these must be set. `audioUrl` is a pre-signed URL (used when the
  // listener doesn't own the audio — e.g. share-link saves). `storagePath`
  // is a private-bucket path that the player signs on demand.
  audioUrl?: string;
  storagePath?: string | null;
  peaks?: number[] | null;
  duration?: number | null;
  artistName?: string | null;
  artworkUrl?: string | null;
}

// Resolves a PlayerTrack to a playable URL, caching the signed result on the
// queue item itself so repeated reads (preload + actual load) don't re-sign.
const signedCache = new Map<string, string>();
export async function resolvePlayerUrl(t: PlayerTrack): Promise<string> {
  if (t.audioUrl) return t.audioUrl;
  if (!t.storagePath) throw new Error("Track has no audioUrl or storagePath");
  const cached = signedCache.get(t.storagePath);
  if (cached) return cached;
  const url = await getSignedAudioUrl(t.storagePath);
  signedCache.set(t.storagePath, url);
  return url;
}

export type RepeatMode = "off" | "one" | "all";

interface PlayerState {
  current: PlayerTrack | null;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  // Transient — set by a caller wanting the player to seek; PlayerBar reads
  // it, applies the seek to its wavesurfer, then clears via consumeSeek().
  // Bumped via a nonce so repeated seeks to the same second still trigger.
  pendingSeek: { sec: number; nonce: number } | null;
  // Full-screen now-playing overlay visibility. Auto-set on play(); user
  // can dismiss via the chevron-down and re-open by tapping PlayerBar.
  expanded: boolean;
  queue: PlayerTrack[];
  volume: number; // 0..1
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  play: (t: PlayerTrack) => void;
  toggle: () => void;
  setPlaying: (p: boolean) => void;
  setPosition: (s: number) => void;
  setDuration: (s: number) => void;
  setQueue: (q: PlayerTrack[]) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  seekTo: (sec: number) => void;
  consumeSeek: () => void;
  setExpanded: (b: boolean) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  next: () => void;
  prev: () => void;
  // Called by the wavesurfer finish handler. Honors repeat:"one" (restart
  // current) and repeat:"all" (wrap to top); next() ignores them because
  // user-clicked-next should always actually advance.
  autoAdvance: () => void;
}

const VOL_KEY = "stagehand:volume";
const MUTE_KEY = "stagehand:muted";
const SHUFFLE_KEY = "stagehand:shuffle";
const REPEAT_KEY = "stagehand:repeat";
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
const initialShuffle = (() => {
  try {
    return localStorage.getItem(SHUFFLE_KEY) === "1";
  } catch {
    return false;
  }
})();
const initialRepeat: RepeatMode = (() => {
  try {
    const v = localStorage.getItem(REPEAT_KEY);
    if (v === "one" || v === "all" || v === "off") return v;
    return "off";
  } catch {
    return "off";
  }
})();

export const usePlayer = create<PlayerState>((set, get) => ({
  current: null,
  isPlaying: false,
  positionSec: 0,
  durationSec: 0,
  pendingSeek: null,
  expanded: false,
  queue: [],
  volume: initialVolume,
  muted: initialMuted,
  shuffle: initialShuffle,
  repeat: initialRepeat,
  play: (t) => set({ current: t, isPlaying: true, positionSec: 0, expanded: true }),
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
  seekTo: (sec) => set({ pendingSeek: { sec: Math.max(0, sec), nonce: Date.now() } }),
  consumeSeek: () => set({ pendingSeek: null }),
  setExpanded: (b) => set({ expanded: b }),
  toggleShuffle: () => {
    set((s) => {
      const nextVal = !s.shuffle;
      try { localStorage.setItem(SHUFFLE_KEY, nextVal ? "1" : "0"); } catch { /* ignore */ }
      return { shuffle: nextVal };
    });
  },
  cycleRepeat: () => {
    set((s) => {
      const order: RepeatMode[] = ["off", "all", "one"];
      const nextVal = order[(order.indexOf(s.repeat) + 1) % order.length];
      try { localStorage.setItem(REPEAT_KEY, nextVal); } catch { /* ignore */ }
      return { repeat: nextVal };
    });
  },
  next: () => {
    const { queue, current, shuffle, repeat } = get();
    if (!current) return;
    const idx = queue.findIndex((t) => t.versionId === current.versionId);
    let nxt: PlayerTrack | undefined;
    if (shuffle && queue.length > 1) {
      // Pick a random track other than the current one. Re-roll until we
      // land on something different — bounded by queue.length so it
      // terminates fast even with a small queue.
      let pick = idx;
      for (let i = 0; i < 8 && pick === idx; i++) {
        pick = Math.floor(Math.random() * queue.length);
      }
      nxt = queue[pick === idx ? (idx + 1) % queue.length : pick];
    } else {
      nxt = queue[idx + 1];
    }
    if (nxt) set({ current: nxt, isPlaying: true, positionSec: 0 });
    else if (repeat === "all" && queue[0]) set({ current: queue[0], isPlaying: true, positionSec: 0 });
    else set({ isPlaying: false });
  },
  autoAdvance: () => {
    const { queue, current, shuffle, repeat } = get();
    if (!current) return;
    // Repeat-one: replay the same track from the top. Use pendingSeek so
    // the wavesurfer rewinds even though the track identity didn't change.
    if (repeat === "one") {
      set({ pendingSeek: { sec: 0, nonce: Date.now() }, positionSec: 0, isPlaying: true });
      return;
    }
    const idx = queue.findIndex((t) => t.versionId === current.versionId);
    let nxt: PlayerTrack | undefined;
    if (shuffle && queue.length > 1) {
      let pick = idx;
      for (let i = 0; i < 8 && pick === idx; i++) {
        pick = Math.floor(Math.random() * queue.length);
      }
      nxt = queue[pick === idx ? (idx + 1) % queue.length : pick];
    } else {
      nxt = queue[idx + 1];
    }
    if (nxt) set({ current: nxt, isPlaying: true, positionSec: 0 });
    else if (repeat === "all" && queue[0]) set({ current: queue[0], isPlaying: true, positionSec: 0 });
    else set({ isPlaying: false });
  },
  prev: () => {
    const { queue, current, positionSec } = get();
    if (!current) return;
    // Spotify/Apple Music behavior: if we're past the 3-second mark, treat
    // the back button as "restart this track" instead of "previous track".
    // Must go through pendingSeek so the wavesurfer actually rewinds —
    // setting positionSec alone only updates the UI label.
    if (positionSec > 3) {
      set({ pendingSeek: { sec: 0, nonce: Date.now() }, positionSec: 0 });
      return;
    }
    const idx = queue.findIndex((t) => t.versionId === current.versionId);
    const prv = queue[idx - 1];
    if (prv) set({ current: prv, isPlaying: true, positionSec: 0 });
    else set({ pendingSeek: { sec: 0, nonce: Date.now() }, positionSec: 0 });
  },
}));
