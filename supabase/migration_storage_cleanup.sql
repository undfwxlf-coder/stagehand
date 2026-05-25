-- Stagehand: sweep orphaned storage objects when their parent DB rows are
-- deleted.
--
-- Today, deleting an album cascades through tracks → versions → share_links
-- at the DB layer, but the underlying audio files in the `audio` bucket and
-- artwork in the `artwork` bucket stay behind. Nothing breaks but storage
-- costs grow with every delete. Same for profile avatars on account
-- deletion.
--
-- Three SECURITY DEFINER triggers, all idempotent:
--   versions  AFTER DELETE → drop audio object at OLD.storage_path
--   albums    AFTER DELETE → drop artwork object derived from artwork_url
--   profiles  AFTER DELETE → drop avatar object derived from avatar_url
--
-- The album / profile triggers extract the storage path from the public
-- URL by stripping everything up to and including the bucket name. URLs
-- come from supabase.storage.from(bucket).getPublicUrl(path), so the
-- format is stable: `<...>/storage/v1/object/public/<bucket>/<path>`.
--
-- Safe to re-run.

-- ============ versions → audio ============

create or replace function public.delete_version_storage()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if OLD.storage_path is not null and OLD.storage_path <> '' then
    delete from storage.objects
    where bucket_id = 'audio' and name = OLD.storage_path;
  end if;
  return OLD;
end;
$$;

drop trigger if exists tr_delete_version_storage on public.versions;
create trigger tr_delete_version_storage
  after delete on public.versions
  for each row
  execute function public.delete_version_storage();

-- ============ albums → artwork ============

create or replace function public.delete_album_storage()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_marker text := '/artwork/';
  v_pos int;
  v_path text;
begin
  if OLD.artwork_url is null or OLD.artwork_url = '' then
    return OLD;
  end if;
  v_pos := position(v_marker in OLD.artwork_url);
  if v_pos = 0 then
    return OLD;
  end if;
  v_path := substring(OLD.artwork_url from v_pos + char_length(v_marker));
  -- Strip any querystring (signed URLs aren't used for public artwork but
  -- guard just in case).
  v_path := split_part(v_path, '?', 1);
  if v_path <> '' then
    delete from storage.objects
    where bucket_id = 'artwork' and name = v_path;
  end if;
  return OLD;
end;
$$;

drop trigger if exists tr_delete_album_storage on public.albums;
create trigger tr_delete_album_storage
  after delete on public.albums
  for each row
  execute function public.delete_album_storage();

-- ============ profiles → avatars (artwork bucket) ============

create or replace function public.delete_profile_avatar_storage()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_marker text := '/artwork/';
  v_pos int;
  v_path text;
begin
  if OLD.avatar_url is null or OLD.avatar_url = '' then
    return OLD;
  end if;
  v_pos := position(v_marker in OLD.avatar_url);
  if v_pos = 0 then
    return OLD;
  end if;
  v_path := substring(OLD.avatar_url from v_pos + char_length(v_marker));
  v_path := split_part(v_path, '?', 1);
  if v_path <> '' then
    delete from storage.objects
    where bucket_id = 'artwork' and name = v_path;
  end if;
  return OLD;
end;
$$;

drop trigger if exists tr_delete_profile_avatar_storage on public.profiles;
create trigger tr_delete_profile_avatar_storage
  after delete on public.profiles
  for each row
  execute function public.delete_profile_avatar_storage();

notify pgrst, 'reload schema';
