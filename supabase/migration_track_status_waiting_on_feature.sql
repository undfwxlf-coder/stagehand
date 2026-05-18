-- Adds 'waiting_on_feature' to the allowed values for tracks.status.
-- Pipeline order: idea -> demo -> tracking -> waiting_on_feature -> mixing -> mastering -> released.
-- Idempotent.

do $$
declare
  cons_name text;
begin
  select conname into cons_name
  from pg_constraint
  where conrelid = 'public.tracks'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%'
    and pg_get_constraintdef(oid) ilike '%idea%';

  if cons_name is not null then
    execute format('alter table public.tracks drop constraint %I', cons_name);
  end if;
end$$;

alter table public.tracks
  add constraint tracks_status_check
  check (status in ('idea','demo','tracking','waiting_on_feature','mixing','mastering','released'));
