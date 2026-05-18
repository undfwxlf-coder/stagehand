-- Stagehand invite shares v2: membership-based access (auto-join).
--
-- Previously, invite-only shares required the artist to pre-list invitee
-- emails in share_invites. High friction; assumed the artist knew everyone's
-- email up front. Often it didn't match the real use case ("here's my new
-- demo, friends").
--
-- New model: an invite link is a *join token*. Anyone with the link who
-- signs in becomes a member of the share. Members keep access even after
-- the link's join window expires — the expiry only stops *new* joiners.
-- The artist sees the member roster. Revoking the link kicks everyone.
--
-- Idempotent — safe to re-run. Run in Supabase SQL Editor.

-- ============ share_members table ============

create table if not exists public.share_members (
  id uuid primary key default gen_random_uuid(),
  share_link_id uuid not null references public.share_links(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  constraint share_members_unique unique (share_link_id, user_id)
);
create index if not exists share_members_link_idx on public.share_members(share_link_id);
create index if not exists share_members_user_idx on public.share_members(user_id);

alter table public.share_members enable row level security;

-- Members can read their own membership rows. Artists read the full roster
-- for their own share via the list_share_members SECURITY DEFINER below.
drop policy if exists "members read own" on public.share_members;
create policy "members read own" on public.share_members
  for select to authenticated
  using (user_id = auth.uid());

-- ============ resolve_share (replace) ============
-- Membership check replaces the prior email-match. Members get continued
-- access past expiry; non-members auto-join while expiry is in the future.

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

  -- Visibility-specific access gates.
  if v_share.visibility = 'invite' then
    if auth.uid() is null then
      return jsonb_build_object('status', 'requires_signin');
    end if;
    select true into v_is_member from share_members
      where share_link_id = v_share.id and user_id = auth.uid();
    if not v_is_member then
      -- Not yet a member — auto-join if the join window is still open.
      if v_share.expires_at is not null and v_share.expires_at < now() then
        return jsonb_build_object('status', 'not_invited');
      end if;
      insert into share_members (share_link_id, user_id)
      values (v_share.id, auth.uid())
      on conflict (share_link_id, user_id) do nothing;
    end if;
  else
    -- 'link' (Public) — standard expiry check.
    if v_share.expires_at is not null and v_share.expires_at < now() then
      return jsonb_build_object('status', 'expired');
    end if;
    if v_share.require_account and auth.uid() is null then
      return jsonb_build_object('status', 'requires_signin');
    end if;
  end if;

  -- Consume single-use AFTER all access checks have passed.
  if v_share.single_use and v_share.consumed_at is null then
    update share_links set consumed_at = now() where id = v_share.id;
    v_share.consumed_at := now();
  end if;

  -- Return payload.
  if v_share.track_id is not null then
    select * into v_track from tracks where id = v_share.track_id;
    select * into v_version from versions where id = v_share.version_id;
    return jsonb_build_object(
      'status', 'ok',
      'type', 'track',
      'link', to_jsonb(v_share),
      'track', to_jsonb(v_track),
      'version', to_jsonb(v_version)
    );
  elsif v_share.album_id is not null then
    select * into v_album from albums where id = v_share.album_id;
    return jsonb_build_object(
      'status', 'ok',
      'type', 'album',
      'link', to_jsonb(v_share),
      'album', jsonb_build_object(
        'id', v_album.id,
        'title', v_album.title,
        'artwork_url', v_album.artwork_url
      ),
      'tracks', coalesce(v_share.payload, '[]'::jsonb)
    );
  else
    return jsonb_build_object('status', 'not_found');
  end if;
end;
$$;
grant execute on function public.resolve_share(text) to anon, authenticated;

-- ============ list_share_members ============

create or replace function public.list_share_members(p_share_link_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_owns boolean;
begin
  -- Caller must own the share (track owner or album owner).
  select exists (
    select 1 from share_links sl
    left join tracks t on t.id = sl.track_id
    left join albums at_ on at_.id = t.album_id
    left join albums a on a.id = sl.album_id
    where sl.id = p_share_link_id
      and (at_.owner_id = auth.uid() or a.owner_id = auth.uid())
  ) into v_owns;
  if not v_owns then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(row order by joined_at desc), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'user_id', m.user_id,
      'artist_name', coalesce(p.artist_name, u.raw_user_meta_data->>'artist_name'),
      'email', u.email,
      'avatar_url', p.avatar_url,
      'joined_at', m.joined_at
    ) as row, m.joined_at
    from share_members m
    left join auth.users u on u.id = m.user_id
    left join profiles p on p.id = m.user_id
    where m.share_link_id = p_share_link_id
    order by m.joined_at desc
  ) sub;
  return v_result;
end;
$$;
grant execute on function public.list_share_members(uuid) to authenticated;

-- ============ record_play update ============
-- Members of an invite share keep playing rights past the join window.

create or replace function public.record_play(p_track_id uuid, p_slug text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share share_links;
begin
  if p_slug is not null then
    select * into v_share from share_links where slug = p_slug;
    if v_share.id is null or v_share.revoked then return; end if;
    if v_share.visibility = 'disabled' then return; end if;

    if v_share.visibility = 'invite' then
      -- Caller must be an existing member; expiry doesn't matter.
      if not exists (
        select 1 from share_members
        where share_link_id = v_share.id and user_id = auth.uid()
      ) then return; end if;
    else
      if v_share.expires_at is not null and v_share.expires_at < now() then return; end if;
    end if;

    if v_share.track_id is not null and v_share.track_id <> p_track_id then return; end if;
    if v_share.album_id is not null then
      if not exists (
        select 1 from tracks t where t.id = p_track_id and t.album_id = v_share.album_id
      ) then return; end if;
    end if;
    update share_links set play_count = play_count + 1 where id = v_share.id;
  else
    -- No slug → the caller is the artist listening in-app. Verify ownership.
    if not exists (
      select 1 from tracks t
      join albums a on a.id = t.album_id
      where t.id = p_track_id and a.owner_id = auth.uid()
    ) then return; end if;
  end if;

  insert into plays (track_id, user_id, share_slug)
  values (p_track_id, auth.uid(), p_slug);

  update tracks set play_count = coalesce(play_count, 0) + 1 where id = p_track_id;
end;
$$;
grant execute on function public.record_play(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
