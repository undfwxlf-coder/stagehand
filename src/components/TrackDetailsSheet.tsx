import { useCallback, useEffect, useRef, useState } from "react";
import type { CollabArtist, Track, Version, ShareLink } from "../lib/database.types";
import { listShareLinks, shareUrlFor } from "../lib/share";
import { supabase } from "../lib/supabase";
import { downloadAudio, getSignedAudioUrl, safeFilename } from "../lib/audio";
import { setTrackCollabArtists } from "../lib/credit";
import { usePlayer } from "../lib/player";
import ShareModal from "./ShareModal";
import InsightsPanel from "./InsightsPanel";

type View = "main" | "insights" | "notes";

interface TrackDetailsSheetProps {
  track: Track;
  version: Version | null;
  albumTitle: string;
  albumArtworkUrl: string | null;
  albumCollabArtists: CollabArtist[];
  artistName: string | null;
  ownerId: string;
  onClose: () => void;
  onTrackChange: (patch: Partial<Track>) => void;
  onRequestReplaceAudio?: () => void;
  onDeleted?: () => void;
}

export default function TrackDetailsSheet({
  track,
  version,
  albumTitle,
  albumArtworkUrl,
  albumCollabArtists,
  artistName,
  ownerId,
  onClose,
  onTrackChange,
  onRequestReplaceAudio,
  onDeleted,
}: TrackDetailsSheetProps) {
  const play = usePlayer((s) => s.play);
  const setQueue = usePlayer((s) => s.setQueue);
  const currentQueue = usePlayer((s) => s.queue);

  const [view, setView] = useState<View>("main");
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Notes state
  const [notes, setNotes] = useState(track.notes ?? "");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);

  // Per-track collab artist override. null on the row = inherit from album;
  // a non-null array (even []) = use the track's own list.
  const overrideOn = track.collab_artists != null;
  const [collabErr, setCollabErr] = useState<string | null>(null);
  const persistTrackCollab = useCallback(async (next: CollabArtist[] | null) => {
    const prev = track.collab_artists;
    setCollabErr(null);
    onTrackChange({ collab_artists: next });
    try {
      const saved = await setTrackCollabArtists(track.id, next);
      onTrackChange({ collab_artists: saved });
    } catch (e) {
      onTrackChange({ collab_artists: prev });
      setCollabErr((e as Error)?.message ?? "Couldn't save");
    }
  }, [track.id, track.collab_artists, onTrackChange]);

  useEffect(() => { setNotes(track.notes ?? ""); setNotesDirty(false); }, [track.id, track.notes]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (view !== "main") setView("main");
      else onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, view]);

  useEffect(() => {
    let cancel = false;
    listShareLinks(track.id)
      .then((rows) => !cancel && setLinks(rows))
      .catch(() => { /* silent */ });
    return () => { cancel = true; };
  }, [track.id]);

  const activeLink = links.find((l) => !l.revoked) ?? null;
  const status: "public" | "invite" | "disabled" | "none" = activeLink
    ? (activeLink.visibility === "link" ? "public" : activeLink.visibility)
    : "none";

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const onCopy = async () => {
    if (!activeLink) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(shareUrlFor(activeLink.slug));
      showToast("Link copied");
    } catch {
      showToast("Couldn't copy");
    } finally {
      setCopying(false);
    }
  };

  const onToggleDownloads = async () => {
    const next = !track.allow_download;
    onTrackChange({ allow_download: next });
    const { error } = await supabase
      .from("tracks")
      .update({ allow_download: next })
      .eq("id", track.id);
    if (error) {
      onTrackChange({ allow_download: !next });
      showToast(error.message);
    } else {
      showToast(next ? "Downloads enabled" : "Downloads disabled");
    }
  };

  const onToggleSingle = async () => {
    const next = !track.is_single;
    onTrackChange({ is_single: next });
    const { error } = await supabase
      .from("tracks")
      .update({ is_single: next })
      .eq("id", track.id);
    if (error) {
      onTrackChange({ is_single: !next });
      showToast(error.message);
    } else {
      showToast(next ? "Marked as single" : "Single tag removed");
    }
  };

  const singleCoverInputRef = useRef<HTMLInputElement>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const onUploadSingleCover = async (file: File) => {
    setCoverBusy(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${ownerId}/track/${track.id}/single-cover-${Date.now()}.${ext}`;
      const up = await supabase.storage.from("artwork").upload(path, file, {
        contentType: file.type || "image/jpeg",
        upsert: true,
      });
      if (up.error) throw up.error;
      const { data } = supabase.storage.from("artwork").getPublicUrl(path);
      const url = data.publicUrl;
      const { error } = await supabase
        .from("tracks")
        .update({ single_cover_url: url })
        .eq("id", track.id);
      if (error) throw error;
      onTrackChange({ single_cover_url: url });
      showToast("Single cover updated");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setCoverBusy(false);
      if (singleCoverInputRef.current) singleCoverInputRef.current.value = "";
    }
  };

  const onAddToQueue = async () => {
    if (!version) return;
    setQueueBusy(true);
    try {
      const url = await getSignedAudioUrl(version.storage_path);
      const queueItem = {
        trackId: track.id,
        versionId: version.id,
        title: track.title,
        albumTitle,
        audioUrl: url,
        peaks: version.peaks,
        duration: version.duration_sec,
        artistName,
        artworkUrl: (track.is_single && track.single_cover_url) || albumArtworkUrl,
      };
      if (currentQueue.length === 0) {
        setQueue([queueItem]);
        play(queueItem);
      } else {
        setQueue([...currentQueue, queueItem]);
        showToast("Added to queue");
      }
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed");
    } finally {
      setQueueBusy(false);
    }
  };

  const onExportAudio = async () => {
    if (!version) return;
    setDownloadBusy(true);
    try {
      const url = await getSignedAudioUrl(version.storage_path);
      const ext = (version.storage_path.split(".").pop() || "wav").toLowerCase();
      const filename = `${safeFilename(track.title)} - ${safeFilename(version.label)}.${ext}`;
      await downloadAudio(url, filename);
      showToast("Downloaded");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed");
    } finally {
      setDownloadBusy(false);
    }
  };

  const saveNotes = async () => {
    if (!notesDirty) return;
    setNotesSaving(true);
    const { error } = await supabase.from("tracks").update({ notes }).eq("id", track.id);
    setNotesSaving(false);
    if (error) {
      showToast(error.message);
    } else {
      onTrackChange({ notes });
      setNotesDirty(false);
    }
  };

  const openManageSharing = () => setShareOpen(true);

  const deleteTrack = async () => {
    const ok = window.confirm(
      `Delete "${track.title}"? This permanently removes the track, every version, and any share links. This cannot be undone.`
    );
    if (!ok) return;
    const { error } = await supabase.from("tracks").delete().eq("id", track.id);
    if (error) {
      showToast(error.message);
      return;
    }
    onDeleted?.();
    onClose();
  };

  const sheetRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Track details"
        className="fixed inset-x-0 bottom-0 z-50 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-6"
      >
        <div
          className="bg-panel border-t sm:border border-edge rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto shadow-2xl"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sm:hidden flex justify-center pt-2.5 pb-1">
            <div className="w-9 h-1 rounded-full bg-edge" />
          </div>

          {/* Header: back arrow in sub-views, artwork+title in main */}
          {view === "main" ? (
            <div className="px-5 pt-3 sm:pt-5 pb-4 flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-panel2 to-ink border border-edge overflow-hidden flex items-center justify-center text-edge text-xl shrink-0">
                {albumArtworkUrl ? <img src={albumArtworkUrl} alt="" className="w-full h-full object-cover" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white truncate">{track.title}</div>
                <div className="text-xs text-muted truncate">
                  {artistName ? `${artistName} · ` : ""}{albumTitle}
                  {track.bpm != null && <> · {track.bpm} BPM</>}
                  {track.song_key && <> · {track.song_key}</>}
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-8 h-8 rounded-full text-muted hover:text-white hover:bg-panel2 flex items-center justify-center shrink-0"
              >
                <CloseIcon />
              </button>
            </div>
          ) : (
            <div className="px-3 pt-3 sm:pt-4 pb-3 flex items-center gap-1">
              <button
                onClick={() => { if (view === "notes") saveNotes(); setView("main"); }}
                aria-label="Back"
                className="w-9 h-9 rounded-full text-muted hover:text-white hover:bg-panel2 flex items-center justify-center"
              >
                <BackIcon />
              </button>
              <div className="text-sm font-medium text-white">
                {view === "insights" ? "Insights" : "Notes"}
              </div>
              <div className="ml-auto pr-2 text-xs text-muted truncate max-w-[40%]">{track.title}</div>
            </div>
          )}

          {/* Main view */}
          {view === "main" && (
            <>
              <div className="mx-4 mb-3 rounded-xl bg-panel2 border border-edge px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">Track sharing</div>
                  <div className="text-xs text-muted mt-0.5 flex items-center gap-1.5">
                    <StatusDot status={status} />
                    <span>{statusLabel(status)}</span>
                  </div>
                </div>
                {activeLink ? (
                  <button
                    onClick={onCopy}
                    disabled={copying}
                    className="text-sm bg-ink hover:bg-edge text-white px-3 py-1.5 rounded-lg border border-edge disabled:opacity-60"
                  >
                    {copying ? "…" : "Copy link"}
                  </button>
                ) : (
                  <button
                    onClick={openManageSharing}
                    className="text-sm bg-accent hover:bg-accent/90 text-white px-3 py-1.5 rounded-lg"
                  >
                    Share
                  </button>
                )}
              </div>

              <div className="mx-4 mb-3 rounded-xl bg-panel2 border border-edge overflow-hidden divide-y divide-edge">
                <ActionRow
                  icon={<ReplaceIcon />}
                  label="Replace audio"
                  disabled={!onRequestReplaceAudio}
                  onClick={() => { onClose(); onRequestReplaceAudio?.(); }}
                />
                <ActionRow icon={<InsightsIcon />} label="Insights" onClick={() => setView("insights")} />
                <ActionRow icon={<NotesIcon />} label="Notes" onClick={() => setView("notes")} />
                <ToggleRow
                  icon={<SingleIcon />}
                  label="Mark as single"
                  active={track.is_single}
                  onClick={onToggleSingle}
                />
                {track.is_single && (
                  <ActionRow
                    icon={<ImageIcon />}
                    label={coverBusy ? "Uploading…" : track.single_cover_url ? "Change single cover" : "Add single cover"}
                    disabled={coverBusy}
                    onClick={() => singleCoverInputRef.current?.click()}
                  />
                )}
                <ActionRow
                  icon={<DownloadIcon />}
                  label={track.allow_download ? "Disable downloads" : "Allow downloads"}
                  onClick={onToggleDownloads}
                />
                <ActionRow
                  icon={<QueueIcon />}
                  label="Add to queue"
                  disabled={!version || queueBusy}
                  onClick={onAddToQueue}
                />
                <ActionRow
                  icon={<ExportIcon />}
                  label={downloadBusy ? "Exporting…" : "Export audio"}
                  disabled={!version || downloadBusy}
                  onClick={onExportAudio}
                />
                <ActionRow
                  icon={<TrashIcon />}
                  label="Delete track"
                  onClick={deleteTrack}
                  destructive
                />
              </div>
              <input
                ref={singleCoverInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadSingleCover(f);
                }}
              />

              <TrackCollabSection
                albumCollabArtists={albumCollabArtists}
                overrideOn={overrideOn}
                trackCollabArtists={track.collab_artists ?? null}
                onSetOverride={(on) => persistTrackCollab(on ? (track.collab_artists ?? []) : null)}
                onChange={persistTrackCollab}
                error={collabErr}
              />

              {activeLink && (
                <div className="mx-4 mb-4">
                  <button
                    onClick={openManageSharing}
                    className="w-full text-sm text-muted hover:text-white px-4 py-2.5 rounded-xl border border-edge hover:border-accent/60 transition"
                  >
                    Manage sharing…
                  </button>
                </div>
              )}

              {toast && (
                <div className="mx-4 mb-4 text-xs text-center text-muted">{toast}</div>
              )}
            </>
          )}

          {/* Insights view */}
          {view === "insights" && (
            <div className="px-4 pb-4">
              <InsightsPanel trackId={track.id} ownerId={ownerId} />
            </div>
          )}

          {/* Notes view */}
          {view === "notes" && (
            <div className="px-4 pb-5">
              <div className="flex items-center justify-end mb-2">
                <button
                  onClick={saveNotes}
                  disabled={notesSaving || !notesDirty}
                  className="text-xs text-muted hover:text-white disabled:opacity-50"
                >
                  {notesSaving ? "Saving…" : notesDirty ? "Save" : "Saved"}
                </button>
              </div>
              <textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
                onBlur={saveNotes}
                rows={10}
                placeholder="Lyrics, ideas, things to fix on the next take…"
                className="w-full bg-ink border border-edge focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-white placeholder:text-muted text-sm"
              />
            </div>
          )}
        </div>
      </div>

      {shareOpen && version && (
        <ShareModal
          track={track}
          version={version}
          albumArtworkUrl={albumArtworkUrl}
          onTrackChange={onTrackChange}
          onClose={() => {
            setShareOpen(false);
            listShareLinks(track.id).then(setLinks).catch(() => { /* silent */ });
          }}
        />
      )}
    </>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
  disabled,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-edge/40 active:bg-edge/60 disabled:opacity-40 disabled:cursor-not-allowed transition ${
        destructive ? "text-red-400" : "text-white"
      }`}
    >
      <span className={`w-6 h-6 flex items-center justify-center shrink-0 ${destructive ? "text-red-400" : "text-muted"}`}>{icon}</span>
      <span className="text-sm flex-1">{label}</span>
      {!destructive && <ChevronIcon />}
    </button>
  );
}

