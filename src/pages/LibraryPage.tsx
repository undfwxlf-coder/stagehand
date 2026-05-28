import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useLibraryStore } from "../lib/library";
import {
  listMySaves,
  unsaveAlbum,
  unsaveTrack,
  type MySaveRow,
  type SavedAlbumItem,
  type SavedTrackItem,
} from "../lib/saves";
import { usePlayer } from "../lib/player";
import { downloadAudio, safeFilename } from "../lib/audio";
import { formatErr } from "../lib/errors";
import type { Album, AlbumStatus } from "../lib/database.types";
import { Download, Music, Play, X } from "lucide-react";

const STATUS_COLORS: Record<AlbumStatus, string> = {
  writing: "bg-slate-500/20 text-slate-300",
  recording: "bg-blue-500/20 text-blue-300",
  mixing: "bg-purple-500/20 text-purple-300",
  mastering: "bg-amber-500/20 text-amber-300",
  released: "bg-emerald-500/20 text-emerald-300",
};

export default function LibraryPage() {
  const { user } = useAuth();
  const albums = useLibraryStore((s) => s.albums);
  const collabs = useLibraryStore((s) => s.collabs);
  const loaded = useLibraryStore((s) => s.loaded);
  const refreshing = useLibraryStore((s) => s.refreshing);
  const loadLibrary = useLibraryStore((s) => s.load);
  const prependAlbum = useLibraryStore((s) => s.prepend);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const [saves, setSaves] = useState<MySaveRow[]>([]);
  const [allowDownload, setAllowDownload] = useState<Record<string, boolean>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const play = usePlayer((s) => s.play);
  const setQueue = usePlayer((s) => s.setQueue);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    let cancel = false;
    listMySaves()
      .then(async (rows) => {
        if (cancel) return;
        setSaves(rows);
        const trackIds = rows
          .filter((r): r is Extract<MySaveRow, { save_type: "track" }> => r.save_type === "track")
          .map((r) => r.item.track_id);
        if (trackIds.length === 0) return;
        const { data } = await supabase.from("tracks").select("id, allow_download").in("id", trackIds);
        if (cancel || !data) return;
        const map: Record<string, boolean> = {};
        for (const row of data as { id: string; allow_download: boolean }[]) {
          map[row.id] = row.allow_download;
        }
        setAllowDownload(map);
      })
      .catch((e) => console.warn("[library] saves load failed", formatErr(e)));
    return () => { cancel = true; };
  }, []);

  const loading = !loaded && refreshing;

  const savedAlbums = saves.filter((r): r is Extract<MySaveRow, { save_type: "album" }> => r.save_type === "album");
  const savedTracks = saves.filter((r): r is Extract<MySaveRow, { save_type: "track" }> => r.save_type === "track");

  const createAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !user) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("albums")
      .insert({ owner_id: user.id, title: newTitle.trim() })
      .select()
      .single();
    setCreating(false);
    if (error) {
      alert(error.message);
      return;
    }
    prependAlbum(data as Album);
    setNewTitle("");
    setShowNew(false);
  };

  const playSavedTrack = (item: SavedTrackItem) => {
    if (!item.share_signed_url || !item.version_id) return;
    const playable = savedTracks.filter((r) => r.item.share_signed_url && r.item.version_id);
    setQueue(
      playable.map((r) => ({
        trackId: r.item.track_id,
        versionId: r.item.version_id!,
        title: r.item.track_title,
        albumTitle: r.item.album_title,
        audioUrl: r.item.share_signed_url!,
        peaks: r.item.version_peaks,
        duration: r.item.version_duration_sec,
        artistName: r.item.artist_name ?? null,
        artworkUrl: r.item.album_artwork_url ?? null,
      }))
    );
    play({
      trackId: item.track_id,
      versionId: item.version_id,
      title: item.track_title,
      albumTitle: item.album_title,
      audioUrl: item.share_signed_url,
      peaks: item.version_peaks,
      duration: item.version_duration_sec,
      artistName: item.artist_name ?? null,
      artworkUrl: item.album_artwork_url ?? null,
    });
  };

  const playSavedAlbum = (album: SavedAlbumItem) => {
    if (!album.share_payload || album.share_payload.length === 0) return;
    const artistName = album.artist_name ?? null;
    const artworkUrl = album.album_artwork_url ?? null;
    setQueue(
      album.share_payload.map((t) => ({
        trackId: t.track_id,
        versionId: t.version_id,
        title: t.title,
        albumTitle: album.album_title,
        audioUrl: t.signed_url,
        peaks: t.peaks,
        duration: t.duration_sec,
        artistName,
        artworkUrl,
      }))
    );
    const first = album.share_payload[0];
    play({
      trackId: first.track_id,
      versionId: first.version_id,
      title: first.title,
      albumTitle: album.album_title,
      audioUrl: first.signed_url,
      peaks: first.peaks,
      duration: first.duration_sec,
      artistName,
      artworkUrl,
    });
  };

  const onDownloadSavedTrack = async (item: SavedTrackItem) => {
    if (!item.share_signed_url) return;
    setDownloadingId(item.track_id);
    try {
      let ext = "wav";
      try {
        const pathname = new URL(item.share_signed_url).pathname;
        ext = (pathname.split(".").pop() || "wav").toLowerCase();
      } catch { /* keep default */ }
      const label = item.version_label ? ` - ${safeFilename(item.version_label)}` : "";
      const filename = `${safeFilename(item.track_title)}${label}.${ext}`;
      await downloadAudio(item.share_signed_url, filename);
    } catch (e) {
      console.error("[saved-download] failed", e);
      alert(formatErr(e));
    } finally {
      setDownloadingId(null);
    }
  };

  const onRemoveSavedTrack = async (item: SavedTrackItem) => {
    if (!confirm(`Remove "${item.track_title}" from saved?`)) return;
    setSaves((prev) => prev.filter((r) => !(r.save_type === "track" && r.item.track_id === item.track_id)));
    try { await unsaveTrack(item.track_id); } catch (e) { console.error(e); }
  };

  const onRemoveSavedAlbum = async (item: SavedAlbumItem) => {
    if (!confirm(`Remove "${item.album_title}" from saved?`)) return;
    setSaves((prev) => prev.filter((r) => !(r.save_type === "album" && r.item.album_id === item.album_id)));
    try { await unsaveAlbum(item.album_id); } catch (e) { console.error(e); }
  };

  const hasAnything = albums.length > 0 || collabs.length > 0 || saves.length > 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex items-end justify-between gap-3 mb-5 sm:mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-white">Your library</h1>
          <p className="text-xs sm:text-sm text-muted mt-1">Albums and EPs you're working on.</p>
        </div>
        <button
          onClick={() => setShowNew((v) => !v)}
          className="bg-accent hover:bg-accent/90 text-white text-sm font-medium px-3 sm:px-4 py-2 rounded-lg transition shrink-0"
        >
          <span className="hidden sm:inline">+ New album</span>
          <span className="sm:hidden">+ New</span>
        </button>
      </div>

      {showNew && (
        <form onSubmit={createAlbum} className="bg-panel border border-edge rounded-xl p-3 sm:p-4 mb-6 flex flex-wrap gap-2 sm:gap-3">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Album title"
            className="flex-1 min-w-0 bg-ink border border-edge focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-white placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={creating}
            className="bg-accent hover:bg-accent/90 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setShowNew(false)}
            className="text-muted hover:text-white text-sm px-3 py-2"
          >
            Cancel
          </button>
        </form>
      )}

      {loading ? (
        <SkeletonGrid />
      ) : !hasAnything ? (
        <EmptyState onCreate={() => setShowNew(true)} />
      ) : (
        <>
          {albums.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
              {albums.map((a) => (
                <Link
                  key={a.id}
                  to={`/album/${a.id}`}
                  className="group bg-panel border border-edge rounded-xl overflow-hidden hover:border-accent/60 transition-[transform,border-color] duration-150 ease-out hover:-translate-y-0.5 active:scale-[0.97] active:duration-100"
                >
                  <div className="aspect-square bg-gradient-to-br from-panel2 to-ink flex items-center justify-center text-edge group-hover:text-muted transition">
                    {a.artwork_url ? (
                      <img src={a.artwork_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Music size={40} strokeWidth={1.2} />
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-sm text-white truncate">{a.title}</div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_COLORS[a.status]}`}>
                        {a.status}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {collabs.length > 0 && (
            <div className={albums.length > 0 ? "mt-10" : ""}>
              <h2 className="text-sm sm:text-base font-medium text-white mb-3">Shared with me</h2>
              <p className="text-xs text-muted mb-4">Projects you're a collaborator on.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
                {collabs.map((a) => (
                  <Link
                    key={a.id}
                    to={`/album/${a.id}`}
                    className="group bg-panel border border-edge rounded-xl overflow-hidden hover:border-accent/60 transition-[transform,border-color] duration-150 ease-out hover:-translate-y-0.5 active:scale-[0.97] active:duration-100 relative"
                  >
                    <span className="absolute top-2 right-2 z-10 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/70 text-white/90 backdrop-blur">
                      Editor
                    </span>
                    <div className="aspect-square bg-gradient-to-br from-panel2 to-ink flex items-center justify-center text-edge group-hover:text-muted transition">
                      {a.artwork_url ? (
                        <img src={a.artwork_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Music size={40} strokeWidth={1.2} />
                      )}
                    </div>
                    <div className="p-3">
                      <div className="text-sm text-white truncate">{a.title}</div>
                      <div className="mt-1.5 flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-muted truncate">
                          {a.owner_artist_name ?? "Unknown artist"}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {savedAlbums.length > 0 && (
            <div className={albums.length > 0 || collabs.length > 0 ? "mt-10" : ""}>
              <h2 className="text-sm sm:text-base font-medium text-white mb-3">Saved albums</h2>
              <p className="text-xs text-muted mb-4">Albums shared with you that you've saved.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
                {savedAlbums.map((r) => (
                  <SavedAlbumCard
                    key={r.save_id}
                    item={r.item}
                    onPlay={() => playSavedAlbum(r.item)}
                    onRemove={() => onRemoveSavedAlbum(r.item)}
                  />
                ))}
              </div>
            </div>
          )}

          {savedTracks.length > 0 && (
            <div className={albums.length > 0 || collabs.length > 0 || savedAlbums.length > 0 ? "mt-10" : ""}>
              <h2 className="text-sm sm:text-base font-medium text-white mb-3">Saved tracks</h2>
              <p className="text-xs text-muted mb-4">Individual tracks shared with you that you've saved.</p>
              <div className="bg-panel border border-edge rounded-2xl overflow-hidden">
                <ul className="divide-y divide-edge">
                  {savedTracks.map((r) => (
                    <SavedTrackRow
                      key={r.save_id}
                      item={r.item}
                      canDownload={Boolean(allowDownload[r.item.track_id] && r.item.share_signed_url)}
                      downloading={downloadingId === r.item.track_id}
                      onPlay={() => playSavedTrack(r.item)}
                      onDownload={() => onDownloadSavedTrack(r.item)}
                      onRemove={() => onRemoveSavedTrack(r.item)}
                    />
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function statusReason(s: { share_revoked?: boolean | null; share_expires_at?: string | null; share_visibility?: string | null }): string | null {
  if (s.share_revoked) return "Revoked by artist";
  if (s.share_expires_at && new Date(s.share_expires_at) < new Date()) return "Link expired";
  if (s.share_visibility === "disabled") return "Sharing disabled";
  return null;
}

function SavedTrackRow({
  item,
  canDownload,
  downloading,
  onPlay,
  onDownload,
  onRemove,
}: {
  item: SavedTrackItem;
  canDownload: boolean;
  downloading: boolean;
  onPlay: () => void;
  onDownload: () => void;
  onRemove: () => void;
}) {
  const accessible = Boolean(item.share_signed_url && item.version_id);
  const reason = !accessible ? statusReason(item) ?? "No longer available" : null;
  return (
    <li className="px-3 sm:px-5 py-3 flex items-center gap-3 sm:gap-4">
      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden bg-gradient-to-br from-panel2 to-ink border border-edge flex items-center justify-center text-edge shrink-0">
        {item.album_artwork_url ? <img src={item.album_artwork_url} alt="" className="w-full h-full object-cover" /> : <Music size={20} strokeWidth={1.4} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">{item.track_title}</div>
        <div className="text-xs text-muted truncate">
          {item.artist_name?.trim() || "Unknown artist"} · {item.album_title}
          {item.track_bpm != null && <span> · {item.track_bpm} BPM</span>}
          {item.track_song_key && <span> · {item.track_song_key}</span>}
        </div>
        {reason && <div className="text-xs text-amber-400/80 mt-0.5">{reason}</div>}
      </div>
      {accessible ? (
        <button onClick={onPlay} className="w-9 h-9 rounded-full bg-panel2 hover:bg-accent text-white flex items-center justify-center shrink-0" aria-label="Play">
          <Play size={14} fill="currentColor" className="translate-x-[1px]" />
        </button>
      ) : item.share_slug ? (
        <Link to={`/listen/${item.share_slug}`} className="text-xs text-muted hover:text-white shrink-0 px-2 py-1">Open</Link>
      ) : null}
      {accessible && canDownload && (
        <button
          onClick={onDownload}
          disabled={downloading}
          className="text-xs text-muted hover:text-white shrink-0 px-2 py-1 disabled:opacity-60 flex items-center gap-1.5"
          aria-label="Download audio"
          title="Download audio file"
        >
          <Download size={14} />
          <span className="hidden sm:inline">{downloading ? "…" : "Download"}</span>
        </button>
      )}
      <button onClick={onRemove} className="text-xs text-muted hover:text-red-400 shrink-0 px-2 py-1 flex items-center gap-1.5" aria-label="Remove">
        <X size={14} />
        <span className="hidden sm:inline">Remove</span>
      </button>
    </li>
  );
}

function SavedAlbumCard({ item, onPlay, onRemove }: { item: SavedAlbumItem; onPlay: () => void; onRemove: () => void }) {
  const trackCount = item.share_payload?.length ?? 0;
  const accessible = Boolean(item.share_payload && item.share_payload.length > 0);
  const reason = !accessible ? statusReason(item) ?? "No longer available" : null;
  return (
    <div className="group bg-panel border border-edge rounded-xl overflow-hidden hover:border-accent/60 transition flex flex-col">
      <div className="relative aspect-square bg-gradient-to-br from-panel2 to-ink flex items-center justify-center text-edge">
        {item.album_artwork_url ? (
          <img src={item.album_artwork_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <Music size={40} strokeWidth={1.2} />
        )}
        {accessible && (
          <button
            onClick={onPlay}
            className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition"
            aria-label="Play album"
          >
            <Play size={16} fill="currentColor" className="translate-x-[1px]" />
          </button>
        )}
      </div>
      <div className="p-3 flex-1 flex flex-col">
        <div className="text-sm text-white truncate">{item.album_title}</div>
        <div className="text-xs text-muted truncate">
          {item.artist_name?.trim() || "Unknown artist"}
          {trackCount > 0 && <span> · {trackCount} tracks</span>}
        </div>
        {reason ? (
          <div className="text-xs text-amber-400/80 mt-1.5 truncate">{reason}</div>
        ) : (
          <div className="mt-1.5 flex items-center gap-2 text-xs">
            {item.share_slug && (
              <Link to={`/listen/${item.share_slug}`} className="text-muted hover:text-white">Open</Link>
            )}
            <span className="flex-1" />
            <button onClick={onRemove} className="text-muted hover:text-red-400">Remove</button>
          </div>
        )}
        {reason && (
          <div className="mt-1.5 flex items-center justify-between text-xs">
            {item.share_slug && (
              <Link to={`/listen/${item.share_slug}`} className="text-muted hover:text-white">Open</Link>
            )}
            <button onClick={onRemove} className="text-muted hover:text-red-400">Remove</button>
          </div>
        )}
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="bg-panel border border-edge rounded-xl overflow-hidden animate-pulse">
          <div className="aspect-square bg-panel2" />
          <div className="p-3 space-y-2">
            <div className="h-3 bg-panel2 rounded w-3/4" />
            <div className="h-2 bg-panel2 rounded w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="bg-panel border border-dashed border-edge rounded-2xl py-20 text-center">
      <Music size={48} strokeWidth={1.2} className="mx-auto mb-3 text-muted" />
      <h2 className="text-lg text-white">No albums yet</h2>
      <p className="text-sm text-muted mt-1 mb-5">Start a new project to track your songs and stash demos.</p>
      <button
        onClick={onCreate}
        className="bg-accent hover:bg-accent/90 text-white text-sm font-medium px-5 py-2.5 rounded-lg"
      >
        Create your first album
      </button>
    </div>
  );
}
