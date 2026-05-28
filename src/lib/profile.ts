import { create } from "zustand";
import { supabase } from "./supabase";
import type { Profile } from "./database.types";

export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, artist_name, avatar_url, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function updateMyProfile(
  userId: string,
  patch: { artist_name?: string | null; avatar_url?: string | null }
): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("id, artist_name, avatar_url, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please pick an image file (JPG, PNG, WebP).");
  }
  if (file.size > 50 * 1024 * 1024) {
    throw new Error("Image must be under 50 MB.");
  }
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${userId}/avatar/avatar-${Date.now()}.${ext}`;
  const up = await supabase.storage.from("artwork").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (up.error) throw up.error;
  const { data: pub } = supabase.storage.from("artwork").getPublicUrl(path);
  return pub.publicUrl;
}

interface ProfileState {
  profile: Profile | null;
  load: (userId: string) => Promise<void>;
  set: (profile: Profile) => void;
  clear: () => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  load: async (userId) => {
    try {
      const p = await fetchMyProfile(userId);
      set({ profile: p });
    } catch {
      // ignore — UI surfaces auth/profile failures elsewhere
    }
  },
  set: (profile) => set({ profile }),
  clear: () => set({ profile: null }),
}));
