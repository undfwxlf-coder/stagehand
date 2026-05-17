import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export interface AdminStats {
  users: number;
  albums: number;
  tracks: number;
  versions: number;
  plays: number;
  shares_active: number;
  shares_total: number;
  saves: number;
  signups_24h: number;
  signups_7d: number;
  plays_24h: number;
  plays_7d: number;
}

export interface AdminSignup {
  user_id: string;
  email: string | null;
  artist_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  album_count: number;
  track_count: number;
}

export interface AdminPlay {
  play_id: string;
  created_at: string;
  track_id: string;
  track_title: string | null;
  album_title: string | null;
  owner_artist_name: string | null;
  listener_user_id: string | null;
  listener_email: string | null;
  listener_artist_name: string | null;
  share_slug: string | null;
}

export interface AdminShare {
  id: string;
  slug: string;
  type: "track" | "album";
  target_title: string | null;
  visibility: string;
  revoked: boolean;
  created_at: string;
  expires_at: string | null;
  play_count: number;
  owner_email: string | null;
  owner_artist_name: string | null;
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const { data, error } = await supabase.rpc("admin_stats");
  if (error) throw error;
  return data as AdminStats;
}

export async function fetchRecentSignups(limit = 30): Promise<AdminSignup[]> {
  const { data, error } = await supabase.rpc("admin_recent_signups", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as AdminSignup[];
}

export async function fetchRecentPlays(limit = 50): Promise<AdminPlay[]> {
  const { data, error } = await supabase.rpc("admin_recent_plays", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as AdminPlay[];
}

export async function fetchRecentShares(limit = 30): Promise<AdminShare[]> {
  const { data, error } = await supabase.rpc("admin_recent_shares", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as AdminShare[];
}

// Cached admin-check: one rpc call per signed-in session.
export function useIsAdmin(): { isAdmin: boolean; loading: boolean } {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    let cancel = false;
    supabase
      .rpc("is_admin")
      .then(({ data, error }) => {
        if (cancel) return;
        if (error) {
          // RPC missing or other error — fail closed.
          setIsAdmin(false);
        } else {
          setIsAdmin(Boolean(data));
        }
        setLoading(false);
      });
    return () => { cancel = true; };
  }, [user]);

  return { isAdmin, loading };
}
