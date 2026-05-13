import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listMySaves,
  unsaveAlbum,
  unsaveTrack,
  type MySaveRow,
  type SavedAlbumItem,
  type SavedTrackItem,
} from "../lib/saves";
import { usePlayer } from "../lib/player";
import { supabase } from "../lib/supabase";
import { downloadAudio, safeFilename } from "../lib/audio";

export default function SavedPage() {
  const [items, setItems] = useState<MySaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [allowDownload, setAllowDownload] = useState<Record<string, boolean>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const play = usePlayer((s) => s.play);
  const setQueue = usePlayer((s) => s.setQueue);

  useEffect(() => {
    let cancel = false;
    listMySaves()
      .then(async (rows) => {
        if (cancel) return;
        setItems(rows);
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
      .catch((e) => !cancel && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, []);

  const onDownloadTrack = async (item: SavedTrackItem) => {
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
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingId(null);
    }
  };

  const trackRows = items.filter((r): r is Extract<MySaveRow, { save_type: "track" }> => r.save_type === "track");
  const albumRows = items.filter((r): r is Extract<MySaveRow, { save_type: "album" }> => r.save_type === "album");

  const playTrackItem = (item: SavedTrackItem) => {
    if (!item.share_signed_url || !item.version_id) return;
    const playableTracks = trackRows.filter((r) => r.item.share_signed_url && r.item.version_id);
    setQueue(
      playableTracks.map((r) => ({
        trackId: r.item.track_id,
        versionId: r.item.version_id!,
        title: r.item.track_title,
        albumTitle: r.item.album_title,
        audioUrl: "",
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

  const playAlbumFirstTrack = (album: SavedAlbumItem) => {
    if (!album.share_payload || album.share_payload.length === 0) return;
    const artistName = album.artist_name ?? null;
    const artworkUrl = album.album_artwork_url ?? null;
    setQueue(
      album.share_payload.map((t) => ({
        trackId: t.track_id,
        versionId: t.version_id,
        title: t.title,
        albumTitle: album.album_title,
        audioUrl: "",
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

  const onRemoveTrack = async (item: SavedTrackItem) => {
    if (!confirm(`Remove "${item.track_title}" from saved?`)) return;
    setItems((prev) => prev.filter((r) => !(r.save_type === "track" && r.item.track_id === item.track_id)));
    try { await unsaveTrack(item.track_id); } catch (e) { console.error(e); }
  };

  const onRemoveAlbum = async (item: SavedAlbumItem) => {
    if (!confirm(`Remove "${item.album_title}" from saved?`)) return;
    setItems((prev) => prev.filter((r) => !(r.save_type === "album" && r.item.album_id === item.album_id)));
    try { await unsaveAlbum(item.album_id); } catch (e) { console.error(e); }
  };

  if (loading) return <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 text-muted">Loading…</div>;
  if (err) return <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 text-red-400">{err}</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-5 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold text-white">Saved</h1>
        <p className="text-xs sm:text-sm text-muted mt-1">
          Tracks and albums you've saved from share links. Playback uses the original artist's link.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="bg-panel border border-dashed border-edge rounded-2xl py-16 text-center">
          <div className="text-4xl mb-3">♡</div>
          <h2 className="text-lg text-white">Nothing saved yet</h2>
          <p className="text-sm text-muted mt-1 max-w-md mx-auto">
            When another artist shares a track or album with you and you click <span className="text-white">Save</span>, it'll appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {albumRows.length > 0 && (
            <section>
              <h2 className="text-xs uppercase tracking-wider text-muted mb-3">Albums</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
                {albumRows.map((r) => (
                  <SavedAlbumCard
                    key={r.save_id}
                    item={r.item}
                    onPlay={() => playAlbumFirstTrack(r.item)}
                    onRemove={() => onRemoveAlbum(r.item)}
                  />
                ))}
              </div>
            </section>
          )}

          {trackRows.length > 0 && (
            <section>
              <h2 className="text-xs uppercase tracking-wider text-muted mb-3">Tracks</h2>
              <div className="bg-panel border border-edge rounded-2xl overflow-hidden">
                <ul className="divide-y divide-edge">
                  {trackRows.map((r) => (
                    <SavedTrackRow
                      key={r.save_id}
                      item={r.item}
                      canDownload={Boolean(allowDownload[r.item.track_id] && r.item.share_signed_url)}
                      downloading={downloadingId === r.item.track_id}
                      onPlay={() => playTrackItem(r.item)}
                      onDownload={() => onDownloadTrack(r.item)}
                      onRemove={() => onRemoveTrack(r.item)}
                    />
                  ))}
                </ul>
              </div>
            </section>
          )}
        </div>
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
      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden bg-gradient-to-br from-panel2 to-ink border border-edge flex items-center justify-center text-xl text-edge shrink-0">
        {item.album_artwork_url ? <img src={item.album_artwork_url} alt="" className="w-full h-full object-cover" /> : "♪"}
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
        <button onClick={onPlay} className="w-9 h-9 rounded-full bg-panel2 hover:bg-accent text-white flex items-center justify-center shrink-0" aria-label="Play">▶</button>
      ) : item.share_slug ? (
        <Link to={`/listen/${item.share_slug}`} className="text-xs text-muted hover:text-white shrink-0 px-2 py-1">Open</Link>
      ) : null}
      {accessible && canDownload && (
        <button
          onClick={onDownload}
          disabled={downloading}
          className="text-xs text-muted hover:text-white shrink-0 px-2 py-1 disabled:opacity-60"
          aria-label="Download audio"
          title="Download audio file"
        >
          <span className="hidden sm:inline">{downloading ? "…" : "⬇ Download"}</span>
          <span className="sm:hidden">{downloading ? "…" : "⬇"}</span>
        </button>
      )}
      <button onClick={onRemove} className="text-xs text-muted hover:text-red-400 shrink-0 px-2 py-1" aria-label="Remove">
        <span className="hidden sm:inline">Remove</span>
        <span className="sm:hidden">✕</span>
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
      <div className="relative aspect-square bg-gradient-to-br from-panel2 to-ink flex items-center justify-center text-4xl text-edge">
        {item.album_artwork_url ? (
          <img src={item.album_artwork_url} alt="" className="w-full h-full object-cover" />
        ) : (
          "♪"
        )}
        {accessible && (
          <button
            onClick={onPlay}
            className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition"
            aria-label="Play album"
          >
            ▶
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
