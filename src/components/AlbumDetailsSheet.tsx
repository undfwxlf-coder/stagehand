import { useEffect, useRef, useState } from "react";
import { ChevronRight, Disc3, ImagePlus, Pencil, Trash2, X } from "lucide-react";
import type { Album, ShareLink } from "../lib/database.types";
import { listAlbumShareLinks, shareUrlFor } from "../lib/share";
import { supabase } from "../lib/supabase";
import { formatErr } from "../lib/errors";
import AlbumShareModal from "./AlbumShareModal";

interface AlbumDetailsSheetProps {
  album: Album;
  artistName: string | null;
  trackCount: number;
  isOwner: boolean;
  onClose: () => void;
  onRequestChangeCover: () => void;
  onRequestRename: () => void;
  onDeleted: () => void;
  onAlbumChange?: (patch: Partial<Album>) => void;
}

export default function AlbumDetailsSheet({
  album,
  artistName,
  trackCount,
  isOwner,
  onClose,
  onRequestChangeCover,
  onRequestRename,
  onDeleted,
  onAlbumChange,
}: AlbumDetailsSheetProps) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    let cancel = false;
    listAlbumShareLinks(album.id)
      .then((rows) => !cancel && setLinks(rows))
      .catch(() => { /* silent */ });
    return () => { cancel = true; };
  }, [album.id]);

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

  const openManageSharing = () => setShareOpen(true);

  const toggleSingle = async () => {
    const next = !album.is_single;
    const { error } = await supabase.from("albums").update({ is_single: next }).eq("id", album.id);
    if (error) {
      showToast(formatErr(error));
      return;
    }
    // Local optimistic update — propagate via onAlbumChange so AlbumPage +
    // library cache pick it up immediately.
    onAlbumChange?.({ is_single: next });
    showToast(next ? "Marked as single" : "Single tag removed");
  };

  const deleteAlbum = async () => {
    const ok = window.confirm(
      `Delete "${album.title}"? This permanently removes the project, every track in it, and any share links. This cannot be undone.`
    );
    if (!ok) return;
    const { error } = await supabase.from("albums").delete().eq("id", album.id);
    if (error) {
      showToast(formatErr(error));
      return;
    }
    onDeleted();
    onClose();
  };

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
        aria-label="Album details"
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

          <div className="px-5 pt-3 sm:pt-5 pb-4 flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-panel2 to-ink border border-edge overflow-hidden flex items-center justify-center text-edge text-xl shrink-0">
              {album.artwork_url ? (
                <img src={album.artwork_url} alt="" className="w-full h-full object-cover" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-white truncate">{album.title}</div>
              <div className="text-xs text-muted truncate">
                {artistName ? `${artistName} · ` : ""}{album.status}
                {trackCount > 0 && <> · {trackCount} {trackCount === 1 ? "track" : "tracks"}</>}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-full text-muted hover:text-white hover:bg-panel2 flex items-center justify-center shrink-0"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mx-4 mb-3 rounded-xl bg-panel2 border border-edge px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white">Project sharing</div>
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

          {isOwner && (
            <div className="mx-4 mb-3 rounded-xl bg-panel2 border border-edge overflow-hidden divide-y divide-edge">
              <ActionRow
                icon={<ImagePlus size={16} />}
                label={
                  album.is_single
                    ? album.artwork_url ? "Change single cover" : "Add single cover"
                    : album.artwork_url ? "Change cover" : "Add cover"
                }
                onClick={() => { onClose(); onRequestChangeCover(); }}
              />
              <ActionRow
                icon={<Pencil size={16} />}
                label={album.is_single ? "Rename single" : "Rename project"}
                onClick={() => { onClose(); onRequestRename(); }}
              />
              <button
                type="button"
                onClick={toggleSingle}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-edge/50 transition text-left"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Disc3 size={16} className="text-muted shrink-0" />
                  <span className="text-sm text-white truncate">Mark as single</span>
                </span>
                <span
                  className={`inline-flex h-5 w-9 shrink-0 rounded-full border transition relative ${
                    album.is_single ? "bg-accent border-accent" : "bg-panel border-edge"
                  }`}
                  aria-hidden
                >
                  <span
                    className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition ${
                      album.is_single ? "right-0.5" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
              <ActionRow
                icon={<Trash2 size={16} />}
                label={album.is_single ? "Delete single" : "Delete project"}
                onClick={deleteAlbum}
                destructive
              />
            </div>
          )}

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
        </div>
      </div>

      {shareOpen && (
        <AlbumShareModal
          album={album}
          onClose={() => {
            setShareOpen(false);
            listAlbumShareLinks(album.id).then(setLinks).catch(() => { /* silent */ });
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
      {!destructive && <ChevronRight size={14} className="text-muted/60 shrink-0" />}
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
