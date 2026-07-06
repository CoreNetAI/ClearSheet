-- ============================================================================
-- ClearSheet — auto-generated employee IDs (emp_code)
-- A stable, human-readable code on employee profiles so the same person can be
-- correlated across clients/assignments and exports. Assigned automatically
-- (never user-typed) via next_emp_code(); format EMP-0001. Only role='employee'
-- receives one; other roles stay null.
-- ============================================================================

alter table public.profiles
  add column if not exists emp_code text;

-- One code per person; multiple NULLs allowed (non-employees / unassigned).
create unique index if not exists uq_profiles_emp_code
  on public.profiles (emp_code)
  where emp_code is not null;

-- Concurrency-safe sequential allocator, mirroring next_invoice_number().
create sequence if not exists public.emp_code_seq;

create or replace function public.next_emp_code()
returns text
language sql
security definer
set search_path = public
as $$
  select 'EMP-' || lpad(nextval('public.emp_code_seq')::text, 4, '0');
$$;

grant execute on function public.next_emp_code() to authenticated;

-- Backfill existing employees in creation order.
do $$
declare
  r record;
begin
  for r in
    select id from public.profiles
    where role = 'employee' and emp_code is null
    order by created_at
  loop
    update public.profiles
      set emp_code = public.next_emp_code()
      where id = r.id;
  end loop;
end $$;
