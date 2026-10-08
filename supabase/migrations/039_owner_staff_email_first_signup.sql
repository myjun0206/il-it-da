begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $guard$
declare dependency record;
begin
  for dependency in select * from (values
    ('auth','users','id',array['uuid']),
    ('auth','users','email',array['text','varchar']),
    ('auth','users','email_confirmed_at',array['timestamptz']),
    ('auth','users','last_sign_in_at',array['timestamptz']),
    ('auth','users','raw_app_meta_data',array['jsonb']),
    ('auth','users','raw_user_meta_data',array['jsonb']),
    ('auth','users','encrypted_password',array['text','varchar']),
    ('auth','identities','user_id',array['uuid']),
    ('auth','identities','provider',array['text','varchar']),
    ('public','profiles','id',array['uuid']),
    ('public','profiles','user_id',array['uuid']),
    ('public','store_memberships','user_id',array['uuid'])
  ) as required(schema_name,table_name,column_name,allowed_types)
  loop
    if not exists (
      select 1 from pg_catalog.pg_namespace n
      join pg_catalog.pg_class c on c.relnamespace=n.oid
      join pg_catalog.pg_attribute a on a.attrelid=c.oid
      join pg_catalog.pg_type t on t.oid=a.atttypid
      where n.nspname=dependency.schema_name and c.relname=dependency.table_name
        and c.relkind in ('r','p') and a.attname=dependency.column_name
        and a.attnum>0 and not a.attisdropped and t.typnamespace='pg_catalog'::regnamespace
        and t.typname=any(dependency.allowed_types)
    ) then raise exception using errcode='55000', message='EMAIL_FIRST_DEPENDENCY_SCHEMA_INCOMPATIBLE'; end if;
  end loop;
  if (select count(*) from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role')) <> 3 then
    raise exception using errcode='55000', message='EMAIL_FIRST_REQUIRED_ROLES_MISSING';
  end if;
end;
$guard$;
create table public.owner_staff_email_signup_flows (
  email text primary key,
  role text not null check (role in ('owner', 'staff')),
  requested_at timestamptz not null,
  available_at timestamptz not null,
  expires_at timestamptz not null,
  request_id uuid not null,
  sent_at timestamptz,
  verified_user_id uuid,
  verified_at timestamptz,
  completed_user_id uuid,
  completed_at timestamptz
);
alter table public.owner_staff_email_signup_flows enable row level security;
revoke all on public.owner_staff_email_signup_flows from public, anon, authenticated;
grant select, insert, update, delete on public.owner_staff_email_signup_flows to service_role;

create function public.prepare_owner_staff_email_first_signup(
  p_email text, p_role text, p_action text, p_user_id uuid default null, p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  target_email text := lower(btrim(p_email));
  account auth.users%rowtype;
  flow public.owner_staff_email_signup_flows%rowtype;
  request_time timestamptz;
  account_exists boolean;
begin
  if p_email is null or p_role is null or p_action is null
    or target_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(target_email) > 254 or p_role not in ('owner', 'staff')
    or p_action not in ('start', 'resend', 'sent', 'inspect', 'verify', 'complete') then
    return jsonb_build_object('kind', 'unavailable');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_email, 39));
  request_time := pg_catalog.clock_timestamp();
  if (select count(*) from auth.users where lower(email) = target_email) > 1 then
    return jsonb_build_object('kind', 'unavailable');
  end if;
  select * into account from auth.users where lower(email) = target_email;
  account_exists := found;
  select * into flow from public.owner_staff_email_signup_flows where email = target_email for update;
  request_time := pg_catalog.clock_timestamp();
  if account_exists then
    if coalesce(account.raw_app_meta_data->>'provider', '') <> 'email'
      or exists (select 1 from auth.identities where user_id = account.id and provider <> 'email')
      or exists (select 1 from public.profiles where id = account.id or user_id = account.id)
      or exists (select 1 from public.store_memberships where user_id = account.id) then
      return jsonb_build_object('kind', 'exists');
    end if;
    if account.raw_user_meta_data->>'role' is distinct from p_role then
      return jsonb_build_object('kind', 'role_mismatch');
    end if;
    if flow.email is null and account.email_confirmed_at is not null and coalesce(account.encrypted_password, '') <> '' then
      return jsonb_build_object('kind', 'legacy', 'userId', account.id);
    end if;
  end if;
  if flow.email is not null and flow.role <> p_role then return jsonb_build_object('kind', 'role_mismatch'); end if;
  if flow.completed_at is not null then
    if p_action = 'complete' and (p_user_id is null or p_user_id is distinct from flow.completed_user_id
      or p_request_id is null or p_request_id is distinct from flow.request_id) then
      return jsonb_build_object('kind', 'unavailable');
    end if;
    return jsonb_build_object('kind', 'complete', 'userId', flow.completed_user_id);
  end if;
  if p_action = 'sent' then
    if flow.email is null or p_request_id is null or flow.request_id <> p_request_id then
      return jsonb_build_object('kind', 'unavailable');
    end if;
    if flow.sent_at is not null then
      return jsonb_build_object('kind', case when account_exists then 'resume' else 'new' end,
        'expiresAt', (extract(epoch from flow.expires_at) * 1000)::bigint);
    end if;
    update public.owner_staff_email_signup_flows set sent_at = request_time, expires_at = request_time + interval '180 seconds' where email = target_email;
    return jsonb_build_object('kind', case when account_exists then 'resume' else 'new' end,
      'expiresAt', (extract(epoch from request_time + interval '180 seconds') * 1000)::bigint);
  end if;
  if p_action = 'inspect' then
    if flow.email is null then return jsonb_build_object('kind', 'unavailable'); end if;
    return jsonb_build_object('kind', case when account_exists then 'resume' else 'new' end,
      'userId', account.id, 'expiresAt', (extract(epoch from flow.expires_at) * 1000)::bigint,
      'requestId', flow.request_id,
      'emailVerified', flow.verified_at is not null and flow.verified_user_id = account.id);
  end if;
  if p_action = 'verify' then
    if flow.email is null or not account_exists or p_user_id is null or account.id <> p_user_id
      or p_request_id is null or flow.request_id is distinct from p_request_id or flow.sent_at is null
      or account.email_confirmed_at is null or account.last_sign_in_at is null
      or account.last_sign_in_at < flow.sent_at or flow.expires_at <= request_time then
      return jsonb_build_object('kind', 'unavailable');
    end if;
    update public.owner_staff_email_signup_flows set verified_user_id = account.id, verified_at = request_time where email = target_email;
    return jsonb_build_object('kind', 'resume', 'userId', account.id, 'emailVerified', true);
  end if;
  if p_action = 'complete' then
    if flow.email is null or not account_exists or p_user_id is null or account.id <> p_user_id or account.email_confirmed_at is null
      or p_request_id is null or flow.request_id is distinct from p_request_id
      or flow.verified_at is null or flow.verified_user_id is distinct from account.id
      or coalesce(account.encrypted_password, '') = '' then
      return jsonb_build_object('kind', 'unavailable');
    end if;
    update public.owner_staff_email_signup_flows set completed_user_id = account.id, completed_at = request_time where email = target_email;
    return jsonb_build_object('kind', 'complete', 'userId', account.id);
  end if;
  if flow.available_at > request_time then
    return jsonb_build_object('kind', 'rate_limited', 'retryAfterSeconds', greatest(1, ceil(extract(epoch from flow.available_at - request_time))::integer));
  end if;
  if p_action = 'resend' and not account_exists then return jsonb_build_object('kind', 'unavailable'); end if;
  insert into public.owner_staff_email_signup_flows(email, role, requested_at, available_at, expires_at, request_id)
    values (target_email, p_role, request_time, request_time + interval '60 seconds', request_time, pg_catalog.gen_random_uuid())
    on conflict (email) do update set requested_at = excluded.requested_at, available_at = excluded.available_at,
      expires_at = excluded.expires_at, request_id = excluded.request_id, sent_at = null, verified_user_id = null, verified_at = null
    returning * into flow;
  return jsonb_build_object('kind', case when account_exists then 'resume' else 'new' end,
    'userId', account.id, 'requestId', flow.request_id, 'expiresAt', (extract(epoch from request_time + interval '180 seconds') * 1000)::bigint);
end;
$function$;
revoke all on function public.prepare_owner_staff_email_first_signup(text,text,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.prepare_owner_staff_email_first_signup(text,text,text,uuid,uuid) to service_role;
commit;