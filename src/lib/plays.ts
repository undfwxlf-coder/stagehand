import { supabase } from "./supabase";

const recorded = new Set<string>();

export async function recordPlay(trackId: string, opts: { slug?: string } = {}): Promise<void> {
  const key = `${trackId}:${opts.slug ?? "owner"}`;
  if (recorded.has(key)) return;
  recorded.add(key);
  try {
    const { error } = await supabase.rpc("record_play", {
      p_track_id: trackId,
      p_slug: opts.slug ?? null,
    });
    if (error) {
      // best-effort — don't block playback. Allow re-attempt if it failed.
      recorded.delete(key);
      console.warn("[plays] increment failed", error.message);
    }
  } catch (e) {
    recorded.delete(key);
    console.warn("[plays] increment threw", e);
  }
}

export function formatPlayCount(n: number | null | undefined): string {
  if (!n || n <= 0) return "0 plays";
  if (n < 1000) return `${n} ${n === 1 ? "play" : "plays"}`;
  if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, "")}k plays`;
  return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M plays`;
}
