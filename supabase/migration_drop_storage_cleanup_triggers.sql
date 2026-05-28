-- Drops the AFTER-DELETE storage cleanup triggers introduced in
-- migration_storage_cleanup.sql.
--
-- Supabase now blocks direct DELETE on storage.objects with the error
-- "Direct deletion from storage tables is not allowed. Use the Storage
-- API." Our SECURITY DEFINER triggers trip that block, which rolls back
-- the parent track/album/profile delete and leaves the user stuck.
--
-- Until we route cleanup through the Storage API (edge function or
-- client-side), drop the triggers. Storage orphans accrue going-forward
-- — already a documented tradeoff for historical deletes.
--
-- Idempotent.

drop trigger if exists tr_delete_version_storage on public.versions;
drop function if exists public.delete_version_storage();

drop trigger if exists tr_delete_album_storage on public.albums;
drop function if exists public.delete_album_storage();

drop trigger if exists tr_delete_profile_avatar_storage on public.profiles;
drop function if exists public.delete_profile_avatar_storage();

notify pgrst, 'reload schema';
