-- ============================================================================
-- ClearSheet — per-client payment terms (net days)
-- Replaces the hardcoded +30 day invoice due date. Each client carries the net
-- days used to compute an invoice's due date at generation time. Default 30
-- preserves the previous behavior for every existing client.
-- ============================================================================

alter table public.clients
  add column if not exists payment_terms_days integer not null default 30
    check (payment_terms_days >= 0 and payment_terms_days <= 365);
