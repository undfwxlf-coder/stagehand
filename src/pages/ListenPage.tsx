import { useEffect, useRef, useState } from "react";

import { formatErr } from "../lib/errors";
import { useParams } from "react-router-dom";
import WaveSurfer from "wavesurfer.js";
import { supabase } from "../lib/supabase";
import type { ShareLink, Track, Version } from "../lib/database.types";
import { audioFormatFromFilename, downloadAudio, fmtTime, formatQualityLabel, safeFilename } from "../lib/audio";
import { recordPlay } from "../lib/plays";
import { isAlbumSaved, isTrackSaved, saveAlbum, saveTrack, unsaveAlbum, unsaveTrack } from "../lib/saves";
import type { AlbumShareTrackPayload } from "../lib/share";
import { useAuth } from "../lib/auth";
import Logo from "../components/Logo";
import CommentFeed from "../components/CommentFeed";
import BottomSheet from "../components/BottomSheet";
import {
  AudioLines,
  ChevronDown,
  Download,
  Heart,
  ListMusic,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Music,
  Pause,
  Play,
  Share2,
  SkipBack,
  SkipForward,
} from "lucide-react";

interface ResolvedTrackShare {
  type: "track";
  link: ShareLink;
  track: Track;
  version: Version;
  album_artwork_url: string | null;
  artist_name: string | null;
}

interface ResolvedAlbum {
  id: string;
  title: string;
  artwork_url: string | null;
}

interface ResolvedAlbumShare {
  type: "album";
  link: ShareLink;
  album: ResolvedAlbum;
  tracks: AlbumShareTrackPayload[];
  artist_name: string | null;
}

type ResolvedShare = ResolvedTrackShare | ResolvedAlbumShare;

interface ResolveStatus {
  message: string;
  cta?: { label: string; href: string };
}

function messageFor(status: string, signedIn: boolean): string {
  switch (status) {
    case "not_found":
      return "This link is invalid or no longer available.";
    case "revoked":
      return "This link has been revoked by the artist.";
    case "expired":
      return "This link has expired.";
    case "consumed":
      return "This was a single-use link and has already been opened.";
    case "disabled":
      return "Sharing for this track is currently disabled.";
    case "requires_signin":
      return signedIn
        ? "You need to be signed in with the email the artist invited."
        : "The artist requires a Stagehand account to listen.";
    case "not_invited":
      return "Your account isn't on the invite list. Ask the artist to add your email.";
    default:
      return "Could not load this track.";
  }
}

function ctaFor(status: string, signedIn: boolean): ResolveStatus["cta"] | undefined {
  if (status === "requires_signin" && !signedIn) {
    return { label: "Sign in to Stagehand", href: "/auth" };
  }
  if (status === "not_invited" && signedIn) {
    return undefined;
  }
  return undefined;
}