function StatusDot({ status }: { status: "public" | "invite" | "disabled" | "none" }) {
  const color =
    status === "public" ? "bg-emerald-400" :
    status === "invite" ? "bg-amber-400" :
    status === "disabled" ? "bg-red-400" :
    "bg-muted/50";
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />;
}

function statusLabel(status: "public" | "invite" | "disabled" | "none"): string {
  switch (status) {
    case "public": return "Anyone with the link";
    case "invite": return "Invite only";
    case "disabled": return "Sharing disabled";
    case "none": return "Not shared";
  }
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M10 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-muted/60 shrink-0">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReplaceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 5h7l-2-2M13 11H6l2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InsightsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="9" width="2.5" height="5" rx="0.5" fill="currentColor" />
      <rect x="6.75" y="6" width="2.5" height="8" rx="0.5" fill="currentColor" />
      <rect x="11.5" y="3" width="2.5" height="11" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function NotesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="2.5" width="10" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 4.5h8M2.5 8h8M2.5 11.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11.5 10.5v4l3-2-3-2z" fill="currentColor" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 4h10M5.5 4V2.5h5V4M4 4l.75 9a1 1 0 001 .9h4.5a1 1 0 001-.9L12 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 10V2m0 0L5 5m3-3l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 10v3.5h11V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function SingleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="5.5" cy="6" r="1" fill="currentColor" />
      <path d="M2.5 11L6 8l3 3 2-2 2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ToggleRow({
  icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full px-4 py-3.5 flex items-center gap-3 text-left text-white hover:bg-edge/40 active:bg-edge/60 disabled:opacity-40 disabled:cursor-not-allowed transition"
    >
      <span className="w-6 h-6 flex items-center justify-center shrink-0 text-muted">{icon}</span>
      <span className="text-sm flex-1">{label}</span>
      <span
        className={`inline-flex h-5 w-9 shrink-0 rounded-full border transition relative ${
          active ? "bg-accent border-accent" : "bg-panel border-edge"
        }`}
        aria-hidden
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition ${
            active ? "right-0.5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function TrackCollabSection({
  albumCollabArtists,
  overrideOn,
  trackCollabArtists,
  onSetOverride,
  onChange,
  error,
}: {
  albumCollabArtists: CollabArtist[];
  overrideOn: boolean;
  trackCollabArtists: CollabArtist[] | null;
  onSetOverride: (on: boolean) => void;
  onChange: (next: CollabArtist[]) => void;
  error: string | null;
}) {
  const [draft, setDraft] = useState("");
  const list = trackCollabArtists ?? [];
  const inheritDisplay = albumCollabArtists
    .map((c) => c.name)
    .filter(Boolean)
    .join(", ");
  const submit = () => {
    const name = draft.trim();
    if (!name) return;
    onChange([...list, { name }]);
    setDraft("");
  };
  const removeAt = (idx: number) => onChange(list.filter((_, i) => i !== idx));
  return (
    <div className="mx-4 mb-3 rounded-xl bg-panel2 border border-edge overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3 border-b border-edge">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white">Override album credits</div>
          <div className="text-xs text-muted mt-0.5 truncate">
            {overrideOn
              ? "Listeners see only the credits below for this track."
              : inheritDisplay
                ? `Inherits: feat. ${inheritDisplay}`
                : "Inherits from album (no extra credits)."}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={overrideOn}
          onClick={() => onSetOverride(!overrideOn)}
          className={`inline-flex h-5 w-9 shrink-0 rounded-full border transition relative ${
            overrideOn ? "bg-accent border-accent" : "bg-panel border-edge"
          }`}
        >
          <span
            className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition ${
              overrideOn ? "right-0.5" : "left-0.5"
            }`}
          />
        </button>
      </div>
      {overrideOn && (
        <div className="px-3 pt-2.5 pb-3">
          {list.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 pb-2">
              {list.map((c, i) => (
                <li
                  key={c.user_id ? `u:${c.user_id}` : `n:${c.name}:${i}`}
                  className={`inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full text-[12px] ${
                    c.user_id
                      ? "bg-accent/15 text-accent border border-accent/30"
                      : "bg-ink text-white/75 border border-edge"
                  }`}
                >
                  <span className="max-w-[120px] truncate">{c.name}</span>
                  <button
                    onClick={() => removeAt(i)}
                    className="w-4 h-4 rounded-full hover:bg-white/10 flex items-center justify-center"
                    aria-label={`Remove ${c.name}`}
                  >
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(e) => { e.preventDefault(); submit(); }}
            className="flex gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Featured artist name"
              className="flex-1 min-w-0 bg-ink border border-edge focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-[13px] text-white placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={draft.trim().length === 0}
              className="shrink-0 bg-edge hover:bg-edge/70 disabled:opacity-40 text-white text-[13px] font-medium px-3 rounded-lg"
            >
              Add
            </button>
          </form>
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        </div>
      )}
    </div>
  );
}
