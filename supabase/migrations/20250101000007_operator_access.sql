-- ============================================================================
-- ClearSheet — operator access to integrations
-- The operator is a least-privilege account (role 'employee' + is_operator=true)
-- that manages integration/infra pages only. Existing RLS already walls it off
-- from customer data; here we grant back the one thing it needs: read/write on
-- integration_connections (QuickBooks connect/disconnect).
-- ============================================================================

-- Security-definer helper: is the current user an operator? (reads profiles
-- regardless of RLS so it can be used inside policies safely).
create or replace function public.is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_operator from public.profiles where id = auth.uid()),
    false
  );
$$;

-- Allow operators alongside finance/admin on the QuickBooks connection row.
-- (finance/admin keep access — the invoice "Sync to QuickBooks" path reads it.)
drop policy if exists integrations_all_finance on public.integration_connections;
create policy integrations_all_finance on public.integration_connections
  for all to authenticated
  using (public.user_role() in ('finance', 'admin') or public.is_operator())
  with check (public.user_role() in ('finance', 'admin') or public.is_operator());
