-- Adds an editor_settings JSONB column to tracks for persisting Adjust/EQ
-- settings from the in-app editor. Idempotent.

alter table public.tracks
  add column if not exists editor_settings jsonb;

comment on column public.tracks.editor_settings is
  'Per-track edit settings from the in-app editor: speed, pitch, EQ bands, EQ bypass, delay, reverb.';
