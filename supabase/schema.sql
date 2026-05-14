-- Stagehand schema. Run in Supabase SQL editor (one shot is fine).

-- ============ TABLES ============

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  artist_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists albums (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  artwork_url text,
  target_release_date date,
  status text not null default 'writing'
    check (status in ('writing','recording','mixing','mastering','released')),
  created_at timestamptz not null default now()
);
create index if not exists albums_owner_idx on albums(owner_id);

create table if not exists tracks (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references albums(id) on delete cascade,
  title text not null,
  position int not null default 0,
  status text not null default 'idea'
    check (status in ('idea','demo','tracking','mixing','mastering','released')),
  notes text,
  bpm numeric,
  song_key text,
  play_count int not null default 0,
  current_version_id uuid,
  created_at timestamptz not null default now()
);
alter table tracks add column if not exists bpm numeric;
alter table tracks add column if not exists song_key text;
alter table tracks add column if not exists play_count int not null default 0;
alter table tracks add column if not exists allow_download boolean not null default false;

create or replace function public.increment_track_play(p_track_id uuid, p_slug text default null)
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
    if v_share.id is null then return; end if;
    if v_share.revoked then return; end if;
    if v_share.expires_at < now() then return; end if;
    if v_share.track_id <> p_track_id then return; end if;
    update share_links set play_count = play_count + 1 where id = v_share.id;
  else
    if auth.uid() is null then return; end if;
    if not exists (
      select 1 from tracks t
      join albums a on a.id = t.album_id
      where t.id = p_track_id and a.owner_id = auth.uid()
    ) then
      return;
    end if;
  end if;
  update tracks set play_count = coalesce(play_count, 0) + 1 where id = p_track_id;
end;
$$;

grant execute on function public.increment_track_play(uuid, text) to anon, authenticated;
create index if not exists tracks_album_idx on tracks(album_id);

create table if not exists versions (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references tracks(id) on delete cascade,
  label text not null default 'v1',
  storage_path text not null,
  duration_sec numeric,
  peaks jsonb,
  uploaded_at timestamptz not null default now()
);
create index if not exists versions_track_idx on versions(track_id);

create table if not exists share_links (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references tracks(id) on delete cascade,
  version_id uuid not null references versions(id) on delete cascade,
  slug text not null unique,
  signed_url text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked boolean not null default false,
  play_count int not null default 0
);
create index if not exists share_links_slug_idx on share_links(slug);
create index if not exists share_links_track_idx on share_links(track_id);

alter table tracks
  add constraint tracks_current_version_fk
  foreign key (current_version_id) references versions(id) on delete set null
  not valid;

-- ============ AUTO-CREATE PROFILE ON SIGNUP ============

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, artist_name)
  values (new.id, nullif(new.raw_user_meta_data->>'artist_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============ ROW LEVEL SECURITY ============

alter table profiles enable row level security;
alter table albums enable row level security;
alter table tracks enable row level security;
alter table versions enable row level security;

drop policy if exists "profile self read" on profiles;
create policy "profile self read" on profiles
  for select using (auth.uid() = id);
drop policy if exists "profile self update" on profiles;
create policy "profile self update" on profiles
  for update using (auth.uid() = id);

drop policy if exists "albums owner all" on albums;
create policy "albums owner all" on albums
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "tracks owner all" on tracks;
create policy "tracks owner all" on tracks
  for all using (
    exists (select 1 from albums a where a.id = tracks.album_id and a.owner_id = auth.uid())
  ) with check (
    exists (select 1 from albums a where a.id = tracks.album_id and a.owner_id = auth.uid())
  );

drop policy if exists "versions owner all" on versions;
create policy "versions owner all" on versions
  for all using (
    exists (
      select 1 from tracks t
      join albums a on a.id = t.album_id
      where t.id = versions.track_id and a.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from tracks t
      join albums a on a.id = t.album_id
      where t.id = versions.track_id and a.owner_id = auth.uid()
    )
  );

alter table share_links enable row level security;
drop policy if exists "owner manages share_links" on share_links;
create policy "owner manages share_links" on share_links
  for all using (
    exists (
      select 1 from tracks t
      join albums a on a.id = t.album_id
      where t.id = share_links.track_id and a.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from tracks t
      join albums a on a.id = t.album_id
      where t.id = share_links.track_id and a.owner_id = auth.uid()
    )
  );

-- NOTE: We intentionally do NOT add public read policies on share_links,
-- tracks, or versions. The `resolve_share` RPC (security definer) handles
-- all public listen access. Adding cross-referencing public-read policies
-- here causes infinite recursion with share_invites.

-- ============ STORAGE BUCKET ============
-- After running this, also: Storage -> Create bucket -> name "audio", PRIVATE.
-- Then run the storage policies below.

insert into storage.buckets (id, name, public, file_size_limit)
values ('audio', 'audio', false, 1073741824)  -- 1 GiB per-file cap
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "audio owner read" on storage.objects;
create policy "audio owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "audio owner write" on storage.objects;
create policy "audio owner write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "audio owner update" on storage.objects;
create policy "audio owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "audio owner delete" on storage.objects;
create policy "audio owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);

-- Optional: artwork bucket (public for easy display)
insert into storage.buckets (id, name, public)
values ('artwork', 'artwork', true)
on conflict (id) do nothing;

drop policy if exists "artwork public read" on storage.objects;
create policy "artwork public read" on storage.objects
  for select using (bucket_id = 'artwork');

drop policy if exists "artwork owner write" on storage.objects;
create policy "artwork owner write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'artwork' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "artwork owner update" on storage.objects;
create policy "artwork owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'artwork' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "artwork owner delete" on storage.objects;
create policy "artwork owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'artwork' and (storage.foldername(name))[1] = auth.uid()::text);
