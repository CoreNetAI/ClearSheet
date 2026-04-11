-- ============================================================================
-- ClearSheet — schema (tables, indexes, triggers, helper functions)
-- Section 6 of the spec. Money is numeric; timestamps are timestamptz.
-- RLS is enabled and policed in the next migration (…_rls.sql).
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  email         text,
  role          text not null default 'employee'
                  check (role in ('employee','reviewer','finance','account_manager','admin')),
  status        text not null default 'active'
                  check (status in ('active','inactive')),
  auth_provider text check (auth_provider in ('email','google','microsoft')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  contact_name           text,
  contact_email          text,
  billing_period         text check (billing_period in ('weekly','biweekly','semimonthly','monthly')),
  account_manager_id     uuid references public.profiles(id) on delete set null,
  billing_address        text,
  quickbooks_customer_id text,
  status                 text not null default 'active'
                           check (status in ('active','inactive')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_clients_am on public.clients(account_manager_id);

create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- assignments  (employee <-> client, carries bill/pay rate)
-- ---------------------------------------------------------------------------
create table if not exists public.assignments (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.profiles(id) on delete restrict,
  client_id           uuid not null references public.clients(id) on delete restrict,
  title               text,
  bill_rate           numeric(10,2) not null default 0 check (bill_rate >= 0),
  pay_rate            numeric(10,2) not null default 0 check (pay_rate >= 0),
  currency            text not null default 'USD',
  employment_type     text check (employment_type in ('W2','1099')),
  overtime_multiplier numeric(4,2) not null default 1.5 check (overtime_multiplier >= 1),
  billing_period      text check (billing_period in ('weekly','biweekly','semimonthly','monthly')),
  start_date          date not null,
  end_date            date,
  status              text not null default 'active' check (status in ('active','ended')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_assignments_employee on public.assignments(employee_id);
create index if not exists idx_assignments_client on public.assignments(client_id);
create index if not exists idx_assignments_status on public.assignments(status);

create trigger trg_assignments_updated_at
  before update on public.assignments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- timesheets
-- ---------------------------------------------------------------------------
create table if not exists public.timesheets (
  id                   uuid primary key default gen_random_uuid(),
  assignment_id        uuid not null references public.assignments(id) on delete restrict,
  employee_id          uuid not null references public.profiles(id) on delete restrict,
  period_start         date not null,
  period_end           date not null,
  status               text not null default 'draft'
                         check (status in ('draft','submitted','approved','invoiced','paid')),
  total_regular_hours  numeric(8,2) not null default 0,
  total_ot_hours       numeric(8,2) not null default 0,
  bill_amount          numeric(12,2) not null default 0,
  pay_amount           numeric(12,2) not null default 0,
  submitted_at         timestamptz,
  reviewed_by          uuid references public.profiles(id) on delete set null,
  reviewed_at          timestamptz,
  review_note          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (assignment_id, period_start)
);

create index if not exists idx_timesheets_employee on public.timesheets(employee_id);
create index if not exists idx_timesheets_assignment on public.timesheets(assignment_id);
create index if not exists idx_timesheets_status on public.timesheets(status);
create index if not exists idx_timesheets_period on public.timesheets(period_start, period_end);

create trigger trg_timesheets_updated_at
  before update on public.timesheets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- timesheet_entries  (per-day hours)
-- ---------------------------------------------------------------------------
create table if not exists public.timesheet_entries (
  id           uuid primary key default gen_random_uuid(),
  timesheet_id uuid not null references public.timesheets(id) on delete cascade,
  work_date    date not null,
  hours        numeric(5,2) not null default 0 check (hours >= 0 and hours <= 24),
  entry_type   text not null default 'regular'
                 check (entry_type in ('regular','overtime','holiday','pto')),
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_entries_timesheet on public.timesheet_entries(timesheet_id);

-- ---------------------------------------------------------------------------
-- timesheet_attachments  (file metadata; bytes live in R2)
-- ---------------------------------------------------------------------------
create table if not exists public.timesheet_attachments (
  id              uuid primary key default gen_random_uuid(),
  timesheet_id    uuid not null references public.timesheets(id) on delete cascade,
  r2_object_key   text not null,
  file_name       text,
  attachment_type text not null default 'approved_timesheet'
                    check (attachment_type in ('approved_timesheet','approval_screenshot')),
  uploaded_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists idx_attachments_timesheet on public.timesheet_attachments(timesheet_id);

-- ---------------------------------------------------------------------------
-- invoice number sequence (per-year, concurrency safe)
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_counters (
  year     int primary key,
  last_seq int not null default 0
);

create or replace function public.next_invoice_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  y int := extract(year from now())::int;
  s int;
begin
  insert into public.invoice_counters(year, last_seq)
    values (y, 1)
  on conflict (year)
    do update set last_seq = public.invoice_counters.last_seq + 1
  returning last_seq into s;
  return 'INV-' || y::text || '-' || lpad(s::text, 4, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id                        uuid primary key default gen_random_uuid(),
  client_id                 uuid not null references public.clients(id) on delete restrict,
  invoice_number            text not null unique,
  period_start              date,
  period_end                date,
  status                    text not null default 'draft'
                              check (status in ('draft','sent','paid','void')),
  subtotal                  numeric(12,2) not null default 0,
  total                     numeric(12,2) not null default 0,
  issued_date               date,
  due_date                  date,
  sent_at                   timestamptz,
  paid_at                   timestamptz,
  stripe_payment_link       text,
  stripe_payment_intent_id  text,
  quickbooks_invoice_id     text,
  created_by                uuid references public.profiles(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists idx_invoices_client on public.invoices(client_id);
create index if not exists idx_invoices_status on public.invoices(status);

create trigger trg_invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- invoice_line_items  (one per invoiced timesheet, snapshot fields)
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_line_items (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid not null references public.invoices(id) on delete cascade,
  timesheet_id     uuid references public.timesheets(id) on delete set null,
  employee_name    text,
  assignment_title text,
  hours            numeric(8,2) not null default 0,
  bill_rate        numeric(10,2) not null default 0,
  amount           numeric(12,2) not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists idx_line_items_invoice on public.invoice_line_items(invoice_id);
create index if not exists idx_line_items_timesheet on public.invoice_line_items(timesheet_id);

-- ---------------------------------------------------------------------------
-- integration_connections  (encrypted OAuth tokens, e.g. QuickBooks)
-- ---------------------------------------------------------------------------
create table if not exists public.integration_connections (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null check (provider in ('quickbooks')),
  access_token  text,
  refresh_token text,
  realm_id      text,
  expires_at    timestamptz,
  connected_by  uuid references public.profiles(id) on delete set null,
  status        text not null default 'connected'
                  check (status in ('connected','disconnected','error')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (provider)
);

create trigger trg_integration_connections_updated_at
  before update on public.integration_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  invoice_id          uuid references public.invoices(id) on delete set null,
  provider            text not null check (provider in ('stripe')),
  provider_payment_id text,
  amount              numeric(12,2) not null default 0,
  status              text not null default 'pending'
                        check (status in ('pending','succeeded','failed','refunded')),
  raw                 jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists idx_payments_invoice on public.payments(invoice_id);
-- Idempotency: a given Stripe event/payment id is recorded at most once.
create unique index if not exists uq_payments_provider_id
  on public.payments(provider, provider_payment_id)
  where provider_payment_id is not null;

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles(id) on delete set null,
  entity_type text,
  entity_id   uuid,
  action      text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_entity on public.audit_log(entity_type, entity_id);
create index if not exists idx_audit_actor on public.audit_log(actor_id);

-- ---------------------------------------------------------------------------
-- Auth → profile bootstrap. Creates a profiles row whenever an auth user
-- is created (email signup or OAuth). Role/full_name come from metadata if
-- present; admins can promote roles afterward.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  provider text;
  resolved_role text;
begin
  provider := coalesce(new.raw_app_meta_data->>'provider', 'email');
  if provider not in ('email','google','microsoft') then
    -- Supabase reports azure for Microsoft Entra
    if provider = 'azure' then
      provider := 'microsoft';
    else
      provider := 'email';
    end if;
  end if;

  resolved_role := coalesce(new.raw_user_meta_data->>'role', 'employee');
  if resolved_role not in ('employee','reviewer','finance','account_manager','admin') then
    resolved_role := 'employee';
  end if;

  insert into public.profiles (id, email, full_name, role, auth_provider)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    resolved_role,
    provider
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
