import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  Link as LinkIcon,
  Plus,
  RotateCcw,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import { formatErr } from "../lib/errors";
import type { Album, CollabArtist, ShareLink, ShareVisibility } from "../lib/database.types";
import {
  type ShareMember,
  createAlbumShareLink,
  listAlbumShareLinks,
  listShareMembers,
  revokeShareLink,
  shareUrlFor,
  updateShareLink,
} from "../lib/share";
import { setAlbumCollabArtists } from "../lib/credit";

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
  const [memberCount, setMemberCount] = useState(0);
  const [collabArtists, setCollabArtistsState] = useState<CollabArtist[]>(album.collab_artists ?? []);

  const persistCollabArtists = useCallback(async (next: CollabArtist[]) => {
    const prev = collabArtists;
    setCollabArtistsState(next);
    try {
      const saved = await setAlbumCollabArtists(album.id, next);
      setCollabArtistsState(saved);
    } catch (e) {
      setCollabArtistsState(prev);
      setErr(formatErr(e));
    }
  }, [album.id, collabArtists]);

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

  // Re-fetch member count whenever the active link changes to an invite link.
  useEffect(() => {
    if (!link || link.visibility !== "invite") {
      setMemberCount(0);
      return;
    }
    let cancel = false;
    listShareMembers(link.id)
      .then((rows) => !cancel && setMemberCount(rows.length))
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
      // For invite links the `expires_at` is the join cutoff. Default to
      // 7 days so the artist doesn't have to think about it; can be changed
      // later. Public links default to never-expires.
      const defaultExpiry = dbViz === "invite" ? 7 * 24 * 60 * 60 : 0;
      if (!link || link.revoked) {
        const created = await createAlbumShareLink({
          albumId: album.id,
          expiresInSec: defaultExpiry,
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

  const setAllowEditing = async (val: boolean) => {
    if (!link) return;
    const prev = link.allow_editing;
    setLink({ ...link, allow_editing: val });
    try {
      await updateShareLink(link.id, { allow_editing: val });
    } catch (e) {
      setLink({ ...link, allow_editing: prev });
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
    if (uiViz === "invite") return memberCount === 0
      ? "Invite only · no one has joined yet"
      : `Invite only · ${memberCount} ${memberCount === 1 ? "person joined" : "people joined"}`;
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
              "radial-gradient(80% 100% at 50% 0%, rgba(187,10,33,0.24) 0%, rgba(187,10,33,0.07) 35%, rgba(187,10,33,0) 70%)",
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
                    "radial-gradient(closest-side, rgba(187,10,33,0.42), transparent)",
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

          {/* Collab / featured artists — applies to the album regardless of
              share visibility, so it sits above the invite list. */}
          <CollabArtistsSection
            collabArtists={collabArtists}
            onChange={persistCollabArtists}
            disabled={busy}
          />

          {/* Invite list — inline when Invite Only is selected */}
          {uiViz === "invite" && link && (
            <ShareMembers
              shareLinkId={link.id}
              onCountChange={setMemberCount}
              collabArtists={collabArtists}
              onPromote={(m) =>
                persistCollabArtists([
                  ...collabArtists,
                  { name: m.artist_name?.trim() || m.email || "Unknown", user_id: m.user_id },
                ])
              }
            />
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
                      sub={uiViz === "invite" ? "Members can edit + add tracks" : "Invite-only shares only"}
                      checked={Boolean(link?.allow_editing) && uiViz === "invite"}
                      onChange={setAllowEditing}
                      disabled={uiViz !== "invite"}
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

function ShareMembers({
  shareLinkId,
  onCountChange,
  collabArtists,
  onPromote,
}: {
  shareLinkId: string;
  onCountChange: (n: number) => void;
  collabArtists: CollabArtist[];
  onPromote: (m: ShareMember) => void;
}) {
  const [members, setMembers] = useState<ShareMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    listShareMembers(shareLinkId)
      .then((r) => {
        if (cancel) return;
        setMembers(r);
        onCountChange(r.length);
      })
      .catch((e) => !cancel && setErr(formatErr(e)))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [shareLinkId, onCountChange]);

  if (loading) {
    return (
      <div className="glass-raised rounded-2xl px-5 py-4 text-[13px] text-white/45 text-center">
        Loading members…
      </div>
    );
  }
  if (err) {
    return <p className="text-[12px] text-red-400 px-2">{err}</p>;
  }
  if (members.length === 0) {
    return (
      <div className="glass-raised rounded-2xl px-5 py-5 text-center">
        <p className="text-[14px] text-white/70">No one's joined yet</p>
        <p className="text-[12px] text-white/45 mt-1">
          Send the link. Anyone who signs in becomes a member.
        </p>
      </div>
    );
  }
  const isPromoted = (userId: string) =>
    collabArtists.some((c) => c.user_id === userId);
  return (
    <div className="glass-raised rounded-2xl overflow-hidden divide-y divide-white/[0.06]">
      {members.map((m) => {
        const display = m.artist_name || m.email || "Anonymous";
        const initial = display.charAt(0).toUpperCase();
        const promoted = isPromoted(m.user_id);
        return (
          <div key={m.user_id} className="px-4 py-3 flex items-center gap-3">
            {m.avatar_url ? (
              <img src={m.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-white/[0.08] flex items-center justify-center text-[13px] font-medium text-white/70 shrink-0">
                {initial}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[14px] text-white truncate flex items-center gap-1.5">
                {display}
                {promoted && (
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/20 text-accent shrink-0">
                    Credited
                  </span>
                )}
              </div>
              <div className="text-[12px] text-white/45">Joined {fmtJoinedAt(m.joined_at)}</div>
            </div>
            {!promoted && (
              <button
                onClick={() => onPromote(m)}
                className="shrink-0 text-[12px] text-white/65 hover:text-white px-2.5 py-1.5 rounded-lg border border-white/[0.08] hover:border-white/[0.2] transition flex items-center gap-1"
                title="Credit as collab artist + grant edit access"
              >
                <Sparkles size={11} />
                Credit
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CollabArtistsSection({
  collabArtists,
  onChange,
  disabled,
}: {
  collabArtists: CollabArtist[];
  onChange: (next: CollabArtist[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const name = draft.trim();
    if (!name) return;
    onChange([...collabArtists, { name }]);
    setDraft("");
  };
  const removeAt = (idx: number) => {
    onChange(collabArtists.filter((_, i) => i !== idx));
  };
  return (
    <div className="glass-raised rounded-2xl overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold text-white">Collab artists</div>
          <div className="text-[11px] text-white/45 mt-0.5">
            Listed as <span className="text-white/65">feat.</span> credits on listener pages.
          </div>
        </div>
      </div>
      {collabArtists.length > 0 && (
        <ul className="px-3 pb-2 flex flex-wrap gap-1.5">
          {collabArtists.map((c, i) => (
            <li
              key={c.user_id ? `u:${c.user_id}` : `n:${c.name}:${i}`}
              className={`inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full text-[12px] ${
                c.user_id
                  ? "bg-accent/15 text-accent border border-accent/30"
                  : "bg-white/[0.06] text-white/75 border border-white/[0.08]"
              }`}
            >
              {c.user_id && <Sparkles size={10} className="opacity-80" />}
              <span className="max-w-[120px] truncate">{c.name}</span>
              <button
                onClick={() => removeAt(i)}
                disabled={disabled}
                className="w-4 h-4 rounded-full hover:bg-white/10 flex items-center justify-center"
                aria-label={`Remove ${c.name}`}
              >
                <X size={10} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="px-3 pb-3">
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="flex gap-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a featured artist by name"
            disabled={disabled}
            className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.08] focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-[13px] text-white placeholder:text-white/35 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={disabled || draft.trim().length === 0}
            className="shrink-0 bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-40 text-white text-[13px] font-medium px-3 rounded-lg flex items-center gap-1.5 transition"
          >
            <Plus size={12} />
            Add
          </button>
        </form>
        <p className="text-[11px] text-white/35 mt-2 px-0.5">
          Stagehand users can be linked (with edit access) from the invite member list below.
        </p>
      </div>
    </div>
  );
}

function fmtJoinedAt(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.max(0, (now - then) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${Math.floor(diffMin)}m ago`;
  const diffHr = diffMin / 60;
  if (diffHr < 24) return `${Math.floor(diffHr)}h ago`;
  const diffDay = diffHr / 24;
  if (diffDay < 7) return `${Math.floor(diffDay)}d ago`;
  return new Date(iso).toLocaleDateString();
}
