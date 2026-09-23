-- 017: Safe server-side email existence check for signup duplicate validation.
--
-- This function returns only a boolean and is intended to be called from server
-- API routes with the service-role client. It checks both public.profiles and
-- auth.users so duplicate detection does not depend on profile creation timing.

create or replace function public.email_exists_for_signup(check_email text)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.profiles p
    where lower(p.email) = lower(trim(check_email))
  )
  or exists (
    select 1
    from auth.users u
    where lower(u.email) = lower(trim(check_email))
  );
$$;

revoke all on function public.email_exists_for_signup(text) from public;