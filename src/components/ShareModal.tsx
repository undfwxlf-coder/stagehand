import { useEffect, useRef, useState } from "react";
import {
  ChevronsUpDown,
  Globe,
  Link as LinkIcon,
  Lock,
  RotateCcw,
  Share2,
  ShoppingBag,
  Users,
  X,
} from "lucide-react";
import { formatErr } from "../lib/errors";
import type {
  ShareInvite,
  ShareLink,
  ShareVisibility,
  Track,
  Version,
} from "../lib/database.types";
import {
  addInvite,
  createShareLink,
  listInvites,
  listShareLinks,
  removeInvite,
  revokeShareLink,
  shareUrlFor,
  updateShareLink,
} from "../lib/share";
import { supabase } from "../lib/supabase";

type UIVisibility = "private" | "invite" | "public" | "paid";

interface VisOption {
  id: UIVisibility;
  label: string;
  sub: string;
  icon: React.ReactNode;
  soon?: boolean;
}

const VIS_OPTIONS: VisOption[] = [
  { id: "private", label: "Private", sub: "Only you", icon: <Lock size={16} /> },
  { id: "invite", label: "Invite Only", sub: "Invite people directly", icon: <Users size={16} /> },
  { id: "public", label: "Public", sub: "Anyone with the link", icon: <Globe size={16} /> },
  { id: "paid", label: "Paid", sub: "Only people who pay", icon: <ShoppingBag size={16} />, soon: true },
];

function uiVisFor(link: ShareLink | null): UIVisibility {
  if (!link || link.revoked) return "private";
  if (link.visibility === "disabled") return "private";
  if (link.visibility === "invite") return "invite";
  return "public";
}

