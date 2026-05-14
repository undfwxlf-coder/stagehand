-- Lifts the per-file size cap on the audio bucket to 1 GiB so artists can
-- upload high-resolution WAV/AIFF masters (a 10-min 24-bit/96 kHz stereo
-- WAV is ~330 MB; a 5-min 24-bit/48 kHz one is ~85 MB).
--
-- NOTE: this only raises the *bucket* limit. Supabase also enforces a
-- project-wide "Global file size limit" in Dashboard -> Storage -> Settings.
-- A bucket cannot exceed it. On the free tier that ceiling is 50 MB; on Pro
-- it can be raised up to 50 GB. Bump it there too, otherwise this migration
-- is silently capped.
--
-- Idempotent.

update storage.buckets
   set file_size_limit = 1073741824  -- 1 GiB in bytes
 where id = 'audio';
