-- Stagehand: singles live on tracks, not albums.
--
-- In music industry terms a "single" is one track inside an album that the
-- artist releases ahead of (or alongside) the full album. It usually carries
-- its own cover art separate from the album cover.
--
-- This migration:
--   - Adds tracks.is_single (default false)
--   - Adds tracks.single_cover_url (nullable text) for the per-single cover
--   - Drops albums.is_single (column was shipped in a prior attempt that
--     scoped this to the wrong level; safe to drop, never used in UI on prod)
--
-- Idempotent. Re-running cleans up the old albums column if it's still
-- around.

alter table public.tracks
  add column if not exists is_single boolean not null default false;

alter table public.tracks
  add column if not exists single_cover_url text;

alter table public.albums
  drop column if exists is_single;
