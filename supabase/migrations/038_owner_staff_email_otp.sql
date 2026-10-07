begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
declare
  dependency record;
  table_oid oid := pg_catalog.to_regclass('public.owner_staff_signup_requests');
  rpc_oid oid := pg_catalog.to_regprocedure('public.prepare_owner_staff_signup(text,text,text)');
  email_attnum smallint;
begin
  for dependency in
    select * from (values
      ('auth', 'users', 'id', array['uuid']),
      ('auth', 'users', 'email', array['text', 'varchar']),
      ('auth', 'users', 'email_confirmed_at', array['timestamptz']),
      ('auth', 'users', 'raw_app_meta_data', array['jsonb']),
      ('auth', 'users', 'raw_user_meta_data', array['jsonb']),
      ('auth', 'identities', 'user_id', array['uuid']),
      ('auth', 'identities', 'provider', array['text', 'varchar']),
      ('public', 'profiles', 'id', array['uuid'])
    ) as required(schema_name, table_name, column_name, allowed_types)
  loop
    if not exists (
      select 1 from pg_catalog.pg_namespace as namespace
      join pg_catalog.pg_class as relation on relation.relnamespace = namespace.oid
      join pg_catalog.pg_attribute as attribute on attribute.attrelid = relation.oid
      join pg_catalog.pg_type as column_type on column_type.oid = attribute.atttypid
      where namespace.nspname = dependency.schema_name and relation.relname = dependency.table_name
        and relation.relkind in ('r', 'p') and attribute.attname = dependency.column_name
        and attribute.attnum > 0 and not attribute.attisdropped
        and column_type.typnamespace = 'pg_catalog'::regnamespace
        and column_type.typname = any(dependency.allowed_types)
    ) then
      raise exception using errcode = '55000', message = 'OTP_DEPENDENCY_SCHEMA_INCOMPATIBLE';
    end if;
  end loop;

  if (select count(*) from pg_catalog.pg_roles where rolname in ('anon', 'authenticated', 'service_role')) <> 3 then
    raise exception using errcode = '55000', message = 'OTP_REQUIRED_ROLES_MISSING';
  end if;

  if table_oid is not null then
    if not exists (select 1 from pg_catalog.pg_class where oid = table_oid and relkind = 'r'
      and relowner = (select oid from pg_catalog.pg_roles where rolname = current_user)
      and not relforcerowsecurity) then
      raise exception using errcode = '55000', message = 'OTP_EXISTING_TABLE_REVIEW_REQUIRED';
    end if;
    lock table public.owner_staff_signup_requests in access exclusive mode;
    if (select count(*) from pg_catalog.pg_attribute where attrelid = table_oid and attnum > 0 and not attisdropped) <> 3
      or exists (
        select 1 from pg_catalog.pg_attribute as attribute
        where attribute.attrelid = table_oid and attribute.attnum > 0 and not attribute.attisdropped
          and not (attribute.attnotnull and not attribute.atthasdef
            and attribute.attidentity = '' and attribute.attgenerated = ''
            and ((attribute.attname = 'email' and attribute.atttypid = 'text'::regtype
              and attribute.attcollation = 'pg_catalog.default'::regcollation)
              or (attribute.attname in ('requested_at', 'available_at') and attribute.atttypid = 'timestamptz'::regtype)))
      ) then
      raise exception using errcode = '55000', message = 'OTP_EXISTING_TABLE_SCHEMA_INCOMPATIBLE';
    end if;
    select attnum into email_attnum from pg_catalog.pg_attribute where attrelid = table_oid and attname = 'email';
    if not exists (
      select 1 from pg_catalog.pg_constraint as constraint_row
      join pg_catalog.pg_index as index_row on index_row.indexrelid = constraint_row.conindid
      where constraint_row.conrelid = table_oid and constraint_row.contype = 'p'
        and constraint_row.conkey = array[email_attnum] and not constraint_row.condeferrable
        and constraint_row.convalidated and index_row.indisvalid and index_row.indimmediate
    ) or exists (select 1 from pg_catalog.pg_constraint where conrelid = table_oid and contype <> 'p')
      or exists (select 1 from pg_catalog.pg_index where indrelid = table_oid
        and not indisprimary and (indisunique or indpred is not null or indexprs is not null))
      or exists (select 1 from pg_catalog.pg_trigger where tgrelid = table_oid and not tgisinternal)
      or exists (select 1 from pg_catalog.pg_policy where polrelid = table_oid)
      or exists (select 1 from pg_catalog.pg_attribute where attrelid = table_oid and attacl is not null)
      or exists (
        select 1 from pg_catalog.pg_class as relation
        cross join lateral pg_catalog.aclexplode(relation.relacl) as grant_row
        where relation.oid = table_oid and grant_row.grantee not in
          (relation.relowner, coalesce((select oid from pg_catalog.pg_roles where rolname = 'service_role'), 0))
      ) then
      raise exception using errcode = '55000', message = 'OTP_EXISTING_TABLE_CONTRACT_REVIEW_REQUIRED';
    end if;
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc as routine
    join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public' and routine.proname = 'prepare_owner_staff_signup'
      and (rpc_oid is null or routine.oid <> rpc_oid)
  ) then
    raise exception using errcode = '55000', message = 'OTP_RPC_OVERLOAD_REVIEW_REQUIRED';
  end if;
  if rpc_oid is not null and not exists (
    select 1 from pg_catalog.pg_proc as routine
    join pg_catalog.pg_language as language on language.oid = routine.prolang
    where routine.oid = rpc_oid and routine.prokind = 'f' and routine.prorettype = 'jsonb'::regtype
      and not routine.proretset and routine.pronargdefaults = 0
      and routine.proargnames = array['p_email', 'p_role', 'p_action']::text[]
      and routine.proowner = (select oid from pg_catalog.pg_roles where rolname = current_user)
      and language.lanname = 'plpgsql' and routine.prosecdef
      and routine.proconfig in (array['search_path=""']::text[], array['search_path=']::text[])
      and md5(btrim(replace(routine.prosrc, E'\r', ''), E' \n\t')) = '39cfceb5774c224e6671f421211e5d4e'
  ) then
    raise exception using errcode = '55000', message = 'OTP_EXISTING_RPC_REVIEW_REQUIRED';
  end if;
