import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Track, Version, ShareLink, ShareInvite, ShareVisibility } from "../lib/database.types";
import {
  SHARE_DURATIONS,
  addInvite,
  createShareLink,
  listInvites,
  listShareLinks,
  removeInvite,
  revokeShareLink,
  shareUrlFor,
  updateShareLink,
} from "../lib/share";

export default function ShareModal({
  track,
  version,
  onClose,
}: {
  track: Track;
  version: Version;
  onClose: () => void;
}) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [duration, setDuration] = useState(SHARE_DURATIONS[1].seconds);
  const [visibility, setVisibility] = useState<ShareVisibility>("link");
  const [requireAccount, setRequireAccount] = useState(false);
  const [singleUse, setSingleUse] = useState(false);
  const [inviteText, setInviteText] = useState("");

  useEffect(() => {
    let cancel = false;
    listShareLinks(track.id)
      .then((rows) => !cancel && setLinks(rows))
      .catch((e) => {
        console.error("[share] list failed", e);
        if (!cancel) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [track.id]);

  const onCreate = async () => {
    setCreating(true);
    setErr(null);
    try {
      const inviteEmails = visibility === "invite"
        ? inviteText.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean)
        : [];
      const link = await createShareLink({
        trackId: track.id,
        version,
        expiresInSec: duration,
        visibility,
        requireAccount,
        singleUse,
        inviteEmails,
      });
      setLinks((ls) => [link, ...ls]);
      setInviteText("");
    } catch (e) {
      console.error("[share] create failed", e);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const updateLocal = (id: string, patch: Partial<ShareLink>) =>
    setLinks((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const onRevoke = async (id: string) => {
    if (!confirm("Revoke this link? Anyone with the URL will lose access immediately.")) return;
    updateLocal(id, { revoked: true });
    try { await revokeShareLink(id); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const onChangeVisibility = async (id: string, v: ShareVisibility) => {
    const patch: Partial<ShareLink> = { visibility: v };
    if (v === "invite") patch.require_account = true;
    updateLocal(id, patch);
    try { await updateShareLink(id, patch); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const onChangeRequireAccount = async (id: string, val: boolean) => {
    updateLocal(id, { require_account: val });
    try { await updateShareLink(id, { require_account: val }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-panel border-t sm:border border-edge w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-edge flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <div className="text-sm uppercase tracking-wider text-muted">Share track</div>
            <div className="text-white font-medium truncate">{track.title}</div>
            <div className="text-xs text-muted">Sharing version: {version.label}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-white px-2 py-1 -m-1 flex items-center justify-center"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 border-b border-edge shrink-0 space-y-3">
          <Field label="Who can listen">
            <div className="grid grid-cols-3 gap-1 bg-ink p-1 rounded-lg">
              <Seg active={visibility === "link"} onClick={() => setVisibility("link")}>Anyone with link</Seg>
              <Seg active={visibility === "invite"} onClick={() => setVisibility("invite")}>Invite only</Seg>
              <Seg active={visibility === "disabled"} onClick={() => setVisibility("disabled")}>Disabled</Seg>
            </div>
          </Field>

          {visibility === "link" && (
            <Field label="">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-white">
                  <input
                    type="checkbox"
                    checked={requireAccount}
                    onChange={(e) => setRequireAccount(e.target.checked)}
                    className="w-4 h-4 accent-accent"
                  />
                  Require listener to have a Stagehand account
                </label>
                <label className="flex items-start gap-2 text-sm text-white">
                  <input
                    type="checkbox"
                    checked={singleUse}
                    onChange={(e) => setSingleUse(e.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-accent"
                  />
                  <span>
                    Single-use link
                    <span className="block text-xs text-muted">Only the first person to open it gets in. Refreshing locks them out.</span>
                  </span>
                </label>
              </div>
            </Field>
          )}

          {visibility === "invite" && (
            <Field label="Invite emails (one per line or comma-separated)">
              <textarea
                value={inviteText}
                onChange={(e) => setInviteText(e.target.value)}
                placeholder="manager@label.com&#10;producer@studio.com"
                rows={3}
                className="w-full bg-ink border border-edge focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted"
              />
              <p className="text-xs text-muted mt-1">
                Each invitee must sign in with the email you've added here.
              </p>
            </Field>
          )}

          <div className="flex items-center gap-2">
            <select
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              className="bg-ink border border-edge rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            >
              {SHARE_DURATIONS.map((d) => (
                <option key={d.seconds} value={d.seconds}>
                  {d.seconds === 0 ? "Never expires" : `Expires in ${d.label}`}
                </option>
              ))}
            </select>
            <button
              onClick={onCreate}
              disabled={creating || (visibility === "invite" && !inviteText.trim())}
              className="bg-accent hover:bg-accent/90 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg shrink-0"
            >
              {creating ? "Creating…" : "Create link"}
            </button>
          </div>
          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loading ? (
            <p className="text-sm text-muted text-center py-8">Loading…</p>
          ) : links.length === 0 ? (
            <p className="text-sm text-muted text-center py-8">No share links yet.</p>
          ) : (
            <ul className="divide-y divide-edge">
              {links.map((l) => (
                <ShareRow
                  key={l.id}
                  link={l}
                  onRevoke={() => onRevoke(l.id)}
                  onChangeVisibility={(v) => onChangeVisibility(l.id, v)}
                  onChangeRequireAccount={(val) => onChangeRequireAccount(l.id, val)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      {label && <span className="block text-xs uppercase tracking-wider text-muted mb-1.5">{label}</span>}
      {children}
    </label>
  );
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs sm:text-sm py-1.5 rounded-md transition ${
        active ? "bg-panel2 text-white" : "text-muted hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function ShareRow({
  link,
  onRevoke,
  onChangeVisibility,
  onChangeRequireAccount,
}: {
  link: ShareLink;
  onRevoke: () => void;
  onChangeVisibility: (v: ShareVisibility) => void;
  onChangeRequireAccount: (val: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showInvites, setShowInvites] = useState(false);
  const url = shareUrlFor(link.slug);
  const expired = link.expires_at != null && new Date(link.expires_at).getTime() < Date.now();
  const consumed = link.single_use && link.consumed_at != null;
  const status = link.revoked
    ? "Revoked"
    : expired
    ? "Expired"
    : consumed
    ? "Used"
    : link.visibility === "disabled"
    ? "Disabled"
    : "Active";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  return (
    <li className="px-5 py-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${
            status === "Active"
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-slate-500/20 text-slate-300"
          }`}
        >
          {status}
        </span>
        <span className="text-xs text-muted">
          {status === "Active"
            ? link.expires_at
              ? `Expires ${new Date(link.expires_at).toLocaleDateString()}`
              : "Never expires"
            : `Created ${new Date(link.created_at).toLocaleDateString()}`}
        </span>
        {link.single_use && (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/15 text-amber-300">
            Single-use
          </span>
        )}
        <span className="text-xs text-muted">
          · {link.play_count} {link.play_count === 1 ? "listen" : "listens"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 bg-ink border border-edge rounded-lg px-3 py-2 text-xs text-white font-mono truncate"
        />
        <button
          onClick={copy}
          disabled={status !== "Active"}
          className="bg-panel2 hover:bg-edge disabled:opacity-40 text-white text-xs font-medium px-3 py-2 rounded-lg shrink-0"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {!link.revoked && !expired && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={link.visibility}
            onChange={(e) => onChangeVisibility(e.target.value as ShareVisibility)}
            className="bg-ink border border-edge rounded px-2 py-1 text-white focus:outline-none focus:border-accent"
          >
            <option value="link">Anyone with link</option>
            <option value="invite">Invite only</option>
            <option value="disabled">Disabled</option>
          </select>
          {link.visibility === "link" && (
            <label className="flex items-center gap-1.5 text-muted">
              <input
                type="checkbox"
                checked={link.require_account}
                onChange={(e) => onChangeRequireAccount(e.target.checked)}
                className="w-3.5 h-3.5 accent-accent"
              />
              Require sign-in
            </label>
          )}
          {link.visibility === "invite" && (
            <button
              onClick={() => setShowInvites((v) => !v)}
              className="text-accent hover:underline"
            >
              {showInvites ? "Hide invites" : "Manage invites"}
            </button>
          )}
          <span className="flex-1" />
          <button
            onClick={onRevoke}
            className="text-muted hover:text-red-400"
            aria-label="Revoke"
          >
            Revoke
          </button>
        </div>
      )}

      {showInvites && link.visibility === "invite" && (
        <InviteList shareLinkId={link.id} />
      )}
    </li>
  );
}

function InviteList({ shareLinkId }: { shareLinkId: string }) {
  const [items, setItems] = useState<ShareInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    listInvites(shareLinkId)
      .then((r) => !cancel && setItems(r))
      .catch((e) => !cancel && setErr(e.message))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [shareLinkId]);

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const next = await addInvite(shareLinkId, draft);
      setItems((it) => {
        if (it.some((i) => i.email === next.email)) return it;
        return [...it, next];
      });
      setDraft("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (id: string) => {
    setItems((it) => it.filter((i) => i.id !== id));
    try { await removeInvite(id); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="bg-ink/50 border border-edge rounded-lg p-3 space-y-2 mt-2">
      <form onSubmit={onAdd} className="flex gap-2">
        <input
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="add@email.com"
          className="flex-1 min-w-0 bg-panel border border-edge focus:border-accent focus:outline-none rounded px-2 py-1.5 text-xs text-white placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="bg-accent hover:bg-accent/90 disabled:opacity-60 text-white text-xs font-medium px-3 rounded"
        >
          Add
        </button>
      </form>
      {err && <p className="text-xs text-red-400">{err}</p>}
      {loading ? (
        <p className="text-xs text-muted">Loading invites…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted">No invitees yet. Add an email above.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between text-xs">
              <span className="text-white truncate">{inv.email}</span>
              <button onClick={() => onRemove(inv.id)} className="text-muted hover:text-red-400 shrink-0 px-2">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
