-- ============================================================================
-- ClearSheet — admin helpers
-- Database size readout for the admin storage page (free tier is 500 MB).
-- ============================================================================

create or replace function public.db_size_bytes()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select pg_database_size(current_database());
$$;
