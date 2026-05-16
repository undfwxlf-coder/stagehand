-- Catch-up migration: brings a stagehand Supabase project up to the schema
-- the app code expects but that isn't fully described in schema.sql.
--
-- Specifically, this adds:
--   * Album-level columns on share_links (album_id, visibility, require_account, payload)
--     and relaxes track_id/version_id/signed_url to nullable so a row can be
--     EITHER a track share OR an album share. Adds a check constraint that
--     enforces exactly-one.
--   * share_invites table for invite-only shares.
--   * saves table (polymorphic track XOR album) so listeners can save shared
--     tracks/albums to their library.
--   * plays table (with anonymous-user support via share_slug) so per-track
--     listen counts and the notifications bell work.
--   * RLS policies for all of the above scoped to the owner (artist).
--
-- Idempotent — safe to re-run. Run in Supabase → SQL Editor on the target
-- project. After this, also run migration_share_optional_expiry_single_use.sql
-- and migration_share_preview.sql if they haven't been applied yet.

-- ============ SHARE_LINKS: polymorphic columns ============

alter table public.share_links
  add column if not exists album_id uuid references public.albums(id) on delete cascade;

alter table public.share_links alter column track_id drop not null;
alter table public.share_links alter column version_id drop not null;
alter table public.share_links alter column signed_url drop not null;

alter table public.share_links
  add column if not exists visibility text not null default 'link';

alter table public.share_links
  add column if not exists require_account boolean not null default false;

alter table public.share_links
  add column if not exists payload jsonb;

-- Visibility may only be one of these three (matches ShareVisibility in TS).
alter table public.share_links drop constraint if exists share_links_visibility_check;
alter table public.share_links
  add constraint share_links_visibility_check
  check (visibility in ('link', 'invite', 'disabled'));

-- Exactly one of track_id / album_id must be set.
alter table public.share_links drop constraint if exists share_links_target_xor;
alter table public.share_links
  add constraint share_links_target_xor
  check (
    (track_id is not null and album_id is null)
    or (track_id is null and album_id is not null)
  );

create index if not exists share_links_album_idx on public.share_links(album_id);

-- ============ SHARE_INVITES ============

