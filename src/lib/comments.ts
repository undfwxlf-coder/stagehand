import { supabase } from "./supabase";
import type { TrackComment } from "./database.types";

export async function listTrackComments(
  trackId: string,
  opts: { slug?: string } = {}
): Promise<TrackComment[]> {
  const { data, error } = await supabase.rpc("list_track_comments", {
    p_track_id: trackId,
    p_slug: opts.slug ?? null,
  });
  if (error) throw error;
  return (data as TrackComment[] | null) ?? [];
}

export async function postTrackComment(args: {
  trackId: string;
  body: string;
  timestampSec: number;
  isReaction?: boolean;
  slug?: string;
  versionId?: string | null;
}): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc("post_track_comment", {
    p_track_id: args.trackId,
    p_slug: args.slug ?? null,
    p_body: args.body,
    p_timestamp_sec: args.timestampSec,
    p_is_reaction: args.isReaction ?? false,
    p_version_id: args.versionId ?? null,
  });
  if (error) throw error;
  return data as { id: string };
}

export async function deleteTrackComment(commentId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_track_comment", {
    p_comment_id: commentId,
  });
  if (error) throw error;
}

// Single-grapheme emoji heuristic: body is at most ~8 chars and contains
// at least one extended-pictographic character. Used to render reactions
// as small chips vs full comment cards in cases where is_reaction wasn't
// set explicitly by an older client.
export function looksLikeReaction(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length > 8) return false;
  // eslint-disable-next-line no-misleading-character-class
  return /\p{Extended_Pictographic}/u.test(trimmed);
}

export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}
