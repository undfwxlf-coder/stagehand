import { supabase } from "./supabase";
import type { ShareInvite, ShareLink, ShareVisibility, Version } from "./database.types";

const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const SLUG_LEN = 11;

function makeSlug(): string {
  const arr = crypto.getRandomValues(new Uint8Array(SLUG_LEN));
  return Array.from(arr).map((b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("");
}

// seconds = 0 is the sentinel for "never expires" — share row gets expires_at=null
// and the signed URL is issued for the storage maximum so playback keeps working.
const NEVER_EXPIRES_SIGNED_URL_SEC = 60 * 60 * 24 * 365 * 10; // 10 years
export const SHARE_DURATIONS: { label: string; seconds: number }[] = [
  { label: "24 hours", seconds: 60 * 60 * 24 },
  { label: "7 days", seconds: 60 * 60 * 24 * 7 },
  { label: "30 days", seconds: 60 * 60 * 24 * 30 },
  { label: "1 year", seconds: 60 * 60 * 24 * 365 },
  { label: "Never", seconds: 0 },
];

export async function createShareLink(opts: {
  trackId: string;
  version: Version;
  expiresInSec: number;
  visibility: ShareVisibility;
  requireAccount: boolean;
  singleUse?: boolean;
  inviteEmails?: string[];
}): Promise<ShareLink> {
  const { trackId, version, expiresInSec, visibility, requireAccount, singleUse, inviteEmails } = opts;
  const signedUrlTtl = expiresInSec === 0 ? NEVER_EXPIRES_SIGNED_URL_SEC : expiresInSec;
  const { data, error } = await supabase.storage
    .from("audio")
    .createSignedUrl(version.storage_path, signedUrlTtl);
  if (error) throw error;
  const slug = makeSlug();
  const expiresAt = expiresInSec === 0 ? null : new Date(Date.now() + expiresInSec * 1000).toISOString();
  const ins = await supabase
    .from("share_links")
    .insert({
      track_id: trackId,
      version_id: version.id,
      slug,
      signed_url: data.signedUrl,
      expires_at: expiresAt,
      visibility,
      require_account: visibility === "invite" ? true : requireAccount,
      single_use: visibility === "link" ? Boolean(singleUse) : false,
    })
    .select()
    .single();
  if (ins.error) throw ins.error;
  const link = ins.data as ShareLink;
  await addInviteRows(link.id, visibility, inviteEmails);
  return link;
}

export interface AlbumShareTrackPayload {
  track_id: string;
  title: string;
  position: number;
  bpm: number | null;
  song_key: string | null;
  version_id: string;
  version_label: string;
  duration_sec: number | null;
  peaks: number[] | null;
  signed_url: string;
}

export async function createAlbumShareLink(opts: {
  albumId: string;
  expiresInSec: number;
  visibility: ShareVisibility;
  requireAccount: boolean;
  singleUse?: boolean;
  inviteEmails?: string[];
}): Promise<ShareLink> {
  const { albumId, expiresInSec, visibility, requireAccount, singleUse, inviteEmails } = opts;
  const signedUrlTtl = expiresInSec === 0 ? NEVER_EXPIRES_SIGNED_URL_SEC : expiresInSec;

  const tracksRes = await supabase
    .from("tracks")
    .select("id, title, position, bpm, song_key, current_version_id")
    .eq("album_id", albumId)
    .order("position");
  if (tracksRes.error) throw tracksRes.error;
  type TrackLite = {
    id: string;
    title: string;
    position: number;
    bpm: number | null;
    song_key: string | null;
    current_version_id: string | null;
  };
  const tracks = (tracksRes.data ?? []) as TrackLite[];
  const playable = tracks.filter((t) => t.current_version_id);
  if (playable.length === 0) {
    throw new Error("This album has no tracks with audio yet — upload at least one before sharing.");
  }

  const versionIds = playable.map((t) => t.current_version_id!) ;
  const versionsRes = await supabase
    .from("versions")
    .select("id, track_id, label, storage_path, duration_sec, peaks")
    .in("id", versionIds);
  if (versionsRes.error) throw versionsRes.error;
  type VLite = {
    id: string;
    track_id: string;
    label: string;
    storage_path: string;
    duration_sec: number | null;
    peaks: number[] | null;
  };
  const versionMap = new Map<string, VLite>(
    ((versionsRes.data ?? []) as VLite[]).map((v) => [v.id, v])
  );

  const payload: AlbumShareTrackPayload[] = [];
  for (const t of playable) {
    const v = versionMap.get(t.current_version_id!);
    if (!v) continue;
    const { data: signed, error: signErr } = await supabase.storage
      .from("audio")
      .createSignedUrl(v.storage_path, signedUrlTtl);
    if (signErr) throw signErr;
    payload.push({
      track_id: t.id,
      title: t.title,
      position: t.position,
      bpm: t.bpm,
      song_key: t.song_key,
      version_id: v.id,
      version_label: v.label,
      duration_sec: v.duration_sec,
      peaks: v.peaks,
      signed_url: signed.signedUrl,
    });
  }

  const slug = makeSlug();
  const expiresAt = expiresInSec === 0 ? null : new Date(Date.now() + expiresInSec * 1000).toISOString();
  const ins = await supabase
    .from("share_links")
    .insert({
      album_id: albumId,
      slug,
      expires_at: expiresAt,
      visibility,
      require_account: visibility === "invite" ? true : requireAccount,
      single_use: visibility === "link" ? Boolean(singleUse) : false,
      payload,
    })
    .select()
    .single();
  if (ins.error) throw ins.error;
  const link = ins.data as ShareLink;
  await addInviteRows(link.id, visibility, inviteEmails);
  return link;
}

async function addInviteRows(
  shareLinkId: string,
  visibility: ShareVisibility,
  inviteEmails: string[] | undefined
): Promise<void> {
  const validEmails = (inviteEmails ?? [])
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (visibility === "invite" && validEmails.length) {
    const rows = validEmails.map((email) => ({ share_link_id: shareLinkId, email }));
    const inviteIns = await supabase.from("share_invites").insert(rows);
    if (inviteIns.error) throw inviteIns.error;
  }
}

export async function listAlbumShareLinks(albumId: string): Promise<ShareLink[]> {
  const { data, error } = await supabase
    .from("share_links")
    .select("*")
    .eq("album_id", albumId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ShareLink[];
}

export async function listShareLinks(trackId: string): Promise<ShareLink[]> {
  const { data, error } = await supabase
    .from("share_links")
    .select("*")
    .eq("track_id", trackId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ShareLink[];
}

export async function updateShareLink(
  id: string,
  patch: Partial<Pick<ShareLink, "visibility" | "require_account">>
): Promise<void> {
  const { error } = await supabase.from("share_links").update(patch).eq("id", id);
  if (error) throw error;
}

export async function revokeShareLink(id: string): Promise<void> {
  const { error } = await supabase.from("share_links").update({ revoked: true }).eq("id", id);
  if (error) throw error;
}

export async function listInvites(shareLinkId: string): Promise<ShareInvite[]> {
  const { data, error } = await supabase
    .from("share_invites")
    .select("*")
    .eq("share_link_id", shareLinkId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ShareInvite[];
}

export async function addInvite(shareLinkId: string, email: string): Promise<ShareInvite> {
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error("Please enter a valid email address.");
  }
  const { data, error } = await supabase
    .from("share_invites")
    .upsert({ share_link_id: shareLinkId, email: trimmed }, { onConflict: "share_link_id,email" })
    .select()
    .single();
  if (error) throw error;
  return data as ShareInvite;
}

export async function removeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.from("share_invites").delete().eq("id", inviteId);
  if (error) throw error;
}

export function shareUrlFor(slug: string): string {
  return `${window.location.origin}/listen/${slug}`;
}
