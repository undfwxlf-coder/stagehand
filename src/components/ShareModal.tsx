import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
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
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-xl flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-md max-h-[94vh] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden bg-ink"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-64"
          style={{
            background:
              "radial-gradient(80% 100% at 50% 0%, rgba(255,107,61,0.22) 0%, rgba(255,107,61,0.06) 35%, rgba(255,107,61,0) 70%)",
          }}
        />

        <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0 relative">
          <div className="w-10 h-1 rounded-full bg-white/15" />
        </div>

        <div className="relative px-6 pt-4 sm:pt-7 pb-6 shrink-0">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-5 top-5 w-9 h-9 rounded-full glass-raised text-white hover:bg-white/10 flex items-center justify-center transition"
          >
            <X size={16} />
          </button>
          <div className="flex flex-col items-center text-center">
            <div className="relative">
              <div
                aria-hidden
                className="absolute inset-0 blur-2xl opacity-60 -z-10"
                style={{
                  background:
                    "radial-gradient(closest-side, rgba(255,107,61,0.4), transparent)",
                }}
              />
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-gradient-to-br from-white/10 to-white/[0.02] border border-white/10 shadow-glass-lg flex items-center justify-center">
                {albumArtworkUrl ? (
                  <img src={albumArtworkUrl} alt="" className="w-full h-full object-cover" />
                ) : null}
              </div>
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-white tracking-tight leading-tight">
              {track.title}
            </h2>
            <p className="mt-1 text-[13px] text-white/50">Share track</p>
          </div>
        </div>

        <div className="relative flex-1 overflow-y-auto px-4 pb-5 min-h-0 space-y-3">
          <div className="relative" ref={pickerWrapRef}>
            <button
              onClick={() => setVizPickerOpen((v) => !v)}
              disabled={busy || loading}
              className="w-full glass-raised rounded-2xl px-5 py-4 flex items-center gap-4 text-left hover:bg-white/[0.09] transition disabled:opacity-60"
            >
              <span className="w-9 h-9 rounded-full bg-white/[0.08] flex items-center justify-center text-white shrink-0">
                {currentOpt.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold text-white">{currentOpt.label}</div>
                <div className="text-[12px] text-white/50">{currentOpt.sub}</div>
              </div>
              <ChevronDown size={18} className="text-white/40 shrink-0" />
            </button>

            {vizPickerOpen && (
              <div className="absolute inset-x-0 top-0 z-10 rounded-2xl overflow-hidden glass-strong shadow-glass-lg">
                {VIS_OPTIONS.map((opt, i) => {
                  const selected = opt.id === uiViz;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setVisibility(opt.id)}
                      disabled={opt.soon || busy}
                      className={`w-full px-5 py-3.5 flex items-center gap-4 text-left hover:bg-white/[0.06] disabled:cursor-not-allowed transition ${
                        i !== 0 ? "border-t border-white/[0.06]" : ""
                      } ${selected ? "bg-white/[0.05]" : ""} ${opt.soon ? "opacity-45" : ""}`}
                    >
                      <span className="w-9 h-9 rounded-full bg-white/[0.08] flex items-center justify-center text-white shrink-0">
                        {opt.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[15px] font-semibold text-white flex items-center gap-2">
                          {opt.label}
                          {opt.soon && <SoonBadge />}
                        </div>
                        <div className="text-[12px] text-white/50">{opt.sub}</div>
                      </div>
                      <span className="w-6 h-6 flex items-center justify-center shrink-0">
                        {selected && <Check size={18} className="text-accent" strokeWidth={2.5} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="glass-raised rounded-2xl px-5 py-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold text-white">Who has access</div>
              <div className="text-[12px] text-white/50 mt-0.5 truncate">{accessSummary}</div>
            </div>
          </div>

          {uiViz === "invite" && link && (
            <div className="pt-1">
              <div className="px-2 mb-2 text-[11px] uppercase tracking-wider text-white/40">Invitees</div>
              <InlineInviteList shareLinkId={link.id} onCountChange={setInviteCount} />
            </div>
          )}

          <div className="pt-2">
            <div className="px-2 mb-2 text-[11px] uppercase tracking-wider text-white/40">Settings</div>
            <div className="glass-raised rounded-2xl overflow-hidden divide-y divide-white/[0.06]">
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
          </div>

          <div className="pt-2 grid grid-cols-2 gap-2">
            <button
              onClick={resetLink}
              disabled={!hasLink || busy}
              className="glass-raised rounded-2xl px-4 py-3 flex items-center justify-center gap-2 hover:bg-white/[0.09] disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <RotateCcw size={14} className="text-white/60 shrink-0" />
              <span className="text-[13px] font-medium text-white">Reset link</span>
            </button>
            <button
              onClick={makePrivate}
              disabled={!hasLink || busy}
              className="glass-raised rounded-2xl px-4 py-3 flex items-center justify-center gap-2 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition text-red-400"
            >
              <Lock size={14} className="shrink-0" />
              <span className="text-[13px] font-medium">Make private</span>
            </button>
          </div>

          {err && <p className="text-[13px] text-red-400 px-2 pt-1">{err}</p>}
        </div>

        <div className="relative border-t border-white/[0.06] px-4 pt-3 pb-3 flex items-center gap-2 shrink-0 bg-ink/80 backdrop-blur-xl">
          <button
            onClick={onCopy}
            disabled={!hasLink || busy}
            className="flex-1 bg-white text-ink rounded-full py-3.5 font-semibold text-[15px] flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition shadow-glass"
          >
            <LinkIcon size={16} strokeWidth={2.5} />
            {copied ? "Copied!" : "Copy link"}
          </button>
          <button
            onClick={onShare}
            disabled={!hasLink || busy}
            className="flex-1 glass-raised rounded-full py-3.5 font-semibold text-[15px] text-white flex items-center justify-center gap-2 hover:bg-white/[0.1] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <Share2 size={16} strokeWidth={2.5} />
            Share
          </button>
        </div>
      </div>
    </div>
  );
}

function SoonBadge() {
  return (
    <span className="text-[10px] uppercase tracking-wider bg-white/[0.08] text-white/55 px-1.5 py-0.5 rounded-md">
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
    <div className={`px-5 py-4 flex items-center gap-3 ${locked ? "opacity-60" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold text-white flex items-center gap-2">
          {title}
          {soon && <SoonBadge />}
        </div>
        {sub && <div className="text-[12px] text-white/50 mt-0.5">{sub}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => !locked && onChange(!checked)}
        disabled={locked}
        className={`w-[52px] h-[31px] rounded-full transition-colors duration-200 relative shrink-0 ${
          checked ? "bg-accent" : "bg-white/[0.12]"
        } ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span
          className={`absolute top-[2px] w-[27px] h-[27px] rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.25)] transition-all duration-200 ease-out ${
            checked ? "left-[23px]" : "left-[2px]"
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
    <div className="glass-raised rounded-2xl p-4 space-y-3">
      <form onSubmit={onAdd} className="flex gap-2">
        <input
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="add@email.com"
          className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.08] focus:border-accent/60 focus:outline-none rounded-xl px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/35"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="bg-accent hover:bg-accent/90 disabled:opacity-60 text-white text-[14px] font-semibold px-4 rounded-xl"
        >
          Add
        </button>
      </form>
      {err && <p className="text-[12px] text-red-400">{err}</p>}
      {loading ? (
        <p className="text-[12px] text-white/45">Loading invitees…</p>
      ) : items.length === 0 ? (
        <p className="text-[12px] text-white/45">No invitees yet.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {items.map((inv) => (
            <li key={inv.id} className="py-2.5 flex items-center justify-between text-[14px]">
              <span className="text-white truncate">{inv.email}</span>
              <button
                onClick={() => onRemove(inv.id)}
                className="text-white/45 hover:text-red-400 shrink-0 px-2 text-[12px] font-medium"
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
