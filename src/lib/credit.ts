import { supabase } from "./supabase";
import type { CollabArtist } from "./database.types";

// Render an artist credit for listener-facing surfaces.
//   formatArtistCredit("Wilfred", [])                     → "Wilfred"
//   formatArtistCredit("Wilfred", [{name:"Drake"}])       → "Wilfred · feat. Drake"
//   formatArtistCredit("Wilfred", [{name:"A"},{name:"B"}]) → "Wilfred · feat. A, B"
//   formatArtistCredit(null, [{name:"Drake"}])            → "feat. Drake"
//
// Empty/whitespace names are skipped. Returns "" only when both inputs
// produce no displayable text — callers usually fall back to "Unknown artist".
export function formatArtistCredit(
  artistName: string | null | undefined,
  collabArtists: CollabArtist[] | null | undefined
): string {
  const lead = artistName?.trim() || "";
  const feats =
    (collabArtists ?? [])
      .map((c) => c.name?.trim())
      .filter((n): n is string => Boolean(n));
  const featStr = feats.length > 0 ? `feat. ${feats.join(", ")}` : "";
  if (lead && featStr) return `${lead} · ${featStr}`;
  if (lead) return lead;
  if (featStr) return featStr;
  return "";
}

// For places that want the feat list on its own line (lockscreen MediaSession,
// inline secondary text under a track row, etc.).
export function joinCollabArtistNames(
  collabArtists: CollabArtist[] | null | undefined
): string {
  return (collabArtists ?? [])
    .map((c) => c.name?.trim())
    .filter((n): n is string => Boolean(n))
    .join(", ");
}

// Normalize a list before writing: trim names, drop empties, de-dupe by
// user_id (when set) or lowercased-name (when free-text).
function dedupe(list: CollabArtist[]): CollabArtist[] {
  const seen = new Set<string>();
  const out: CollabArtist[] = [];
  for (const c of list) {
    const name = c.name?.trim();
    if (!name) continue;
    const key = c.user_id ? `u:${c.user_id}` : `n:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, ...(c.user_id ? { user_id: c.user_id } : {}) });
  }
  return out;
}

export async function setAlbumCollabArtists(
  albumId: string,
  next: CollabArtist[]
): Promise<CollabArtist[]> {
  const clean = dedupe(next);
  const { error } = await supabase
    .from("albums")
    .update({ collab_artists: clean })
    .eq("id", albumId);
  if (error) throw error;
  return clean;
}

export async function setTrackCollabArtists(
  trackId: string,
  next: CollabArtist[] | null
): Promise<CollabArtist[] | null> {
  const clean = next === null ? null : dedupe(next);
  const { error } = await supabase
    .from("tracks")
    .update({ collab_artists: clean })
    .eq("id", trackId);
  if (error) throw error;
  return clean;
}
