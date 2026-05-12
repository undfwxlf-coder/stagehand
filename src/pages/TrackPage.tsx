import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Album, Track, Version } from "../lib/database.types";
import { downloadAudio, getSignedAudioUrl, inferAudioMeta, inferVersionLabel, safeFilename } from "../lib/audio";
import { decodeAudio, detectBpm, detectKey, peaksFromBuffer } from "../lib/audioAnalysis";
import { usePlayer } from "../lib/player";
import ShareModal from "../components/ShareModal";
import InsightsPanel from "../components/InsightsPanel";

export default function TrackPage() {
  const { trackId } = useParams<{ trackId: string }>();
  const { user } = useAuth();
  const [track, setTrack] = useState<Track | null>(null);
  const [album, setAlbum] = useState<Album | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const play = usePlayer((s) => s.play);
  const [shareVersion, setShareVersion] = useState<Version | null>(null);
  const [tab, setTab] = useState<"insights" | "notes">("insights");
  const [redetecting, setRedetecting] = useState(false);
  const [redetectStatus, setRedetectStatus] = useState<string | null>(null);
  const [redetectErr, setRedetectErr] = useState<string | null>(null);

  useEffect(() => {
    if (!trackId) return;
    let cancel = false;
    (async () => {
      const t = await supabase.from("tracks").select("*").eq("id", trackId).single();
      if (cancel || !t.data) return;
      setTrack(t.data as Track);
      setNotes((t.data as Track).notes ?? "");
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

  const saveNotes = async () => {
    if (!track) return;
    setSavingNotes(true);
    await supabase.from("tracks").update({ notes }).eq("id", track.id);
    setSavingNotes(false);
  };

  const onUpload = async (file: File) => {
    if (!user || !track) return;
    setUploading(true);
    setUploadErr(null);
    try {
      setUploadStatus("Decoding audio…");
      const audioBuffer = await decodeAudio(file);
      const peaks = peaksFromBuffer(audioBuffer, 1024);
      const duration = audioBuffer.duration;

      // Kick off detection in parallel with the upload — we apply results after both finish.
      setUploadStatus("Analyzing tempo and key…");
      const detectionPromise = Promise.allSettled([
        detectBpm(audioBuffer),
        Promise.resolve(detectKey(audioBuffer)),
      ]);

      setUploadStatus("Uploading…");
      const ext = (file.name.split(".").pop() || "wav").toLowerCase();
      const path = `${user.id}/${track.id}/${Date.now()}.${ext}`;
      const up = await supabase.storage.from("audio").upload(path, file, {
        contentType: file.type || "audio/mpeg",
        upsert: false,
      });
      if (up.error) throw up.error;

      setUploadStatus("Saving…");
      const label = inferVersionLabel(file.name, versions.length);
      const ins = await supabase
        .from("versions")
        .insert({ track_id: track.id, label, storage_path: path, duration_sec: duration, peaks })
        .select()
        .single();
      if (ins.error) throw ins.error;
      const newVersion = ins.data as Version;

      // Filename hints take priority over content detection (artist explicitly named it).
      const fromFilename = inferAudioMeta(file.name);
      const [bpmResult, keyResult] = await detectionPromise;
      const detectedBpm = bpmResult.status === "fulfilled" ? bpmResult.value : null;
      const detectedKeyObj = keyResult.status === "fulfilled" ? keyResult.value : null;
      const detectedKey = detectedKeyObj?.key ?? null;
      console.log("[upload] detected", { bpm: detectedBpm, key: detectedKey, keyConfidence: detectedKeyObj?.confidence });

      const newBpm = fromFilename.bpm ?? detectedBpm;
      const newKey = fromFilename.key ?? detectedKey;

      const trackPatch: { current_version_id: string; bpm?: number; song_key?: string } = {
        current_version_id: newVersion.id,
      };
      if (newBpm != null && track.bpm == null) trackPatch.bpm = newBpm;
      if (newKey != null && !track.song_key) trackPatch.song_key = newKey;
      console.log("[upload] applying patch", trackPatch, "(existing track.bpm:", track.bpm, ", existing track.song_key:", track.song_key, ")");
      const updateRes = await supabase.from("tracks").update(trackPatch).eq("id", track.id);
      if (updateRes.error) console.error("[upload] track update failed", updateRes.error);

      setVersions((v) => [newVersion, ...v]);
      setTrack({
        ...track,
        current_version_id: newVersion.id,
        bpm: trackPatch.bpm ?? track.bpm,
        song_key: trackPatch.song_key ?? track.song_key,
      });
      setUploadStatus(null);
    } catch (e) {
      console.error("[upload] failed", e);
      setUploadErr(formatErr(e));
      setUploadStatus(null);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

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
      <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight mt-2 mb-4 break-words">{track.title}</h1>

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
          <span aria-hidden>✦</span>
          {redetecting ? (redetectStatus ?? "Detecting…") : "Re-detect"}
        </button>
        {redetectErr && <span className="text-xs text-red-400">{redetectErr}</span>}
        {!redetecting && redetectStatus === "Done." && <span className="text-xs text-emerald-400">Updated</span>}
      </div>

      <DownloadToggle
        track={track}
        onChange={(allow) => setTrack({ ...track, allow_download: allow })}
      />

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
              disabled={uploading}
              className="bg-accent hover:bg-accent/90 disabled:opacity-60 text-white text-sm font-medium px-3 sm:px-4 py-2 rounded-lg"
            >
              <span className="hidden sm:inline">{uploading ? "Uploading…" : "+ Upload version"}</span>
              <span className="sm:hidden">{uploading ? "…" : "+ Upload"}</span>
            </button>
          </div>
        </div>
        {uploadStatus && <p className="text-sm text-muted mb-3">{uploadStatus}</p>}
        {uploadErr && <p className="text-sm text-red-400 mb-3">{uploadErr}</p>}

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
                  ▶
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
                  className="text-xs text-muted hover:text-white shrink-0"
                  aria-label="Share version"
                  title="Share"
                >
                  <span className="hidden sm:inline">Share</span>
                  <span className="sm:hidden">↗</span>
                </button>
                <button
                  onClick={() => onDownloadVersion(v)}
                  disabled={downloadingVersionId === v.id}
                  className="text-xs text-muted hover:text-white shrink-0 disabled:opacity-60"
                  aria-label="Download version"
                  title="Download audio file"
                >
                  <span className="hidden sm:inline">{downloadingVersionId === v.id ? "…" : "Download"}</span>
                  <span className="sm:hidden">{downloadingVersionId === v.id ? "…" : "⬇"}</span>
                </button>
                <button
                  onClick={() => deleteVersion(v)}
                  className="text-xs text-muted hover:text-red-400 shrink-0"
                  aria-label="Delete version"
                >
                  <span className="hidden sm:inline">Delete</span>
                  <span className="sm:hidden">✕</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-panel border border-edge rounded-2xl p-4 sm:p-5">
        <div className="flex items-center gap-1 mb-4 bg-ink p-1 rounded-lg w-fit">
          <TabButton active={tab === "insights"} onClick={() => setTab("insights")}>
            Insights
          </TabButton>
          <TabButton active={tab === "notes"} onClick={() => setTab("notes")}>
            Notes
          </TabButton>
        </div>

        {tab === "insights" ? (
          <InsightsPanel trackId={track.id} ownerId={user?.id ?? ""} />
        ) : (
          <div>
            <div className="flex items-center justify-end mb-2">
              <button
                onClick={saveNotes}
                disabled={savingNotes}
                className="text-xs text-muted hover:text-white"
              >
                {savingNotes ? "Saving…" : "Save"}
              </button>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              rows={8}
              placeholder="Lyrics, ideas, things to fix on the next take…"
              className="w-full bg-ink border border-edge focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-white placeholder:text-muted text-sm"
            />
          </div>
        )}
      </section>

      {shareVersion && track && (
        <ShareModal
          track={track}
          version={shareVersion}
          onClose={() => setShareVersion(null)}
        />
      )}
    </div>
  );
}

function DownloadToggle({
  track,
  onChange,
}: {
  track: Track;
  onChange: (allow: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const allow = track.allow_download;
  const toggle = async () => {
    setBusy(true);
    const next = !allow;
    onChange(next);
    const { error } = await supabase
      .from("tracks")
      .update({ allow_download: next })
      .eq("id", track.id);
    setBusy(false);
    if (error) {
      console.error("[download-toggle] failed", error);
      onChange(allow); // revert
      alert(error.message);
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`mb-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition disabled:opacity-60 ${
        allow
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:border-emerald-500/60"
          : "bg-panel border-edge text-muted hover:border-accent/60 hover:text-white"
      }`}
      aria-pressed={allow}
    >
      <span aria-hidden>{allow ? "⬇" : "🔒"}</span>
      <span>{allow ? "Downloads enabled" : "Streaming only"}</span>
      <span className={`ml-1 inline-flex h-4 w-7 rounded-full p-0.5 transition ${allow ? "bg-emerald-500/60" : "bg-edge"}`}>
        <span className={`h-3 w-3 rounded-full bg-white transition-transform ${allow ? "translate-x-3" : "translate-x-0"}`} />
      </span>
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-sm px-3 py-1.5 rounded-md transition ${
        active ? "bg-panel2 text-white" : "text-muted hover:text-white"
      }`}
    >
      {children}
    </button>
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
        }}
      />
    </div>
  );
}

function formatErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const obj = e as { message?: unknown; error_description?: unknown; error?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [obj.message, obj.error_description, obj.error, obj.details, obj.hint]
      .filter((x) => typeof x === "string" && x.length > 0) as string[];
    if (parts.length) return obj.code ? `${parts[0]} (${String(obj.code)})` : parts[0];
    try {
      return JSON.stringify(e);
    } catch {
      return "Unknown error";
    }
  }
  return String(e);
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