end;
$guard$;

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

do $permissions$
declare
  caller_role oid;
begin
  for caller_role in select oid from pg_catalog.pg_roles where rolname in ('anon', 'authenticated') loop
    if pg_catalog.has_function_privilege(caller_role, 'public.prepare_owner_staff_signup(text,text,text)', 'EXECUTE')
      or pg_catalog.has_table_privilege(caller_role, 'public.owner_staff_signup_requests', 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception using errcode = '55000', message = 'OTP_INHERITED_CLIENT_PRIVILEGES_REVIEW_REQUIRED';
    end if;
  end loop;
  if exists (
    select 1 from pg_catalog.pg_class as relation
    cross join lateral pg_catalog.aclexplode(relation.relacl) as grant_row
    where relation.oid = 'public.owner_staff_signup_requests'::regclass
      and grant_row.grantee not in (relation.relowner, (select oid from pg_catalog.pg_roles where rolname = 'service_role'))
  ) or exists (
    select 1 from pg_catalog.pg_proc as routine
    cross join lateral pg_catalog.aclexplode(routine.proacl) as grant_row
    where routine.oid = 'public.prepare_owner_staff_signup(text,text,text)'::regprocedure
      and grant_row.grantee not in (routine.proowner, (select oid from pg_catalog.pg_roles where rolname = 'service_role'))
  ) then
    raise exception using errcode = '55000', message = 'OTP_UNEXPECTED_GRANTEES_REVIEW_REQUIRED';
  end if;
  if not pg_catalog.has_schema_privilege(current_user, 'auth', 'USAGE')
    or exists (
      select 1 from pg_catalog.pg_class as relation
      join pg_catalog.pg_roles as owner_role on owner_role.rolname = current_user
      where relation.oid in ('auth.users'::regclass, 'auth.identities'::regclass, 'public.profiles'::regclass)
        and (not pg_catalog.has_table_privilege(owner_role.oid, relation.oid, 'SELECT')
          or (relation.relrowsecurity and not (owner_role.rolsuper or owner_role.rolbypassrls
            or (relation.relowner = owner_role.oid and not relation.relforcerowsecurity))))
    ) then
    raise exception using errcode = '55000', message = 'OTP_FUNCTION_OWNER_ACCESS_REVIEW_REQUIRED';
  end if;
  if not pg_catalog.has_schema_privilege('service_role', 'public', 'USAGE')
    or not exists(select 1 from pg_catalog.pg_roles where rolname = 'service_role' and (rolbypassrls or rolsuper)) then
    raise exception using errcode = '55000', message = 'OTP_SERVICE_ROLE_ACCESS_REVIEW_REQUIRED';
  end if;
end;
$permissions$;

commit;