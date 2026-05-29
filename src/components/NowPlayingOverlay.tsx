import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AudioLines,
  ChevronDown,
  Download,
  ListMusic,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
} from "lucide-react";
import { usePlayer } from "../lib/player";
import { audioFormatFromFilename, fmtTime, formatQualityLabel } from "../lib/audio";
import CommentFeed from "./CommentFeed";
import BottomSheet from "./BottomSheet";
import ArtBackdrop from "./ArtBackdrop";

export default function NowPlayingOverlay() {
  const current = usePlayer((s) => s.current);
  const expanded = usePlayer((s) => s.expanded);
  const setExpanded = usePlayer((s) => s.setExpanded);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const positionSec = usePlayer((s) => s.positionSec);
  const durationSec = usePlayer((s) => s.durationSec);
  const toggle = usePlayer((s) => s.toggle);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const queue = usePlayer((s) => s.queue);
  const seekTo = usePlayer((s) => s.seekTo);

  const [showComments, setShowComments] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showMore, setShowMore] = useState(false);

  // Esc closes the overlay.
  useEffect(() => {
    if (!expanded) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [expanded, setExpanded]);

  if (!current || !expanded) return null;

  const remaining = Math.max(0, (durationSec || 0) - positionSec);
  const fb = audioFormatFromFilename(current.storagePath ?? current.audioUrl ?? "");
  const qualityDetail = formatQualityLabel(fb.format, null);

  const idxInQueue = queue.findIndex((t) => t.versionId === current.versionId);
  const hasPrev = idxInQueue > 0;
  const hasNext = idxInQueue >= 0 && idxInQueue < queue.length - 1;

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden">
      {/* Full-bleed sharp cover fills the screen; the bottom glass card floats
          over its lower third (the reference now-playing composition). Falls
          back to the ambient backdrop when the track has no artwork. */}
      {current.artworkUrl ? (
        <>
          <img
            src={current.artworkUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/20 to-ink/90" />
        </>
      ) : (
        <ArtBackdrop artworkUrl={null} className="absolute inset-0" />
      )}

      {/* Top bar over the art */}
      <div
        className="relative flex items-center justify-between px-4 sm:px-6 pb-2"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      >
        <button
          onClick={() => setExpanded(false)}
          aria-label="Collapse player"
          className="w-10 h-10 rounded-full glass text-white/90 hover:text-white flex items-center justify-center transition"
        >
          <ChevronDown size={20} />
        </button>
        <span className="text-[10px] uppercase tracking-wider text-white/70 truncate max-w-[14rem]">
          {current.albumTitle}
        </span>
        <button
          onClick={() => setShowMore(true)}
          aria-label="More"
          className="w-10 h-10 rounded-full glass text-white/90 hover:text-white flex items-center justify-center transition"
        >
          <MoreHorizontal size={20} />
        </button>
      </div>

      {/* Spacer pushes the control cluster to the bottom */}
      <div className="relative flex-1 min-h-0" />

      {/* Bottom cluster: frosted control card + icon-only utility row */}
      <div
        className="relative w-full px-3 sm:px-0 sm:max-w-md sm:mx-auto"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="glass-strong rounded-3xl px-5 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-[24px] sm:text-[28px] leading-tight font-bold text-white tracking-tight truncate">
                {current.title}
              </h1>
              <p className="text-[14px] text-white/65 mt-0.5 truncate">
                {current.artistName ?? "Stagehand"}
                <span className="text-white/40"> · {current.albumTitle}</span>
              </p>
            </div>
            {(fb.isLossless || fb.format) && (
              <div className="shrink-0 mt-1.5">
                {fb.isLossless ? (
                  <span
                    title={qualityDetail ?? "Original master quality"}
                    className="inline-flex items-center gap-1 rounded-md bg-white/10 text-white/85 px-1.5 py-0.5 text-[10px] font-medium tracking-tight"
                  >
                    <AudioLines size={10} strokeWidth={2.2} />
                    Lossless
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-white/10 text-white/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
                    {fb.format}
                  </span>
                )}
              </div>
            )}
          </div>

          <ProgressSlider position={positionSec} duration={durationSec} onSeek={seekTo} />

          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-white/55 tabular-nums">{fmtTime(positionSec)}</span>
            <span className="text-xs text-white/55 tabular-nums">
              {durationSec > 0 ? `-${fmtTime(remaining)}` : fmtTime(durationSec)}
            </span>
          </div>

          <div className="flex items-center justify-center gap-10 mt-4">
            <IconBtn onClick={prev} disabled={!hasPrev} label="Previous track">
              <SkipBack size={24} fill="currentColor" />
            </IconBtn>
            <button
              onClick={toggle}
              className="w-[68px] h-[68px] rounded-full bg-white text-ink flex items-center justify-center hover:scale-105 active:scale-95 transition shadow-glass-lg"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="translate-x-[1px]" />}
            </button>
            <IconBtn onClick={next} disabled={!hasNext} label="Next track">
              <SkipForward size={24} fill="currentColor" />
            </IconBtn>
          </div>
        </div>

        {/* Utility icon row — sits on the art beneath the card */}
        <div className="flex items-center justify-around px-6 pt-3.5">
          <RowIcon onClick={() => setShowComments(true)} label="Comments">
            <MessageSquare size={20} />
          </RowIcon>
          <RowIconLink to={`/edit/${current.trackId}`} onClick={() => setExpanded(false)} label="Edit">
            <SlidersHorizontal size={20} />
          </RowIconLink>
          <RowIconLink to={`/track/${current.trackId}`} onClick={() => setExpanded(false)} label="Details">
            <Download size={20} />
          </RowIconLink>
          <RowIcon
            onClick={() => setShowQueue(true)}
            label={queue.length > 1 ? `Queue · ${queue.length}` : "Queue"}
            disabled={queue.length <= 1}
          >
            <ListMusic size={20} />
          </RowIcon>
        </div>
      </div>

      {showComments && (
        <BottomSheet onClose={() => setShowComments(false)} title="Comments">
          <CommentFeed
            trackId={current.trackId}
            versionId={current.versionId}
            currentTimeSec={positionSec}
            onSeek={(sec) => {
              seekTo(sec);
              setShowComments(false);
            }}
            canPost={true}
          />
        </BottomSheet>
      )}

      {showQueue && (
        <BottomSheet onClose={() => setShowQueue(false)} title="Up next">
          <ul className="divide-y divide-edge -mx-4 sm:-mx-5">
            {queue.map((t, i) => {
              const isActive = t.versionId === current.versionId;
              return (
                <li
                  key={t.versionId}
                  className={`px-4 sm:px-5 py-3 flex items-center gap-3 ${isActive ? "bg-panel2/40" : ""}`}
                >
                  <span className="text-muted text-xs tabular-nums w-5 shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm truncate ${isActive ? "text-accent" : "text-white"}`}>{t.title}</div>
                    <div className="text-xs text-muted truncate">{t.albumTitle}</div>
                  </div>
                  {isActive && (
                    <span className="text-[10px] uppercase tracking-wider text-accent">Now</span>
                  )}
                </li>
              );
            })}
          </ul>
        </BottomSheet>
      )}

      {showMore && (
        <BottomSheet onClose={() => setShowMore(false)} title="Options" compact>
          <ul className="divide-y divide-edge -mx-4 sm:-mx-5">
            <li>
              <Link
                to={`/edit/${current.trackId}`}
                onClick={() => { setShowMore(false); setExpanded(false); }}
                className="w-full px-4 sm:px-5 py-3 flex items-center gap-3 hover:bg-panel2/60 transition"
              >
                <span className="w-8 h-8 rounded-full bg-panel2 flex items-center justify-center text-white/80 shrink-0">
                  <SlidersHorizontal size={16} />
                </span>
                <span className="text-sm text-white">Open editor</span>
              </Link>
            </li>
            <li>
              <Link
                to={`/track/${current.trackId}`}
                onClick={() => { setShowMore(false); setExpanded(false); }}
                className="w-full px-4 sm:px-5 py-3 flex items-center gap-3 hover:bg-panel2/60 transition"
              >
                <span className="w-8 h-8 rounded-full bg-panel2 flex items-center justify-center text-white/80 shrink-0">
                  <Download size={16} />
                </span>
                <span className="text-sm text-white">Track details</span>
              </Link>
            </li>
          </ul>
        </BottomSheet>
      )}
    </div>
  );
}

function ProgressSlider({
  position,
  duration,
  onSeek,
}: {
  position: number;
  duration: number;
  onSeek: (sec: number) => void;
}) {
  const dur = duration > 0 && isFinite(duration) ? duration : 0;
  const pct = dur > 0 ? Math.min(1, Math.max(0, position / dur)) * 100 : 0;
  return (
    <div className="mt-6 w-full">
      <div
        className="relative h-1.5 bg-white/15 rounded-full cursor-pointer group"
        onClick={(e) => {
          if (!dur) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          onSeek(ratio * dur);
        }}
      >
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-accent"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-glass opacity-0 group-hover:opacity-100 transition"
          style={{ left: `calc(${pct}% - 7px)` }}
        />
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-12 h-12 rounded-full text-white/90 hover:text-white hover:bg-white/10 flex items-center justify-center transition disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function RowIcon({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-11 h-11 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 active:bg-white/15 transition disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function RowIconLink({
  children,
  label,
  to,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  to: string;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="w-11 h-11 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 active:bg-white/15 transition"
    >
      {children}
    </Link>
  );
}
