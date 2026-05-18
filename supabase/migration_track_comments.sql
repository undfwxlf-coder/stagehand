-- Stagehand: timestamped comments on shared tracks.
--
-- Listeners (signed-in only) can pin reactions and short text comments to a
-- specific playhead position on a track. The artist sees feedback aggregated
-- across all shares of the track; listeners on a given share see comments
-- left through that same share (the artist's annotations to that audience
-- included). Different invite groups stay isolated from each other.
--
-- Access flows through three SECURITY DEFINER RPCs so RLS stays simple:
--   list_track_comments(track_id, slug?)  → comments visible to the caller
--   post_track_comment(track_id, slug?, body, timestamp_sec, is_reaction, version_id?)
--   delete_track_comment(comment_id)      → owner of comment OR track owner
--
-- The table is added to the supabase_realtime publication so the artist's
-- notifications bell can pick up new comments on their tracks in real time.
--
-- Idempotent — safe to re-run.

-- ============ track_comments table ============

create table if not exists public.track_comments (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  share_link_id uuid references public.share_links(id) on delete set null,
  version_id uuid references public.versions(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  timestamp_sec numeric not null default 0,
  is_reaction boolean not null default false,
  created_at timestamptz not null default now(),
  constraint track_comments_body_len check (char_length(body) between 1 and 1000),
  constraint track_comments_timestamp_nonneg check (timestamp_sec >= 0)
);
create index if not exists track_comments_track_idx
  on public.track_comments(track_id, timestamp_sec);
create index if not exists track_comments_user_idx
  on public.track_comments(user_id);
create index if not exists track_comments_share_idx
  on public.track_comments(share_link_id);

alter table public.track_comments enable row level security;

-- Owners of the track can read all comments on their tracks (drives the
-- artist's notifications bell + Realtime subscription). Listeners read via
-- the RPC, never directly — so no listener SELECT policy is required.
drop policy if exists "track owner reads comments" on public.track_comments;
create policy "track owner reads comments" on public.track_comments
  for select to authenticated
  using (
    exists (
      select 1 from public.tracks t
      join public.albums a on a.id = t.album_id
      where t.id = track_comments.track_id and a.owner_id = auth.uid()
    )
  );

-- INSERT / DELETE intentionally have no policy — they only happen through
-- the SECURITY DEFINER RPCs below, which run with elevated privileges.

-- ============ list_track_comments ============

create or replace function public.list_track_comments(
  p_track_id uuid,
  p_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share share_links;
  v_is_owner boolean := false;
  v_can_listen boolean := false;
  v_filter_share uuid;
  v_result jsonb;
begin
  -- Track owner gets everything; their identity is checked first.
  select exists (
    select 1 from tracks t
    join albums a on a.id = t.album_id
    where t.id = p_track_id and a.owner_id = auth.uid()
  ) into v_is_owner;

  if not v_is_owner then
    -- Non-owner must come through a valid share slug.
    if p_slug is null or auth.uid() is null then
      return '[]'::jsonb;
    end if;
    select * into v_share from share_links where slug = p_slug;
    if v_share.id is null or v_share.revoked then return '[]'::jsonb; end if;
    if v_share.visibility = 'disabled' then return '[]'::jsonb; end if;

    -- The slug must reach this track (direct or via album payload).
    if v_share.track_id is not null and v_share.track_id <> p_track_id then
      return '[]'::jsonb;
    end if;
    if v_share.album_id is not null then
      if not exists (
        select 1 from tracks t where t.id = p_track_id and t.album_id = v_share.album_id
      ) then return '[]'::jsonb; end if;
    end if;

    -- Same access check as record_play / resolve_share.
    if v_share.visibility = 'invite' then
      if not exists (
        select 1 from share_members
        where share_link_id = v_share.id and user_id = auth.uid()
      ) then return '[]'::jsonb; end if;
      v_can_listen := true;
    else
      if v_share.expires_at is not null and v_share.expires_at < now() then
        return '[]'::jsonb;
      end if;
      if v_share.require_account and auth.uid() is null then
        return '[]'::jsonb;
      end if;
      v_can_listen := true;
    end if;

    if not v_can_listen then return '[]'::jsonb; end if;
    v_filter_share := v_share.id;
  end if;

  select coalesce(jsonb_agg(row order by timestamp_sec asc, created_at asc), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'id', c.id,
      'track_id', c.track_id,
      'share_link_id', c.share_link_id,
      'version_id', c.version_id,
      'user_id', c.user_id,
      'body', c.body,
      'timestamp_sec', c.timestamp_sec,
      'is_reaction', c.is_reaction,
      'created_at', c.created_at,
      'artist_name', coalesce(p.artist_name, u.raw_user_meta_data->>'artist_name'),
      'avatar_url', p.avatar_url,
      'is_mine', (c.user_id = auth.uid())
    ) as row, c.timestamp_sec, c.created_at
    from track_comments c
    left join auth.users u on u.id = c.user_id
    left join profiles p on p.id = c.user_id
    where c.track_id = p_track_id
      and (
        v_is_owner
        or c.share_link_id = v_filter_share
        or c.user_id = auth.uid()
      )
  ) sub;
  return v_result;
end;
$$;
grant execute on function public.list_track_comments(uuid, text) to authenticated;

-- ============ post_track_comment ============

create or replace function public.post_track_comment(
  p_track_id uuid,
  p_slug text default null,
  p_body text default '',
  p_timestamp_sec numeric default 0,
  p_is_reaction boolean default false,
  p_version_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share share_links;
  v_is_owner boolean := false;
  v_share_id uuid;
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'sign-in required';
  end if;
  if char_length(coalesce(p_body, '')) = 0 then
    raise exception 'body required';
  end if;
  if char_length(p_body) > 1000 then
    raise exception 'body too long';
  end if;
  if p_timestamp_sec < 0 then
    p_timestamp_sec := 0;
  end if;

  select exists (
    select 1 from tracks t
    join albums a on a.id = t.album_id
    where t.id = p_track_id and a.owner_id = auth.uid()
  ) into v_is_owner;

  if not v_is_owner then
    if p_slug is null then
      raise exception 'no access';
    end if;
    select * into v_share from share_links where slug = p_slug;
    if v_share.id is null or v_share.revoked then raise exception 'no access'; end if;
    if v_share.visibility = 'disabled' then raise exception 'no access'; end if;

    if v_share.track_id is not null and v_share.track_id <> p_track_id then
      raise exception 'no access';
    end if;
    if v_share.album_id is not null then
      if not exists (
        select 1 from tracks t where t.id = p_track_id and t.album_id = v_share.album_id
      ) then raise exception 'no access'; end if;
    end if;

    if v_share.visibility = 'invite' then
      if not exists (
        select 1 from share_members
        where share_link_id = v_share.id and user_id = auth.uid()
      ) then raise exception 'no access'; end if;
    else
      if v_share.expires_at is not null and v_share.expires_at < now() then
        raise exception 'no access';
      end if;
      if v_share.require_account and auth.uid() is null then
        raise exception 'sign-in required';
      end if;
    end if;
    v_share_id := v_share.id;
  elsif p_slug is not null then
    -- Owner posting through a specific share context (annotating to that audience).
    select id into v_share_id from share_links where slug = p_slug;
  end if;

  insert into track_comments (track_id, share_link_id, version_id, user_id, body, timestamp_sec, is_reaction)
  values (p_track_id, v_share_id, p_version_id, auth.uid(), p_body, p_timestamp_sec, coalesce(p_is_reaction, false))
  returning id into v_new_id;

  return jsonb_build_object('id', v_new_id);
end;
$$;
grant execute on function public.post_track_comment(uuid, text, text, numeric, boolean, uuid) to authenticated;

-- ============ delete_track_comment ============

create or replace function public.delete_track_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comment track_comments;
  v_is_owner boolean := false;
begin
  if auth.uid() is null then
    raise exception 'sign-in required';
  end if;
  select * into v_comment from track_comments where id = p_comment_id;
  if v_comment.id is null then return; end if;

  if v_comment.user_id = auth.uid() then
    delete from track_comments where id = p_comment_id;
    return;
  end if;

  select exists (
    select 1 from tracks t
    join albums a on a.id = t.album_id
    where t.id = v_comment.track_id and a.owner_id = auth.uid()
  ) into v_is_owner;

  if v_is_owner then
    delete from track_comments where id = p_comment_id;
    return;
  end if;

  raise exception 'no access';
end;
$$;
grant execute on function public.delete_track_comment(uuid) to authenticated;

-- ============ Realtime publication ============
-- Lets the artist's notifications bell subscribe to INSERTs on their tracks.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'track_comments'
  ) then
    execute 'alter publication supabase_realtime add table public.track_comments';
  end if;
end$$;

notify pgrst, 'reload schema';
