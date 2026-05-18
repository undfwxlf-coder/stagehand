import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Album, Track, Version } from "../lib/database.types";
import { downloadAudio, getSignedAudioUrl, safeFilename } from "../lib/audio";
import { formatErr } from "../lib/errors";
import { detectBpm, detectKey } from "../lib/audioAnalysis";
import { usePlayer } from "../lib/player";
import { useUploadStore, isActivePhase } from "../lib/uploads";
import { resyncSharesForTrack } from "../lib/share";
import ShareModal from "../components/ShareModal";
import CommentFeed from "../components/CommentFeed";
import { Download, Play, Share2, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";

export default function TrackPage() {
  const { trackId } = useParams<{ trackId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [track, setTrack] = useState<Track | null>(null);
  const [album, setAlbum] = useState<Album | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const enqueueUpload = useUploadStore((s) => s.enqueue);
  const allJobs = useUploadStore((s) => s.jobs);
  const myJobs = useMemo(() => allJobs.filter((j) => j.trackId === trackId), [allJobs, trackId]);
  const activeJob = myJobs.find((j) => isActivePhase(j.phase)) ?? null;
  const lastErrorJob = myJobs.find((j) => j.phase === "error") ?? null;
  const play = usePlayer((s) => s.play);
  const playerCurrent = usePlayer((s) => s.current);
  const playerPositionSec = usePlayer((s) => s.positionSec);
  const playerSeekTo = usePlayer((s) => s.seekTo);
  const [shareVersion, setShareVersion] = useState<Version | null>(null);
  const [redetecting, setRedetecting] = useState(false);
  const [redetectStatus, setRedetectStatus] = useState<string | null>(null);
  const [redetectErr, setRedetectErr] = useState<string | null>(null);

  // Auto-trigger the file picker when arriving with ?action=upload (from "Replace audio" sheet row).
  useEffect(() => {
    if (searchParams.get("action") !== "upload") return;
    const timer = setTimeout(() => {
      fileRef.current?.click();
      // Strip the query so refreshes don't re-open the picker.
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }, 150);
    return () => clearTimeout(timer);
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!trackId) return;
    let cancel = false;
    (async () => {
      const t = await supabase.from("tracks").select("*").eq("id", trackId).single();
      if (cancel || !t.data) return;
      setTrack(t.data as Track);
      const [a, v] = await Promise.all([
        supabase.from("albums").select("*").eq("id", (t.data as Track).album_id).single(),
        supabase.from("versions").select("*").eq("track_id", trackId).order("uploaded_at", { ascending: false }),
      ]);
      if (cancel) return;
      if (a.data) setAlbum(a.data as Album);
      setVersions((v.data ?? []) as Version[]);
    })();
    return () => {
      cancel = true;
    };
  }, [trackId]);

  const onUpload = (file: File) => {
    if (!user || !track) return;
    enqueueUpload({ file, track, userId: user.id, existingVersionCount: versions.length });
    if (fileRef.current) fileRef.current.value = "";
  };

  // Subscribe to the upload store and merge completed jobs for this track into local
  // state on the phase→"done" transition. Jobs survive navigation, so if the user
  // returns to a track whose upload finished elsewhere, the initial fetch already
  // includes the row — we only need to catch transitions that happen while mounted.
  useEffect(() => {
    if (!trackId) return;
    const seen = new Set<string>();
    // Seed with whatever's already "done" at mount time so we don't re-merge stale jobs.
    for (const j of useUploadStore.getState().jobs) {
      if (j.trackId === trackId && j.phase === "done" && j.version) {
        seen.add(j.version.id);
      }
    }
    return useUploadStore.subscribe((state) => {
      for (const j of state.jobs) {
        if (j.trackId !== trackId || j.phase !== "done" || !j.version) continue;
        if (seen.has(j.version.id)) continue;
        seen.add(j.version.id);
        const v = j.version;
        const p = j.trackPatch;
        setVersions((cur) => (cur.some((x) => x.id === v.id) ? cur : [v, ...cur]));
        if (p) setTrack((cur) => (cur ? { ...cur, ...p } : cur));
      }
    });
  }, [trackId]);

  const redetectFromCurrent = async () => {
    if (!track) return;
    const currentVersion = versions.find((v) => v.id === track.current_version_id);
    if (!currentVersion) {
      setRedetectErr("No current version to analyze. Upload audio first.");
      return;
    }
    setRedetecting(true);
    setRedetectErr(null);
    setRedetectStatus("Loading audio…");
    try {
      const url = await getSignedAudioUrl(currentVersion.storage_path);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn't fetch audio (HTTP ${res.status})`);
      const buf = await res.arrayBuffer();
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const audioBuffer = await ctx.decodeAudioData(buf);
      ctx.close();

      setRedetectStatus("Analyzing…");
      const [bpmResult, keyResult] = await Promise.allSettled([
        detectBpm(audioBuffer),
        Promise.resolve(detectKey(audioBuffer)),
      ]);
      const newBpm = bpmResult.status === "fulfilled" ? bpmResult.value : null;
      const keyObj = keyResult.status === "fulfilled" ? keyResult.value : null;
      const newKey = keyObj?.key ?? null;
      console.log("[redetect]", { bpm: newBpm, key: newKey, keyConfidence: keyObj?.confidence });

      if (newBpm == null && newKey == null) {
        setRedetectErr("Couldn't detect anything from this audio.");
        return;
      }

      const patch: { bpm?: number | null; song_key?: string | null } = {};
      if (newBpm != null) patch.bpm = newBpm;
      if (newKey != null) patch.song_key = newKey;
      const { error } = await supabase.from("tracks").update(patch).eq("id", track.id);
      if (error) throw error;
      setTrack({ ...track, ...patch });
      resyncSharesForTrack(track.id, track.album_id);
      setRedetectStatus("Done.");
      setTimeout(() => setRedetectStatus(null), 2000);
    } catch (e) {
      console.error("[redetect] failed", e);
      setRedetectErr(formatErr(e));
    } finally {
      setRedetecting(false);
    }
  };

  const setCurrent = async (versionId: string) => {
    if (!track) return;
    setTrack({ ...track, current_version_id: versionId });
    await supabase.from("tracks").update({ current_version_id: versionId }).eq("id", track.id);
    resyncSharesForTrack(track.id, track.album_id);
  };

  const deleteVersion = async (v: Version) => {
    if (!track) return;
    if (!confirm(`Delete ${v.label}? The audio file will be removed.`)) return;
    await supabase.storage.from("audio").remove([v.storage_path]);
    await supabase.from("versions").delete().eq("id", v.id);
    setVersions((vs) => vs.filter((x) => x.id !== v.id));
    if (track.current_version_id === v.id) {
      setTrack({ ...track, current_version_id: null });
    }
  };

  const playVersion = async (v: Version) => {
    if (!track || !album) return;
    const url = await getSignedAudioUrl(v.storage_path);
    play({
      trackId: track.id,
      versionId: v.id,
      title: track.title,
      albumTitle: album.title,
      audioUrl: url,
      peaks: v.peaks,
      duration: v.duration_sec,
      artistName: (user?.user_metadata?.artist_name as string | undefined) ?? null,
      artworkUrl: album.artwork_url ?? null,
    });
  };

  const [downloadingVersionId, setDownloadingVersionId] = useState<string | null>(null);

  const onDownloadVersion = async (v: Version) => {
    if (!track) return;
    setDownloadingVersionId(v.id);
    try {
      const url = await getSignedAudioUrl(v.storage_path);
      const ext = (v.storage_path.split(".").pop() || "wav").toLowerCase();
      const filename = `${safeFilename(track.title)} - ${safeFilename(v.label)}.${ext}`;
      await downloadAudio(url, filename);
    } catch (e) {
      console.error("[download] failed", e);
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingVersionId(null);
    }
  };

  if (!track || !album)
    return <div className="max-w-4xl mx-auto px-6 py-8 text-muted">Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <Link to={`/album/${album.id}`} className="text-xs text-muted hover:text-white">
        ← {album.title}
      </Link>
      <div className="flex items-start justify-between gap-3 mt-2 mb-4">
        <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight break-words flex-1 min-w-0">{track.title}</h1>
        <Link
          to={`/edit/${track.id}`}
          aria-label="Edit track"
          title="Edit track"
          className="shrink-0 inline-flex items-center gap-1.5 bg-panel border border-edge hover:border-accent/60 text-white text-sm px-3 py-2 rounded-lg transition mt-1"
        >
          <SlidersHorizontal size={14} />
          <span>Edit</span>
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <TrackMetaStrip
          track={track}
          onChange={(patch) => setTrack({ ...track, ...patch })}
        />
        <button
          onClick={redetectFromCurrent}
          disabled={redetecting || !track.current_version_id}
          title="Re-analyze the current version's audio for BPM and key"
          className="bg-panel border border-edge hover:border-accent/60 disabled:opacity-50 text-white text-sm px-3 py-2 rounded-lg flex items-center gap-1.5"
        >
          <Sparkles size={14} />
          {redetecting ? (redetectStatus ?? "Detecting…") : "Re-detect"}
        </button>
        {redetectErr && <span className="text-xs text-red-400">{redetectErr}</span>}
        {!redetecting && redetectStatus === "Done." && <span className="text-xs text-emerald-400">Updated</span>}
      </div>

      <section className="bg-panel border border-edge rounded-2xl p-4 sm:p-5 mb-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-sm uppercase tracking-wider text-muted">Versions</h2>
          <div className="shrink-0">
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,.wav,.mp3,.aiff,.flac,.m4a"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="bg-accent hover:bg-accent/90 text-white text-sm font-medium px-3 sm:px-4 py-2 rounded-lg"
            >
              <span className="hidden sm:inline">+ Upload version</span>
              <span className="sm:hidden">+ Upload</span>
            </button>
          </div>
        </div>
        {activeJob && (
          <p className="text-sm text-muted mb-3">
            {activeJob.message} <span className="text-muted/70">· {activeJob.fileName}</span>
          </p>
        )}
        {lastErrorJob && !activeJob && (
          <p className="text-sm text-red-400 mb-3">{lastErrorJob.error}</p>
        )}

        {versions.length === 0 ? (
          <p className="text-sm text-muted py-6 text-center">
            No versions yet. Upload a WAV, MP3, AIFF, FLAC, or M4A.
          </p>
        ) : (
          <ul className="divide-y divide-edge -mx-4 sm:-mx-5">
            {versions.map((v) => (
              <li key={v.id} className="px-4 sm:px-5 py-3 flex items-center gap-3 sm:gap-4">
                <button
                  onClick={() => playVersion(v)}
                  className="w-9 h-9 shrink-0 rounded-full bg-panel2 hover:bg-accent text-white flex items-center justify-center"
                  aria-label="Play"
                >
                  <Play size={14} fill="currentColor" className="translate-x-[1px]" />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{v.label}</div>
                  <div className="text-xs text-muted truncate">
                    {new Date(v.uploaded_at).toLocaleDateString()} ·{" "}
                    {v.duration_sec ? `${Math.floor(v.duration_sec / 60)}:${Math.floor(v.duration_sec % 60).toString().padStart(2, "0")}` : "—"}
                  </div>
                </div>
                {track.current_version_id === v.id ? (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-accent/20 text-accent shrink-0">
                    Current
                  </span>
                ) : (
                  <button
                    onClick={() => setCurrent(v.id)}
                    className="text-xs text-muted hover:text-white shrink-0"
                  >
                    <span className="hidden sm:inline">Make current</span>
                    <span className="sm:hidden">Use</span>
                  </button>
                )}
                <button
                  onClick={() => setShareVersion(v)}
                  className="text-xs text-muted hover:text-white shrink-0 flex items-center gap-1.5"
                  aria-label="Share version"
                  title="Share"
                >
                  <Share2 size={14} />
                  <span className="hidden sm:inline">Share</span>
                </button>
                <button
                  onClick={() => onDownloadVersion(v)}
                  disabled={downloadingVersionId === v.id}
                  className="text-xs text-muted hover:text-white shrink-0 disabled:opacity-60 flex items-center gap-1.5"
                  aria-label="Download version"
                  title="Download audio file"
                >
                  <Download size={14} />
                  <span className="hidden sm:inline">{downloadingVersionId === v.id ? "…" : "Download"}</span>
                </button>
                <button
                  onClick={() => deleteVersion(v)}
                  className="text-xs text-muted hover:text-red-400 shrink-0 flex items-center gap-1.5"
                  aria-label="Delete version"
                >
                  <Trash2 size={14} />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CommentFeed
        trackId={track.id}
        versionId={track.current_version_id}
        currentTimeSec={playerCurrent?.trackId === track.id ? playerPositionSec : 0}
        onSeek={(sec) => {
          if (playerCurrent?.trackId === track.id) {
            playerSeekTo(sec);
          } else {
            // Track isn't loaded in the global player yet — start it, then seek
            // once the position is reported back from PlayerBar.
            const current = versions.find((v) => v.id === track.current_version_id);
            if (current) {
              void playVersion(current).then(() => {
                setTimeout(() => playerSeekTo(sec), 250);
              });
            }
          }
        }}
        canPost={Boolean(user)}
      />

      {shareVersion && track && (
        <ShareModal
          track={track}
          version={shareVersion}
          albumArtworkUrl={album?.artwork_url ?? null}
          onTrackChange={(patch) => setTrack({ ...track, ...patch })}
          onClose={() => setShareVersion(null)}
        />
      )}
    </div>
  );
}

function TrackMetaStrip({
  track,
  onChange,
}: {
  track: Track;
  onChange: (patch: Partial<Track>) => void;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <MetaField
        label="BPM"
        value={track.bpm != null ? String(track.bpm) : ""}
        placeholder="—"
        type="number"
        width="w-24"
        onCommit={async (v) => {
          const trimmed = v.trim();
          const next = trimmed === "" ? null : parseFloat(trimmed);
          if (next != null && (!isFinite(next) || next < 30 || next > 300)) return;
          onChange({ bpm: next });
          await supabase.from("tracks").update({ bpm: next }).eq("id", track.id);
          resyncSharesForTrack(track.id, track.album_id);
        }}
      />
      <MetaField
        label="Key"
        value={track.song_key ?? ""}
        placeholder="—"
        type="text"
        width="w-24"
        onCommit={async (v) => {
          const next = v.trim() === "" ? null : v.trim();
          onChange({ song_key: next });
          await supabase.from("tracks").update({ song_key: next }).eq("id", track.id);
          resyncSharesForTrack(track.id, track.album_id);
        }}
      />
    </div>
  );
}

function MetaField({
  label,
  value,
  placeholder,
  type,
  width,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  type: "text" | "number";
  width: string;
  onCommit: (v: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <label className="bg-panel border border-edge rounded-lg px-3 py-2 flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <input
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(value);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        className={`${width} bg-transparent text-sm text-white placeholder:text-muted focus:outline-none`}
      />
    </label>
  );
}
