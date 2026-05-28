-- Pin the artwork bucket's per-file cap to 50 MB so cover-art uploads
-- aren't silently capped by the project-level Global file size limit.
-- Idempotent.

update storage.buckets
   set file_size_limit = 52428800  -- 50 MiB in bytes
 where id = 'artwork';
