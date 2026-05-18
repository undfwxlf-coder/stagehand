import { useEffect, useState } from "react";
import {
  ChevronDown,
  Link as LinkIcon,
  RotateCcw,
  Share2,
  X,
} from "lucide-react";
import { formatErr } from "../lib/errors";
import type { Album, ShareInvite, ShareLink, ShareVisibility } from "../lib/database.types";
import {
  addInvite,
  createAlbumShareLink,
  listAlbumShareLinks,
  listInvites,
  removeInvite,
  revokeShareLink,
  shareUrlFor,
  updateShareLink,
} from "../lib/share";

type UIVisibility = "private" | "invite" | "public" | "paid";

interface VisOption {
  id: UIVisibility;
  label: string;
  soon?: boolean;
}

const VIS_OPTIONS: VisOption[] = [
  { id: "private", label: "Private" },
  { id: "invite", label: "Invite" },
  { id: "public", label: "Public" },
  { id: "paid", label: "Paid", soon: true },
];

function uiVisFor(link: ShareLink | null): UIVisibility {
  if (!link || link.revoked) return "private";
  if (link.visibility === "disabled") return "private";
  if (link.visibility === "invite") return "invite";
  return "public";
}

export default function AlbumShareModal({
  album,
  onClose,
}: {
  album: Album;
  onClose: () => void;
}) {
  const [link, setLink] = useState<ShareLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteCount, setInviteCount] = useState(0);

  useEffect(() => {
    let cancel = false;
    listAlbumShareLinks(album.id)
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
  }, [album.id]);

  // Re-fetch invite count whenever the active link changes to an invite link
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
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const uiViz = uiVisFor(link);

  const setVisibility = async (next: UIVisibility) => {
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
        const created = await createAlbumShareLink({
          albumId: album.id,
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

  const resetLink = async () => {
    if (!link) return;
    const ok = window.confirm(
      "Reset project link? The current link stops working immediately and a fresh one is created with the same settings."
    );
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      const oldViz = link.visibility;
      const oldReqAcct = link.require_account;
      await revokeShareLink(link.id);
      const created = await createAlbumShareLink({
        albumId: album.id,
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
        await nav.share({ title: album.title, url });
      } catch {
        // user cancelled
      }
    } else {
      await onCopy();
    }
  };

  const hasLink = Boolean(link && !link.revoked);
  const accessSummary = (() => {
    if (loading) return "Loading…";
    if (!hasLink) return "Private · only you can see this";
    if (uiViz === "public") return "Anyone with the link can listen";
    if (uiViz === "invite") return inviteCount === 0
      ? "Invite only · no invitees yet"
      : `Invite only · ${inviteCount} ${inviteCount === 1 ? "person" : "people"}`;
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
        {/* Premium ambient glow behind the artwork */}
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

        {/* Hero: large artwork + title, centered */}
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
                {album.artwork_url ? (
                  <img src={album.artwork_url} alt="" className="w-full h-full object-cover" />
                ) : null}
              </div>
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-white tracking-tight leading-tight">
              {album.title}
            </h2>
            <p className="mt-1.5 text-[13px] text-white/55">{accessSummary}</p>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="relative flex-1 overflow-y-auto px-4 pb-5 min-h-0 space-y-4">
          {/* Segmented visibility control — replaces dropdown */}
          <SegmentedVisibility uiViz={uiViz} onChange={setVisibility} disabled={busy || loading} />

          {/* Invite list — inline when Invite Only is selected */}
          {uiViz === "invite" && link && (
            <InlineInviteList shareLinkId={link.id} onCountChange={setInviteCount} />
          )}

          {/* More options disclosure */}
          {hasLink && (
            <div>
              <button
                onClick={() => setOptionsOpen((v) => !v)}
                className="w-full flex items-center justify-between px-2 py-2 text-[13px] text-white/55 hover:text-white/80 transition"
              >
                <span className="font-medium">More options</span>
                <ChevronDown
                  size={16}
                  className={`transition-transform duration-200 ${optionsOpen ? "rotate-180" : ""}`}
                />
              </button>
              {optionsOpen && (
                <div className="mt-1 space-y-3">
                  <div className="glass-raised rounded-2xl overflow-hidden divide-y divide-white/[0.06]">
                    <ToggleRow
                      title="Allow editing"
                      sub="Can edit and add tracks"
                      checked={false}
                      onChange={() => {}}
                      soon
                    />
                    <ToggleRow
                      title="Allow downloads"
                      sub="Can export audio"
                      checked={false}
                      onChange={() => {}}
                      soon
                    />
                    <ToggleRow
                      title="Require account"
                      sub={uiViz === "invite" ? "Always on for invite-only" : "Limit to Stagehand users"}
                      checked={Boolean(link?.require_account)}
                      onChange={setRequireAccount}
                      disabled={uiViz === "invite" || uiViz === "private"}
                    />
                  </div>

                  <button
                    onClick={resetLink}
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2 py-2.5 text-[13px] text-white/55 hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RotateCcw size={14} className="shrink-0" />
                    Reset link · generates a fresh URL
                  </button>
                </div>
              )}
            </div>
          )}

          {err && <p className="text-[13px] text-red-400 px-2 pt-1">{err}</p>}
        </div>

        {/* Sticky bottom action bar */}
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

function SegmentedVisibility({
  uiViz,
  onChange,
  disabled,
}: {
  uiViz: UIVisibility;
  onChange: (v: UIVisibility) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex p-1 rounded-2xl bg-white/[0.06] border border-white/[0.08]">
      {VIS_OPTIONS.map((opt) => {
        const active = opt.id === uiViz;
        const locked = Boolean(opt.soon) || disabled;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => !locked && onChange(opt.id)}
            disabled={locked}
            className={`flex-1 px-2 py-2.5 rounded-xl text-[13px] font-semibold transition relative ${
              active
                ? "bg-white text-ink shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
                : opt.soon
                ? "text-white/30 cursor-not-allowed"
                : disabled
                ? "text-white/40 cursor-not-allowed"
                : "text-white/65 hover:text-white"
            }`}
          >
            <span className="block leading-tight">{opt.label}</span>
            {opt.soon && (
              <span className="block text-[9px] uppercase tracking-wider text-white/35 mt-0.5">
                Soon
              </span>
            )}
          </button>
        );
      })}
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
