export type AlbumStatus =
  | "writing"
  | "recording"
  | "mixing"
  | "mastering"
  | "released";

export type TrackStatus =
  | "idea"
  | "demo"
  | "tracking"
  | "waiting_on_feature"
  | "mixing"
  | "mastering"
  | "released";

export interface Profile {
  id: string;
  artist_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface Album {
  id: string;
  owner_id: string;
  title: string;
  artwork_url: string | null;
  target_release_date: string | null;
  status: AlbumStatus;
  created_at: string;
}

export interface Track {
  id: string;
  album_id: string;
  title: string;
  position: number;
  status: TrackStatus;
  notes: string | null;
  bpm: number | null;
  song_key: string | null;
  play_count: number;
  allow_download: boolean;
  current_version_id: string | null;
  editor_settings: unknown | null;
  created_at: string;
}

export interface Version {
  id: string;
  track_id: string;
  label: string;
  storage_path: string;
  duration_sec: number | null;
  peaks: number[] | null;
  uploaded_at: string;
}

export type ShareVisibility = "link" | "invite" | "disabled";

export interface ShareLink {
  id: string;
  // Polymorphic: exactly one of track_id / album_id is set (DB-enforced).
  track_id: string | null;
  album_id: string | null;
  version_id: string | null;
  slug: string;
  signed_url: string | null;
  expires_at: string | null;
  created_at: string;
  revoked: boolean;
  play_count: number;
  visibility: ShareVisibility;
  require_account: boolean;
  single_use: boolean;
  consumed_at: string | null;
  // Snapshot of tracks + signed URLs at share creation time (album shares only).
  payload: unknown | null;
}

export interface ShareInvite {
  id: string;
  share_link_id: string;
  email: string;
  created_at: string;
}

export interface Play {
  id: string;
  track_id: string;
  user_id: string | null;
  share_slug: string | null;
  created_at: string;
}

export interface Save {
  user_id: string;
  track_id: string;
  share_link_id: string | null;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      albums: { Row: Album; Insert: Partial<Album>; Update: Partial<Album> };
      tracks: { Row: Track; Insert: Partial<Track>; Update: Partial<Track> };
      versions: { Row: Version; Insert: Partial<Version>; Update: Partial<Version> };
    };
  };
}
