import { useEffect, useRef, useState } from "react";

import { formatErr } from "../lib/errors";
import WaveSurfer from "wavesurfer.js";
import { Pause, Play, SkipBack, SkipForward, AlertTriangle, Music } from "lucide-react";
import { usePlayer, resolvePlayerUrl } from "../lib/player";
import { fmtTime } from "../lib/audio";
import { recordPlay } from "../lib/plays";

export default function PlayerBar() {
  // Per-field selectors so positionSec changes (60/sec during playback) only
  // re-render the small Time/Progress subcomponents below — not the whole bar.
  const current = usePlayer((s) => s.current);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const setPlaying = usePlayer((s) => s.setPlaying);
  const setPosition = usePlayer((s) => s.setPosition);
  const setDuration = usePlayer((s) => s.setDuration);
  const pendingSeek = usePlayer((s) => s.pendingSeek);
  const consumeSeek = usePlayer((s) => s.consumeSeek);
  const queue = usePlayer((s) => s.queue);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const autoAdvance = usePlayer((s) => s.autoAdvance);
  const toggle = usePlayer((s) => s.toggle);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const setExpanded = usePlayer((s) => s.setExpanded);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const lastVersionId = useRef<string | null>(null);
  const readyRef = useRef(false);
  const wantsPlayRef = useRef(false);
  // Versions we've already fired `finish` → next() for. Wavesurfer can fire
  // `finish` twice near the end on some files; the second call would read
  // the just-updated store and advance again, skipping a track. Guard by
  // recording the version we advanced from and short-circuiting repeats.
  const lastFinishedVersionRef = useRef<string | null>(null);
  const lastFinishAtRef = useRef(0);
  // True from the moment a natural-end advance starts until the new track's
  // wavesurfer instance fires `ready`. While true, the trailing `pause` from
  // load() is swallowed AND we force-play on ready regardless of store state
  // drift. Replaces an older 250ms setTimeout that lost autoplay on slow
  // network loads.
  const autoAdvancingRef = useRef(false);
  // Hidden <audio> we point at the next queue item so the browser pre-fetches
  // and HTTP-caches the bytes. When the current track finishes and the player
  // advances, `ws.load(nextUrl)` reads from cache instead of re-fetching → no
  // audible gap between tracks.
  const preloadAudioRef = useRef<HTMLAudioElement | null>(null);
  const preloadedVersionRef = useRef<string | null>(null);
  // Set true the moment a track ends naturally and we call next(). Suppresses
  // the trailing `pause` event that wavesurfer fires after the audio element's
  // `ended` — otherwise that pause flips isPlaying back to false and the next
  // track loads but doesn't auto-play.
  const finishingRef = useRef(false);
  // True when wavesurfer paused without the user asking — iOS audio session
  // interrupt (Apple Music / phone call / AirPods swap), tab backgrounded,
  // OS taking the audio focus. We capture intent here so when the page
  // becomes visible / focused again we can resume automatically.
  const interruptedRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Lazily create the wavesurfer instance on the first track-change effect.
  // We can't do this on mount because `PlayerBar` early-returns `null` until
  // the first track is set, so the `<div ref={containerRef}>` doesn't exist
  // until after `current` becomes non-null. Once created, the same instance
  // is reused for every subsequent track change — only `ws.load()` is called,
  // which (combined with the queue-preload effect below) makes auto-advance
  // effectively gapless.
  useEffect(() => {
    if (!current) return;
    if (!containerRef.current) return;
    if (lastVersionId.current === current.versionId && wsRef.current) return;

    let ws = wsRef.current;
    if (!ws) {
      ws = WaveSurfer.create({
        container: containerRef.current,
        height: 32,
        waveColor: "rgba(255,255,255,0.18)",
        progressColor: "#BB0A21",
        cursorColor: "rgba(255,255,255,0.5)",
        barWidth: 2,
        barRadius: 2,
        barGap: 2,
        normalize: true,
      });

      ws.on("ready", () => {
        readyRef.current = true;
        const w = wsRef.current;
        if (!w) return;
        setDuration(w.getDuration());
        const { volume: v, muted: m, isPlaying: shouldPlay } = usePlayer.getState();
        try {
          w.setVolume(m ? 0 : v);
          w.setMuted(m);
        } catch {
          // ignore
        }
        // Auto-advance overrides any stale isPlaying=false that may have
        // slipped in between `finish` and this `ready`.
        const wasAdvancing = autoAdvancingRef.current;
        autoAdvancingRef.current = false;
        if (wasAdvancing || shouldPlay || wantsPlayRef.current) {
          console.log("[player] ready → auto-play", { wasAdvancing, shouldPlay });
          setPlaying(true);
          w.play().catch((e) => {
            console.error("[player] play() rejected", e);
            setPlaying(false);
          });
        } else {
          console.log("[player] ready → not playing (shouldPlay false)");
        }
      });
      ws.on("loading", (n) => {
        if (n === 0) setLoadError(null);
      });
      ws.on("error", (e) => {
        console.error("[player] wavesurfer error", e);
        setLoadError(formatErr(e));
        setPlaying(false);
      });
      // Throttle position writes to ~10Hz. wavesurfer fires audioprocess at
      // roughly 60Hz; the store update + downstream subscribers don't need
      // sub-100ms resolution and the saved cycles add up on phones.
      let lastPosWrite = 0;
      ws.on("audioprocess", () => {
        const now = performance.now();
        if (now - lastPosWrite < 100) return;
        lastPosWrite = now;
        const w = wsRef.current;
        if (w) setPosition(w.getCurrentTime());
      });
      ws.on("seeking", () => {
        const w = wsRef.current;
        if (w) setPosition(w.getCurrentTime());
      });
      ws.on("play", () => {
        setPlaying(true);
        const cur = usePlayer.getState().current;
        if (cur) recordPlay(cur.trackId);
      });
      ws.on("pause", () => {
        if (finishingRef.current || autoAdvancingRef.current) {
          // Swallow the trailing pause from a natural track end or from the
          // ws.load() of an auto-advance. The next track's `ready` handler
          // will resume playback.
          console.log("[player] pause (suppressed — auto-advance in flight)");
          return;
        }
        // If the store still thinks we should be playing, this pause was
        // not user-initiated (iOS audio interrupt, tab backgrounded, OS
        // muting). Capture intent so the visibility/focus listener can
        // auto-resume when we get the audio session back.
        if (usePlayer.getState().isPlaying) {
          interruptedRef.current = true;
          console.log("[player] pause (external — interrupted, will resume on return)");
        } else {
          console.log("[player] pause");
        }
        setPlaying(false);
      });
      ws.on("finish", () => {
        // Identify the track that just ended by what we last loaded into this
        // wavesurfer — store.current may already point at the next track if
        // React processed the prior next() before the duplicate finish fires.
        const finishedVersion = lastVersionId.current;
        const now = Date.now();
        if (
          (finishedVersion && lastFinishedVersionRef.current === finishedVersion) ||
          now - lastFinishAtRef.current < 500
        ) {
          console.log("[player] finish (duplicate — ignored)");
          return;
        }
        lastFinishedVersionRef.current = finishedVersion;
        lastFinishAtRef.current = now;
        console.log("[player] finish → advancing queue");
        finishingRef.current = true;
        autoAdvancingRef.current = true;
        // Cleared in the next track's `ready` handler (autoAdvancingRef) or
        // on user action. The 250ms timer is a fallback in case there is no
        // next track to load (queue end) — we don't want to swallow real
        // pauses forever.
        setTimeout(() => { finishingRef.current = false; }, 250);
        // autoAdvance honors repeat:"one" / repeat:"all" / shuffle. The
        // user-facing next() button on the transport always advances.
        autoAdvance();
      });

      wsRef.current = ws;
    }

    lastVersionId.current = current.versionId;
    readyRef.current = false;
    setLoadError(null);
    const peaks = current.peaks ? [current.peaks] : undefined;
    const duration = current.duration ?? undefined;
    const instance = ws;
    (async () => {
      try {
        const url = await resolvePlayerUrl(current);
        console.log("[player] load", current.title, current.versionId);
        await instance.load(url, peaks, duration);
      } catch (e) {
        console.error("[player] load() rejected", e);
        setLoadError(formatErr(e));
      }
    })();
  }, [current, autoAdvance, setDuration, setPlaying, setPosition]);

  // Tear down the wavesurfer instance on unmount.
  useEffect(() => {
    return () => {
      wsRef.current?.destroy();
      wsRef.current = null;
    };
  }, []);

  // Preload the *next* queue item once the current track is in flight. The
  // bytes land in the browser HTTP cache, so when the user finishes the
  // current track, ws.load(nextUrl) is effectively instant.
  useEffect(() => {
    if (!current) return;
    const idx = queue.findIndex((t) => t.versionId === current.versionId);
    const upcoming = queue[idx + 1];
    if (!upcoming) {
      // Nothing to preload — clear any prior preload so we don't keep bytes
      // alive for a queue item we're no longer about to play.
      if (preloadAudioRef.current) {
        preloadAudioRef.current.src = "";
        preloadAudioRef.current = null;
      }
      preloadedVersionRef.current = null;
      return;
    }
    if (preloadedVersionRef.current === upcoming.versionId) return;
    let cancelled = false;
    (async () => {
      try {
        const url = await resolvePlayerUrl(upcoming);
        if (cancelled) return;
        const audio = new Audio();
        audio.preload = "auto";
        audio.crossOrigin = "anonymous";
        audio.src = url;
        // Some browsers need an explicit .load() to start the network fetch
        // when preload="auto" — calling it is harmless if already in flight.
        audio.load();
        preloadAudioRef.current = audio;
        preloadedVersionRef.current = upcoming.versionId;
      } catch (e) {
        console.warn("[player] preload failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current, queue]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const effective = muted ? 0 : volume;
    try {
      ws.setVolume(effective);
      ws.setMuted(muted);
    } catch {
      // ignore
    }
  }, [volume, muted, current]);

  useEffect(() => {
    wantsPlayRef.current = isPlaying;
    // If isPlaying drops to false while an auto-advance is in flight, treat
    // it as a user-initiated pause and cancel the pending auto-play — so
    // the next track's ready handler doesn't force playback to resume.
    if (!isPlaying) autoAdvancingRef.current = false;
    const ws = wsRef.current;
    if (!ws || !readyRef.current) return;
    if (isPlaying) {
      ws.play().catch((e) => {
        console.error("[player] play() rejected", e);
        setPlaying(false);
      });
    } else {
      ws.pause();
    }
  }, [isPlaying, setPlaying]);

  // MediaSession: title/artist/album/artwork shown in iOS Control Center & Android lock screen.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    const artwork = current.artworkUrl
      ? [{ src: current.artworkUrl, sizes: "512x512", type: "image/jpeg" }]
      : [
          { src: "/logo-192.png", sizes: "192x192", type: "image/png" },
          { src: "/logo-512.png", sizes: "512x512", type: "image/png" },
          { src: "/logo-1024.png", sizes: "1024x1024", type: "image/png" },
        ];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artistName ?? "Stagehand",
      album: current.albumTitle,
      artwork,
    });
  }, [current]);

  // MediaSession action handlers — iOS Control Center play/pause/skip/seek.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => setPlaying(true));
    ms.setActionHandler("pause", () => setPlaying(false));
    ms.setActionHandler("nexttrack", () => next());
    ms.setActionHandler("previoustrack", () => prev());
    try {
      ms.setActionHandler("seekto", (details) => {
        if (details.seekTime != null && wsRef.current) {
          wsRef.current.setTime(details.seekTime);
        }
      });
    } catch {
      // Older browsers don't support seekto
    }
    return () => {
      ms.setActionHandler("play", null);
      ms.setActionHandler("pause", null);
      ms.setActionHandler("nexttrack", null);
      ms.setActionHandler("previoustrack", null);
      try { ms.setActionHandler("seekto", null); } catch { /* ignore */ }
    };
  }, [next, prev, setPlaying]);

  // Auto-resume after an external audio interruption. When iOS hands the
  // audio session to another app (Apple Music, a phone call, AirPods swap)
  // or the tab gets backgrounded with audio focus stolen, wavesurfer pauses
  // and we mark interruptedRef. When the user returns to the tab (visibility,
  // focus, or pageshow), we restore play. iOS doesn't surface a clean
  // "interruption ended" event for web apps, so coming back to the tab is
  // the most reliable resume trigger.
  useEffect(() => {
    const resume = () => {
      if (!interruptedRef.current) return;
      if (document.visibilityState !== "visible") return;
      const ws = wsRef.current;
      if (!ws || !readyRef.current) return;
      interruptedRef.current = false;
      console.log("[player] resuming after interruption");
      setPlaying(true);
      ws.play().catch((e) => {
        console.warn("[player] auto-resume play() rejected", e);
        setPlaying(false);
      });
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, [setPlaying]);

  // Reflect play state to MediaSession.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  // Honor external seek requests (e.g. clicking a comment timestamp on TrackPage).
  // The nonce on pendingSeek ensures back-to-back seeks to the same second still fire.
  useEffect(() => {
    if (!pendingSeek) return;
    const ws = wsRef.current;
    if (ws && readyRef.current) {
      try { ws.setTime(Math.max(0, pendingSeek.sec)); } catch { /* ignore */ }
    }
    consumeSeek();
  }, [pendingSeek, consumeSeek]);

  if (!current) return null;

  const seekRatio = (ratio: number) => {
    const r = Math.max(0, Math.min(1, ratio));
    wsRef.current?.seekTo(r);
  };

  return (
    <div
      className="fixed inset-x-0 z-30 px-3 sm:px-4 pointer-events-none bottom-[calc(env(safe-area-inset-bottom,0px)+4.75rem)] sm:bottom-3"
    >
      <div className="max-w-5xl mx-auto pointer-events-auto glass-raised rounded-full relative">
        {/* Mobile-only thin progress bar — inset along the bottom of the pill
            so the full rounding doesn't clip it. Subscribes to positionSec on
            its own so the outer bar doesn't re-render 60x/sec. */}
        <MobileProgressBar onSeek={seekRatio} />

        <div className="px-3 sm:px-5 pt-2.5 pb-4 sm:py-3">
          <div className="flex items-center gap-3 sm:gap-4">
            <button
              onClick={() => setExpanded(true)}
              className="min-w-0 flex-1 sm:flex-none sm:w-60 text-left hover:bg-white/5 -mx-2 px-2 -my-1 py-1 rounded-xl transition flex items-center gap-3"
              aria-label="Expand now-playing"
              title="Tap to expand"
            >
              <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-white/[0.06] border border-white/10 flex items-center justify-center text-white/30">
                {current.artworkUrl ? (
                  <img src={current.artworkUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Music size={18} strokeWidth={1.4} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white truncate tracking-tight">{current.title}</div>
                <div className="text-xs text-white/50 truncate">{current.albumTitle}</div>
                {loadError && (
                  <div className="text-xs text-red-400 truncate flex items-center gap-1" title={loadError}>
                    <AlertTriangle size={12} className="shrink-0" />
                    <span className="truncate">{loadError}</span>
                  </div>
                )}
              </div>
            </button>

            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <IconBtn onClick={prev} label="Previous"><SkipBack size={18} /></IconBtn>
              <button
                onClick={toggle}
                className="w-11 h-11 sm:w-10 sm:h-10 rounded-full bg-white text-ink flex items-center justify-center shadow-[0_4px_20px_-4px_rgba(255,255,255,0.4)] hover:scale-105 active:scale-95 transition"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="translate-x-[1px]" />}
              </button>
              <IconBtn onClick={next} label="Next"><SkipForward size={18} /></IconBtn>
            </div>

            {/* Desktop-only waveform + timestamps — isolated subscription too. */}
            <DesktopTimeStrip containerRef={containerRef} />

            <VolumeControl volume={volume} muted={muted} onVolumeChange={setVolume} onToggleMute={toggleMute} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopTimeStrip({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  // Isolated subscription. Re-renders ~10x/sec (throttled in PlayerBar's
  // audioprocess) but only this small subtree, not the whole bar.
  const positionSec = usePlayer((s) => s.positionSec);
  const durationSec = usePlayer((s) => s.durationSec);

  // iOS Control Center scrubber — keep it co-located with the time display.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!isFinite(durationSec) || durationSec <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: durationSec,
        position: Math.min(Math.max(0, positionSec), durationSec),
        playbackRate: 1,
      });
    } catch {
      // ignore
    }
  }, [positionSec, durationSec]);

  return (
    <div className="hidden sm:flex flex-1 items-center gap-3">
      <span className="text-xs text-white/40 tabular-nums w-10 text-right">{fmtTime(positionSec)}</span>
      <div ref={containerRef} className="flex-1 cursor-pointer" />
      <span className="text-xs text-white/40 tabular-nums w-10">{fmtTime(durationSec)}</span>
    </div>
  );
}

function MobileProgressBar({ onSeek }: { onSeek: (ratio: number) => void }) {
  // Subscribes only to position + duration, isolated from the parent bar.
  const positionSec = usePlayer((s) => s.positionSec);
  const durationSec = usePlayer((s) => s.durationSec);
  const ratio = durationSec > 0 ? Math.min(1, positionSec / durationSec) : 0;

  const handleEvent = (clientX: number, target: HTMLDivElement) => {
    const rect = target.getBoundingClientRect();
    onSeek((clientX - rect.left) / rect.width);
  };

  return (
    <div
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.max(1, durationSec)}
      aria-valuenow={positionSec}
      tabIndex={0}
      onClick={(e) => handleEvent(e.clientX, e.currentTarget)}
      onTouchStart={(e) => {
        if (e.touches[0]) handleEvent(e.touches[0].clientX, e.currentTarget);
      }}
      onTouchMove={(e) => {
        if (e.touches[0]) handleEvent(e.touches[0].clientX, e.currentTarget);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onSeek(Math.max(0, ratio - 0.05));
        else if (e.key === "ArrowRight") onSeek(Math.min(1, ratio + 0.05));
      }}
      className="sm:hidden absolute left-6 right-6 bottom-1.5 cursor-pointer flex items-center"
      style={{ touchAction: "none", height: 12 }}
    >
      <div className="w-full h-1 rounded-full bg-white/15 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-[#e0233a]"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

function VolumeControl({
  volume,
  muted,
  onVolumeChange,
  onToggleMute,
}: {
  volume: number;
  muted: boolean;
  onVolumeChange: (v: number) => void;
  onToggleMute: () => void;
}) {
  const effective = muted ? 0 : volume;
  return (
    <div className="hidden sm:flex items-center gap-2 w-28 shrink-0 mr-1">
      <button
        onClick={onToggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        title={muted ? "Unmute" : "Mute"}
        className="w-7 h-7 shrink-0 rounded-full text-white/60 hover:text-white hover:bg-white/10 flex items-center justify-center transition"
      >
        <VolumeIcon level={effective} muted={muted} />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={effective}
        onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
        aria-label="Volume"
        className={[
          "min-w-0 flex-1 h-1 cursor-pointer rounded-full",
          "appearance-none [-webkit-appearance:none]",
          "outline-none focus:outline-none focus-visible:outline-none",
          "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent",
          "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:[-webkit-appearance:none]",
          "[&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#F0EDDF] [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:cursor-pointer",
          "[&::-moz-range-track]:h-1 [&::-moz-range-track]:bg-transparent [&::-moz-range-track]:border-0",
          "[&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#F0EDDF] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer",
        ].join(" ")}
        style={{
          background: `linear-gradient(to right, #BB0A21 0%, #e0233a ${effective * 100}%, rgba(240,237,223,0.14) ${effective * 100}%, rgba(240,237,223,0.14) 100%)`,
        }}
      />
    </div>
  );
}

function VolumeIcon({ level, muted }: { level: number; muted: boolean }) {
  const showMute = muted || level === 0;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 6h2.5l3-2.5v9L5.5 10H3V6z" fill="currentColor" />
      {showMute ? (
        <path d="M11 6l3 4M14 6l-3 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      ) : (
        <>
          {level > 0.05 && <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
          {level > 0.5 && <path d="M12.5 4a5.5 5.5 0 0 1 0 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
        </>
      )}
    </svg>
  );
}

function IconBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="w-10 h-10 sm:w-9 sm:h-9 rounded-full text-white/70 hover:text-white hover:bg-white/10 active:bg-white/15 flex items-center justify-center transition"
    >
      {children}
    </button>
  );
}
