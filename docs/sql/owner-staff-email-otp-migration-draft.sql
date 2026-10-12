-- DRAFT: operator review required. Shared database application is not authorized.
begin;

create table if not exists public.owner_staff_signup_requests (
  email text primary key,
  requested_at timestamptz not null,
  available_at timestamptz not null
);
alter table public.owner_staff_signup_requests enable row level security;
revoke all on public.owner_staff_signup_requests from public, anon, authenticated;
grant all on public.owner_staff_signup_requests to service_role;

create or replace function public.prepare_owner_staff_signup(p_email text, p_role text, p_action text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(p_email));
  account auth.users%rowtype;
  request_row public.owner_staff_signup_requests%rowtype;
  request_time timestamptz;
  result_kind text;
begin
  if p_role is null or p_action is null
    or p_role not in ('owner', 'staff') or p_action not in ('start', 'resend', 'inspect')
    or normalized_email is null or length(normalized_email) > 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('kind', 'unavailable');
  end if;

  if p_action <> 'inspect' then
    request_time := clock_timestamp();
    insert into public.owner_staff_signup_requests(email, requested_at, available_at)
    values (normalized_email, request_time, request_time)
    on conflict (email) do nothing;
    select * into request_row from public.owner_staff_signup_requests
      where email = normalized_email for update;
    request_time := clock_timestamp();
    if request_row.available_at > request_time then
      return jsonb_build_object('kind', 'rate_limited', 'retryAfterSeconds',
        ceil(extract(epoch from request_row.available_at - request_time)));
    end if;
  end if;

  select * into account from auth.users where lower(email) = normalized_email limit 1;
  if account.id is null then
    result_kind := 'new';
  elsif account.email_confirmed_at is not null
    or coalesce(account.raw_app_meta_data->>'provider', '') <> 'email'
    or exists (select 1 from auth.identities where user_id = account.id and provider <> 'email')
    or exists (select 1 from public.profiles where id = account.id) then
    result_kind := 'exists';
  elsif coalesce(account.raw_user_meta_data->>'role', '') <> p_role then
    result_kind := 'role_mismatch';
  else
    result_kind := 'resume';
  end if;

  if p_action <> 'inspect' then
    update public.owner_staff_signup_requests
    set requested_at = request_time,
      available_at = request_time + case when result_kind = 'new' then interval '5 minutes' else interval '60 seconds' end
    where email = normalized_email;
  end if;
  return jsonb_build_object('kind', result_kind);
end;
$$;

revoke all on function public.prepare_owner_staff_signup(text, text, text) from public, anon, authenticated;
grant execute on function public.prepare_owner_staff_signup(text, text, text) to service_role;

commit;