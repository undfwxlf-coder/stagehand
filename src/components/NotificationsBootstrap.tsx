import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useNotifications, useToasts, type PlayNotification } from "../lib/notifications";

type RawPlay = {
  id: string;
  track_id: string;
  user_id: string | null;
  created_at: string;
};

export default function NotificationsBootstrap() {
  const { user } = useAuth();
  const setInitial = useNotifications((s) => s.setInitial);
  const push = useNotifications((s) => s.push);
  const showToast = useToasts((s) => s.show);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancel = false;

    // Caches to avoid re-fetching the same track/profile on every realtime row.
    const trackCache = new Map<string, string>(); // track_id -> title
    const profileCache = new Map<string, string | null>(); // user_id -> artist_name

    const resolveTrackTitle = async (trackId: string): Promise<string | null> => {
      if (trackCache.has(trackId)) return trackCache.get(trackId)!;
      const { data } = await supabase
        .from("tracks")
        .select("id, title")
        .eq("id", trackId)
        .maybeSingle();
      const title = (data as { title: string } | null)?.title ?? null;
      if (title) trackCache.set(trackId, title);
      return title;
    };

    const resolveListenerName = async (userId: string | null): Promise<string | null> => {
      if (!userId) return null;
      if (profileCache.has(userId)) return profileCache.get(userId) ?? null;
      const { data } = await supabase
        .from("profiles")
        .select("id, artist_name")
        .eq("id", userId)
        .maybeSingle();
      const name = ((data as { artist_name: string | null } | null)?.artist_name ?? null) || null;
      profileCache.set(userId, name);
      return name;
    };

    (async () => {
      // Initial fetch — RLS scopes plays to owners of the parent track.
      const { data, error } = await supabase
        .from("plays")
        .select("id, track_id, user_id, created_at, tracks(title)")
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancel || error || !data) return;

      const rows = (data as unknown as (RawPlay & { tracks: { title: string } | null })[]).filter(
        (r) => r.user_id !== user.id // skip the owner's own plays
      );

      const userIds = Array.from(
        new Set(rows.map((r) => r.user_id).filter((x): x is string => Boolean(x)))
      );
      if (userIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, artist_name")
          .in("id", userIds);
        if (profs) {
          for (const p of profs as { id: string; artist_name: string | null }[]) {
            profileCache.set(p.id, (p.artist_name ?? null) || null);
          }
        }
      }
      for (const r of rows) {
        if (r.tracks?.title) trackCache.set(r.track_id, r.tracks.title);
      }

      const items: PlayNotification[] = rows.map((r) => ({
        id: r.id,
        trackId: r.track_id,
        trackTitle: r.tracks?.title ?? "Unknown track",
        listenerName: r.user_id ? profileCache.get(r.user_id) ?? null : null,
        createdAt: r.created_at,
      }));
      if (!cancel) setInitial(items);
    })();

    // Realtime subscription — RLS already filters server-side to plays we can read.
    const channel = supabase
      .channel(`plays-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "plays" },
        async (payload) => {
          const row = payload.new as RawPlay;
          if (!row || row.user_id === user.id) return;
          const [title, name] = await Promise.all([
            resolveTrackTitle(row.track_id),
            resolveListenerName(row.user_id),
          ]);
          if (!title) return;
          const notif: PlayNotification = {
            id: row.id,
            trackId: row.track_id,
            trackTitle: title,
            listenerName: name,
            createdAt: row.created_at,
          };
          push(notif);
          showToast(notif);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancel = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user, setInitial, push, showToast]);

  return null;
}