export default function ShareModal({
  track,
  version,
  albumArtworkUrl,
  onClose,
  onTrackChange,
}: {
  track: Track;
  version: Version;
  albumArtworkUrl?: string | null;
  onClose: () => void;
  onTrackChange?: (patch: Partial<Track>) => void;
}) {
  const [link, setLink] = useState<ShareLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [vizPickerOpen, setVizPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteCount, setInviteCount] = useState(0);
  const pickerWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancel = false;
    listShareLinks(track.id)
      .then((rows) => {
        if (cancel) return;
        const active = rows.find((l) => !l.revoked) ?? null;
        setLink(active);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancel) {
          setErr(formatErr(e));
          setLoading(false);
        }
      });
    return () => {
      cancel = true;
    };
  }, [track.id]);

  useEffect(() => {
    if (!link || link.visibility !== "invite") {
      setInviteCount(0);
      return;
    }
    let cancel = false;
    listInvites(link.id)
      .then((rows) => !cancel && setInviteCount(rows.length))
      .catch(() => { /* silent */ });
    return () => { cancel = true; };
  }, [link]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (vizPickerOpen) setVizPickerOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, vizPickerOpen]);

  useEffect(() => {
    if (!vizPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerWrapRef.current && !pickerWrapRef.current.contains(e.target as Node)) {
        setVizPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [vizPickerOpen]);

  const uiViz = uiVisFor(link);
  const currentOpt = VIS_OPTIONS.find((o) => o.id === uiViz) ?? VIS_OPTIONS[0];

  const setVisibility = async (next: UIVisibility) => {
    setVizPickerOpen(false);
    if (next === "paid" || next === uiViz) return;
    setBusy(true);
    setErr(null);
    try {
      if (next === "private") {
        if (link && !link.revoked) await revokeShareLink(link.id);
        setLink(null);
        return;
      }
      const dbViz: ShareVisibility = next === "invite" ? "invite" : "link";
      if (!link || link.revoked) {
        const created = await createShareLink({
          trackId: track.id,
          version,
          expiresInSec: 0,
          visibility: dbViz,
          requireAccount: dbViz === "invite",
          singleUse: false,
          inviteEmails: [],
        });
        setLink(created);
      } else if (link.visibility !== dbViz) {
        const patch: Partial<ShareLink> = { visibility: dbViz };
        if (dbViz === "invite") patch.require_account = true;
        await updateShareLink(link.id, patch);
        setLink({ ...link, ...patch });
      }
    } catch (e) {
      setErr(formatErr(e));
    } finally {
      setBusy(false);
    }
  };

  const setRequireAccount = async (val: boolean) => {
    if (!link) return;
    const prev = link.require_account;
    setLink({ ...link, require_account: val });
    try {
      await updateShareLink(link.id, { require_account: val });
    } catch (e) {
      setLink({ ...link, require_account: prev });
      setErr(formatErr(e));
    }
  };

  // Allow downloads is per-track: writes to tracks.allow_download. Synced
  // back to the parent so e.g. the AlbumPage row reflects the new state.
  const setAllowDownloads = async (val: boolean) => {
    const prev = track.allow_download;
    onTrackChange?.({ allow_download: val });
    const { error } = await supabase
      .from("tracks")
      .update({ allow_download: val })
      .eq("id", track.id);
    if (error) {
      onTrackChange?.({ allow_download: prev });
      setErr(formatErr(error));
    }
  };

  const resetLink = async () => {
    if (!link) return;
    const ok = window.confirm(
      "Reset track link? The current link stops working immediately and a fresh one is created with the same settings."
    );
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      const oldViz = link.visibility;
      const oldReqAcct = link.require_account;
      await revokeShareLink(link.id);
      const created = await createShareLink({
        trackId: track.id,
        version,
        expiresInSec: 0,
        visibility: oldViz,
        requireAccount: oldReqAcct,
        singleUse: false,
        inviteEmails: [],
      });
      setLink(created);
    } catch (e) {
      setErr(formatErr(e));
    } finally {
      setBusy(false);
    }
  };

  const makePrivate = async () => {
    if (!link || link.revoked) return;
    const ok = window.confirm(
      "Make this track private? The current link stops working immediately."
    );
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      await revokeShareLink(link.id);
      setLink(null);
    } catch (e) {
      setErr(formatErr(e));
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(shareUrlFor(link.slug));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setErr("Couldn't copy");
    }
  };

  const onShare = async () => {
    if (!link) return;
    const url = shareUrlFor(link.slug);
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: track.title, url });
      } catch {
        // user cancelled
      }
    } else {
      await onCopy();
    }
  };

  const hasLink = Boolean(link && !link.revoked);
  const accessSummary = (() => {
    if (loading) return "…";
    if (!hasLink) return "No one";
    if (uiViz === "public") return "Anyone with the link";
    if (uiViz === "invite") return inviteCount === 0
      ? "No invitees yet"
      : `${inviteCount} ${inviteCount === 1 ? "invitee" : "invitees"}`;
    return "—";
  })();

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-panel border-t sm:border border-edge w-full sm:max-w-md max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="w-9 h-1 rounded-full bg-edge" />
        </div>

        <div className="px-5 pt-3 sm:pt-5 pb-4 flex items-center gap-3 shrink-0">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-panel2 to-ink border border-edge overflow-hidden flex items-center justify-center shrink-0">
            {albumArtworkUrl ? (
              <img src={albumArtworkUrl} alt="" className="w-full h-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold text-white truncate">{track.title}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-lg bg-panel2 border border-edge text-white hover:bg-edge/60 flex items-center justify-center shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
          <div className="relative mb-4" ref={pickerWrapRef}>
            <button
              onClick={() => setVizPickerOpen((v) => !v)}
              disabled={busy || loading}
              className="w-full bg-panel2 border border-edge rounded-xl px-4 py-3.5 flex items-center gap-3 text-left hover:border-accent/60 transition disabled:opacity-60"
            >
              <span className="text-white shrink-0">{currentOpt.icon}</span>
              <span className="text-sm font-medium text-white flex-1">{currentOpt.label}</span>
              <ChevronsUpDown size={16} className="text-muted shrink-0" />
            </button>

            {vizPickerOpen && (
              <div className="absolute inset-x-0 top-0 z-10 bg-panel border border-edge rounded-xl shadow-2xl overflow-hidden">
                {VIS_OPTIONS.map((opt) => {
                  const selected = opt.id === uiViz;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setVisibility(opt.id)}
                      disabled={opt.soon || busy}
                      className={`w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-panel2 disabled:cursor-not-allowed transition border-b border-edge last:border-b-0 ${
                        selected ? "bg-panel2/60" : ""
                      } ${opt.soon ? "opacity-50" : ""}`}
                    >
                      <span className="w-6 h-6 flex items-center justify-center text-white shrink-0">
                        {opt.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white flex items-center gap-2">
                          {opt.label}
                          {opt.soon && <SoonBadge />}
                        </div>
                        <div className="text-xs text-muted">{opt.sub}</div>
                      </div>
                      <span
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          selected ? "border-white bg-white" : "border-edge"
                        }`}
                      >
                        {selected && <span className="w-1.5 h-1.5 rounded-full bg-ink" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mb-5 rounded-xl bg-panel2 border border-edge px-4 py-3.5 flex items-center gap-3">
            <div className="text-sm font-medium text-white flex-1">Who has access</div>
            <div className="text-xs text-muted truncate max-w-[60%] text-right">{accessSummary}</div>
          </div>

          {uiViz === "invite" && link && (
            <div className="mb-5">
              <div className="mb-2 text-sm font-medium text-white">Invitees</div>
              <InlineInviteList shareLinkId={link.id} onCountChange={setInviteCount} />
            </div>
          )}

          <div className="mb-2 text-base font-semibold text-white">Settings</div>
          <div className="mb-4 rounded-xl bg-panel2 border border-edge overflow-hidden divide-y divide-edge">
            <ToggleRow
              title="Allow downloads"
              sub="Can export audio"
              checked={Boolean(track.allow_download)}
              onChange={setAllowDownloads}
            />
            <ToggleRow
              title="Require account"
              sub={uiViz === "invite" ? "Always on for invite-only" : "Limit to Stagehand users"}
              checked={Boolean(link?.require_account)}
              onChange={setRequireAccount}
              disabled={!hasLink || uiViz === "invite" || uiViz === "private"}
            />
          </div>

          <div className="rounded-xl bg-panel2 border border-edge overflow-hidden divide-y divide-edge">
            <button
              onClick={resetLink}
              disabled={!hasLink || busy}
              className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-edge/40 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <RotateCcw size={16} className="text-muted shrink-0" />
              <span className="text-sm text-white flex-1">Reset track link</span>
            </button>
            <button
              onClick={makePrivate}
              disabled={!hasLink || busy}
              className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-edge/40 disabled:opacity-40 disabled:cursor-not-allowed transition text-red-400"
            >
              <Lock size={16} className="shrink-0" />
              <span className="text-sm flex-1">Make track private</span>
            </button>
          </div>

          {err && <p className="text-sm text-red-400 mt-3">{err}</p>}
        </div>

        <div className="border-t border-edge px-4 py-3 flex items-center gap-2 bg-panel shrink-0">
          <button
            onClick={onCopy}
            disabled={!hasLink || busy}
            className="flex-1 bg-white text-ink rounded-full py-3 font-medium text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition"
          >
            <LinkIcon size={16} />
            {copied ? "Copied!" : "Copy link"}
          </button>
          <button
            onClick={onShare}
            disabled={!hasLink || busy}
            className="flex-1 bg-panel2 border border-edge text-white rounded-full py-3 font-medium text-sm flex items-center justify-center gap-2 hover:bg-edge/40 disabled:opacity-50 transition"
          >
            <Share2 size={16} />
            Share
          </button>
        </div>
      </div>
    </div>
  );
}

function SoonBadge() {
  return (
    <span className="text-[10px] uppercase tracking-wider bg-edge text-muted px-1.5 py-0.5 rounded">
      Soon
    </span>
  );
}

function ToggleRow({
  title,
  sub,
  checked,
  onChange,
  disabled,
  soon,
}: {
  title: string;
  sub?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  soon?: boolean;
}) {
  const locked = disabled || soon;
  return (
    <div className={`px-4 py-3.5 flex items-center gap-3 ${locked ? "opacity-60" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white flex items-center gap-2">
          {title}
          {soon && <SoonBadge />}
        </div>
        {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => !locked && onChange(!checked)}
        disabled={locked}
        className={`w-11 h-6 rounded-full transition relative shrink-0 ${
          checked ? "bg-accent" : "bg-edge"
        } ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function InlineInviteList({
  shareLinkId,
  onCountChange,
}: {
  shareLinkId: string;
  onCountChange: (n: number) => void;
}) {
  const [items, setItems] = useState<ShareInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    listInvites(shareLinkId)
      .then((r) => {
        if (cancel) return;
        setItems(r);
        onCountChange(r.length);
      })
      .catch((e) => !cancel && setErr(formatErr(e)))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [shareLinkId, onCountChange]);

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const next = await addInvite(shareLinkId, draft);
      setItems((it) => {
        if (it.some((i) => i.email === next.email)) return it;
        const updated = [...it, next];
        onCountChange(updated.length);
        return updated;
      });
      setDraft("");
    } catch (e) {
      setErr(formatErr(e));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (id: string) => {
    setItems((it) => {
      const updated = it.filter((i) => i.id !== id);
      onCountChange(updated.length);
      return updated;
    });
    try {
      await removeInvite(id);
    } catch (e) {
      setErr(formatErr(e));
    }
  };

  return (
    <div className="rounded-xl bg-panel2 border border-edge p-3 space-y-2">
      <form onSubmit={onAdd} className="flex gap-2">
        <input
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="add@email.com"
          className="flex-1 min-w-0 bg-ink border border-edge focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="bg-accent hover:bg-accent/90 disabled:opacity-60 text-white text-sm font-medium px-4 rounded-lg"
        >
          Add
        </button>
      </form>
      {err && <p className="text-xs text-red-400">{err}</p>}
      {loading ? (
        <p className="text-xs text-muted">Loading invitees…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted">No invitees yet.</p>
      ) : (
        <ul className="divide-y divide-edge -mx-1">
          {items.map((inv) => (
            <li key={inv.id} className="px-1 py-2 flex items-center justify-between text-sm">
              <span className="text-white truncate">{inv.email}</span>
              <button
                onClick={() => onRemove(inv.id)}
                className="text-muted hover:text-red-400 shrink-0 px-2 text-xs"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
