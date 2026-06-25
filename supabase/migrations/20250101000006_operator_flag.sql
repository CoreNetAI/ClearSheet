-- ============================================================================
-- ClearSheet — hidden "operator" capability
-- An operator is an admin-role user with is_operator=true. They see the
-- builder-only pages (Storage, Integrations, QuickBooks connect) on top of
-- everything an admin can do. Set manually via the dashboard; never via the app.
-- ============================================================================

alter table public.profiles
  add column if not exists is_operator boolean not null default false;
