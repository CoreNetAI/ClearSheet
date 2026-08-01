-- ============================================================================
-- ClearSheet — stop trusting a client-supplied role at signup (security fix)
-- auth.users.raw_user_meta_data is set by whoever signs up, so reading the role
-- from it let anyone with the public key register as an admin. Every new profile
-- now starts as 'employee'; trusted server code (admin createUser, seed) assigns
-- any other role afterwards with the service role.
--
-- This does not change existing accounts. To look for accounts that may have used
-- the hole, review privileged users who were not invited through the app:
--   select p.email, p.role, u.created_at
--   from public.profiles p join auth.users u on u.id = p.id
--   where p.role <> 'employee' and u.invited_at is null
--   order by u.created_at;
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  provider text;
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

  resolved_invite_status := case
    when new.invited_at is not null then 'pending'
    else 'accepted'
  end;

  insert into public.profiles (id, email, full_name, role, auth_provider, invite_status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    'employee',
    provider,
    resolved_invite_status
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
