-- ============================================================================
-- ClearSheet — invoice adjustments (deductions / reimbursements) (#9)
-- At the accounting stage, finance can attach deductions (e.g. BGC, 2%) and
-- reimbursements (e.g. vendor expenses) to an invoice. They affect the invoice's
-- net and flow into exports so payroll is processed with the correct figures.
-- An optional employee link records WHOSE adjustment it is (for per-person
-- payroll), or is left blank for an invoice-wide adjustment.
-- ============================================================================

create table if not exists public.invoice_adjustments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  employee_id uuid references public.profiles(id) on delete set null,
  kind        text not null check (kind in ('deduction', 'reimbursement')),
  label       text not null,
  amount      numeric(10,2) not null default 0 check (amount >= 0),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_invoice_adjustments_invoice
  on public.invoice_adjustments (invoice_id);

alter table public.invoice_adjustments enable row level security;

create policy invoice_adjustments_select on public.invoice_adjustments
  for select to authenticated
  using (public.user_role() in ('finance', 'admin'));

create policy invoice_adjustments_write on public.invoice_adjustments
  for all to authenticated
  using (public.user_role() in ('finance', 'admin'))
  with check (public.user_role() in ('finance', 'admin'));
