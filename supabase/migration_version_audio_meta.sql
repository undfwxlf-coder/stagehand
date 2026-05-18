-- Stagehand: lossless badge support — capture audio format metadata per version.
--
-- The app already streams the original uploaded file (no transcoding), so a
-- WAV / FLAC / AIFF upload is delivered to listeners losslessly. This migration
-- adds the columns needed to *display* that on the player so collaborators
-- know they're hearing the master, not a re-encode.
--
-- New columns on versions:
--   format         text   — "WAV" / "FLAC" / "AIFF" / "MP3" / "M4A" / "OGG" / …
--   sample_rate    int    — Hz (e.g. 44100, 48000, 96000)
--   is_lossless    bool   — convenience flag derived from format
--
-- For pre-existing rows we backfill from the storage_path extension. That's
-- correct for format / lossless; sample_rate can't be inferred without reading
-- the file, so it stays NULL until the file is re-uploaded or a future
-- backfill job runs.
--
-- Idempotent.

alter table public.versions
  add column if not exists format text,
  add column if not exists sample_rate int,
  add column if not exists is_lossless boolean;

-- Backfill from storage_path extension where the column is null.
update public.versions
set
  format = case lower(split_part(storage_path, '.', -1))
    when 'wav'  then 'WAV'
    when 'wave' then 'WAV'
    when 'flac' then 'FLAC'
    when 'aiff' then 'AIFF'
    when 'aif'  then 'AIFF'
    when 'mp3'  then 'MP3'
    when 'm4a'  then 'M4A'
    when 'aac'  then 'AAC'
    when 'ogg'  then 'OGG'
    when 'opus' then 'OPUS'
    else null
  end,
  is_lossless = lower(split_part(storage_path, '.', -1)) in ('wav','wave','flac','aiff','aif')
where format is null;

notify pgrst, 'reload schema';
