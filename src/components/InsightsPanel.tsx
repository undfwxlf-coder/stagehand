import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Play, Save } from "../lib/database.types";

interface ProfileLite {
  id: string;
  artist_name: string | null;
}

interface PlayRow extends Play {
  profile: ProfileLite | null;
}
interface SaveRow extends Save {
  profile: ProfileLite | null;
}

export default function InsightsPanel({ trackId, ownerId }: { trackId: string; ownerId: string }) {
  const [plays, setPlays] = useState<PlayRow[]>([]);
  const [saves, setSaves] = useState<SaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [playsRes, savesRes] = await Promise.all([
          supabase
            .from("plays")
            .select("*")
            .eq("track_id", trackId)
            .order("created_at", { ascending: false })
            .limit(100),
          supabase
            .from("saves")
            .select("*")
            .eq("track_id", trackId)
            .order("created_at", { ascending: false }),
        ]);
        if (cancel) return;
        if (playsRes.error) throw playsRes.error;
        if (savesRes.error) throw savesRes.error;

        const playRows = (playsRes.data ?? []) as Play[];
        const saveRows = (savesRes.data ?? []) as Save[];

        const userIds = Array.from(
          new Set(
            [
              ...playRows.map((p) => p.user_id).filter((x): x is string => Boolean(x)),
              ...saveRows.map((s) => s.user_id),
            ]
          )
        );
        let profileMap: Record<string, ProfileLite> = {};
        if (userIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, artist_name")
            .in("id", userIds);
          if (profs) {
            profileMap = Object.fromEntries(
              (profs as ProfileLite[]).map((p) => [p.id, p])
            );
          }
        }

        // Filter out the owner's own plays — these aren't useful for insight.
        const externalPlays = playRows
          .filter((p) => p.user_id !== ownerId)
          .map((p) => ({ ...p, profile: p.user_id ? profileMap[p.user_id] ?? null : null }));
        const enrichedSaves = saveRows.map((s) => ({
          ...s,
          profile: profileMap[s.user_id] ?? null,
        }));

        if (!cancel) {
          setPlays(externalPlays);
          setSaves(enrichedSaves);
          setLoading(false);
        }
      } catch (e) {
        if (!cancel) {
          setErr(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [trackId, ownerId]);

  if (loading) return <p className="text-sm text-muted py-6 text-center">Loading insights…</p>;
  if (err) return <p className="text-sm text-red-400 py-4">{err}</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Plays" value={plays.length} />
        <Stat label="Saves" value={saves.length} />
      </div>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted mb-2">Listeners</h3>
        {plays.length === 0 ? (
          <p className="text-sm text-muted">
            No external plays yet. Share a link to get listens.
          </p>
        ) : (
          <ul className="divide-y divide-edge bg-ink/30 rounded-lg overflow-hidden">
            {plays.map((p) => (
              <li key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <span className="text-sm text-white truncate">
                  {p.profile?.artist_name?.trim() || "Anonymous"}
                </span>
                <span className="text-xs text-muted shrink-0">{relativeTime(p.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted mb-2">Saves</h3>
        {saves.length === 0 ? (
          <p className="text-sm text-muted">
            Nobody has saved this track yet. Listeners with a Stagehand account can save it from the share link.
          </p>
        ) : (
          <ul className="divide-y divide-edge bg-ink/30 rounded-lg overflow-hidden">
            {saves.map((s) => (
              <li key={s.user_id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <span className="text-sm text-white truncate">
                  {s.profile?.artist_name?.trim() || "Anonymous"}
                </span>
                <span className="text-xs text-muted shrink-0">saved {relativeTime(s.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-ink/50 border border-edge rounded-lg p-4">
      <div className="text-2xl font-semibold text-white tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs uppercase tracking-wider text-muted mt-0.5">{label}</div>
    </div>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 4) return `${w}w ago`;
  return new Date(iso).toLocaleDateString();
}
