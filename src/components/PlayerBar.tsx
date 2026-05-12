import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { usePlayer } from "../lib/player";
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
    next,
    prev,
    toggle,
    volume,
    muted,
    setVolume,
    toggleMute,
  } = usePlayer();
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const lastVersionId = useRef<string | null>(null);
  const readyRef = useRef(false);
  const wantsPlayRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!current || !containerRef.current) return;
    if (lastVersionId.current === current.versionId) return;

    wsRef.current?.destroy();
    readyRef.current = false;
    setLoadError(null);

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 36,
      waveColor: "#3a4150",
      progressColor: "#ff5e3a",
      cursorColor: "rgba(255,255,255,0.4)",
      barWidth: 2,
      barRadius: 1,
      barGap: 1,
      normalize: true,
    });

    ws.on("ready", () => {
      readyRef.current = true;
      setDuration(ws.getDuration());
      try {
        ws.setVolume(muted ? 0 : volume);
        ws.setMuted(muted);
      } catch {
        // ignore
      }
      if (wantsPlayRef.current) {
        ws.play().catch((e) => {
          console.error("[player] play() rejected", e);
          setPlaying(false);
        });
      }
    });
    ws.on("loading", (n) => {
      if (n === 0) setLoadError(null);
    });
    ws.on("error", (e) => {
      console.error("[player] wavesurfer error", e);
      setLoadError(e instanceof Error ? e.message : String(e));
      setPlaying(false);
    });
    ws.on("audioprocess", () => setPosition(ws.getCurrentTime()));
    ws.on("seeking", () => setPosition(ws.getCurrentTime()));
    ws.on("play", () => {
      setPlaying(true);
      if (current) recordPlay(current.trackId);
    });
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => next());

    const peaks = current.peaks ? [current.peaks] : undefined;
    const duration = current.duration ?? undefined;
    ws.load(current.audioUrl, peaks, duration).catch((e) => {
      console.error("[player] load() rejected", e);
      setLoadError(e instanceof Error ? e.message : String(e));
    });

    wsRef.current = ws;
    lastVersionId.current = current.versionId;
  }, [current, next, setDuration, setPosition, setPlaying]);

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

  useEffect(() => {
    return () => {
      wsRef.current?.destroy();
      wsRef.current = null;
    };
  }, []);

  if (!current) return null;

  const seekRatio = (ratio: number) => {
    const r = Math.max(0, Math.min(1, ratio));
    wsRef.current?.seekTo(r);
  };

  return (
    <div
      className="fixed bottom-0 inset-x-0 bg-panel border-t border-edge z-30"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {/* Mobile-only thin progress bar at the top edge */}
      <MobileProgressBar
        positionSec={positionSec}
        durationSec={durationSec}
        onSeek={seekRatio}
      />

      <div className="px-3 sm:px-4 py-2.5 sm:py-3">
        <div className="max-w-7xl mx-auto flex items-center gap-3 sm:gap-4">
          <div className="min-w-0 flex-1 sm:flex-none sm:w-56">
            <div className="text-sm text-white truncate">{current.title}</div>
            <div className="text-xs text-muted truncate">{current.albumTitle}</div>
            {loadError && <div className="text-xs text-red-400 truncate" title={loadError}>⚠ {loadError}</div>}
          </div>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <IconBtn onClick={prev} label="Previous">⏮</IconBtn>
            <button
              onClick={toggle}
              className="w-11 h-11 sm:w-10 sm:h-10 rounded-full bg-white text-ink flex items-center justify-center hover:scale-105 active:scale-95 transition"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <IconBtn onClick={next} label="Next">⏭</IconBtn>
          </div>

          {/* Desktop-only waveform + timestamps */}
          <div className="hidden sm:flex flex-1 items-center gap-3">
            <span className="text-xs text-muted tabular-nums w-10 text-right">{fmtTime(positionSec)}</span>
            <div ref={containerRef} className="flex-1 cursor-pointer" />
            <span className="text-xs text-muted tabular-nums w-10">{fmtTime(durationSec)}</span>
          </div>

          <VolumeControl volume={volume} muted={muted} onVolumeChange={setVolume} onToggleMute={toggleMute} />
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
      <div className="w-full h-1.5 bg-edge">
        <div className="h-full bg-accent" style={{ width: `${ratio * 100}%` }} />
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
        className="w-8 h-8 rounded-full text-muted hover:text-white hover:bg-panel2 flex items-center justify-center transition"
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
        className="flex-1 h-1 accent-accent cursor-pointer"
        style={{
          background: `linear-gradient(to right, #ff5e3a 0%, #ff5e3a ${effective * 100}%, #262b33 ${effective * 100}%, #262b33 100%)`,
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
      className="w-10 h-10 sm:w-9 sm:h-9 rounded-full text-muted hover:text-white hover:bg-panel2 active:bg-panel2 flex items-center justify-center transition"
    >
      {children}
    </button>
  );
}
