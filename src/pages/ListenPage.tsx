import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import WaveSurfer from "wavesurfer.js";
import { supabase } from "../lib/supabase";
import type { ShareLink, Track, Version } from "../lib/database.types";
import { downloadAudio, fmtTime, safeFilename } from "../lib/audio";
import { recordPlay } from "../lib/plays";
import { isAlbumSaved, isTrackSaved, saveAlbum, saveTrack, unsaveAlbum, unsaveTrack } from "../lib/saves";
import type { AlbumShareTrackPayload } from "../lib/share";
import { useAuth } from "../lib/auth";
import Logo from "../components/Logo";
import { Download, Heart, Lock, Music, Pause, Play } from "lucide-react";

interface ResolvedTrackShare {
  type: "track";
  link: ShareLink;
  track: Track;
  version: Version;
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

  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const readyRef = useRef(false);

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
        };
        if (r.status === "ok" && r.link && r.type === "track" && r.track && r.version) {
          setData({ type: "track", link: r.link, track: r.track, version: r.version });
        } else if (r.status === "ok" && r.link && r.type === "album" && r.album && r.tracks) {
          setData({ type: "album", link: r.link, album: r.album, tracks: r.tracks });
        } else {
          setErr(messageFor(r.status, Boolean(user)));
          setErrStatus(r.status);
        }
        setLoading(false);
      } catch (e) {
        if (!cancel) {
          setErr(e instanceof Error ? e.message : String(e));
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

    if (wsRef.current) {
      wsRef.current.destroy();
      wsRef.current = null;
      readyRef.current = false;
    }

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 64,
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
    ws.on("finish", () => {
      setIsPlaying(false);
      // Auto-advance for album shares
      if (data?.type === "album" && activeAlbumTrackIdx < data.tracks.length - 1) {
        setActiveAlbumTrackIdx((i) => i + 1);
      }
    });
    ws.on("error", (e) => {
      console.error("[listen] wavesurfer error", e);
      setErr("Could not load the audio file.");
    });

    let url: string;
    let peaks: number[][] | undefined;
    let dur: number | undefined;
    if (data.type === "track") {
      url = data.link.signed_url;
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
  }, [data, activeAlbumTrack, activeAlbumTrackIdx]);

  const toggle = () => {
    const ws = wsRef.current;
    if (!ws) return;
    if (isPlaying) ws.pause();
    else ws.play().catch(() => setIsPlaying(false));
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
      await downloadAudio(data.link.signed_url, filename);
    } catch (e) {
      console.error("[download] failed", e);
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
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
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingState(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-edge bg-panel/60 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/" aria-label="Stagehand home" className="hover:opacity-90 transition">
            <Logo size={22} withWordmark />
          </a>
          <a
            href="/"
            className="text-xs text-muted hover:text-white"
          >
            stagehand.app
          </a>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-10">
        {loading ? (
          <p className="text-muted">Loading…</p>
        ) : err ? (
          <ErrorCard message={err} cta={errStatus ? ctaFor(errStatus, Boolean(user)) : undefined} />
        ) : data?.type === "track" ? (
          <div className="max-w-2xl w-full">
            <div className="text-center mb-8">
              <p className="text-xs uppercase tracking-wider text-muted">A private listen</p>
              <h1 className="text-3xl sm:text-4xl font-semibold text-white tracking-tight mt-2 break-words">
                {data.track.title}
              </h1>
              <p className="text-sm text-muted mt-2">
                {data.version.label}
                {data.track.bpm != null && ` · ${data.track.bpm} BPM`}
                {data.track.song_key && ` · ${data.track.song_key}`}
              </p>
            </div>

            <div className="bg-panel border border-edge rounded-2xl p-5 sm:p-8">
              <div ref={containerRef} className="cursor-pointer mb-5" />
              <div className="flex items-center gap-4">
                <button
                  onClick={toggle}
                  className="w-14 h-14 rounded-full bg-white text-ink flex items-center justify-center hover:scale-105 active:scale-95 transition shrink-0"
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="translate-x-[1px]" />}
                </button>
                <div className="flex-1 flex items-center justify-between text-xs text-muted tabular-nums">
                  <span>{fmtTime(position)}</span>
                  <span>{fmtTime(duration)}</span>
                </div>
                {data.track.allow_download && (
                  <button
                    onClick={onDownload}
                    disabled={downloading}
                    aria-label="Download audio"
                    title="Download audio file"
                    className="shrink-0 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium border bg-panel2 border-edge text-white hover:border-accent/60 transition disabled:opacity-60 flex items-center gap-1.5"
                  >
                    <Download size={14} />
                    {downloading ? "…" : "Download"}
                  </button>
                )}
                {user && (
                  <button
                    onClick={onToggleSave}
                    disabled={savingState}
                    aria-label={saved ? "Unsave track" : "Save track"}
                    title={saved ? "Saved — click to remove" : "Save to your library"}
                    className={`shrink-0 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium border transition disabled:opacity-60 flex items-center gap-1.5 ${
                      saved
                        ? "bg-accent/15 border-accent/40 text-accent"
                        : "bg-panel2 border-edge text-white hover:border-accent/60"
                    }`}
                  >
                    <Heart size={14} fill={saved ? "currentColor" : "none"} />
                    {savingState ? "…" : saved ? "Saved" : "Save"}
                  </button>
                )}
              </div>
            </div>

            <p className="text-center text-xs text-muted mt-6">
              {user ? (
                <>Saved tracks appear in your Stagehand library.<br /></>
              ) : (
                <><a href="/auth" className="underline hover:text-white">Sign in</a> to save this track to your library.<br /></>
              )}
              {data.link.single_use
                ? "This is a single-use link — refreshing will lock you out. "
                : data.link.expires_at
                ? `This link expires ${new Date(data.link.expires_at).toLocaleDateString()}. `
                : ""}
              {data.track.allow_download
                ? "The artist allowed downloads — please don't redistribute."
                : "Streaming-only — please don't redistribute."}
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
                <p className="text-sm text-muted mt-1">{data.tracks.length} tracks</p>
                {user && (
                  <button
                    onClick={onToggleSave}
                    disabled={savingState}
                    className={`mt-4 px-4 py-2 rounded-lg text-sm font-medium border transition disabled:opacity-60 inline-flex items-center gap-1.5 ${
                      saved
                        ? "bg-accent/15 border-accent/40 text-accent"
                        : "bg-panel2 border-edge text-white hover:border-accent/60"
                    }`}
                  >
                    <Heart size={14} fill={saved ? "currentColor" : "none"} />
                    {savingState ? "…" : saved ? "Saved album" : "Save album"}
                  </button>
                )}
              </div>
            </div>

            <div className="bg-panel border border-edge rounded-2xl p-4 sm:p-5">
              <div ref={containerRef} className="cursor-pointer mb-3" />
              {activeAlbumTrack && (
                <div className="flex items-center gap-3 mb-4">
                  <button
                    onClick={toggle}
                    className="w-12 h-12 rounded-full bg-white text-ink flex items-center justify-center hover:scale-105 active:scale-95 transition shrink-0"
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="translate-x-[1px]" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{activeAlbumTrack.title}</div>
                    <div className="text-xs text-muted">
                      {activeAlbumTrack.version_label}
                      {activeAlbumTrack.bpm != null && ` · ${activeAlbumTrack.bpm} BPM`}
                      {activeAlbumTrack.song_key && ` · ${activeAlbumTrack.song_key}`}
                    </div>
                  </div>
                  <div className="text-xs text-muted tabular-nums shrink-0">
                    {fmtTime(position)} / {fmtTime(duration)}
                  </div>
                </div>
              )}
              <ul className="divide-y divide-edge -mx-4 sm:-mx-5">
                {data.tracks.map((t, i) => {
                  const isActive = i === activeAlbumTrackIdx;
                  return (
                    <li key={t.track_id} className={`px-4 sm:px-5 py-2.5 flex items-center gap-3 ${isActive ? "bg-panel2/40" : ""}`}>
                      <button
                        onClick={() => {
                          if (isActive) toggle();
                          else setActiveAlbumTrackIdx(i);
                        }}
                        className="w-7 h-7 rounded-full text-muted hover:text-white hover:bg-ink flex items-center justify-center shrink-0"
                        aria-label="Play"
                      >
                        {isActive && isPlaying ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="translate-x-[1px]" />}
                      </button>
                      <span className="text-muted text-xs tabular-nums w-5 shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm truncate ${isActive ? "text-accent" : "text-white"}`}>{t.title}</div>
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
