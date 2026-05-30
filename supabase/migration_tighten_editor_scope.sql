-- Tighten the collaborator trust model.
--
-- Previously (collabs v1, "simpler v1" by intent):
--   * Editors had FOR ALL on tracks / versions / share_links — they could
--     INSERT, UPDATE, and DELETE freely.
--   * In practice this meant: an editor could create a PUBLIC share link of
--     the owner's project without notification, and could cascade-delete
--     the entire project.
--
-- This migration splits the FOR ALL policies into per-action policies so
-- editors keep their editorial powers (adding tracks, replacing audio,
-- renaming, changing status, *revoking* existing shares, etc.) but cannot:
--   * Create NEW share links of the owner's project (owner-only).
--   * Delete tracks or versions (owner-only).
--
-- SELECT and UPDATE remain owner-or-editor across all three tables so
-- collaboration UX is unchanged. Idempotent.

-- ============ tracks ============

drop policy if exists "tracks owner or editor read" on public.tracks;
drop policy if exists "tracks owner or editor write" on public.tracks;
drop policy if exists "tracks owner or editor select" on public.tracks;
drop policy if exists "tracks owner or editor insert" on public.tracks;
drop policy if exists "tracks owner or editor update" on public.tracks;
drop policy if exists "tracks owner delete" on public.tracks;

create policy "tracks owner or editor select" on public.tracks
  for select to authenticated
  using (
    exists (select 1 from albums a where a.id = tracks.album_id and a.owner_id = auth.uid())
    or public.is_album_editor(tracks.album_id)
  );

create policy "tracks owner or editor insert" on public.tracks
  for insert to authenticated
  with check (
    exists (select 1 from albums a where a.id = tracks.album_id and a.owner_id = auth.uid())
    or public.is_album_editor(tracks.album_id)
  );

create policy "tracks owner or editor update" on public.tracks
  for update to authenticated
  using (
    exists (select 1 from albums a where a.id = tracks.album_id and a.owner_id = auth.uid())
    or public.is_album_editor(tracks.album_id)
  )
  with check (
    exists (select 1 from albums a where a.id = tracks.album_id and a.owner_id = auth.uid())
    or public.is_album_editor(tracks.album_id)
  );

create policy "tracks owner delete" on public.tracks
  for delete to authenticated
  using (
    exists (select 1 from albums a where a.id = tracks.album_id and a.owner_id = auth.uid())
  );

-- ============ versions ============

drop policy if exists "versions owner or editor" on public.versions;
drop policy if exists "versions owner or editor select" on public.versions;
drop policy if exists "versions owner or editor insert" on public.versions;
drop policy if exists "versions owner or editor update" on public.versions;
drop policy if exists "versions owner delete" on public.versions;

create policy "versions owner or editor select" on public.versions
  for select to authenticated
  using (
    exists (
      select 1 from tracks t
      join albums a on a.id = t.album_id
      where t.id = versions.track_id and a.owner_id = auth.uid()
    )
    or public.is_track_editor(versions.track_id)
  );

create policy "versions owner or editor insert" on public.versions
  for insert to authenticated
  with check (
    exists (
      select 1 from tracks t
      join albums a on a.id = t.album_id
      where t.id = versions.track_id and a.owner_id = auth.uid()
    )
    or public.is_track_editor(versions.track_id)
  );

create policy "versions owner or editor update" on public.versions
  for update to authenticated
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

create policy "versions owner delete" on public.versions
  for delete to authenticated
  using (
    exists (
      select 1 from tracks t
      join albums a on a.id = t.album_id
      where t.id = versions.track_id and a.owner_id = auth.uid()
    )
  );

-- ============ share_links ============
-- Editors keep SELECT / UPDATE / DELETE so they can audit + revoke
-- existing shares (a real collab workflow), but NEW shares are
-- owner-only — closing the "editor silently publishes a public link"
-- gap.

drop policy if exists "share_links owner or editor" on public.share_links;
drop policy if exists "share_links owner or editor select" on public.share_links;
drop policy if exists "share_links owner insert" on public.share_links;
drop policy if exists "share_links owner or editor update" on public.share_links;
drop policy if exists "share_links owner or editor delete" on public.share_links;

create policy "share_links owner or editor select" on public.share_links
  for select to authenticated
  using (
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

create policy "share_links owner insert" on public.share_links
  for insert to authenticated
  with check (
    (share_links.track_id is not null and
      exists (
        select 1 from tracks t
        join albums a on a.id = t.album_id
        where t.id = share_links.track_id and a.owner_id = auth.uid()
      )
    )
    or
    (share_links.album_id is not null and
      exists (select 1 from albums a where a.id = share_links.album_id and a.owner_id = auth.uid())
    )
  );

create policy "share_links owner or editor update" on public.share_links
  for update to authenticated
  using (
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

create policy "share_links owner or editor delete" on public.share_links
  for delete to authenticated
  using (
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

notify pgrst, 'reload schema';
