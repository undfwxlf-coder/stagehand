-- Run in Supabase SQL editor on project ccsewcccfgqofvxsavne.
-- Adds: optional expiry (nullable expires_at) + single-use links.
-- Updates resolve_share to handle both.

alter table share_links alter column expires_at drop not null;
alter table share_links add column if not exists single_use boolean not null default false;
alter table share_links add column if not exists consumed_at timestamptz;

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
  v_email text;
begin
  select * into v_share from share_links where slug = p_slug;
  if v_share.id is null then
    return jsonb_build_object('status','not_found');
  end if;
  if v_share.revoked then
    return jsonb_build_object('status','revoked');
  end if;
  if v_share.expires_at is not null and v_share.expires_at < now() then
    return jsonb_build_object('status','expired');
  end if;
  if v_share.visibility = 'disabled' then
    return jsonb_build_object('status','disabled');
  end if;
  if v_share.single_use and v_share.consumed_at is not null then
    return jsonb_build_object('status','consumed');
  end if;

  if v_share.require_account and auth.uid() is null then
    return jsonb_build_object('status','requires_signin');
  end if;

  if v_share.visibility = 'invite' then
    if auth.uid() is null then
      return jsonb_build_object('status','requires_signin');
    end if;
    select email into v_email from auth.users where id = auth.uid();
    if v_email is null or not exists (
      select 1 from share_invites
      where share_link_id = v_share.id
        and lower(email) = lower(v_email)
    ) then
      return jsonb_build_object('status','not_invited');
    end if;
  end if;

  if v_share.single_use and v_share.consumed_at is null then
    update share_links set consumed_at = now() where id = v_share.id;
    v_share.consumed_at := now();
  end if;

  if v_share.track_id is not null then
    select * into v_track from tracks where id = v_share.track_id;
    select * into v_version from versions where id = v_share.version_id;
    return jsonb_build_object(
      'status','ok',
      'type','track',
      'link', to_jsonb(v_share),
      'track', to_jsonb(v_track),
      'version', to_jsonb(v_version)
    );
  elsif v_share.album_id is not null then
    select * into v_album from albums where id = v_share.album_id;
    return jsonb_build_object(
      'status','ok',
      'type','album',
      'link', to_jsonb(v_share),
      'album', jsonb_build_object(
        'id', v_album.id,
        'title', v_album.title,
        'artwork_url', v_album.artwork_url
      ),
      'tracks', coalesce(v_share.payload, '[]'::jsonb)
    );
  else
    return jsonb_build_object('status','not_found');
  end if;
end;
$$;

grant execute on function public.resolve_share(text) to anon, authenticated;
notify pgrst, 'reload schema';
