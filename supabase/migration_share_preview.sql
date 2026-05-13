-- Run in Supabase SQL editor on project ccsewcccfgqofvxsavne.
-- Adds resolve_share_preview: a lightweight, read-only RPC used by the
-- Netlify edge function that rewrites OG meta tags on /listen/<slug>.
--
-- Differences vs. resolve_share:
--   * Does NOT consume single-use links (scrapers must not burn shares).
--   * Does NOT return audio URLs / signed URLs / version data.
--   * Returns 'unavailable' for revoked/expired/disabled/consumed shares
--     so unfurls fall back to the generic Stagehand image.
--   * Always exposes title + artwork even for invite-only / requires-signin
--     shares — the unfurl needs to look real even when the recipient must
--     sign in to actually listen.

drop function if exists public.resolve_share_preview(text);

create or replace function public.resolve_share_preview(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share share_links;
  v_track tracks;
  v_album albums;
  v_artist text;
begin
  select * into v_share from share_links where slug = p_slug;
  if v_share.id is null then
    return jsonb_build_object('status','not_found');
  end if;
  if v_share.revoked
     or (v_share.expires_at is not null and v_share.expires_at < now())
     or v_share.visibility = 'disabled'
     or (v_share.single_use and v_share.consumed_at is not null) then
    return jsonb_build_object('status','unavailable');
  end if;

  if v_share.track_id is not null then
    select * into v_track from tracks where id = v_share.track_id;
    if v_track.id is null then
      return jsonb_build_object('status','unavailable');
    end if;
    select * into v_album from albums where id = v_track.album_id;
    if v_album.id is not null then
      select artist_name into v_artist from profiles where id = v_album.owner_id;
    end if;
    return jsonb_build_object(
      'status','ok',
      'kind','track',
      'title', v_track.title,
      'artist_name', v_artist,
      'artwork_url', v_album.artwork_url
    );
  elsif v_share.album_id is not null then
    select * into v_album from albums where id = v_share.album_id;
    if v_album.id is null then
      return jsonb_build_object('status','unavailable');
    end if;
    select artist_name into v_artist from profiles where id = v_album.owner_id;
    return jsonb_build_object(
      'status','ok',
      'kind','album',
      'title', v_album.title,
      'artist_name', v_artist,
      'artwork_url', v_album.artwork_url
    );
  end if;
  return jsonb_build_object('status','unavailable');
end;
$$;

grant execute on function public.resolve_share_preview(text) to anon, authenticated;
notify pgrst, 'reload schema';
