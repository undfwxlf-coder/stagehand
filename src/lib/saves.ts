import { supabase } from "./supabase";
import type { Save } from "./database.types";

export async function isTrackSaved(trackId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from("saves")
    .select("track_id")
    .eq("user_id", user.id)
    .eq("track_id", trackId)
    .maybeSingle();
  if (error) {
    console.warn("[saves] check failed", error.message);
    return false;
  }
  return Boolean(data);
}

export async function saveTrack(trackId: string, shareLinkId?: string | null): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You need an account to save tracks.");
  const { error } = await supabase.from("saves").insert({
    user_id: user.id,
    track_id: trackId,
    share_link_id: shareLinkId ?? null,
  });
  if (error && error.code !== "23505") throw error; // ignore unique violation (already saved)
}

export async function unsaveTrack(trackId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { error } = await supabase
    .from("saves")
    .delete()
    .eq("user_id", user.id)
    .eq("track_id", trackId);
  if (error) throw error;
}

export async function isAlbumSaved(albumId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from("saves")
    .select("album_id")
    .eq("user_id", user.id)
    .eq("album_id", albumId)
    .maybeSingle();
  if (error) {
    console.warn("[saves] album check failed", error.message);
    return false;
  }
  return Boolean(data);
}

export async function saveAlbum(albumId: string, shareLinkId?: string | null): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You need an account to save albums.");
  const { error } = await supabase.from("saves").insert({
    user_id: user.id,
    album_id: albumId,
    share_link_id: shareLinkId ?? null,
  });
  if (error && error.code !== "23505") throw error;
}

export async function unsaveAlbum(albumId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { error } = await supabase
    .from("saves")
    .delete()
    .eq("user_id", user.id)
    .eq("album_id", albumId);
  if (error) throw error;
}

export async function listSavesForTrack(trackId: string): Promise<Save[]> {
  const { data, error } = await supabase
    .from("saves")
    .select("*")
    .eq("track_id", trackId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Save[];
}

export interface SavedTrackItem {
  track_id: string;
  track_title: string;
  track_bpm: number | null;
  track_song_key: string | null;
  album_id: string;
  album_title: string;
  album_artwork_url: string | null;
  artist_name: string | null;
  share_link_id: string | null;
  share_slug: string | null;
  share_signed_url: string | null;
  share_expires_at: string | null;
  share_revoked: boolean | null;
  share_visibility: string | null;
  version_id: string | null;
  version_label: string | null;
  version_duration_sec: number | null;
  version_peaks: number[] | null;
}

export interface SavedAlbumItem {
  album_id: string;
  album_title: string;
  album_artwork_url: string | null;
  artist_name: string | null;
  share_link_id: string | null;
  share_slug: string | null;
  share_payload: Array<{
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
  }> | null;
  share_expires_at: string | null;
  share_revoked: boolean | null;
  share_visibility: string | null;
}

export type MySaveRow =
  | { save_id: string; saved_at: string; save_type: "track"; item: SavedTrackItem }
  | { save_id: string; saved_at: string; save_type: "album"; item: SavedAlbumItem };

export async function listMySaves(): Promise<MySaveRow[]> {
  const { data, error } = await supabase.rpc("list_my_saves");
  if (error) throw error;
  return (data ?? []) as MySaveRow[];
}
