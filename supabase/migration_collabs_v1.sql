-- Stagehand collabs v1: invite-share members with allow_editing become full
-- editors on the album. Editor = same edit power as the owner over tracks,
-- versions, and share_links. They cannot delete the album, change
-- collaborator membership, or change ownership.
--
-- Mental model: a share link is the join token; toggling its allow_editing
-- promotes every member of that share to editor on the album the share
-- points at. Reuses share_members entirely — no new collaborator table.
--
-- Idempotent.

-- ============ schema: share_links.allow_editing ============

alter table public.share_links
  add column if not exists allow_editing boolean not null default false;

-- ============ helper: is_album_editor(album_id) ============
-- True if the caller is a member of an active invite share for this album
-- that has allow_editing = true. SECURITY DEFINER so RLS policies on the
-- caller side don't need to grant read on share_members / share_links.

create or replace function public.is_album_editor(p_album_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from share_links sl
    join share_members sm on sm.share_link_id = sl.id
    where sl.album_id = p_album_id
      and sl.allow_editing = true
      and sl.revoked = false
      and sl.visibility = 'invite'
      and sm.user_id = auth.uid()
  );
$$;
grant execute on function public.is_album_editor(uuid) to authenticated;

-- Convenience: also accept a track id, for policies on tracks/versions.
create or replace function public.is_track_editor(p_track_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from tracks t
    join share_links sl on sl.album_id = t.album_id
    join share_members sm on sm.share_link_id = sl.id
    where t.id = p_track_id
      and sl.allow_editing = true
      and sl.revoked = false
      and sl.visibility = 'invite'
      and sm.user_id = auth.uid()
  );
$$;
grant execute on function public.is_track_editor(uuid) to authenticated;

-- ============ RLS: tracks ============

drop policy if exists "tracks owner all" on public.tracks;
drop policy if exists "tracks owner or editor read" on public.tracks;
drop policy if exists "tracks owner or editor write" on public.tracks;

-- Read: owner OR editor of the album.
create policy "tracks owner or editor read" on public.tracks
  for select to authenticated
  using (
    exists (select 1 from albums a where a.id = tracks.album_id and a.owner_id = auth.uid())
    or public.is_album_editor(tracks.album_id)
  );

-- Write (insert/update/delete): same — editors can rename, reorder, change
-- status, replace audio (via versions), add tracks, delete tracks.
create policy "tracks owner or editor write" on public.tracks
  for all to authenticated
  using (
    exists (select 1 from albums a where a.id = tracks.album_id and a.owner_id = auth.uid())
    or public.is_album_editor(tracks.album_id)
  )
  with check (
    exists (select 1 from albums a where a.id = tracks.album_id and a.owner_id = auth.uid())
    or public.is_album_editor(tracks.album_id)
  );

-- ============ RLS: versions ============

drop policy if exists "versions owner all" on public.versions;
drop policy if exists "versions owner or editor" on public.versions;

create policy "versions owner or editor" on public.versions
  for all to authenticated
  using (
    exists (
      select 1 from tracks t
      join albums a on a.id = t.album_id
      where t.id = versions.track_id and a.owner_id = auth.uid()
    )
    or public.is_track_editor(versions.track_id)
  )
  with check (
    exists (
      select 1 from tracks t
      join albums a on a.id = t.album_id
      where t.id = versions.track_id and a.owner_id = auth.uid()
    )
    or public.is_track_editor(versions.track_id)
  );

-- ============ RLS: share_links ============
-- Editors can create / revoke their OWN share links on the album. The owner
-- still sees and manages everyone's; an editor sees their own + the owner's.
-- Simpler v1: editors see and manage all share_links on the album. Restrict
-- later if it becomes a real concern.

drop policy if exists "owner manages share_links" on public.share_links;
drop policy if exists "share_links owner or editor" on public.share_links;

create policy "share_links owner or editor" on public.share_links
  for all to authenticated
  using (
    -- Track-share path
    (share_links.track_id is not null and (
      exists (
        select 1 from tracks t
        join albums a on a.id = t.album_id
        where t.id = share_links.track_id and a.owner_id = auth.uid()
      )
      or public.is_track_editor(share_links.track_id)
    ))
    or
    -- Album-share path
    (share_links.album_id is not null and (
      exists (select 1 from albums a where a.id = share_links.album_id and a.owner_id = auth.uid())
      or public.is_album_editor(share_links.album_id)
    ))
  )
  with check (
    (share_links.track_id is not null and (
      exists (
        select 1 from tracks t
        join albums a on a.id = t.album_id
        where t.id = share_links.track_id and a.owner_id = auth.uid()
      )
      or public.is_track_editor(share_links.track_id)
    ))
    or
    (share_links.album_id is not null and (
      exists (select 1 from albums a where a.id = share_links.album_id and a.owner_id = auth.uid())
      or public.is_album_editor(share_links.album_id)
    ))
  );

-- ============ RLS: albums ============
-- Editors get SELECT on the album so they can render its header / list it
-- in their library. UPDATE/DELETE/INSERT stay owner-only.

drop policy if exists "albums owner all" on public.albums;
drop policy if exists "albums owner manage" on public.albums;
drop policy if exists "albums editor read" on public.albums;

create policy "albums owner manage" on public.albums
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "albums editor read" on public.albums
  for select to authenticated
  using (public.is_album_editor(albums.id));

-- ============ Storage: audio bucket reads for editors ============
-- An editor needs to fetch signed URLs for the owner's existing audio
-- objects so they can listen to / replace them. The current owner-only
-- policy keyed off the user-id folder prefix doesn't cover that. Extend
-- the read policy to also allow callers who are editors of the album
-- containing the version with that storage_path.

drop policy if exists "audio owner read" on storage.objects;
drop policy if exists "audio owner or editor read" on storage.objects;

create policy "audio owner or editor read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'audio'
    and (
      -- Owner of the user-id folder
      auth.uid()::text = (storage.foldername(name))[1]
      -- OR an editor of an album that has a version pointing at this path
      or exists (
        select 1 from public.versions v
        join public.tracks t on t.id = v.track_id
        where v.storage_path = storage.objects.name
          and public.is_album_editor(t.album_id)
      )
    )
  );

-- ============ list_collaborating_albums RPC ============
-- Returns albums where the caller is an active editor. Used by the
-- "Shared with me" section of the library.

create or replace function public.list_collaborating_albums()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb) into v_result
  from (
    select distinct on (a.id)
      jsonb_build_object(
        'id', a.id,
        'title', a.title,
        'artwork_url', a.artwork_url,
        'status', a.status,
        'is_single', coalesce(a.is_single, false),
        'owner_id', a.owner_id,
        'owner_artist_name', coalesce(p.artist_name, u.raw_user_meta_data->>'artist_name'),
        'created_at', a.created_at
      ) as row,
      a.created_at
    from share_links sl
    join share_members sm on sm.share_link_id = sl.id
    join albums a on a.id = sl.album_id
    left join auth.users u on u.id = a.owner_id
    left join profiles p on p.id = a.owner_id
    where sm.user_id = auth.uid()
      and sl.allow_editing = true
      and sl.revoked = false
      and sl.visibility = 'invite'
      and a.owner_id <> auth.uid()  -- exclude own albums (e.g. self-test shares)
    order by a.id, a.created_at desc
  ) sub;
  return v_result;
end;
$$;
grant execute on function public.list_collaborating_albums() to authenticated;

notify pgrst, 'reload schema';
