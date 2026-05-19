import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AudioLines,
  ChevronDown,
  Download,
  ListMusic,
  MessageSquare,
  MoreHorizontal,
  Music,
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
    <div className="fixed inset-0 z-40 bg-ink/95 backdrop-blur-2xl overflow-y-auto">
      <div className="min-h-screen flex flex-col px-4 sm:px-6 py-4 sm:py-6">
        <div className="flex items-center justify-between mb-2 sm:mb-4 max-w-md w-full mx-auto">
          <button
            onClick={() => setExpanded(false)}
            aria-label="Collapse player"
            className="w-10 h-10 rounded-full text-white/85 hover:text-white hover:bg-panel2 flex items-center justify-center transition"
          >
            <ChevronDown size={20} />
          </button>
          <span className="text-[10px] uppercase tracking-wider text-muted truncate max-w-[14rem]">
            {current.albumTitle}
          </span>
          <button
            onClick={() => setShowMore(true)}
            aria-label="More"
            className="w-10 h-10 rounded-full text-white/85 hover:text-white hover:bg-panel2 flex items-center justify-center transition"
          >
            <MoreHorizontal size={20} />
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-md w-full">
            <div className="relative mx-auto aspect-square w-full max-w-[260px]">
              {current.artworkUrl && (
                <img
                  src={current.artworkUrl}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 w-full h-full object-cover rounded-2xl blur-3xl opacity-50 scale-110 pointer-events-none"
                />
              )}
              <div className="relative w-full h-full rounded-2xl overflow-hidden bg-gradient-to-br from-panel2 to-ink border border-edge shadow-2xl flex items-center justify-center text-edge">
                {current.artworkUrl ? (
                  <img src={current.artworkUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Music size={48} strokeWidth={1.2} />
                )}
              </div>
            </div>

            <div className="mt-7">
              <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight break-words">
                {current.title}
              </h1>
              <p className="text-base text-muted mt-0.5 truncate">
                {current.artistName ?? "Stagehand"}
                <span className="text-muted/70"> · {current.albumTitle}</span>
              </p>
            </div>

            <ProgressSlider
              position={positionSec}
              duration={durationSec}
              onSeek={seekTo}
            />

            <div className="grid grid-cols-3 items-center mt-2 gap-2">
              <span className="text-xs text-muted tabular-nums">{fmtTime(positionSec)}</span>
              <div className="flex justify-center">
                {fb.isLossless ? (
                  <span
                    title={qualityDetail ?? "Original master quality"}
                    className="inline-flex items-center gap-1 rounded-md bg-panel2/80 text-white/85 px-1.5 py-0.5 text-[10px] font-medium tracking-tight"
                  >
                    <AudioLines size={10} strokeWidth={2.2} />
                    Lossless
                  </span>
                ) : fb.format ? (
                  <span className="inline-flex items-center rounded-full border border-edge bg-panel2 text-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
                    {fb.format}
                  </span>
                ) : null}
              </div>
              <span className="text-xs text-muted tabular-nums text-right">
                {durationSec > 0 ? `-${fmtTime(remaining)}` : fmtTime(durationSec)}
              </span>
            </div>

            <div className="flex items-center justify-center gap-8 mt-7">
              <IconBtn onClick={prev} disabled={!hasPrev} label="Previous track">
                <SkipBack size={22} fill="currentColor" />
              </IconBtn>
              <button
                onClick={toggle}
                className="w-16 h-16 rounded-full bg-white text-ink flex items-center justify-center hover:scale-105 active:scale-95 transition shadow-lg"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="translate-x-[1px]" />}
              </button>
              <IconBtn onClick={next} disabled={!hasNext} label="Next track">
                <SkipForward size={22} fill="currentColor" />
              </IconBtn>
            </div>

            <div className="mt-9 grid grid-cols-3 sm:grid-cols-4 gap-2">
              <ActionBtn onClick={() => setShowComments(true)} icon={<MessageSquare size={18} />} label="Comments" />
              <ActionBtnLink to={`/edit/${current.trackId}`} onClick={() => setExpanded(false)} icon={<SlidersHorizontal size={18} />} label="Edit" />
              <ActionBtnLink to={`/track/${current.trackId}`} onClick={() => setExpanded(false)} icon={<Download size={18} />} label="Details" />
              {queue.length > 1 && (
                <ActionBtn onClick={() => setShowQueue(true)} icon={<ListMusic size={18} />} label={`Queue · ${queue.length}`} />
              )}
            </div>

            <div className="h-10" />
          </div>
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
        className="relative h-1.5 bg-edge/60 rounded-full cursor-pointer group"
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
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition"
          style={{ left: `calc(${pct}% - 6px)` }}
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
      className="w-10 h-10 rounded-full text-white/85 hover:text-white hover:bg-panel2 flex items-center justify-center transition disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-2xl bg-panel/60 border border-edge hover:border-accent/60 transition disabled:opacity-40 text-white/85"
    >
      <span className="shrink-0">{icon}</span>
      <span className="text-[11px] tracking-wide truncate max-w-full">{label}</span>
    </button>
  );
}

function ActionBtnLink({
  icon,
  label,
  to,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  to: string;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-2xl bg-panel/60 border border-edge hover:border-accent/60 transition text-white/85"
    >
      <span className="shrink-0">{icon}</span>
      <span className="text-[11px] tracking-wide truncate max-w-full">{label}</span>
    </Link>
  );
}
