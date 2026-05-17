-- Stagehand admin layer. Run in Supabase SQL Editor.
--
-- Adds:
--   * `admins` table — allowlist of user IDs that can hit admin RPCs.
--   * `is_admin()` — cheap boolean for client + RLS use.
--   * `admin_stats()` — top-level counts and 24h/7d deltas.
--   * `admin_recent_signups()` — most recent signed-up users.
--   * `admin_recent_plays()` — most recent listen events with track + listener metadata.
--   * `admin_recent_shares()` — most recent share links with owner metadata.
--
-- All RPCs are SECURITY DEFINER and gate access via `admins`, so they
-- can safely read across users / auth.users without exposing data to
-- non-admins. Idempotent — safe to re-run.
--
-- After running: insert your own user_id into the admins table:
--   insert into admins (user_id) values ((select id from auth.users where email = 'YOU@EXAMPLE.COM'));

-- ============ admins table ============

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.admins enable row level security;

drop policy if exists "admins read" on public.admins;
create policy "admins read" on public.admins
  for select to authenticated
  using (user_id = auth.uid());

-- ============ is_admin() ============

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(select 1 from admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to authenticated;

-- ============ admin_stats() ============

create or replace function public.admin_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists(select 1 from admins where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'users',          (select count(*) from auth.users),
    'albums',         (select count(*) from albums),
    'tracks',         (select count(*) from tracks),
    'versions',       (select count(*) from versions),
    'plays',          (select count(*) from plays),
    'shares_active',  (select count(*) from share_links where not revoked),
    'shares_total',   (select count(*) from share_links),
    'saves',          (select count(*) from saves),
    'signups_24h',    (select count(*) from auth.users where created_at >= now() - interval '24 hours'),
    'signups_7d',     (select count(*) from auth.users where created_at >= now() - interval '7 days'),
    'plays_24h',      (select count(*) from plays where created_at >= now() - interval '24 hours'),
    'plays_7d',       (select count(*) from plays where created_at >= now() - interval '7 days')
  );
end;
$$;
grant execute on function public.admin_stats() to authenticated;

-- ============ admin_recent_signups(limit) ============

create or replace function public.admin_recent_signups(p_limit int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not exists(select 1 from admins where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
  select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'user_id',         u.id,
      'email',           u.email,
      'artist_name',     coalesce(p.artist_name, u.raw_user_meta_data->>'artist_name'),
      'created_at',      u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'album_count',     (select count(*) from albums where owner_id = u.id),
      'track_count',     (select count(*) from tracks t join albums a on a.id = t.album_id where a.owner_id = u.id)
    ) as row, u.created_at
    from auth.users u
    left join profiles p on p.id = u.id
    order by u.created_at desc
    limit p_limit
  ) sub;
  return v_result;
end;
$$;
grant execute on function public.admin_recent_signups(int) to authenticated;

-- ============ admin_recent_plays(limit) ============

create or replace function public.admin_recent_plays(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not exists(select 1 from admins where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
  select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'play_id',             pl.id,
      'created_at',          pl.created_at,
      'track_id',            pl.track_id,
      'track_title',         t.title,
      'album_title',         a.title,
      'owner_artist_name',   coalesce(prof.artist_name, ar.raw_user_meta_data->>'artist_name'),
      'listener_user_id',    pl.user_id,
      'listener_email',      lu.email,
      'listener_artist_name',coalesce(lprof.artist_name, lu.raw_user_meta_data->>'artist_name'),
      'share_slug',          pl.share_slug
    ) as row, pl.created_at
    from plays pl
    left join tracks t on t.id = pl.track_id
    left join albums a on a.id = t.album_id
    left join auth.users ar on ar.id = a.owner_id
    left join profiles prof on prof.id = a.owner_id
    left join auth.users lu on lu.id = pl.user_id
    left join profiles lprof on lprof.id = pl.user_id
    order by pl.created_at desc
    limit p_limit
  ) sub;
  return v_result;
end;
$$;
grant execute on function public.admin_recent_plays(int) to authenticated;

-- ============ admin_recent_shares(limit) ============

create or replace function public.admin_recent_shares(p_limit int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not exists(select 1 from admins where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
  select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'id',                sl.id,
      'slug',              sl.slug,
      'type',              case when sl.track_id is not null then 'track' else 'album' end,
      'target_title',      coalesce(t.title, a.title),
      'visibility',        sl.visibility,
      'revoked',           sl.revoked,
      'created_at',        sl.created_at,
      'expires_at',        sl.expires_at,
      'play_count',        sl.play_count,
      'owner_email',       u.email,
      'owner_artist_name', coalesce(prof.artist_name, u.raw_user_meta_data->>'artist_name')
    ) as row, sl.created_at
    from share_links sl
    left join tracks t on t.id = sl.track_id
    left join albums at_ on at_.id = t.album_id
    left join albums a on a.id = sl.album_id
    left join auth.users u on u.id = coalesce(at_.owner_id, a.owner_id)
    left join profiles prof on prof.id = u.id
    order by sl.created_at desc
    limit p_limit
  ) sub;
  return v_result;
end;
$$;
grant execute on function public.admin_recent_shares(int) to authenticated;

notify pgrst, 'reload schema';