export default function ListenPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<ResolvedShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [errStatus, setErrStatus] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [saved, setSaved] = useState(false);
  const [savingState, setSavingState] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  // For album shares: 'landing' shows the album cover + track list (the legacy
  // listener view). 'player' is the Apple Music-style now-playing screen for
  // the active track. Clicking a row in landing switches to player; the
  // back chevron returns. Track shares always render player.
  const [albumView, setAlbumView] = useState<"landing" | "player">("landing");

  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const readyRef = useRef(false);
  // Survives the wavesurfer rebuild between tracks. Set true when we want the
  // next track to auto-play (natural-end advance, or user clicking a row while
  // already playing). Cleared after the ready handler kicks off playback.
  const wantsPlayOnReadyRef = useRef(false);
  // Cross-instance finish dedupe. Wavesurfer can fire `finish` more than once
  // near the end on some files / mobile Safari; the second call would advance
  // the queue again and skip a track. Combined with a tight time-based
  // debounce as a fallback in case the new wavesurfer instance fires a stale
  // finish for the previous track-id right after mount.
  const lastFinishedTrackIdRef = useRef<string | null>(null);
  const lastFinishAtRef = useRef(0);

  useEffect(() => {
    if (!slug) return;
    let cancel = false;
    (async () => {
      try {
        const { data: result, error } = await supabase.rpc("resolve_share", { p_slug: slug });
        if (cancel) return;
        if (error) {
          setErr(error.message);
          setLoading(false);
          return;
        }
        const r = result as {
          status: string;
          type?: "track" | "album";
          link?: ShareLink;
          track?: Track;
          version?: Version;
          album?: ResolvedAlbum;
          tracks?: AlbumShareTrackPayload[];
          album_artwork_url?: string | null;
          artist_name?: string | null;
        };
        if (r.status === "ok" && r.link && r.type === "track" && r.track && r.version) {
          setData({
            type: "track",
            link: r.link,
            track: r.track,
            version: r.version,
            album_artwork_url: r.album_artwork_url ?? null,
            artist_name: r.artist_name ?? null,
          });
        } else if (r.status === "ok" && r.link && r.type === "album" && r.album && r.tracks) {
          setData({
            type: "album",
            link: r.link,
            album: r.album,
            tracks: r.tracks,
            artist_name: r.artist_name ?? null,
          });
        } else {
          setErr(messageFor(r.status, Boolean(user)));
          setErrStatus(r.status);
        }
        setLoading(false);
      } catch (e) {
        if (!cancel) {
          setErr(formatErr(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [slug, user]);

  // Track for album-share playback selection
  const [activeAlbumTrackIdx, setActiveAlbumTrackIdx] = useState(0);
  const activeAlbumTrack =
    data?.type === "album" && data.tracks.length > 0 ? data.tracks[activeAlbumTrackIdx] : null;

  useEffect(() => {
    if (!data || !containerRef.current) return;
    // Album shares wait for the player sub-view to mount before initializing
    // wavesurfer — the container only exists in the now-playing view.
    if (data.type === "album" && albumView !== "player") return;

    if (wsRef.current) {
      wsRef.current.destroy();
      wsRef.current = null;
      readyRef.current = false;
    }

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 28,
      waveColor: "#3a4150",
      progressColor: "#ff5e3a",
      cursorColor: "rgba(255,255,255,0.4)",
      barWidth: 1.5,
      barRadius: 1,
      barGap: 1,
      normalize: true,
    });
    ws.on("ready", () => {
      readyRef.current = true;
      setDuration(ws.getDuration());
      if (wantsPlayOnReadyRef.current) {
        wantsPlayOnReadyRef.current = false;
        ws.play().catch(() => setIsPlaying(false));
      }
    });
    ws.on("audioprocess", () => setPosition(ws.getCurrentTime()));
    ws.on("seeking", () => setPosition(ws.getCurrentTime()));
    ws.on("play", () => {
      setIsPlaying(true);
      if (data && slug) {
        const trackId = data.type === "track" ? data.track.id : activeAlbumTrack?.track_id;
        if (trackId) recordPlay(trackId, { slug });
      }
    });
    ws.on("pause", () => setIsPlaying(false));
    // Per-instance guard against multi-fire `finish`. Closure-captured idx is
    // correct because the handler is freshly registered on every effect run.
    // Combined with the cross-instance `lastFinishedTrackIdRef` so duplicate
    // events that survive instance destruction (or fire on a fresh instance
    // for stale audio buffers) are also rejected.
    let advanced = false;
    ws.on("finish", () => {
      setIsPlaying(false);
      if (advanced) return;
      if (data?.type !== "album") return;
      if (activeAlbumTrackIdx >= data.tracks.length - 1) return;

      const finishedTrackId = data.tracks[activeAlbumTrackIdx]?.track_id ?? null;
      const now = Date.now();
      if (
        (finishedTrackId && lastFinishedTrackIdRef.current === finishedTrackId) ||
        now - lastFinishAtRef.current < 500
      ) {
        console.log("[listen] finish (duplicate — ignored)");
        return;
      }
      lastFinishedTrackIdRef.current = finishedTrackId;
      lastFinishAtRef.current = now;

      advanced = true;
      wantsPlayOnReadyRef.current = true;
      setActiveAlbumTrackIdx(activeAlbumTrackIdx + 1);
    });
    ws.on("error", (e) => {
      console.error("[listen] wavesurfer error", e);
      setErr("Could not load the audio file.");
    });

    let url: string;
    let peaks: number[][] | undefined;
    let dur: number | undefined;
    if (data.type === "track") {
      // Track shares always have a signed_url (DB-enforced via the polymorphic check).
      url = data.link.signed_url!;
      peaks = data.version.peaks ? [data.version.peaks] : undefined;
      dur = data.version.duration_sec ?? undefined;
    } else if (activeAlbumTrack) {
      url = activeAlbumTrack.signed_url;
      peaks = activeAlbumTrack.peaks ? [activeAlbumTrack.peaks] : undefined;
      dur = activeAlbumTrack.duration_sec ?? undefined;
    } else {
      return;
    }

    ws.load(url, peaks, dur).catch((e) => {
      console.error("[listen] load failed", e);
      setErr("Could not load the audio file.");
    });

    wsRef.current = ws;
    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [data, activeAlbumTrack, activeAlbumTrackIdx, albumView]);

  const toggle = () => {
    const ws = wsRef.current;
    if (!ws) return;
    if (isPlaying) ws.pause();
    else ws.play().catch(() => setIsPlaying(false));
  };

  const seekToSec = (sec: number) => {
    const ws = wsRef.current;
    if (!ws || !readyRef.current) return;
    const dur = ws.getDuration();
    if (dur > 0) ws.seekTo(Math.max(0, Math.min(sec, dur)) / dur);
  };

  // Check saved state when share resolves
  useEffect(() => {
    if (!data || !user) {
      setSaved(false);
      return;
    }
    let cancel = false;
    const checker = data.type === "track" ? isTrackSaved(data.track.id) : isAlbumSaved(data.album.id);
    checker.then((s) => {
      if (!cancel) setSaved(s);
    });
    return () => { cancel = true; };
  }, [data, user]);

  const onDownload = async () => {
    if (!data || data.type !== "track") return;
    setDownloading(true);
    try {
      const ext = (data.version.storage_path.split(".").pop() || "wav").toLowerCase();
      const filename = `${safeFilename(data.track.title)} - ${safeFilename(data.version.label)}.${ext}`;
      await downloadAudio(data.link.signed_url!, filename);
    } catch (e) {
      console.error("[download] failed", e);
      alert(formatErr(e));
    } finally {
      setDownloading(false);
    }
  };

  const onShare = async () => {
    const url = window.location.href;
    const title =
      data?.type === "track"
        ? data.track.title
        : data?.type === "album"
        ? data.album.title
        : "Stagehand";
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // User canceled or share failed — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareFeedback("Link copied");
      setTimeout(() => setShareFeedback(null), 1800);
    } catch {
      setShareFeedback("Could not copy");
      setTimeout(() => setShareFeedback(null), 1800);
    }
  };

  const onToggleSave = async () => {
    if (!data) return;
    setSavingState(true);
    try {
      if (data.type === "track") {
        if (saved) await unsaveTrack(data.track.id);
        else await saveTrack(data.track.id, data.link.id);
      } else {
        if (saved) await unsaveAlbum(data.album.id);
        else await saveAlbum(data.album.id, data.link.id);
      }
      setSaved((s) => !s);
    } catch (e) {
      console.error("[save] failed", e);
      alert(formatErr(e));
    } finally {
      setSavingState(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="border-b border-edge bg-panel/60 backdrop-blur"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-center">
          <a href="/" aria-label="Stagehand home" className="hover:opacity-90 transition">
            <Logo size={22} withWordmark />
          </a>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-10">
        {loading ? (
          <p className="text-muted">Loading…</p>
        ) : err ? (
          <ErrorCard message={err} cta={errStatus ? ctaFor(errStatus, Boolean(user)) : undefined} />
        ) : data?.type === "track" ? (
          <div className="max-w-md w-full">
            <NowPlayingArtwork artworkUrl={data.album_artwork_url} />

            <div className="mt-7 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight break-words">
                  {data.track.title}
                </h1>
                <p className="text-base text-muted mt-0.5 truncate">
                  {data.artist_name ?? "Stagehand"}
                  <span className="text-muted/70"> · {data.version.label}</span>
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0 pt-1">
                {user && (
                  <IconButton
                    onClick={onToggleSave}
                    disabled={savingState}
                    active={saved}
                    label={saved ? "Saved — tap to remove" : "Save to library"}
                  >
                    <Heart size={18} fill={saved ? "currentColor" : "none"} />
                  </IconButton>
                )}
                <IconButton onClick={() => setShowMoreMenu(true)} label="More options">
                  <MoreHorizontal size={18} />
                </IconButton>
              </div>
            </div>

            <div ref={containerRef} className="cursor-pointer mt-6" />
            {(() => {
              const fb = audioFormatFromFilename(data.version.storage_path ?? data.link.signed_url ?? "");
              return (
                <ProgressMeta
                  position={position}
                  duration={duration}
                  isLossless={data.version.is_lossless ?? fb.isLossless}
                  format={data.version.format ?? fb.format}
                  sampleRate={data.version.sample_rate}
                />
              );
            })()}

            <div className="flex items-center justify-center gap-12 mt-7">
              <button
                onClick={toggle}
                className="w-16 h-16 rounded-full bg-white text-ink flex items-center justify-center hover:scale-105 active:scale-95 transition shadow-lg"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="translate-x-[1px]" />}
              </button>
            </div>

            <div className="mt-9 grid grid-cols-3 sm:grid-cols-4 gap-2">
              <ActionButton onClick={() => setShowComments(true)} icon={<MessageSquare size={18} />} label="Comments" />
              <ActionButton onClick={onShare} icon={<Share2 size={18} />} label={shareFeedback ?? "Share"} />
              {data.track.allow_download && (
                <ActionButton
                  onClick={onDownload}
                  disabled={downloading}
                  icon={<Download size={18} />}
                  label={downloading ? "…" : "Download"}
                />
              )}
              {!user && (
                <ActionButton
                  onClick={() => { window.location.href = "/auth"; }}
                  icon={<Heart size={18} />}
                  label="Sign in"
                  className="hidden sm:flex"
                />
              )}
            </div>

            <p className="text-center text-xs text-muted mt-10">
              {data.link.single_use
                ? "Single-use link — refreshing will lock you out. "
                : data.link.expires_at
                ? `Expires ${new Date(data.link.expires_at).toLocaleDateString()}. `
                : ""}
              {data.track.allow_download
                ? "Downloads enabled — please don't redistribute."
                : "Streaming-only — please don't redistribute."}
            </p>
          </div>
        ) : data?.type === "album" && activeAlbumTrack && albumView === "player" ? (
          <div className="max-w-md w-full">
            <div className="mb-5 flex items-center justify-between">
              <button
                onClick={() => {
                  if (wsRef.current) {
                    try { wsRef.current.pause(); } catch { /* ignore */ }
                  }
                  setAlbumView("landing");
                }}
                aria-label="Back to album"
                className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-white transition"
              >
                <ChevronDown size={16} />
                <span className="truncate max-w-[14rem]">{data.album.title}</span>
              </button>
              <span className="text-[10px] uppercase tracking-wider text-muted">
                {activeAlbumTrackIdx + 1} / {data.tracks.length}
              </span>
            </div>

            <NowPlayingArtwork artworkUrl={data.album.artwork_url} />

            <div className="mt-7 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight break-words">
                  {activeAlbumTrack.title}
                </h1>
                <p className="text-base text-muted mt-0.5 truncate">
                  {data.artist_name ?? "Stagehand"}
                  <span className="text-muted/70"> · {data.album.title}</span>
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0 pt-1">
                {user && (
                  <IconButton
                    onClick={onToggleSave}
                    disabled={savingState}
                    active={saved}
                    label={saved ? "Saved — tap to remove" : "Save album to library"}
                  >
                    <Heart size={18} fill={saved ? "currentColor" : "none"} />
                  </IconButton>
                )}
                <IconButton onClick={() => setShowMoreMenu(true)} label="More options">
                  <MoreHorizontal size={18} />
                </IconButton>
              </div>
            </div>

            <div ref={containerRef} className="cursor-pointer mt-6" />
            {(() => {
              const fb = audioFormatFromFilename(activeAlbumTrack.signed_url ?? "");
              return (
                <ProgressMeta
                  position={position}
                  duration={duration}
                  isLossless={activeAlbumTrack.is_lossless ?? fb.isLossless}
                  format={activeAlbumTrack.format ?? fb.format}
                  sampleRate={activeAlbumTrack.sample_rate}
                />
              );
            })()}

            <div className="flex items-center justify-center gap-8 mt-7">
              <IconButton
                onClick={() => {
                  if (activeAlbumTrackIdx > 0) {
                    wantsPlayOnReadyRef.current = isPlaying;
                    setActiveAlbumTrackIdx(activeAlbumTrackIdx - 1);
                  }
                }}
                disabled={activeAlbumTrackIdx === 0}
                label="Previous track"
              >
                <SkipBack size={22} fill="currentColor" />
              </IconButton>
              <button
                onClick={toggle}
                className="w-16 h-16 rounded-full bg-white text-ink flex items-center justify-center hover:scale-105 active:scale-95 transition shadow-lg"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="translate-x-[1px]" />}
              </button>
              <IconButton
                onClick={() => {
                  if (activeAlbumTrackIdx < data.tracks.length - 1) {
                    wantsPlayOnReadyRef.current = isPlaying;
                    setActiveAlbumTrackIdx(activeAlbumTrackIdx + 1);
                  }
                }}
                disabled={activeAlbumTrackIdx >= data.tracks.length - 1}
                label="Next track"
              >
                <SkipForward size={22} fill="currentColor" />
              </IconButton>
            </div>

            <div className="mt-9 grid grid-cols-4 gap-2">
              <ActionButton onClick={() => setShowComments(true)} icon={<MessageSquare size={18} />} label="Comments" />
              <ActionButton onClick={() => setShowQueue(true)} icon={<ListMusic size={18} />} label={`Queue · ${data.tracks.length}`} />
              <ActionButton onClick={onShare} icon={<Share2 size={18} />} label={shareFeedback ?? "Share"} />
              {!user ? (
                <ActionButton
                  onClick={() => { window.location.href = "/auth"; }}
                  icon={<Heart size={18} />}
                  label="Sign in"
                />
              ) : (
                <ActionButton
                  onClick={onToggleSave}
                  disabled={savingState}
                  icon={<Heart size={18} fill={saved ? "currentColor" : "none"} />}
                  label={saved ? "Saved" : "Save"}
                  active={saved}
                />
              )}
            </div>

            <p className="text-center text-xs text-muted mt-10">
              {data.link.single_use
                ? "Single-use link — refreshing will lock you out. "
                : data.link.expires_at
                ? `Expires ${new Date(data.link.expires_at).toLocaleDateString()}. `
                : ""}
              Streaming-only — please don't redistribute.
            </p>
          </div>
        ) : data?.type === "album" ? (
          <div className="max-w-3xl w-full">
            <div className="flex flex-col sm:flex-row gap-5 sm:gap-6 items-center sm:items-start mb-6">
              <div className="w-40 h-40 sm:w-48 sm:h-48 rounded-2xl bg-gradient-to-br from-panel2 to-ink border border-edge flex items-center justify-center text-edge shrink-0 overflow-hidden">
                {data.album.artwork_url ? (
                  <img src={data.album.artwork_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Music size={56} strokeWidth={1.2} />
                )}
              </div>
              <div className="flex-1 min-w-0 w-full text-center sm:text-left">
                <p className="text-xs uppercase tracking-wider text-muted">A private album listen</p>
                <h1 className="text-3xl sm:text-4xl font-semibold text-white tracking-tight mt-1 break-words">
                  {data.album.title}
                </h1>
                <p className="text-sm text-muted mt-1">
                  {data.artist_name ?? "Stagehand"} · {data.tracks.length} track{data.tracks.length === 1 ? "" : "s"}
                </p>
                {user && (
                  <div className="mt-4 flex items-center justify-center sm:justify-start">
                    <button
                      onClick={onToggleSave}
                      disabled={savingState}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border transition disabled:opacity-60 inline-flex items-center gap-1.5 ${
                        saved
                          ? "bg-accent/15 border-accent/40 text-accent"
                          : "bg-panel2 border-edge text-white hover:border-accent/60"
                      }`}
                    >
                      <Heart size={14} fill={saved ? "currentColor" : "none"} />
                      {savingState ? "…" : saved ? "Saved" : "Save"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-panel border border-edge rounded-2xl p-4 sm:p-5">
              <ul className="divide-y divide-edge -mx-4 sm:-mx-5">
                {data.tracks.map((t, i) => (
                  <li key={t.track_id}>
                    <button
                      onClick={() => {
                        wantsPlayOnReadyRef.current = true;
                        setActiveAlbumTrackIdx(i);
                        setAlbumView("player");
                      }}
                      className="w-full px-4 sm:px-5 py-2.5 flex items-center gap-3 hover:bg-panel2/40 active:bg-panel2/60 transition text-left"
                      aria-label={`Play ${t.title}`}
                    >
                      <span className="w-7 h-7 rounded-full text-muted flex items-center justify-center shrink-0">
                        <Play size={12} fill="currentColor" className="translate-x-[1px]" />
                      </span>
                      <span className="text-muted text-xs tabular-nums w-5 shrink-0">{i + 1}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-white truncate">{t.title}</span>
                        <span className="block text-xs text-muted truncate">
                          {t.version_label}
                          {t.bpm != null && ` · ${t.bpm} BPM`}
                          {t.song_key && ` · ${t.song_key}`}
                        </span>
                      </span>
                      <span className="text-xs text-muted tabular-nums shrink-0">
                        {t.duration_sec ? fmtTime(t.duration_sec) : "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-center text-xs text-muted mt-6">
              {user ? (
                <>Saved albums appear in your Stagehand library.<br /></>
              ) : (
                <><a href="/auth" className="underline hover:text-white">Sign in</a> to save this album to your library.<br /></>
              )}
              {data.link.single_use
                ? "This is a single-use link — refreshing will lock you out. "
                : data.link.expires_at
                ? `This link expires ${new Date(data.link.expires_at).toLocaleDateString()}. `
                : ""}
              Streaming-only — please don't redistribute.
            </p>
          </div>
        ) : null}
      </main>

      {showComments && data && (
        <BottomSheet onClose={() => setShowComments(false)} title="Comments">
          <CommentFeed
            trackId={data.type === "track" ? data.track.id : activeAlbumTrack!.track_id}
            slug={slug}
            versionId={data.type === "track" ? data.version.id : activeAlbumTrack!.version_id}
            currentTimeSec={position}
            onSeek={(sec) => {
              seekToSec(sec);
              setShowComments(false);
            }}
            canPost={Boolean(user)}
          />
        </BottomSheet>
      )}

      {showQueue && data?.type === "album" && (
        <BottomSheet onClose={() => setShowQueue(false)} title={data.album.title}>
          <ul className="divide-y divide-edge -mx-4 sm:-mx-5">
            {data.tracks.map((t, i) => {
              const isActive = i === activeAlbumTrackIdx;
              return (
                <li
                  key={t.track_id}
                  className={`px-4 sm:px-5 py-3 flex items-center gap-3 ${isActive ? "bg-panel2/40" : ""}`}
                >
                  <button
                    onClick={() => {
                      if (isActive) {
                        toggle();
                      } else {
                        wantsPlayOnReadyRef.current = true;
                        setActiveAlbumTrackIdx(i);
                      }
                    }}
                    className="w-8 h-8 rounded-full text-muted hover:text-white hover:bg-ink flex items-center justify-center shrink-0"
                    aria-label="Play"
                  >
                    {isActive && isPlaying ? (
                      <Pause size={13} fill="currentColor" />
                    ) : (
                      <Play size={13} fill="currentColor" className="translate-x-[1px]" />
                    )}
                  </button>
                  <span className="text-muted text-xs tabular-nums w-5 shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm truncate ${isActive ? "text-accent" : "text-white"}`}>
                      {t.title}
                    </div>
                    <div className="text-xs text-muted truncate">
                      {t.version_label}
                      {t.bpm != null && ` · ${t.bpm} BPM`}
                      {t.song_key && ` · ${t.song_key}`}
                    </div>
                  </div>
                  <div className="text-xs text-muted tabular-nums shrink-0">
                    {t.duration_sec ? fmtTime(t.duration_sec) : "—"}
                  </div>
                </li>
              );
            })}
          </ul>
        </BottomSheet>
      )}

      {showMoreMenu && data && (
        <BottomSheet onClose={() => setShowMoreMenu(false)} title="Options" compact>
          <ul className="divide-y divide-edge -mx-4 sm:-mx-5">
            <MoreMenuRow
              onClick={() => {
                setShowMoreMenu(false);
                void onShare();
              }}
              icon={<Share2 size={16} />}
              label="Copy share link"
            />
            {user && (
              <MoreMenuRow
                onClick={() => {
                  setShowMoreMenu(false);
                  void onToggleSave();
                }}
                icon={<Heart size={16} fill={saved ? "currentColor" : "none"} />}
                label={saved ? "Remove from library" : "Save to library"}
              />
            )}
            {data.type === "track" && data.track.allow_download && (
              <MoreMenuRow
                onClick={() => {
                  setShowMoreMenu(false);
                  void onDownload();
                }}
                icon={<Download size={16} />}
                label="Download audio"
              />
            )}
            {!user && (
              <MoreMenuRow
                onClick={() => { window.location.href = "/auth"; }}
                icon={<Heart size={16} />}
                label="Sign in to save & comment"
              />
            )}
          </ul>
        </BottomSheet>
      )}

      <footer className="border-t border-edge py-5 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between text-xs text-muted">
          <span>Shared via Stagehand</span>
          <a href="/" className="hover:text-white">
            Make your own album page →
          </a>
        </div>
      </footer>
    </div>
  );
}

function NowPlayingArtwork({ artworkUrl }: { artworkUrl: string | null }) {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[260px]">
      {artworkUrl && (
        <img
          src={artworkUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover rounded-2xl blur-3xl opacity-50 scale-110 pointer-events-none"
        />
      )}
      <div className="relative w-full h-full rounded-2xl overflow-hidden bg-gradient-to-br from-panel2 to-ink border border-edge shadow-2xl flex items-center justify-center text-edge">
        {artworkUrl ? (
          <img src={artworkUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <Music size={48} strokeWidth={1.2} />
        )}
      </div>
    </div>
  );
}

function ProgressMeta({
  position,
  duration,
  isLossless,
  format,
  sampleRate,
}: {
  position: number;
  duration: number;
  isLossless: boolean | null;
  format: string | null;
  sampleRate: number | null;
}) {
  const remaining = Math.max(0, (duration || 0) - position);
  return (
    <div className="grid grid-cols-3 items-center mt-2 gap-2">
      <span className="text-xs text-muted tabular-nums">{fmtTime(position)}</span>
      <div className="flex justify-center min-w-0">
        <QualityBadge isLossless={isLossless} format={format} sampleRate={sampleRate} compact />
      </div>
      <span className="text-xs text-muted tabular-nums text-right">
        {duration > 0 ? `-${fmtTime(remaining)}` : fmtTime(duration)}
      </span>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  active,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`w-10 h-10 rounded-full flex items-center justify-center transition disabled:opacity-30 ${
        active ? "text-accent bg-accent/15" : "text-white/80 hover:text-white hover:bg-panel2"
      }`}
    >
      {children}
    </button>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  className = "",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-2xl bg-panel/60 border border-edge hover:border-accent/60 transition disabled:opacity-40 ${
        active ? "text-accent border-accent/40 bg-accent/10" : "text-white/85"
      } ${className}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="text-[11px] tracking-wide truncate max-w-full">{label}</span>
    </button>
  );
}

function MoreMenuRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className="w-full px-4 sm:px-5 py-3 flex items-center gap-3 text-left hover:bg-panel2/60 transition"
      >
        <span className="w-8 h-8 rounded-full bg-panel2 flex items-center justify-center text-white/80 shrink-0">
          {icon}
        </span>
        <span className="text-sm text-white">{label}</span>
      </button>
    </li>
  );
}

