-- Stagehand: redesigned listener UI needs the album artwork + the artist's
-- display name on a track share, so the now-playing layout has something to
-- render (large square cover, "Title / Artist" caption).
--
-- Previously resolve_share's track-share response only returned the track
-- row + version row; artwork and artist name lived on the parent album /
-- owner profile and weren't reachable by the listener (RLS).
--
-- This migration replaces resolve_share so that:
--   - track-share responses gain `album_artwork_url` and `artist_name`
--   - album-share responses gain `artist_name`
--
-- All other behavior (status codes, invite auto-join, expiry, single-use,
-- consume-after-checks) is unchanged. Idempotent.

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
    return jsonb_build_object(
      'status', 'ok',
      'type', 'track',
      'link', to_jsonb(v_share),
      'track', to_jsonb(v_track),
      'version', to_jsonb(v_version),
      'album_artwork_url', v_album_artwork,
      'artist_name', v_artist_name
    );
  elsif v_share.album_id is not null then
    select * into v_album from albums where id = v_share.album_id;
    v_owner_id := v_album.owner_id;
    select coalesce(p.artist_name, u.raw_user_meta_data->>'artist_name')
      into v_artist_name
      from auth.users u
      left join profiles p on p.id = u.id
      where u.id = v_owner_id;
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
      'artist_name', v_artist_name
    );
  else
    return jsonb_build_object('status', 'not_found');
  end if;
end;
$$;
grant execute on function public.resolve_share(text) to anon, authenticated;

notify pgrst, 'reload schema';
