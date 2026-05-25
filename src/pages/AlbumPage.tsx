import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { formatErr } from "../lib/errors";
import { Link, useNavigate, useParams } from "react-router-dom";
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
import { getSignedAudioUrl, inferTrackTitle, isAudioFile } from "../lib/audio";
import AlbumDetailsSheet from "../components/AlbumDetailsSheet";
import TrackDetailsSheet from "../components/TrackDetailsSheet";
import { Check, Music, Pencil, Share2, UploadCloud, X } from "lucide-react";
import { useLibraryStore } from "../lib/library";
import { useUploadStore } from "../lib/uploads";
import { resyncAlbumSharesFireAndForget, resyncSharesForTrack } from "../lib/share";

const ALBUM_STATUSES: AlbumStatus[] = ["writing", "recording", "mixing", "mastering", "released"];
const TRACK_STATUSES: TrackStatus[] = ["idea", "demo", "tracking", "waiting_on_feature", "mixing", "mastering", "released"];

const TRACK_STATUS_COLORS: Record<TrackStatus, string> = {
  idea: "bg-slate-500/20 text-slate-300",
  demo: "bg-blue-500/20 text-blue-300",
  tracking: "bg-cyan-500/20 text-cyan-300",
  waiting_on_feature: "bg-pink-500/20 text-pink-300",
  mixing: "bg-purple-500/20 text-purple-300",
  mastering: "bg-amber-500/20 text-amber-300",
  released: "bg-emerald-500/20 text-emerald-300",
};

const TRACK_STATUS_LABELS: Record<TrackStatus, string> = {
  idea: "idea",
  demo: "demo",
  tracking: "tracking",
  waiting_on_feature: "waiting on feat",
  mixing: "mixing",
  mastering: "mastering",
  released: "released",
};

interface TrackWithVersion extends Track {
  version?: Version | null;
}

// Mobile: title (1fr) | status (108) | more (28). Desktop: handle | # | title | status | length | more.
// Tap the title to play; the play button is gone now that the row is the play affordance.
const ROW_GRID = "grid-cols-[1fr_108px_28px] sm:grid-cols-[24px_24px_1fr_140px_100px_28px]";