function QualityBadge({
  isLossless,
  format,
  sampleRate,
  compact = false,
}: {
  isLossless: boolean | null;
  format: string | null;
  sampleRate: number | null;
  compact?: boolean;
}) {
  if (!format && isLossless == null) return null;
  const detail = formatQualityLabel(format, sampleRate);
  if (isLossless) {
    return (
      <span
        title={detail ?? "Original master quality"}
        className={`inline-flex items-center gap-1 rounded-md bg-panel2/80 text-white/85 ${
          compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"
        } font-medium tracking-tight`}
      >
        <AudioLines size={compact ? 10 : 12} strokeWidth={2.2} />
        Lossless
      </span>
    );
  }
  if (!detail) return null;
  return (
    <span
      title="Compressed audio (lossy)"
      className={`inline-flex items-center rounded-full border border-edge bg-panel2 text-muted ${
        compact ? "px-1.5 py-0 text-[9px]" : "px-2.5 py-0.5 text-[10px]"
      } uppercase tracking-wider`}
    >
      {detail}
    </span>
  );
}

function ErrorCard({
  message,
  cta,
}: {
  message: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="max-w-md w-full bg-panel border border-edge rounded-2xl p-8 text-center">
      <Lock size={28} strokeWidth={1.5} className="mx-auto mb-3 text-muted" />
      <h1 className="text-lg text-white mb-2">Link unavailable</h1>
      <p className="text-sm text-muted">{message}</p>
      {cta && (
        <a
          href={cta.href}
          className="inline-block mt-5 bg-accent hover:bg-accent/90 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          {cta.label}
        </a>
      )}
      <a
        href="/"
        className="block mt-3 text-xs text-muted hover:text-white"
      >
        Go to Stagehand
      </a>
    </div>
  );
}
