-- ============================================================================
-- ClearSheet — vendor & notes on assignments (#7)
-- For staff sourced through a third party, `vendor` records who is actually paid
-- (blank when hired directly). `notes` is free-text that flows into the payroll
-- export. Both are per-assignment, so the same person can be sourced through
-- different vendors on different projects.
-- ============================================================================

alter table public.assignments
  add column if not exists vendor text,
  add column if not exists notes  text;
