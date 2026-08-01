-- ============================================================================
-- ClearSheet — Challenges/Learnings note on timesheets
-- Free-text note the employee writes for each timesheet. Saved with the draft
-- and required at submit (enforced in submitTimesheet). Nullable because drafts
-- may not have it yet and timesheets submitted before this column have none.
-- ============================================================================

alter table public.timesheets
  add column if not exists challenges_learnings text;

alter table public.timesheets
  drop constraint if exists timesheets_challenges_learnings_length;

alter table public.timesheets
  add constraint timesheets_challenges_learnings_length
  check (char_length(challenges_learnings) <= 2000);
