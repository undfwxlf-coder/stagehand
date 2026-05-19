import { useEffect, useRef, useState } from "react";

import { formatErr } from "../lib/errors";
import WaveSurfer from "wavesurfer.js";
import { Pause, Play, SkipBack, SkipForward, AlertTriangle } from "lucide-react";
import { usePlayer, resolvePlayerUrl } from "../lib/player";
import { fmtTime } from "../lib/audio";
import { recordPlay } from "../lib/plays";

export default function PlayerBar() {
  const {
    current,
    isPlaying,
    setPlaying,
    setPosition,
    setDuration,
    positionSec,
    durationSec,
    pendingSeek,
    consumeSeek,
    queue,
    next,
    prev,
    toggle,
    volume,
    muted,
    setVolume,
    toggleMute,
    setExpanded,
  } = usePlayer();
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const lastVersionId = useRef<string | null>(null);
  const readyRef = useRef(false);
  const wantsPlayRef = useRef(false);
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
        progressColor: "#ff6b3d",
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
        // Read the freshest store state rather than the ref, since the
        // wantsPlayRef effect may not have run yet when this fires right
        // after an auto-advance.
        if (shouldPlay || wantsPlayRef.current) {
          console.log("[player] ready → auto-play");
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
      ws.on("audioprocess", () => {
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
        if (finishingRef.current) {
          // Swallow the trailing pause from a natural track end. The finish
          // handler has already advanced the queue and we want playback to
          // continue on the next track.
          console.log("[player] pause (suppressed — natural end)");
          return;
        }
        console.log("[player] pause");
        setPlaying(false);
      });
      ws.on("finish", () => {
        console.log("[player] finish → advancing queue");
        finishingRef.current = true;
        // Reset after a tick — long enough to swallow the trailing pause but
        // short enough that any legitimate user-initiated pause that follows
        // will work normally.
        setTimeout(() => { finishingRef.current = false; }, 250);
        next();
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
  }, [current, next, setDuration, setPlaying, setPosition]);

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

  // Reflect play state to MediaSession.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  // Position state so iOS shows accurate scrubber + elapsed time.
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
      className="fixed inset-x-0 z-30 px-2 sm:px-4 pointer-events-none"
      style={{ bottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="max-w-5xl mx-auto pointer-events-auto glass-raised rounded-2xl sm:rounded-3xl overflow-hidden">
        {/* Mobile-only thin progress bar at the top edge */}
        <MobileProgressBar
          positionSec={positionSec}
          durationSec={durationSec}
          onSeek={seekRatio}
        />

        <div className="px-3 sm:px-5 py-2.5 sm:py-3">
          <div className="flex items-center gap-3 sm:gap-4">
            <button
              onClick={() => setExpanded(true)}
              className="min-w-0 flex-1 sm:flex-none sm:w-56 text-left hover:bg-white/5 -mx-2 px-2 -my-1 py-1 rounded transition"
              aria-label="Expand now-playing"
              title="Tap to expand"
            >
              <div className="text-sm font-medium text-white truncate tracking-tight">{current.title}</div>
              <div className="text-xs text-white/50 truncate">{current.albumTitle}</div>
              {loadError && (
                <div className="text-xs text-red-400 truncate flex items-center gap-1" title={loadError}>
                  <AlertTriangle size={12} className="shrink-0" />
                  <span className="truncate">{loadError}</span>
                </div>
              )}
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

            {/* Desktop-only waveform + timestamps */}
            <div className="hidden sm:flex flex-1 items-center gap-3">
              <span className="text-xs text-white/40 tabular-nums w-10 text-right">{fmtTime(positionSec)}</span>
              <div ref={containerRef} className="flex-1 cursor-pointer" />
              <span className="text-xs text-white/40 tabular-nums w-10">{fmtTime(durationSec)}</span>
            </div>

            <VolumeControl volume={volume} muted={muted} onVolumeChange={setVolume} onToggleMute={toggleMute} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileProgressBar({
  positionSec,
  durationSec,
  onSeek,
}: {
  positionSec: number;
  durationSec: number;
  onSeek: (ratio: number) => void;
}) {
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
      className="sm:hidden cursor-pointer flex items-center"
      style={{ touchAction: "none", height: 14 }}
    >
      <div className="w-full h-1 bg-white/10">
        <div
          className="h-full bg-gradient-to-r from-accent to-[#ff8a5a]"
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
    <div className="hidden sm:flex items-center gap-2 w-32">
      <button
        onClick={onToggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        title={muted ? "Unmute" : "Mute"}
        className="w-8 h-8 rounded-full text-white/60 hover:text-white hover:bg-white/10 flex items-center justify-center transition"
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
        className="flex-1 h-1 cursor-pointer"
        style={{
          background: `linear-gradient(to right, #ff6b3d 0%, #ff8a5a ${effective * 100}%, rgba(255,255,255,0.12) ${effective * 100}%, rgba(255,255,255,0.12) 100%)`,
          appearance: "none",
          borderRadius: 999,
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
