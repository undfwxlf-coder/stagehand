-- Stagehand: mark an album as a single.
--
-- Adds a boolean flag on albums. When true:
--   - SINGLE badge renders on the library card, album page header, and the
--     listener's album-share view.
--   - The cover-upload affordance relabels itself as "Single cover."
--
-- Doesn't change anything about how tracks/versions/shares work — a single
-- is still an album row under the hood, just labeled differently in the UI.
--
-- Idempotent.

alter table public.albums
  add column if not exists is_single boolean not null default false;
