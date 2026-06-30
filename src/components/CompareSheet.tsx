import { useEffect, useMemo, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { GitCompare, Pause, Play } from "lucide-react";
import type { Version } from "../lib/database.types";
import { fmtTime, formatQualityLabel, getSignedAudioUrl } from "../lib/audio";
import BottomSheet from "./BottomSheet";

interface CompareSheetProps {
  trackTitle: string;
  versionA: Version;
  versionB: Version;
  onClose: () => void;
}

type Active = "A" | "B";

// Maximum allowed drift between the two streams (in seconds) before we
// hard-seek the follower back onto the leader. Anything below ~50ms is
// imperceptible. Set conservatively to avoid jittery micro-seeks.
const SYNC_TOLERANCE_SEC = 0.06;

/**
 * A/B compare sheet.
 *
 * Both versions decode and play SIMULTANEOUSLY in their own wavesurfer
 * instances. Only one is audible at a time — the other is volume=0. Swapping
 * which one is audible is therefore instant and gapless (mute-swap, no
 * decoder restart, no buffer underrun).
 *
 * Sync model: A is the leader. On every position update, if B has drifted
 * past SYNC_TOLERANCE_SEC, we hard-seek B back to A. In practice both audio
 * elements stay in lockstep on their own; the seek-correction is a guardrail
 * for the occasional dropout.
 *
 * Tap either waveform to make that side audible; Space toggles A↔B.
 */
export default function CompareSheet({
  trackTitle,
  versionA,
  versionB,
  onClose,
}: CompareSheetProps) {
  const containerA = useRef<HTMLDivElement>(null);
  const containerB = useRef<HTMLDivElement>(null);
  const wsA = useRef<WaveSurfer | null>(null);
  const wsB = useRef<WaveSurfer | null>(null);
  const readyA = useRef(false);
  const readyB = useRef(false);
  // While true, an A/B swap is in progress and we suppress the resync guard
  // so neither stream is yanked to the other's slightly stale position.
  const swappingRef = useRef(false);

  const [active, setActive] = useState<Active>("A");
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [bothReady, setBothReady] = useState(false);

  const metaA = useMemo(() => formatQualityLabel(versionA.format, versionA.sample_rate), [versionA]);
  const metaB = useMemo(() => formatQualityLabel(versionB.format, versionB.sample_rate), [versionB]);

  // Build both wavesurfers and load their signed URLs in parallel.
  useEffect(() => {
    let cancelled = false;
    setLoadErr(null);
    setBothReady(false);

    const a = WaveSurfer.create({
      container: containerA.current!,
      height: 40,
      waveColor: "rgba(240,237,223,0.20)",
      progressColor: "#BB0A21",
      cursorColor: "rgba(240,237,223,0.5)",
      barWidth: 2,
      barRadius: 2,
      barGap: 2,
      normalize: true,
    });
    const b = WaveSurfer.create({
      container: containerB.current!,
      height: 40,
      waveColor: "rgba(240,237,223,0.20)",
      progressColor: "#BB0A21",
      cursorColor: "rgba(240,237,223,0.5)",
      barWidth: 2,
      barRadius: 2,
      barGap: 2,
      normalize: true,
    });
    wsA.current = a;
    wsB.current = b;

    a.on("ready", () => {
      readyA.current = true;
      setDuration((d) => Math.max(d, a.getDuration()));
      if (readyB.current) setBothReady(true);
    });
    b.on("ready", () => {
      readyB.current = true;
      setDuration((d) => Math.max(d, b.getDuration()));
      if (readyA.current) setBothReady(true);
    });

    // A is the leader for sync + position display. We throttle the position
    // emit to ~10Hz to match PlayerBar — anything faster repaints the time
    // strip without the user being able to perceive the difference.
    let lastEmit = 0;
    a.on("audioprocess", () => {
      const now = performance.now();
      if (now - lastEmit < 100) return;
      lastEmit = now;
      const t = a.getCurrentTime();
      setPosition(t);
      // Resync guard: if B has drifted past tolerance, snap it back onto A.
      if (!swappingRef.current && readyB.current && wsB.current) {
        const dt = wsB.current.getCurrentTime() - t;
        if (Math.abs(dt) > SYNC_TOLERANCE_SEC) {
          try { wsB.current.setTime(t); } catch { /* ignore */ }
        }
      }
    });
    a.on("seeking", () => {
      const t = a.getCurrentTime();
      setPosition(t);
      if (wsB.current && readyB.current) {
        try { wsB.current.setTime(t); } catch { /* ignore */ }
      }
    });
    a.on("finish", () => setIsPlaying(false));
    const onErr = (label: string) => (e: unknown) => {
      console.error(`[compare] ${label} wavesurfer error`, e);
      setLoadErr("Couldn't load one of the audio files.");
    };
    a.on("error", onErr("A"));
    b.on("error", onErr("B"));

    (async () => {
      try {
        const [urlA, urlB] = await Promise.all([
          getSignedAudioUrl(versionA.storage_path),
          getSignedAudioUrl(versionB.storage_path),
        ]);
        if (cancelled) return;
        const peaksA = versionA.peaks ? [versionA.peaks] : undefined;
        const peaksB = versionB.peaks ? [versionB.peaks] : undefined;
        await Promise.all([
          a.load(urlA, peaksA, versionA.duration_sec ?? undefined),
          b.load(urlB, peaksB, versionB.duration_sec ?? undefined),
        ]);
      } catch (e) {
        if (cancelled) return;
        console.error("[compare] load failed", e);
        setLoadErr("Couldn't load one of the audio files.");
      }
    })();

    return () => {
      cancelled = true;
      try { a.destroy(); } catch { /* ignore */ }
      try { b.destroy(); } catch { /* ignore */ }
      wsA.current = null;
      wsB.current = null;
      readyA.current = false;
      readyB.current = false;
    };
  }, [versionA, versionB]);

  // Apply volumes for the active side. Both streams stay playing — only the
  // audible one is at full volume; the other is muted. This is why A/B swaps
  // are instant and gapless.
  useEffect(() => {
    const a = wsA.current;
    const b = wsB.current;
    if (!a || !b) return;
    try {
      a.setVolume(active === "A" ? 1 : 0);
      b.setVolume(active === "B" ? 1 : 0);
    } catch {
      // ignore
    }
  }, [active, bothReady]);

  const togglePlay = async () => {
    const a = wsA.current;
    const b = wsB.current;
    if (!a || !b || !bothReady) return;
    if (isPlaying) {
      a.pause();
      b.pause();
      setIsPlaying(false);
      return;
    }
    // Always start both at the same position before resuming.
    const t = a.getCurrentTime();
    try { b.setTime(t); } catch { /* ignore */ }
    try {
      await Promise.all([a.play(), b.play()]);
      setIsPlaying(true);
    } catch (e) {
      console.error("[compare] play() rejected", e);
      setIsPlaying(false);
    }
  };

  const swapActive = (next: Active) => {
    if (next === active) return;
    swappingRef.current = true;
    setActive(next);
    // Re-allow the drift guard after the volume swap settles.
    window.setTimeout(() => { swappingRef.current = false; }, 120);
  };

  // Spacebar shortcut while the sheet is open: toggle A/B if playing,
  // otherwise toggle play/pause. Matches what mix engineers expect from
  // a comparison tool — keep your fingers on the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      if (isPlaying) swapActive(active === "A" ? "B" : "A");
      else void togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, isPlaying, bothReady]);

  const seekRatio = (ratio: number) => {
    const a = wsA.current;
    const b = wsB.current;
    if (!a || !b || !bothReady) return;
    const dur = a.getDuration();
    const t = Math.max(0, Math.min(dur, ratio * dur));
    try { a.setTime(t); } catch { /* ignore */ }
    try { b.setTime(t); } catch { /* ignore */ }
    setPosition(t);
  };

  return (
    <BottomSheet onClose={onClose} title={`Compare · ${trackTitle}`}>
      <div className="px-1 pb-2">
        {/* A side */}
        <button
          onClick={() => swapActive("A")}
          className={`w-full text-left rounded-2xl border transition px-3 py-3 mb-3 ${
            active === "A"
              ? "border-accent/60 bg-accent/8 shadow-[0_0_24px_-8px_rgba(187,10,33,0.4)]"
              : "border-edge bg-panel/60 hover:border-muted/60"
          }`}
          aria-pressed={active === "A"}
          aria-label={`Listen to ${versionA.label}`}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                active === "A" ? "bg-accent text-white" : "bg-panel2 text-muted"
              }`}
            >
              A
            </span>
            <span className="text-sm text-white truncate flex-1 min-w-0">{versionA.label}</span>
            {metaA && (
              <span className="text-[10px] uppercase tracking-wider text-muted shrink-0">{metaA}</span>
            )}
          </div>
          <div ref={containerA} className="w-full" />
        </button>

        {/* B side */}
        <button
          onClick={() => swapActive("B")}
          className={`w-full text-left rounded-2xl border transition px-3 py-3 mb-4 ${
            active === "B"
              ? "border-accent/60 bg-accent/8 shadow-[0_0_24px_-8px_rgba(187,10,33,0.4)]"
              : "border-edge bg-panel/60 hover:border-muted/60"
          }`}
          aria-pressed={active === "B"}
          aria-label={`Listen to ${versionB.label}`}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                active === "B" ? "bg-accent text-white" : "bg-panel2 text-muted"
              }`}
            >
              B
            </span>
            <span className="text-sm text-white truncate flex-1 min-w-0">{versionB.label}</span>
            {metaB && (
              <span className="text-[10px] uppercase tracking-wider text-muted shrink-0">{metaB}</span>
            )}
          </div>
          <div ref={containerB} className="w-full" />
        </button>

        {/* Shared seek strip */}
        <div
          className="relative h-1.5 bg-white/12 rounded-full cursor-pointer mb-2"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seekRatio((e.clientX - rect.left) / rect.width);
          }}
        >
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-accent"
            style={{ width: duration > 0 ? `${Math.min(100, (position / duration) * 100)}%` : "0%" }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted tabular-nums mb-4">
          <span>{fmtTime(position)}</span>
          <span>-{fmtTime(Math.max(0, duration - position))}</span>
        </div>

        {/* Transport */}
        <div className="flex items-center justify-center gap-4 mb-3">
          <button
            onClick={() => swapActive(active === "A" ? "B" : "A")}
            disabled={!bothReady}
            className="inline-flex items-center gap-1.5 bg-panel border border-edge hover:border-accent/60 disabled:opacity-50 text-white text-sm px-3 py-2 rounded-full transition"
            aria-label="Swap A/B"
            title="Swap A/B (Space)"
          >
            <GitCompare size={14} />
            {active === "A" ? "A → B" : "B → A"}
          </button>
          <button
            onClick={togglePlay}
            disabled={!bothReady}
            className="w-14 h-14 rounded-full bg-white text-ink flex items-center justify-center shadow-glass disabled:opacity-50 hover:scale-105 active:scale-95 transition"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="translate-x-[1px]" />}
          </button>
          <div className="w-[88px]" aria-hidden />
        </div>

        <p className="text-[11px] text-muted text-center mb-1">
          Tap either waveform — or hit <span className="px-1.5 py-0.5 rounded bg-panel2 text-white/80">Space</span> — to swap instantly.
        </p>
        {loadErr && <p className="text-xs text-red-400 text-center mt-2">{loadErr}</p>}
        {!bothReady && !loadErr && (
          <p className="text-[11px] text-muted text-center mt-1">Loading both versions…</p>
        )}
      </div>
    </BottomSheet>
  );
}
