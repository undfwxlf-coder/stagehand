import { useEffect, useRef, useState } from "react";

import { formatErr } from "../lib/errors";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronRight,
  FileText,
  Mail,
  MessageSquare,
  Pencil,
  Share2,
  ShieldCheck,
  ShoppingBag,
  X,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  fetchMyProfile,
  updateMyProfile,
  uploadAvatar,
  useProfileStore,
} from "../lib/profile";
import type { Profile } from "../lib/database.types";

// TODO: replace with the real destinations.
const CONTACT_EMAIL = "stagehand.studio@gmail.com";
const INSTAGRAM_URL = "https://instagram.com/stagehand.studio";
const TERMS_URL = ""; // leave empty until the page exists — row renders as "Coming soon"
const PRIVACY_URL = ""; // ditto

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const setStoreProfile = useProfileStore((s) => s.set);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const tellAFriend = async () => {
    const url = window.location.origin;
    const shareData = {
      title: "Stagehand",
      text: "Check out Stagehand — a private home for unreleased music.",
      url,
    };
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // User dismissed the share sheet — fall through to no-op.
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  useEffect(() => {
    if (!user) return;
    let alive = true;
    fetchMyProfile(user.id)
      .then((p) => {
        if (!alive) return;
        if (p) {
          setProfile(p);
          setStoreProfile(p);
          setNameDraft(p.artist_name ?? "");
        } else {
          const fallbackName =
            (user.user_metadata?.artist_name as string | undefined) ?? "";
          setProfile({
            id: user.id,
            artist_name: fallbackName || null,
            avatar_url: null,
            created_at: user.created_at ?? new Date().toISOString(),
          });
          setNameDraft(fallbackName);
        }
      })
      .catch((e) => setErr(formatErr(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [user, setStoreProfile]);

  if (!user) return null;

  const onPickAvatar = () => fileRef.current?.click();

  const onAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setUploadingAvatar(true);
    try {
      const url = await uploadAvatar(user.id, file);
      const updated = await updateMyProfile(user.id, { avatar_url: url });
      setProfile(updated);
      setStoreProfile(updated);
    } catch (e) {
      setErr(formatErr(e));
    } finally {
      setUploadingAvatar(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setErr("Artist name can't be empty.");
      return;
    }
    setErr(null);
    setSavingName(true);
    try {
      const updated = await updateMyProfile(user.id, { artist_name: trimmed });
      setProfile(updated);
      setStoreProfile(updated);
      await supabase.auth.updateUser({ data: { artist_name: trimmed } });
      setEditing(false);
    } catch (e) {
      setErr(formatErr(e));
    } finally {
      setSavingName(false);
    }
  };

  const cancelEdit = () => {
    setNameDraft(profile?.artist_name ?? "");
    setEditing(false);
    setErr(null);
  };

  const displayName = profile?.artist_name?.trim() || "Add your artist name";
  const initial = (profile?.artist_name?.trim() || user.email || "?")
    .charAt(0)
    .toUpperCase();
  const joined = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, {
        month: "numeric",
        day: "numeric",
        year: "2-digit",
      })
    : "";

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="flex items-center justify-between mb-6">
        <Link
          to="/"
          className="flex items-center gap-1 text-sm text-muted hover:text-white transition"
        >
          <ArrowLeft size={16} />
          <span>Back</span>
        </Link>
      </div>

      <div className="bg-panel border border-edge rounded-3xl p-6 sm:p-8 flex flex-col items-center text-center">
        <button
          type="button"
          onClick={onPickAvatar}
          disabled={uploadingAvatar}
          aria-label={profile?.avatar_url ? "Change profile photo" : "Add profile photo"}
          className="relative group w-32 h-32 sm:w-36 sm:h-36 rounded-full overflow-hidden bg-panel2 border border-edge flex items-center justify-center disabled:opacity-60"
        >
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-4xl font-semibold text-muted">{initial}</span>
          )}
          <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
            <Camera size={22} className="text-white" />
          </span>
          {uploadingAvatar && (
            <span className="absolute inset-0 bg-black/60 flex items-center justify-center text-xs text-white">
              Uploading…
            </span>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={onAvatarChange}
          className="hidden"
        />

        <div className="mt-5 w-full">
          {editing ? (
            <div className="flex items-center justify-center gap-2">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                autoFocus
                maxLength={60}
                placeholder="Artist name"
                className="bg-ink border border-edge rounded-lg px-3 py-2 text-center text-lg text-white focus:outline-none focus:border-accent w-full max-w-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") cancelEdit();
                }}
              />
              <button
                type="button"
                onClick={saveName}
                disabled={savingName}
                aria-label="Save name"
                className="p-2 rounded-md bg-accent hover:bg-accent/90 text-white disabled:opacity-60"
              >
                <Check size={16} />
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={savingName}
                aria-label="Cancel"
                className="p-2 rounded-md bg-panel2 hover:bg-edge text-muted hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
              {displayName}
            </h1>
          )}
          {joined && (
            <p className="mt-1 text-xs text-muted">Joined {joined}</p>
          )}
        </div>

        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-6 inline-flex items-center gap-2 bg-panel2 hover:bg-edge text-white text-sm px-4 py-2 rounded-full transition"
          >
            <Pencil size={14} />
            Edit Profile
          </button>
        )}

        {err && <p className="mt-4 text-sm text-red-400">{err}</p>}
        {loading && <p className="mt-4 text-xs text-muted">Loading…</p>}
      </div>

      <div className="mt-6 bg-panel border border-edge rounded-2xl divide-y divide-edge overflow-hidden">
        <ValueRow label="Email" value={user.email ?? ""} />
        <ActionRow
          icon={<ShoppingBag size={16} />}
          label="Purchases"
          soon
        />
      </div>

      <SectionLabel>Support</SectionLabel>
      <div className="bg-panel border border-edge rounded-2xl divide-y divide-edge overflow-hidden">
        <ActionRow
          icon={<Share2 size={16} />}
          label="Tell a friend"
          onClick={tellAFriend}
          trailing={
            copied ? (
              <span className="text-[10px] uppercase tracking-wider text-accent bg-accent/10 px-2 py-0.5 rounded">
                Copied!
              </span>
            ) : undefined
          }
        />
        <ActionRow
          icon={<MessageSquare size={16} />}
          label="Send feedback"
          href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("[Stagehand feedback] ")}&body=${encodeURIComponent("What's working / what's broken / what you wish existed:\n\n")}`}
        />
        <ActionRow
          icon={<Mail size={16} />}
          label="Contact us"
          href={`mailto:${CONTACT_EMAIL}`}
        />
        <ActionRow
          icon={<InstagramIcon />}
          label="Stagehand on Instagram"
          href={INSTAGRAM_URL}
          external
        />
      </div>

      <SectionLabel>Legal</SectionLabel>
      <div className="bg-panel border border-edge rounded-2xl divide-y divide-edge overflow-hidden">
        <ActionRow
          icon={<FileText size={16} />}
          label="Terms of Service"
          href={TERMS_URL || undefined}
          external={Boolean(TERMS_URL)}
          soon={!TERMS_URL}
        />
        <ActionRow
          icon={<ShieldCheck size={16} />}
          label="Privacy Policy"
          href={PRIVACY_URL || undefined}
          external={Boolean(PRIVACY_URL)}
          soon={!PRIVACY_URL}
        />
      </div>

      <div className="mt-6 bg-panel border border-edge rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={signOut}
          className="w-full text-left px-5 py-4 text-sm text-red-400 hover:bg-panel2 transition"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function InstagramIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-6 mb-2 px-1 text-[11px] uppercase tracking-wider text-muted">
      {children}
    </h2>
  );
}

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4 flex items-center justify-between gap-4">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm text-white truncate">{value}</span>
    </div>
  );
}

interface ActionRowProps {
  icon: React.ReactNode;
  label: string;
  href?: string;
  external?: boolean;
  soon?: boolean;
  onClick?: () => void;
  trailing?: React.ReactNode;
}

function ActionRow({ icon, label, href, external, soon, onClick, trailing }: ActionRowProps) {
  const inner = (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className="text-muted shrink-0">{icon}</span>
      <span className="text-sm text-white flex-1 truncate">{label}</span>
      {trailing ? (
        trailing
      ) : soon ? (
        <span className="text-[10px] uppercase tracking-wider text-muted bg-panel2 px-2 py-0.5 rounded">
          Soon
        </span>
      ) : (
        <ChevronRight size={16} className="text-muted shrink-0" />
      )}
    </div>
  );

  const className = `block w-full text-left transition ${
    soon ? "opacity-60 cursor-not-allowed" : "hover:bg-panel2"
  }`;

  if (soon || (!href && !onClick)) {
    return (
      <div aria-disabled className={className}>
        {inner}
      </div>
    );
  }

  if (href) {
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className={className}
      >
        {inner}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}
