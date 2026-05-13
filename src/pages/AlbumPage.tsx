import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Album, AlbumStatus, Track, TrackStatus, Version } from "../lib/database.types";
import { usePlayer } from "../lib/player";
import { getSignedAudioUrl } from "../lib/audio";
import AlbumShareModal from "../components/AlbumShareModal";
import TrackDetailsSheet from "../components/TrackDetailsSheet";
import { Music, Share2 } from "lucide-react";

const ALBUM_STATUSES: AlbumStatus[] = ["writing", "recording", "mixing", "mastering", "released"];
const TRACK_STATUSES: TrackStatus[] = ["idea", "demo", "tracking", "mixing", "mastering", "released"];

const TRACK_STATUS_COLORS: Record<TrackStatus, string> = {
  idea: "bg-slate-500/20 text-slate-300",
  demo: "bg-blue-500/20 text-blue-300",
  tracking: "bg-cyan-500/20 text-cyan-300",
  mixing: "bg-purple-500/20 text-purple-300",
  mastering: "bg-amber-500/20 text-amber-300",
  released: "bg-emerald-500/20 text-emerald-300",
};

interface TrackWithVersion extends Track {
  version?: Version | null;
}

// Mobile: title (1fr) | status (108) | play (28) | more (28). Desktop: handle | # | title | status | length | play | more.
const ROW_GRID = "grid-cols-[1fr_108px_28px_28px] sm:grid-cols-[24px_24px_1fr_140px_100px_28px_28px]";

