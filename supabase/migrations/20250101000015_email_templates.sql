-- ============================================================================
-- ClearSheet — admin-customized email text
-- One row per customized email. An email with no row uses its built-in default
-- from src/lib/email-templates.ts, so resetting an email deletes its row. Only
-- admins can read or write; sending reads with the service role.
-- ============================================================================

create table if not exists public.email_templates (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,
  subject       text not null,
  heading       text not null,
  body          text not null,
  button_label  text not null,
  footer        text not null default '',
  updated_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_email_templates_updated_at on public.email_templates;
create trigger trg_email_templates_updated_at
  before update on public.email_templates
  for each row execute function public.set_updated_at();

alter table public.email_templates enable row level security;

drop policy if exists email_templates_admin on public.email_templates;
create policy email_templates_admin on public.email_templates
  for all to authenticated
  using (public.user_role() = 'admin')
  with check (public.user_role() = 'admin');
