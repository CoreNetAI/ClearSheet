-- ============================================================================
-- ClearSheet — effective-dated assignment rate history
-- A project's bill/pay rate can change mid-assignment. Instead of overwriting
-- the single rate on `assignments`, we keep a timeline here: each period is
-- priced using the rate whose effective_from is the latest on-or-before the
-- period's start. The assignment's own bill_rate/pay_rate/overtime_multiplier
-- columns are kept as the denormalized "current" rate (= latest row).
-- ============================================================================

create table if not exists public.assignment_rates (
  id                  uuid primary key default gen_random_uuid(),
  assignment_id       uuid not null references public.assignments(id) on delete cascade,
  bill_rate           numeric(10,2) not null default 0 check (bill_rate >= 0),
  pay_rate            numeric(10,2) not null default 0 check (pay_rate >= 0),
  overtime_multiplier numeric(4,2) not null default 1.5 check (overtime_multiplier >= 1),
  effective_from      date not null,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists idx_assignment_rates_lookup
  on public.assignment_rates (assignment_id, effective_from desc);

-- Backfill: one row per existing assignment, using its current rate, effective
-- from the assignment's start date.
insert into public.assignment_rates
  (assignment_id, bill_rate, pay_rate, overtime_multiplier, effective_from)
select id, bill_rate, pay_rate, overtime_multiplier, start_date
from public.assignments
on conflict do nothing;

-- RLS: mirror assignments_select (staff or the assignment's own employee may
-- read — the employee's timesheet action computes amounts server-side); only
-- admins write.
alter table public.assignment_rates enable row level security;

create policy assignment_rates_select on public.assignment_rates
  for select to authenticated
  using (
    public.user_role() in ('admin', 'finance', 'reviewer')
    or exists (
      select 1 from public.assignments a
      where a.id = assignment_rates.assignment_id
        and a.employee_id = auth.uid()
    )
  );

create policy assignment_rates_write_admin on public.assignment_rates
  for all to authenticated
  using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');
