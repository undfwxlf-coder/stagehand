import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Camera, Check, Pencil, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import {
  fetchMyProfile,
  updateMyProfile,
  uploadAvatar,
  useProfileStore,
} from "../lib/profile";
import type { Profile } from "../lib/database.types";

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
  const fileRef = useRef<HTMLInputElement>(null);

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
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
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
      setErr(e instanceof Error ? e.message : String(e));
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
      setErr(e instanceof Error ? e.message : String(e));
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

      <div className="mt-6 bg-panel border border-edge rounded-2xl divide-y divide-edge">
        <Row label="Email" value={user.email ?? ""} />
        <button
          type="button"
          onClick={signOut}
          className="w-full text-left px-5 py-4 text-sm text-red-400 hover:bg-panel2 transition rounded-b-2xl"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4 flex items-center justify-between gap-4">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm text-white truncate">{value}</span>
    </div>
  );
}
