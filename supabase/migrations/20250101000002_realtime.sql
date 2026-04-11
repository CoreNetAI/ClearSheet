-- ============================================================================
-- ClearSheet — Realtime
-- Stream timesheet changes so the reviewer queue and submission dashboards
-- update live. Realtime respects RLS, so each subscriber only receives rows
-- their policies allow.
-- ============================================================================

-- Ensure the Supabase realtime publication exists (it does by default).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

-- Add timesheets to the publication (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'timesheets'
  ) then
    alter publication supabase_realtime add table public.timesheets;
  end if;
end
$$;

-- Include full row data on update/delete events for richer client payloads.
alter table public.timesheets replica identity full;