export default function AlbumPage() {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [album, setAlbum] = useState<Album | null>(null);
  const [tracks, setTracks] = useState<TrackWithVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingArt, setUploadingArt] = useState(false);
  const [artErr, setArtErr] = useState<string | null>(null);
  const artFileRef = useRef<HTMLInputElement>(null);
  const addTrackFileRef = useRef<HTMLInputElement>(null);
  const [addTrackMenuOpen, setAddTrackMenuOpen] = useState(false);
  const addTrackBtnRef = useRef<HTMLButtonElement>(null);
  const [addTrackMenuPos, setAddTrackMenuPos] = useState<{ left: number; bottom: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!addTrackMenuOpen) return;
    const update = () => {
      const rect = addTrackBtnRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAddTrackMenuPos({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
        width: rect.width,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [addTrackMenuOpen]);
  const [showAlbumSheet, setShowAlbumSheet] = useState(false);
  const [detailsTrackId, setDetailsTrackId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const updateLibraryAlbum = useLibraryStore((s) => s.update);
  const removeLibraryAlbum = useLibraryStore((s) => s.remove);
  const play = usePlayer((s) => s.play);
  const setQueue = usePlayer((s) => s.setQueue);
  const enqueueUpload = useUploadStore((s) => s.enqueue);
  const [dropActive, setDropActive] = useState(false);
  const [dropTargetTrackId, setDropTargetTrackId] = useState<string | null>(null);
  const dropDepth = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!albumId) return;
    let cancel = false;

    // Cache-first paint: if the library store already has this album (almost
    // always true when navigating from /library), render it immediately. The
    // network fetch below still runs to pick up edits made elsewhere — and
    // tracks will fill in shortly.
    const cached = useLibraryStore.getState().albums.find((a) => a.id === albumId);
    if (cached) {
      setAlbum(cached);
      setLoading(false);
    }

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

  const addEmptyTrack = async () => {
    if (!albumId) return;
    const position = tracks.length;
    const { data, error } = await supabase
      .from("tracks")
      .insert({ album_id: albumId, title: "Untitled", position })
      .select()
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    setTracks((tr) => [...tr, data as Track]);
  };

  // Drop one or more audio files onto the album → create a new track per file and
  // enqueue an upload for each. Track inserts run in parallel; positions reserve
  // contiguous slots starting at the current end of the list.
  const createTracksFromFiles = async (files: File[]) => {
    if (!albumId || !user || files.length === 0) return;
    const basePosition = tracks.length;
    const inserts = await Promise.all(
      files.map((f, i) =>
        supabase
          .from("tracks")
          .insert({ album_id: albumId, title: inferTrackTitle(f.name), position: basePosition + i })
          .select()
          .single()
      )
    );
    const created: Track[] = [];
    inserts.forEach((res, i) => {
      if (res.error || !res.data) {
        console.error("[drop] track insert failed", res.error);
        return;
      }
      const newTrack = res.data as Track;
      created.push(newTrack);
      enqueueUpload({ file: files[i], track: newTrack, userId: user.id, existingVersionCount: 0 });
    });
    if (created.length) {
      setTracks((tr) => [...tr, ...created.map((t) => ({ ...t, version: null }))]);
    }
  };

  const replaceTrackWithFile = (trackId: string, file: File) => {
    if (!user) return;
    const t = tracks.find((tr) => tr.id === trackId);
    if (!t) return;
    enqueueUpload({ file, track: t, userId: user.id, existingVersionCount: 0 });
  };

  const onAlbumDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dropDepth.current += 1;
    setDropActive(true);
  };
  const onAlbumDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onAlbumDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dropDepth.current = Math.max(0, dropDepth.current - 1);
    if (dropDepth.current === 0) {
      setDropActive(false);
      setDropTargetTrackId(null);
    }
  };
  const resetDropState = () => {
    dropDepth.current = 0;
    setDropActive(false);
    setDropTargetTrackId(null);
  };
  const onAlbumDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    resetDropState();
    const audio = Array.from(e.dataTransfer.files).filter(isAudioFile);
    if (audio.length === 0) return;
    void createTracksFromFiles(audio);
  };

  const updateAlbumStatus = async (status: AlbumStatus) => {
    if (!album) return;
    setAlbum({ ...album, status });
    updateLibraryAlbum(album.id, { status });
    await supabase.from("albums").update({ status }).eq("id", album.id);
  };

  const startTitleEdit = () => {
    if (!album) return;
    setTitleDraft(album.title);
    setEditingTitle(true);
  };

  const saveTitle = async () => {
    if (!album) return;
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === album.title) return;
    setAlbum({ ...album, title: next });
    updateLibraryAlbum(album.id, { title: next });
    const { error } = await supabase.from("albums").update({ title: next }).eq("id", album.id);
    if (error) {
      alert(error.message);
    }
  };

  const cancelTitleEdit = () => {
    setEditingTitle(false);
    setTitleDraft("");
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
    else if (albumId) resyncSharesForTrack(id, albumId);
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
    } else if (albumId) {
      resyncAlbumSharesFireAndForget(albumId);
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
      setArtErr(formatErr(e));
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
          storagePath: tr.version!.storage_path,
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
  if (!album) return <div className="max-w-5xl mx-auto px-6 py-8 text-muted">Project not found.</div>;

  // Owner of this album vs collaborator. Editors can change tracks/versions
  // freely but the album row itself (title, cover, status, delete) stays
  // owner-only — see migration_collabs_v1.sql.
  const isOwner = Boolean(user && album.owner_id === user.id);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 mb-6 sm:mb-8 items-start">
        <div className="shrink-0 mx-auto sm:mx-0">
          <button
            type="button"
            onClick={() => isOwner && artFileRef.current?.click()}
            disabled={uploadingArt || !isOwner}
            aria-label={album.artwork_url ? (album.is_single ? "Change single cover" : "Change cover") : (album.is_single ? "Upload single cover" : "Upload cover")}
            className="group relative w-40 h-40 sm:w-48 sm:h-48 rounded-2xl bg-gradient-to-br from-panel2 to-ink border border-edge hover:border-accent/60 flex items-center justify-center text-6xl text-edge overflow-hidden transition disabled:opacity-60 disabled:hover:border-edge"
          >
            {album.artwork_url ? (
              <img src={album.artwork_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <Music size={48} strokeWidth={1.25} />
            )}
            {album.is_single && (
              <span className="absolute top-2 left-2 z-10 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/70 text-white/95 backdrop-blur">
                Single
              </span>
            )}
            {isOwner && (
              <span className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-sm font-medium">
                {uploadingArt
                  ? "Uploading…"
                  : album.artwork_url
                    ? (album.is_single ? "Change single cover" : "Change cover")
                    : (album.is_single ? "Upload single cover" : "Upload cover")}
              </span>
            )}
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
            {editingTitle ? (
              <div className="flex items-center gap-2 flex-1 min-w-0 mt-1">
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  maxLength={120}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTitle();
                    if (e.key === "Escape") cancelTitleEdit();
                  }}
                  className="flex-1 min-w-0 bg-ink border border-edge focus:border-accent focus:outline-none rounded-lg px-3 py-1.5 text-2xl sm:text-3xl font-semibold text-white"
                />
                <button
                  onClick={saveTitle}
                  aria-label="Save title"
                  className="p-2 rounded-md bg-accent hover:bg-accent/90 text-white"
                >
                  <Check size={16} />
                </button>
                <button
                  onClick={cancelTitleEdit}
                  aria-label="Cancel rename"
                  className="p-2 rounded-md bg-panel2 hover:bg-edge text-muted hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-1 min-w-0 mt-1 group">
                <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight break-words min-w-0">
                  {album.title}
                </h1>
                {isOwner && (
                  <button
                    onClick={startTitleEdit}
                    aria-label="Rename project"
                    title="Rename project"
                    className="opacity-0 group-hover:opacity-100 sm:opacity-100 text-muted hover:text-white p-1 transition shrink-0"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {!isOwner && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 shrink-0">
                    Editor
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 mt-1 shrink-0">
              <button
                onClick={() => setShowAlbumSheet(true)}
                className="bg-panel2 hover:bg-edge text-white text-sm font-medium px-3 sm:px-4 py-2 rounded-lg border border-edge flex items-center gap-1.5"
                aria-label="Share project"
              >
                <Share2 size={14} />
                <span className="hidden sm:inline">Share project</span>
                <span className="sm:hidden">Share</span>
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 overflow-x-auto sm:flex-wrap -mx-4 sm:mx-0 px-4 sm:px-0 [&>*]:shrink-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
            {ALBUM_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => isOwner && updateAlbumStatus(s)}
                disabled={!isOwner}
                className={`text-xs uppercase tracking-wider px-2.5 py-1 rounded transition disabled:cursor-default ${
                  album.status === s ? "bg-accent text-white" : "bg-panel2 text-muted hover:text-white"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className={`bg-panel border rounded-2xl overflow-hidden relative transition-colors ${
          dropActive && !dropTargetTrackId ? "border-accent ring-2 ring-accent/30" : "border-edge"
        }`}
        onDragEnter={onAlbumDragEnter}
        onDragOver={onAlbumDragOver}
        onDragLeave={onAlbumDragLeave}
        onDrop={onAlbumDrop}
      >
        {dropActive && !dropTargetTrackId && (
          <div className="pointer-events-none absolute inset-0 z-10 bg-accent/10 flex items-center justify-center">
            <div className="bg-panel/95 border border-accent rounded-xl px-4 py-2 text-sm text-white flex items-center gap-2 shadow-xl">
              <UploadCloud size={16} className="text-accent" />
              Drop audio to add tracks · drop on a row to add a version
            </div>
          </div>
        )}
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
                  isDropTarget={dropTargetTrackId === t.id}
                  onRowDragEnter={() => setDropTargetTrackId(t.id)}
                  onRowDragLeave={() => setDropTargetTrackId((cur) => (cur === t.id ? null : cur))}
                  onRowDrop={(file) => {
                    resetDropState();
                    replaceTrackWithFile(t.id, file);
                  }}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
        <div className="px-3 sm:px-5 py-3 bg-panel2/30 relative">
          <input
            ref={addTrackFileRef}
            type="file"
            accept="audio/*,.wav,.mp3,.aiff,.flac,.m4a"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []).filter(isAudioFile);
              if (files.length) void createTracksFromFiles(files);
              if (addTrackFileRef.current) addTrackFileRef.current.value = "";
            }}
          />
          <button
            ref={addTrackBtnRef}
            type="button"
            onClick={() => setAddTrackMenuOpen((v) => !v)}
            className="w-full bg-accent hover:bg-accent/90 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            + Add track
          </button>
          {addTrackMenuOpen && addTrackMenuPos && createPortal(
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setAddTrackMenuOpen(false)} aria-hidden />
              <div
                className="fixed bg-panel border border-edge rounded-lg shadow-xl py-1 z-[61]"
                style={{
                  left: addTrackMenuPos.left,
                  bottom: addTrackMenuPos.bottom,
                  width: addTrackMenuPos.width,
                }}
              >
                <button
                  onClick={() => {
                    setAddTrackMenuOpen(false);
                    addTrackFileRef.current?.click();
                  }}
                  className="w-full text-left px-3 py-2.5 text-sm text-white hover:bg-panel2 flex items-center gap-2.5"
                >
                  <UploadCloud size={16} className="text-muted shrink-0" />
                  <span className="flex-1 min-w-0 truncate">From audio file</span>
                  <span className="hidden sm:inline text-xs text-muted">WAV, MP3, AIFF, FLAC, M4A</span>
                </button>
                <button
                  onClick={() => {
                    setAddTrackMenuOpen(false);
                    void addEmptyTrack();
                  }}
                  className="w-full text-left px-3 py-2.5 text-sm text-white hover:bg-panel2 flex items-center gap-2.5"
                >
                  <Music size={16} className="text-muted shrink-0" />
                  <span>Empty track (add audio later)</span>
                </button>
                <div className="border-t border-edge mt-1 pt-1 px-3 pb-1 text-xs text-muted">
                  Tip: drop audio anywhere on the list to add tracks fast.
                </div>
              </div>
            </>,
            document.body
          )}
        </div>
      </div>

      {showAlbumSheet && (
        <AlbumDetailsSheet
          album={album}
          artistName={(user?.user_metadata?.artist_name as string | undefined) ?? null}
          trackCount={tracks.length}
          isOwner={isOwner}
          onClose={() => setShowAlbumSheet(false)}
          onRequestChangeCover={() => artFileRef.current?.click()}
          onRequestRename={() => startTitleEdit()}
          onAlbumChange={(patch) => {
            setAlbum({ ...album, ...patch });
            updateLibraryAlbum(album.id, patch);
          }}
          onDeleted={() => {
            removeLibraryAlbum(album.id);
            navigate("/");
          }}
        />
      )}

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
            onRequestReplaceAudio={() => navigate(`/track/${t.id}?action=upload`)}
            onDeleted={() => {
              setTracks((rows) => rows.filter((r) => r.id !== t.id));
              setDetailsTrackId(null);
              if (albumId) resyncAlbumSharesFireAndForget(albumId);
            }}
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
  isDropTarget,
  onRowDragEnter,
  onRowDragLeave,
  onRowDrop,
}: {
  track: TrackWithVersion;
  index: number;
  onStatusChange: (s: TrackStatus) => void;
  onRename: (title: string) => void;
  onPlay: () => void;
  onOpenDetails: () => void;
  isDropTarget: boolean;
  onRowDragEnter: () => void;
  onRowDragLeave: () => void;
  onRowDrop: (file: File) => void;
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

  const rowDepth = useRef(0);

  return (
    <div
      ref={setNodeRef}
      style={style}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        rowDepth.current += 1;
        onRowDragEnter();
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        rowDepth.current = Math.max(0, rowDepth.current - 1);
        if (rowDepth.current === 0) onRowDragLeave();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        rowDepth.current = 0;
        onRowDragLeave();
        const audio = Array.from(e.dataTransfer.files).find((f) => {
          if (f.type && f.type.startsWith("audio/")) return true;
          const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
          return ["wav", "mp3", "aiff", "aif", "flac", "m4a", "ogg", "opus", "aac", "wma"].includes(ext);
        });
        if (audio) onRowDrop(audio);
      }}
      className={`px-3 sm:px-5 py-3 border-b border-edge last:border-b-0 grid ${ROW_GRID} gap-2 sm:gap-3 items-center group transition-colors ${
        isDragging ? "bg-panel2 shadow-lg" : isDropTarget ? "bg-accent/15 ring-1 ring-accent/40" : "hover:bg-panel2/50"
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
          <button
            type="button"
            onClick={onPlay}
            onDoubleClick={(e) => { e.preventDefault(); setEditing(true); }}
            disabled={!track.version}
            aria-label={track.version ? `Play ${track.title}` : track.title}
            className="min-w-0 flex-1 text-left disabled:cursor-default"
          >
            <div className="text-white text-sm truncate">{track.title}</div>
            <div className="text-xs text-muted truncate">
              {track.version ? track.version.label : <span className="opacity-60">No audio yet</span>}
              {track.bpm != null && <span> · {track.bpm} BPM</span>}
              {track.song_key && <span> · {track.song_key}</span>}
            </div>
          </button>
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
            {TRACK_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <span className="hidden sm:block text-right text-xs text-muted tabular-nums">
        {track.version?.duration_sec ? formatDur(track.version.duration_sec) : "—"}
      </span>
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