export default function AlbumPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const { user } = useAuth();
  const [album, setAlbum] = useState<Album | null>(null);
  const [tracks, setTracks] = useState<TrackWithVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTrackTitle, setNewTrackTitle] = useState("");
  const [uploadingArt, setUploadingArt] = useState(false);
  const [artErr, setArtErr] = useState<string | null>(null);
  const artFileRef = useRef<HTMLInputElement>(null);
  const [showShare, setShowShare] = useState(false);
  const [detailsTrackId, setDetailsTrackId] = useState<string | null>(null);
  const play = usePlayer((s) => s.play);
  const setQueue = usePlayer((s) => s.setQueue);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!albumId) return;
    let cancel = false;
    (async () => {
      const [a, t] = await Promise.all([
        supabase.from("albums").select("*").eq("id", albumId).single(),
        supabase.from("tracks").select("*").eq("album_id", albumId).order("position"),
      ]);
      if (cancel) return;
      if (a.data) setAlbum(a.data as Album);
      const trackList = (t.data ?? []) as Track[];
      const versionIds = trackList.map((tr) => tr.current_version_id).filter(Boolean) as string[];
      let versionMap: Record<string, Version> = {};
      if (versionIds.length) {
        const v = await supabase.from("versions").select("*").in("id", versionIds);
        if (v.data) versionMap = Object.fromEntries((v.data as Version[]).map((vv) => [vv.id, vv]));
      }
      setTracks(
        trackList.map((tr) => ({
          ...tr,
          version: tr.current_version_id ? versionMap[tr.current_version_id] ?? null : null,
        }))
      );
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [albumId]);

  const addTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTrackTitle.trim() || !albumId) return;
    const position = tracks.length;
    const { data, error } = await supabase
      .from("tracks")
      .insert({ album_id: albumId, title: newTrackTitle.trim(), position })
      .select()
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    setTracks((tr) => [...tr, data as Track]);
    setNewTrackTitle("");
  };

  const updateAlbumStatus = async (status: AlbumStatus) => {
    if (!album) return;
    setAlbum({ ...album, status });
    await supabase.from("albums").update({ status }).eq("id", album.id);
  };

  const updateTrackStatus = async (id: string, status: TrackStatus) => {
    setTracks((tr) => tr.map((t) => (t.id === id ? { ...t, status } : t)));
    await supabase.from("tracks").update({ status }).eq("id", id);
  };

  const renameTrack = async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setTracks((tr) => tr.map((t) => (t.id === id ? { ...t, title: trimmed } : t)));
    const { error } = await supabase.from("tracks").update({ title: trimmed }).eq("id", id);
    if (error) console.error("[rename] failed", error);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = tracks.findIndex((t) => t.id === active.id);
    const newIdx = tracks.findIndex((t) => t.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;

    const reordered = arrayMove(tracks, oldIdx, newIdx);
    setTracks(reordered);

    const lo = Math.min(oldIdx, newIdx);
    const hi = Math.max(oldIdx, newIdx);
    const updates = reordered.slice(lo, hi + 1).map((t, i) =>
      supabase.from("tracks").update({ position: lo + i }).eq("id", t.id)
    );
    const results = await Promise.all(updates);
    const fail = results.find((r) => r.error);
    if (fail?.error) {
      console.error("[reorder] failed", fail.error);
      // best-effort: refetch to recover from any partial update
      const { data } = await supabase.from("tracks").select("*").eq("album_id", albumId!).order("position");
      if (data) {
        setTracks((prev) =>
          (data as Track[]).map((tr) => ({
            ...tr,
            version: prev.find((p) => p.id === tr.id)?.version ?? null,
          }))
        );
      }
    }
  };

  const uploadArtwork = async (file: File) => {
    if (!user || !album) return;
    setArtErr(null);
    if (!file.type.startsWith("image/")) {
      setArtErr("Please pick an image file (JPG, PNG, WebP).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setArtErr("Image must be under 8 MB.");
      return;
    }
    setUploadingArt(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${user.id}/${album.id}/cover-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("artwork").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (up.error) throw up.error;
      const { data: pub } = supabase.storage.from("artwork").getPublicUrl(path);
      const url = pub.publicUrl;
      const { error } = await supabase.from("albums").update({ artwork_url: url }).eq("id", album.id);
      if (error) throw error;
      setAlbum({ ...album, artwork_url: url });
    } catch (e) {
      setArtErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingArt(false);
      if (artFileRef.current) artFileRef.current.value = "";
    }
  };

  const playTrack = async (t: TrackWithVersion) => {
    if (!t.version || !album) return;
    const url = await getSignedAudioUrl(t.version.storage_path);
    const artistName = (user?.user_metadata?.artist_name as string | undefined) ?? null;
    const artworkUrl = album.artwork_url ?? null;
    setQueue(
      tracks
        .filter((tr) => tr.version)
        .map((tr) => ({
          trackId: tr.id,
          versionId: tr.version!.id,
          title: tr.title,
          albumTitle: album.title,
          audioUrl: "",
          peaks: tr.version!.peaks,
          duration: tr.version!.duration_sec,
          artistName,
          artworkUrl,
        }))
    );
    play({
      trackId: t.id,
      versionId: t.version.id,
      title: t.title,
      albumTitle: album.title,
      audioUrl: url,
      peaks: t.version.peaks,
      duration: t.version.duration_sec,
      artistName,
      artworkUrl,
    });
  };

  if (loading) return <div className="max-w-5xl mx-auto px-6 py-8 text-muted">Loading…</div>;
  if (!album) return <div className="max-w-5xl mx-auto px-6 py-8 text-muted">Album not found.</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 mb-6 sm:mb-8 items-start">
        <div className="shrink-0 mx-auto sm:mx-0">
          <button
            type="button"
            onClick={() => artFileRef.current?.click()}
            disabled={uploadingArt}
            aria-label={album.artwork_url ? "Change cover" : "Upload cover"}
            className="group relative w-40 h-40 sm:w-48 sm:h-48 rounded-2xl bg-gradient-to-br from-panel2 to-ink border border-edge hover:border-accent/60 flex items-center justify-center text-6xl text-edge overflow-hidden transition disabled:opacity-60"
          >
            {album.artwork_url ? (
              <img src={album.artwork_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <Music size={48} strokeWidth={1.25} />
            )}
            <span className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-sm font-medium">
              {uploadingArt ? "Uploading…" : album.artwork_url ? "Change cover" : "Upload cover"}
            </span>
          </button>
          <input
            ref={artFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadArtwork(f);
            }}
          />
          {artErr && <p className="text-xs text-red-400 mt-2 max-w-[12rem]">{artErr}</p>}
        </div>
        <div className="flex-1 min-w-0 w-full">
          <Link to="/" className="text-xs text-muted hover:text-white">← Library</Link>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight mt-1 break-words">{album.title}</h1>
            <button
              onClick={() => setShowShare(true)}
              className="mt-1 shrink-0 bg-panel2 hover:bg-edge text-white text-sm font-medium px-3 sm:px-4 py-2 rounded-lg border border-edge flex items-center gap-1.5"
              aria-label="Share album"
            >
              <Share2 size={14} />
              <span className="hidden sm:inline">Share album</span>
              <span className="sm:hidden">Share</span>
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {ALBUM_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => updateAlbumStatus(s)}
                className={`text-xs uppercase tracking-wider px-2.5 py-1 rounded transition ${
                  album.status === s ? "bg-accent text-white" : "bg-panel2 text-muted hover:text-white"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-panel border border-edge rounded-2xl overflow-hidden">
        <div className={`px-3 sm:px-5 py-3 border-b border-edge text-xs uppercase tracking-wider text-muted grid ${ROW_GRID} gap-2 sm:gap-3 items-center`}>
          <span className="hidden sm:block"></span>
          <span className="hidden sm:block">#</span>
          <span>Title</span>
          <span>Status</span>
          <span className="text-right hidden sm:block">Length</span>
          <span></span>
          <span></span>
        </div>
        {tracks.length === 0 ? (
          <div className="px-5 py-12 text-center text-muted text-sm">
            No tracks yet. Add your first track below.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={tracks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {tracks.map((t, i) => (
                <SortableTrackRow
                  key={t.id}
                  track={t}
                  index={i}
                  onStatusChange={(status) => updateTrackStatus(t.id, status)}
                  onRename={(title) => renameTrack(t.id, title)}
                  onPlay={() => playTrack(t)}
                  onOpenDetails={() => setDetailsTrackId(t.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
        <form onSubmit={addTrack} className="px-3 sm:px-5 py-3 flex gap-2 bg-panel2/30">
          <input
            value={newTrackTitle}
            onChange={(e) => setNewTrackTitle(e.target.value)}
            placeholder="Add a track…"
            className="flex-1 min-w-0 bg-ink border border-edge focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted"
          />
          <button
            type="submit"
            className="bg-accent hover:bg-accent/90 text-white text-sm font-medium px-4 rounded-lg shrink-0"
          >
            Add
          </button>
        </form>
      </div>

      {showShare && <AlbumShareModal album={album} onClose={() => setShowShare(false)} />}

      {detailsTrackId && (() => {
        const t = tracks.find((tr) => tr.id === detailsTrackId);
        if (!t) return null;
        return (
          <TrackDetailsSheet
            track={t}
            version={t.version ?? null}
            albumTitle={album.title}
            albumArtworkUrl={album.artwork_url ?? null}
            artistName={(user?.user_metadata?.artist_name as string | undefined) ?? null}
            ownerId={user?.id ?? ""}
            onClose={() => setDetailsTrackId(null)}
            onTrackChange={(patch) =>
              setTracks((rows) => rows.map((r) => (r.id === t.id ? { ...r, ...patch } : r)))
            }
          />
        );
      })()}
    </div>
  );
}

function SortableTrackRow({
  track,
  index,
  onStatusChange,
  onRename,
  onPlay,
  onOpenDetails,
}: {
  track: TrackWithVersion;
  index: number;
  onStatusChange: (s: TrackStatus) => void;
  onRename: (title: string) => void;
  onPlay: () => void;
  onOpenDetails: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: track.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(track.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(track.title);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, track.title]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== track.title) onRename(trimmed);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(track.title);
    setEditing(false);
  };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`px-3 sm:px-5 py-3 border-b border-edge last:border-b-0 grid ${ROW_GRID} gap-2 sm:gap-3 items-center group ${
        isDragging ? "bg-panel2 shadow-lg" : "hover:bg-panel2/50"
      }`}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
        className="hidden sm:flex text-muted/40 group-hover:text-muted hover:text-white cursor-grab active:cursor-grabbing items-center justify-center"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="5" cy="3" r="1.1" fill="currentColor" />
          <circle cx="9" cy="3" r="1.1" fill="currentColor" />
          <circle cx="5" cy="7" r="1.1" fill="currentColor" />
          <circle cx="9" cy="7" r="1.1" fill="currentColor" />
          <circle cx="5" cy="11" r="1.1" fill="currentColor" />
          <circle cx="9" cy="11" r="1.1" fill="currentColor" />
        </svg>
      </button>
      <span className="hidden sm:block text-muted text-sm tabular-nums">{index + 1}</span>
      {editing ? (
        <div className="min-w-0">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            className="w-full bg-ink border border-accent focus:outline-none rounded-md px-2 py-1 text-sm text-white"
          />
          <div className="text-xs text-muted truncate mt-0.5">
            {track.version ? track.version.label : <span className="opacity-60">No audio yet</span>}
          </div>
        </div>
      ) : (
        <div className="min-w-0 flex items-center gap-2">
          <Link to={`/track/${track.id}`} className="min-w-0 flex-1">
            <div className="text-white text-sm truncate" onDoubleClick={(e) => { e.preventDefault(); setEditing(true); }}>
              {track.title}
            </div>
            <div className="text-xs text-muted truncate">
              {track.version ? track.version.label : <span className="opacity-60">No audio yet</span>}
              {track.bpm != null && <span> · {track.bpm} BPM</span>}
              {track.song_key && <span> · {track.song_key}</span>}
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Rename track"
            title="Rename"
            className="opacity-60 sm:opacity-0 sm:group-hover:opacity-100 text-muted hover:text-white p-1 -m-1 transition shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M11.3 1.7a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L5.5 13.5l-3 .8.8-3L11.3 1.7Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      )}
      <select
        value={track.status}
        onChange={(e) => onStatusChange(e.target.value as TrackStatus)}
        className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded border-none focus:outline-none cursor-pointer w-full max-w-full truncate ${TRACK_STATUS_COLORS[track.status]}`}
      >
        {TRACK_STATUSES.map((s) => (
          <option key={s} value={s} className="bg-ink text-white">
            {s}
          </option>
        ))}
      </select>
      <span className="hidden sm:block text-right text-xs text-muted tabular-nums">
        {track.version?.duration_sec ? formatDur(track.version.duration_sec) : "—"}
      </span>
      <button
        onClick={onPlay}
        disabled={!track.version}
        className="w-8 h-8 rounded-full text-muted hover:text-white disabled:opacity-30 hover:bg-ink active:bg-ink flex items-center justify-center"
        aria-label="Play"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M2.5 1.5v9l8-4.5-8-4.5z" />
        </svg>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onOpenDetails(); }}
        className="w-8 h-8 rounded-full text-muted hover:text-white hover:bg-ink active:bg-ink flex items-center justify-center"
        aria-label="Track details"
        title="Track details"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="3.5" cy="8" r="1.3" />
          <circle cx="8" cy="8" r="1.3" />
          <circle cx="12.5" cy="8" r="1.3" />
        </svg>
      </button>
    </div>
  );
}

function formatDur(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
