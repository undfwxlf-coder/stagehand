-- Stagehand: collaborating artists ("feat." credits + edit access for
-- linked users).
--
-- Two storage spots:
--   albums.collab_artists  jsonb  default '[]'  not null
--   tracks.collab_artists  jsonb  nullable      (overrides album when set)
--
-- Each entry: { "name": text, "user_id": uuid? }
--   - free-text entries (no user_id) are credit-only — pure attribution
--   - linked entries (user_id present) ALSO grant editor permissions on
--     the album, via the is_album_editor / is_track_editor helpers below
--
-- Listener-facing surfaces render "ArtistName feat. A, B" by reading
-- resolve_share's collab_artists return field (track override wins if
-- the track's value is non-null).
--
-- Idempotent.

-- ============ schema ============

alter table public.albums
  add column if not exists collab_artists jsonb not null default '[]'::jsonb;

alter table public.tracks
  add column if not exists collab_artists jsonb;

-- GIN indexes so the editor-permission helper can probe by user_id quickly
-- as the lists grow.
create index if not exists albums_collab_artists_gin
  on public.albums using gin (collab_artists);

create index if not exists tracks_collab_artists_gin
  on public.tracks using gin (collab_artists);

-- ============ editor helpers ============
-- Extend the existing helpers so that linked collab artists (entries
-- whose user_id matches auth.uid()) also count as editors of the album.
-- Free-text entries (no user_id) are credit-only and do NOT grant any
-- edit power.

create or replace function public.is_album_editor(p_album_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1
      from share_links sl
      join share_members sm on sm.share_link_id = sl.id
      where sl.album_id = p_album_id
        and sl.allow_editing = true
        and sl.revoked = false
        and sl.visibility = 'invite'
        and sm.user_id = auth.uid()
    )
    or exists (
      select 1
      from albums a,
           jsonb_array_elements(a.collab_artists) as entry
      where a.id = p_album_id
        and (entry->>'user_id')::uuid = auth.uid()
    );
$$;

create or replace function public.is_track_editor(p_track_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1
      from tracks t
      join share_links sl on sl.album_id = t.album_id
      join share_members sm on sm.share_link_id = sl.id
      where t.id = p_track_id
        and sl.allow_editing = true
        and sl.revoked = false
        and sl.visibility = 'invite'
        and sm.user_id = auth.uid()
    )
    or exists (
      select 1
      from tracks t
      join albums a on a.id = t.album_id,
           jsonb_array_elements(a.collab_artists) as entry
      where t.id = p_track_id
        and (entry->>'user_id')::uuid = auth.uid()
    );
$$;

-- list_collaborating_albums was returning albums where the caller is a
-- share-member editor. Extend it to also return albums where the caller
-- is a linked collab artist, so those projects show up under
-- "Shared with me" in the library.

create or replace function public.list_collaborating_albums()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb)
    into v_result
  from (
    select
      jsonb_build_object(
        'id',                  a.id,
        'title',               a.title,
        'artwork_url',         a.artwork_url,
        'status',              a.status,
        'created_at',          a.created_at,
        'owner_id',            a.owner_id,
        'owner_artist_name',   coalesce(p.artist_name, u.raw_user_meta_data->>'artist_name')
      ) as row,
      a.created_at
    from albums a
    left join auth.users u on u.id = a.owner_id
    left join profiles p on p.id = a.owner_id
    where a.owner_id <> auth.uid()
      and (
        exists (
          select 1
          from share_links sl
          join share_members sm on sm.share_link_id = sl.id
          where sl.album_id = a.id
            and sl.allow_editing = true
            and sl.revoked = false
            and sl.visibility = 'invite'
            and sm.user_id = auth.uid()
        )
        or exists (
          select 1
          from jsonb_array_elements(a.collab_artists) as entry
          where (entry->>'user_id')::uuid = auth.uid()
        )
      )
  ) sub;
  return v_result;
end;
$$;

grant execute on function public.list_collaborating_albums() to authenticated;

