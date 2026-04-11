-- ============================================================================
-- ClearSheet — Row Level Security
-- Policies mirror the Section 4 permission matrix. The service_role key (used
-- only by trusted server code: webhooks, presign, seed, admin user creation)
-- bypasses RLS automatically. Everything else runs as the authenticated user.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Role helpers (SECURITY DEFINER → read profiles without recursive RLS)
-- ---------------------------------------------------------------------------
create or replace function public.user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.am_owns_client(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.clients c
    where c.id = cid and c.account_manager_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.profiles                enable row level security;
alter table public.clients                 enable row level security;
alter table public.assignments             enable row level security;
alter table public.timesheets              enable row level security;
alter table public.timesheet_entries       enable row level security;
alter table public.timesheet_attachments   enable row level security;
alter table public.invoices                enable row level security;
alter table public.invoice_line_items      enable row level security;
alter table public.integration_connections enable row level security;
alter table public.payments                enable row level security;
alter table public.audit_log               enable row level security;
alter table public.invoice_counters        enable row level security;

-- ===========================================================================
-- profiles
-- ===========================================================================
-- Any authenticated user may read colleague profiles (names shown across the
-- app). Writes are admin-only; self/role changes go through admin tooling.
create policy profiles_select on public.profiles
  for select to authenticated
  using (auth.uid() is not null);

create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (public.user_role() = 'admin');

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (public.user_role() = 'admin');

-- ===========================================================================
-- clients
-- ===========================================================================
create policy clients_select on public.clients
  for select to authenticated
  using (
    public.user_role() in ('admin','finance','reviewer')
    or account_manager_id = auth.uid()
    or exists (
      select 1 from public.assignments a
      where a.client_id = clients.id and a.employee_id = auth.uid()
    )
  );

create policy clients_write_admin on public.clients
  for all to authenticated
  using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

-- ===========================================================================
-- assignments
-- ===========================================================================
create policy assignments_select on public.assignments
  for select to authenticated
  using (
    public.user_role() in ('admin','finance','reviewer')
    or employee_id = auth.uid()
    or public.am_owns_client(client_id)
  );

create policy assignments_write_admin on public.assignments
  for all to authenticated
  using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');

-- ===========================================================================
-- timesheets
-- ===========================================================================
create policy timesheets_select on public.timesheets
  for select to authenticated
  using (
    employee_id = auth.uid()
    or public.user_role() in ('reviewer','finance','admin')
    or exists (
      select 1 from public.assignments a
      where a.id = timesheets.assignment_id and public.am_owns_client(a.client_id)
    )
  );

-- Employee creates own drafts
create policy timesheets_insert_own on public.timesheets
  for insert to authenticated
  with check (
    employee_id = auth.uid() and status = 'draft'
  );

-- Employee edits/submits own timesheet only while it is a draft
create policy timesheets_update_own_draft on public.timesheets
  for update to authenticated
  using (employee_id = auth.uid() and status = 'draft')
  with check (employee_id = auth.uid() and status in ('draft','submitted'));

-- Reviewer/admin can approve, reject, edit
create policy timesheets_update_reviewer on public.timesheets
  for update to authenticated
  using (public.user_role() in ('reviewer','admin'))
  with check (public.user_role() in ('reviewer','admin'));

-- Finance/admin move approved → invoiced/paid
create policy timesheets_update_finance on public.timesheets
  for update to authenticated
  using (public.user_role() in ('finance','admin'))
  with check (public.user_role() in ('finance','admin'));

-- Employee may delete an unsubmitted draft; admin may delete any
create policy timesheets_delete on public.timesheets
  for delete to authenticated
  using (
    (employee_id = auth.uid() and status = 'draft')
    or public.user_role() = 'admin'
  );

-- ===========================================================================
-- timesheet_entries  (visibility/edit follow the parent timesheet's RLS)
-- ===========================================================================
create policy entries_select on public.timesheet_entries
  for select to authenticated
  using (
    exists (select 1 from public.timesheets t where t.id = timesheet_entries.timesheet_id)
  );

create policy entries_write_employee on public.timesheet_entries
  for all to authenticated
  using (
    exists (
      select 1 from public.timesheets t
      where t.id = timesheet_entries.timesheet_id
        and t.employee_id = auth.uid()
        and t.status = 'draft'
    )
  )
  with check (
    exists (
      select 1 from public.timesheets t
      where t.id = timesheet_entries.timesheet_id
        and t.employee_id = auth.uid()
        and t.status = 'draft'
    )
  );

-- Reviewer/admin may edit hours on a submitted timesheet (with note → audit)
create policy entries_write_reviewer on public.timesheet_entries
  for all to authenticated
  using (
    public.user_role() in ('reviewer','admin')
    and exists (select 1 from public.timesheets t where t.id = timesheet_entries.timesheet_id)
  )
  with check (
    public.user_role() in ('reviewer','admin')
    and exists (select 1 from public.timesheets t where t.id = timesheet_entries.timesheet_id)
  );

-- ===========================================================================
-- timesheet_attachments
-- ===========================================================================
create policy attachments_select on public.timesheet_attachments
  for select to authenticated
  using (
    exists (select 1 from public.timesheets t where t.id = timesheet_attachments.timesheet_id)
  );

create policy attachments_write_employee on public.timesheet_attachments
  for all to authenticated
  using (
    exists (
      select 1 from public.timesheets t
      where t.id = timesheet_attachments.timesheet_id
        and t.employee_id = auth.uid()
        and t.status = 'draft'
    )
    or public.user_role() = 'admin'
  )
  with check (
    exists (
      select 1 from public.timesheets t
      where t.id = timesheet_attachments.timesheet_id
        and t.employee_id = auth.uid()
        and t.status = 'draft'
    )
    or public.user_role() = 'admin'
  );

-- ===========================================================================
-- invoices
-- ===========================================================================
create policy invoices_select on public.invoices
  for select to authenticated
  using (
    public.user_role() in ('finance','admin')
    or public.am_owns_client(client_id)
  );

create policy invoices_write_finance on public.invoices
  for all to authenticated
  using (public.user_role() in ('finance','admin'))
  with check (public.user_role() in ('finance','admin'));

-- ===========================================================================
-- invoice_line_items  (follow parent invoice RLS)
-- ===========================================================================
create policy line_items_select on public.invoice_line_items
  for select to authenticated
  using (
    exists (select 1 from public.invoices i where i.id = invoice_line_items.invoice_id)
  );

create policy line_items_write_finance on public.invoice_line_items
  for all to authenticated
  using (public.user_role() in ('finance','admin'))
  with check (public.user_role() in ('finance','admin'));

-- ===========================================================================
-- integration_connections  (finance/admin only; tokens are encrypted at rest)
-- ===========================================================================
create policy integrations_all_finance on public.integration_connections
  for all to authenticated
  using (public.user_role() in ('finance','admin'))
  with check (public.user_role() in ('finance','admin'));

-- ===========================================================================
-- payments  (finance/admin read; writes happen via service role webhook)
-- ===========================================================================
create policy payments_select_finance on public.payments
  for select to authenticated
  using (public.user_role() in ('finance','admin'));

create policy payments_write_finance on public.payments
  for all to authenticated
  using (public.user_role() in ('finance','admin'))
  with check (public.user_role() in ('finance','admin'));

-- ===========================================================================
-- audit_log  (actor sees own; admin sees all; any user may append own action)
-- ===========================================================================
create policy audit_select on public.audit_log
  for select to authenticated
  using (actor_id = auth.uid() or public.user_role() = 'admin');

create policy audit_insert on public.audit_log
  for insert to authenticated
  with check (actor_id = auth.uid() or public.user_role() in ('reviewer','finance','admin'));

-- ===========================================================================
-- invoice_counters  (no direct client access; only the SECURITY DEFINER fn)
-- ===========================================================================
-- RLS enabled with no policies → denies all authenticated direct access.