create table if not exists public.share_invites (
  id uuid primary key default gen_random_uuid(),
  share_link_id uuid not null references public.share_links(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists share_invites_link_email_idx
  on public.share_invites (share_link_id, lower(email));

alter table public.share_invites enable row level security;

drop policy if exists "owner manages share_invites" on public.share_invites;
create policy "owner manages share_invites" on public.share_invites
  for all to authenticated
  using (
    exists (
      select 1
      from public.share_links sl
      left join public.tracks t on t.id = sl.track_id
      left join public.albums at on at.id = t.album_id
      left join public.albums aa on aa.id = sl.album_id
      where sl.id = share_invites.share_link_id
        and (at.owner_id = auth.uid() or aa.owner_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.share_links sl
      left join public.tracks t on t.id = sl.track_id
      left join public.albums at on at.id = t.album_id
      left join public.albums aa on aa.id = sl.album_id
      where sl.id = share_invites.share_link_id
        and (at.owner_id = auth.uid() or aa.owner_id = auth.uid())
    )
  );

-- ============ SAVES ============

create table if not exists public.saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id uuid references public.tracks(id) on delete cascade,
  album_id uuid references public.albums(id) on delete cascade,
  share_link_id uuid references public.share_links(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint saves_target_xor check (
    (track_id is not null and album_id is null)
    or (track_id is null and album_id is not null)
  ),
  constraint saves_track_unique unique (user_id, track_id),
  constraint saves_album_unique unique (user_id, album_id)
);
create index if not exists saves_user_idx on public.saves(user_id);

alter table public.saves enable row level security;

drop policy if exists "owner manages saves" on public.saves;
create policy "owner manages saves" on public.saves
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============ PLAYS ============

create table if not exists public.plays (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  share_slug text,
  created_at timestamptz not null default now()
);
create index if not exists plays_track_created_idx on public.plays (track_id, created_at desc);

alter table public.plays enable row level security;

-- Track owner can read plays for their own tracks (drives the notifications
-- bell and Insights panel). Inserts happen via record_play (SECURITY DEFINER).
drop policy if exists "owner reads plays" on public.plays;
create policy "owner reads plays" on public.plays
  for select to authenticated
  using (
    exists (
      select 1
      from public.tracks t
      join public.albums a on a.id = t.album_id
      where t.id = plays.track_id and a.owner_id = auth.uid()
    )
  );

-- Add to realtime publication so the live notification toasts fire.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plays'
  ) then
    alter publication supabase_realtime add table public.plays;
  end if;
end $$;

-- ============ record_play RPC ============

create or replace function public.record_play(p_track_id uuid, p_slug text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share share_links;
begin
  -- If a slug is supplied, validate the share before counting the play.
  if p_slug is not null then
    select * into v_share from share_links where slug = p_slug;
    if v_share.id is null or v_share.revoked then return; end if;
    if v_share.expires_at is not null and v_share.expires_at < now() then return; end if;
    if v_share.visibility = 'disabled' then return; end if;
    -- Track shares must match; album shares need the track in the album payload.
    if v_share.track_id is not null and v_share.track_id <> p_track_id then return; end if;
    if v_share.album_id is not null then
      if not exists (
        select 1 from tracks t where t.id = p_track_id and t.album_id = v_share.album_id
      ) then return; end if;
    end if;
    update share_links set play_count = play_count + 1 where id = v_share.id;
  else
    -- Anonymous play with no slug is only allowed if the caller owns the track
    -- (i.e. the artist is listening to their own track in-app).
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

-- ============ list_my_saves RPC ============

create or replace function public.list_my_saves()
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

  with rows as (
    select
      s.id as save_id,
      s.created_at,
      case when s.track_id is not null then 'track' else 'album' end as save_type,
      s.track_id,
      s.album_id,
      s.share_link_id,
      -- Track payload
      t.title as track_title,
      t.bpm as track_bpm,
      t.song_key as track_song_key,
      t.allow_download as track_allow_download,
      v.id as version_id,
      v.label as version_label,
      v.duration_sec as version_duration_sec,
      v.peaks as version_peaks,
      -- Track's share for playback
      tsl.signed_url as track_share_signed_url,
      tsl.slug as track_share_slug,
      tsl.revoked as track_share_revoked,
      tsl.expires_at as track_share_expires_at,
      tsl.visibility as track_share_visibility,
      -- Track parent album metadata
      ta.title as track_album_title,
      ta.artwork_url as track_album_artwork_url,
      tp.artist_name as track_artist_name,
      -- Album payload
      al.title as album_title,
      al.artwork_url as album_artwork_url,
      ap.artist_name as album_artist_name,
      asl.payload as album_share_payload,
      asl.slug as album_share_slug,
      asl.revoked as album_share_revoked,
      asl.expires_at as album_share_expires_at,
      asl.visibility as album_share_visibility
    from saves s
    left join tracks t on t.id = s.track_id
    left join versions v on v.id = t.current_version_id
    left join albums ta on ta.id = t.album_id
    left join profiles tp on tp.id = ta.owner_id
    left join share_links tsl on tsl.id = s.share_link_id and tsl.track_id is not null
    left join albums al on al.id = s.album_id
    left join profiles ap on ap.id = al.owner_id
    left join share_links asl on asl.id = s.share_link_id and asl.album_id is not null
    where s.user_id = auth.uid()
    order by s.created_at desc
  )
  select coalesce(jsonb_agg(
    case
      when save_type = 'track' then jsonb_build_object(
        'save_id', save_id,
        'save_type', 'track',
        'created_at', created_at,
        'share_revoked', track_share_revoked,
        'share_expires_at', track_share_expires_at,
        'share_visibility', track_share_visibility,
        'share_slug', track_share_slug,
        'item', jsonb_build_object(
          'track_id', track_id,
          'track_title', track_title,
          'track_bpm', track_bpm,
          'track_song_key', track_song_key,
          'album_title', track_album_title,
          'album_artwork_url', track_album_artwork_url,
          'artist_name', track_artist_name,
          'version_id', version_id,
          'version_label', version_label,
          'version_duration_sec', version_duration_sec,
          'version_peaks', version_peaks,
          'share_signed_url',
            case when track_share_revoked
              or (track_share_expires_at is not null and track_share_expires_at < now())
              or track_share_visibility = 'disabled'
              then null
              else track_share_signed_url
            end,
          'share_slug', track_share_slug
        )
      )
      else jsonb_build_object(
        'save_id', save_id,
        'save_type', 'album',
        'created_at', created_at,
        'share_revoked', album_share_revoked,
        'share_expires_at', album_share_expires_at,
        'share_visibility', album_share_visibility,
        'share_slug', album_share_slug,
        'item', jsonb_build_object(
          'album_id', album_id,
          'album_title', album_title,
          'album_artwork_url', album_artwork_url,
          'artist_name', album_artist_name,
          'share_payload',
            case when album_share_revoked
              or (album_share_expires_at is not null and album_share_expires_at < now())
              or album_share_visibility = 'disabled'
              then null
              else album_share_payload
            end,
          'share_slug', album_share_slug
        )
      )
    end
  ), '[]'::jsonb) into v_result from rows;

  return v_result;
end;
$$;
grant execute on function public.list_my_saves() to authenticated;
