-- ============================================================================
-- ClearSheet — invite-based onboarding
-- Tracks whether an admin-invited user has accepted (set their password) yet.
-- Existing users default to 'accepted' so they are unaffected.
-- ============================================================================

alter table public.profiles
  add column if not exists invite_status text not null default 'accepted'
    check (invite_status in ('pending', 'accepted'));

-- Recreate the auth→profile bootstrap so invited users (auth.users.invited_at
-- set by admin.generateLink/inviteUserByEmail) land as 'pending' until they
-- complete set-password. Self-signups and OAuth users remain 'accepted'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  provider text;
  resolved_role text;
  resolved_invite_status text;
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

  resolved_invite_status := case
    when new.invited_at is not null then 'pending'
    else 'accepted'
  end;

  insert into public.profiles (id, email, full_name, role, auth_provider, invite_status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    resolved_role,
    provider,
    resolved_invite_status
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