-- ============ resolve_share returns merged collab_artists ============
-- Track shares: returns track.collab_artists if non-null, else album.collab_artists.
-- Album shares: returns album.collab_artists.

drop function if exists public.resolve_share(text);

create or replace function public.resolve_share(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share share_links;
  v_track tracks;
  v_version versions;
  v_album albums;
  v_owner_id uuid;
  v_artist_name text;
  v_album_artwork text;
  v_collab_artists jsonb;
  v_is_member boolean := false;
begin
  select * into v_share from share_links where slug = p_slug;
  if v_share.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_share.revoked then
    return jsonb_build_object('status', 'revoked');
  end if;
  if v_share.visibility = 'disabled' then
    return jsonb_build_object('status', 'disabled');
  end if;
  if v_share.single_use and v_share.consumed_at is not null then
    return jsonb_build_object('status', 'consumed');
  end if;

  if v_share.visibility = 'invite' then
    if auth.uid() is null then
      return jsonb_build_object('status', 'requires_signin');
    end if;
    select true into v_is_member from share_members
      where share_link_id = v_share.id and user_id = auth.uid();
    if not v_is_member then
      if v_share.expires_at is not null and v_share.expires_at < now() then
        return jsonb_build_object('status', 'not_invited');
      end if;
      insert into share_members (share_link_id, user_id)
      values (v_share.id, auth.uid())
      on conflict (share_link_id, user_id) do nothing;
    end if;
  else
    if v_share.expires_at is not null and v_share.expires_at < now() then
      return jsonb_build_object('status', 'expired');
    end if;
    if v_share.require_account and auth.uid() is null then
      return jsonb_build_object('status', 'requires_signin');
    end if;
  end if;

  if v_share.single_use and v_share.consumed_at is null then
    update share_links set consumed_at = now() where id = v_share.id;
    v_share.consumed_at := now();
  end if;

  if v_share.track_id is not null then
    select * into v_track from tracks where id = v_share.track_id;
    select * into v_version from versions where id = v_share.version_id;
    select * into v_album from albums where id = v_track.album_id;
    v_owner_id := v_album.owner_id;
    v_album_artwork := v_album.artwork_url;
    select coalesce(p.artist_name, u.raw_user_meta_data->>'artist_name')
      into v_artist_name
      from auth.users u
      left join profiles p on p.id = u.id
      where u.id = v_owner_id;
    -- Track-level override wins if the track's value is non-null.
    v_collab_artists := coalesce(v_track.collab_artists, v_album.collab_artists, '[]'::jsonb);
    return jsonb_build_object(
      'status', 'ok',
      'type', 'track',
      'link', to_jsonb(v_share),
      'track', to_jsonb(v_track),
      'version', to_jsonb(v_version),
      'album_artwork_url', v_album_artwork,
      'artist_name', v_artist_name,
      'collab_artists', v_collab_artists
    );
  elsif v_share.album_id is not null then
    select * into v_album from albums where id = v_share.album_id;
    v_owner_id := v_album.owner_id;
    select coalesce(p.artist_name, u.raw_user_meta_data->>'artist_name')
      into v_artist_name
      from auth.users u
      left join profiles p on p.id = u.id
      where u.id = v_owner_id;
    v_collab_artists := coalesce(v_album.collab_artists, '[]'::jsonb);
    return jsonb_build_object(
      'status', 'ok',
      'type', 'album',
      'link', to_jsonb(v_share),
      'album', jsonb_build_object(
        'id', v_album.id,
        'title', v_album.title,
        'artwork_url', v_album.artwork_url
      ),
      'tracks', coalesce(v_share.payload, '[]'::jsonb),
      'artist_name', v_artist_name,
      'collab_artists', v_collab_artists
    );
  else
    return jsonb_build_object('status', 'not_found');
  end if;
end;
$$;
grant execute on function public.resolve_share(text) to anon, authenticated;

notify pgrst, 'reload schema';
