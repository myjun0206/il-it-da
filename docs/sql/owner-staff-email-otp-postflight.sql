begin transaction read only;
set local statement_timeout = '15s';

with objects as (
  select pg_catalog.to_regclass('public.owner_staff_signup_requests') as table_oid,
         pg_catalog.to_regprocedure('public.prepare_owner_staff_signup(text,text,text)') as rpc_oid
), checks as (
  select 'request_table_exists' as check_name, table_oid is not null as passed from objects
  union all
  select 'request_table_exact_columns', coalesce((
    select count(*) = 3 and bool_and(attribute.attnotnull and not attribute.atthasdef
      and attribute.attidentity = '' and attribute.attgenerated = ''
      and ((attribute.attname = 'email' and attribute.atttypid = 'text'::regtype
        and attribute.attcollation = 'pg_catalog.default'::regcollation)
        or (attribute.attname in ('requested_at', 'available_at') and attribute.atttypid = 'timestamptz'::regtype)))
    from pg_catalog.pg_attribute as attribute where attribute.attrelid = table_oid
      and attribute.attnum > 0 and not attribute.attisdropped
  ), false) from objects
  union all
  select 'request_email_immediate_primary_key', exists (
    select 1 from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_index as index_row on index_row.indexrelid = constraint_row.conindid
    join pg_catalog.pg_attribute as attribute on attribute.attrelid = constraint_row.conrelid and attribute.attname = 'email'
    where constraint_row.conrelid = table_oid and constraint_row.contype = 'p'
      and constraint_row.conkey = array[attribute.attnum] and not constraint_row.condeferrable
      and index_row.indisvalid and index_row.indimmediate
  ) from objects
  union all
  select 'request_rls_enabled', coalesce((select relrowsecurity from pg_catalog.pg_class where oid = table_oid), false) from objects
  union all
  select 'rpc_exact_contract_and_tested_body', exists (
    select 1 from pg_catalog.pg_proc as routine
    join pg_catalog.pg_language as language on language.oid = routine.prolang
    where routine.oid = rpc_oid and routine.prokind = 'f' and routine.prorettype = 'jsonb'::regtype
      and not routine.proretset and routine.pronargdefaults = 0
      and routine.proargnames = array['p_email', 'p_role', 'p_action']::text[]
      and language.lanname = 'plpgsql' and routine.prosecdef
      and routine.proconfig in (array['search_path=""']::text[], array['search_path=']::text[])
      and md5(btrim(replace(routine.prosrc, E'\r', ''), E' \n\t')) = '39cfceb5774c224e6671f421211e5d4e'
  ) from objects
  union all
  select 'no_rpc_overloads', (select count(*) from pg_catalog.pg_proc as routine
    join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public' and routine.proname = 'prepare_owner_staff_signup') = 1
  union all
  select 'no_request_policies_or_custom_triggers', not exists (select 1 from pg_catalog.pg_policy where polrelid = table_oid)
    and not exists (select 1 from pg_catalog.pg_trigger where tgrelid = table_oid and not tgisinternal) from objects
  union all
  select 'no_extra_request_contracts_or_grantees', not exists (
      select 1 from pg_catalog.pg_constraint where conrelid = table_oid and contype <> 'p')
    and not exists (select 1 from pg_catalog.pg_index where indrelid = table_oid
      and not indisprimary and (indisunique or indpred is not null or indexprs is not null))
    and not exists (select 1 from pg_catalog.pg_attribute where attrelid = table_oid and attacl is not null)
    and not exists (
      select 1 from pg_catalog.pg_class as relation
      cross join lateral pg_catalog.aclexplode(relation.relacl) as grant_row
      where relation.oid = table_oid and grant_row.grantee not in
        (relation.relowner, coalesce((select oid from pg_catalog.pg_roles where rolname = 'service_role'), 0))
    ) and table_oid is not null from objects
  union all
  select 'service_role_bypasses_request_rls', exists (
    select 1 from pg_catalog.pg_roles where rolname = 'service_role' and (rolbypassrls or rolsuper))
  union all
  select 'rpc_only_owner_and_service_grantees', not exists (
    select 1 from pg_catalog.pg_proc as routine
    cross join lateral pg_catalog.aclexplode(routine.proacl) as grant_row
    where routine.oid = rpc_oid and grant_row.grantee not in
      (routine.proowner, coalesce((select oid from pg_catalog.pg_roles where rolname = 'service_role'), 0))
  ) and rpc_oid is not null from objects
  union all
  select 'rpc_public_execute_revoked', not exists (
    select 1 from pg_catalog.pg_proc as routine
    cross join lateral pg_catalog.aclexplode(coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))) as grant_row
    where routine.oid = rpc_oid and grant_row.grantee = 0 and grant_row.privilege_type = 'EXECUTE'
  ) and rpc_oid is not null from objects
)
select check_name, passed from checks order by check_name;

with objects as (
  select pg_catalog.to_regclass('public.owner_staff_signup_requests') as table_oid,
         pg_catalog.to_regprocedure('public.prepare_owner_staff_signup(text,text,text)') as rpc_oid
), expected(role_name) as (values ('anon'), ('authenticated'), ('service_role'))
select expected.role_name, role.oid is not null as role_exists,
       case when objects.rpc_oid is not null and role.oid is not null
         then pg_catalog.has_function_privilege(role.oid, objects.rpc_oid, 'EXECUTE') end as rpc_execute,
       case when objects.table_oid is not null and role.oid is not null
         then pg_catalog.has_table_privilege(role.oid, objects.table_oid, 'SELECT') end as request_select,
       case when objects.table_oid is not null and role.oid is not null
         then pg_catalog.has_table_privilege(role.oid, objects.table_oid, 'INSERT') end as request_insert,
       case when objects.table_oid is not null and role.oid is not null
         then pg_catalog.has_table_privilege(role.oid, objects.table_oid, 'UPDATE') end as request_update,
       case when objects.table_oid is not null and role.oid is not null
         then pg_catalog.has_table_privilege(role.oid, objects.table_oid, 'DELETE') end as request_delete,
       case when role.oid is not null then pg_catalog.has_schema_privilege(role.oid, 'public', 'USAGE') end as public_schema_usage
from expected cross join objects
left join pg_catalog.pg_roles as role on role.rolname = expected.role_name
order by expected.role_name;

select pg_catalog.pg_get_userbyid(routine.proowner) as function_owner,
       coalesce(bool_and(pg_catalog.has_table_privilege(routine.proowner, dependency.table_oid, 'SELECT')), false) as owner_dependency_select,
       coalesce(bool_and(not relation.relrowsecurity or owner_role.rolsuper or owner_role.rolbypassrls
         or (relation.relowner = owner_role.oid and not relation.relforcerowsecurity)), false) as owner_reads_without_rls_filter,
       pg_catalog.has_schema_privilege(routine.proowner, 'auth', 'USAGE') as owner_auth_schema_usage
from pg_catalog.pg_proc as routine
cross join (values (pg_catalog.to_regclass('auth.users')), (pg_catalog.to_regclass('auth.identities')),
                   (pg_catalog.to_regclass('public.profiles'))) as dependency(table_oid)
join pg_catalog.pg_class as relation on relation.oid = dependency.table_oid
join pg_catalog.pg_roles as owner_role on owner_role.oid = routine.proowner
where routine.oid = pg_catalog.to_regprocedure('public.prepare_owner_staff_signup(text,text,text)')
group by routine.proowner;

rollback;