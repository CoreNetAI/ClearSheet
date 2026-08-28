-- ============================================================================
-- ClearSheet — bi-weekly 1:1 meetings
-- Every cycle (14 days by default) the scheduler shuffles active, accepted
-- employees into sequential slots inside working hours. Each meeting gets one
-- email, sent a fixed number of hours (24 by default) before it starts, to the
-- employee and every meeting conductor. The Zoom meeting is created when that
-- email goes out, not when the cycle is generated, to stay under Zoom's daily
-- meeting-create limit. Admin-only; the cron job uses the service role.
-- ============================================================================

create table if not exists public.meeting_cycles (
  id                        uuid primary key default gen_random_uuid(),
  starts_on                 date not null unique,
  ends_on                   date not null,
  timezone                  text not null,
  slot_count                integer not null default 0,
  eligible_count            integer not null default 0,
  -- Employees who didn't fit because there were more employees than slots.
  unscheduled_employee_ids  uuid[] not null default '{}',
  -- The meeting settings used to build this cycle, for reference.
  settings                  jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table if not exists public.meetings (
  id                 uuid primary key default gen_random_uuid(),
  cycle_id           uuid not null references public.meeting_cycles(id) on delete cascade,
  employee_id        uuid not null references public.profiles(id) on delete cascade,
  starts_at          timestamptz not null,
  duration_minutes   integer not null check (duration_minutes between 5 and 240),
  status             text not null default 'scheduled'
                       check (status in ('scheduled', 'canceled')),
  cancel_reason      text,
  canceled_at        timestamptz,
  canceled_by        uuid references public.profiles(id) on delete set null,
  zoom_meeting_id    text,
  zoom_join_url      text,
  -- When the "your meeting is tomorrow" email went out. Null = not sent yet.
  invite_sent_at     timestamptz,
  -- Set while a cron run is sending, so overlapping runs never double-send.
  invite_claimed_at  timestamptz,
  attempts           integer not null default 0,
  last_attempt_at    timestamptz,
  last_error         text,
  -- Bumped on every reschedule so calendar apps update the same event.
  sequence           integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One live meeting per employee per cycle, and never two at the same moment.
create unique index if not exists uq_meetings_cycle_employee
  on public.meetings(cycle_id, employee_id) where status = 'scheduled';
create unique index if not exists uq_meetings_starts_at
  on public.meetings(starts_at) where status = 'scheduled';
create index if not exists idx_meetings_due
  on public.meetings(starts_at) where status = 'scheduled' and invite_sent_at is null;
create index if not exists idx_meetings_cycle on public.meetings(cycle_id, starts_at);

drop trigger if exists trg_meetings_updated_at on public.meetings;
create trigger trg_meetings_updated_at
  before update on public.meetings
  for each row execute function public.set_updated_at();

alter table public.meeting_cycles enable row level security;
alter table public.meetings enable row level security;

drop policy if exists meeting_cycles_admin on public.meeting_cycles;
create policy meeting_cycles_admin on public.meeting_cycles
  for all to authenticated
  using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

drop policy if exists meetings_admin on public.meetings;
create policy meetings_admin on public.meetings
  for all to authenticated
  using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');
