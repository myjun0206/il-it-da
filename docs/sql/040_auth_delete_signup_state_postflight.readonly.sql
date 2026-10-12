-- READ ONLY postflight for the proposed 040 Auth-delete signup-state trigger.
-- This inspects catalog objects/permissions only; it does not read signup row values.
begin transaction read only;

with recursive cascade_relations(relation_oid, visited) as (
  select 'auth.users'::regclass::oid, array['auth.users'::regclass::oid]
  union all
  select dependency.conrelid, parent.visited || dependency.conrelid
  from cascade_relations as parent
  join pg_catalog.pg_constraint as dependency on dependency.confrelid = parent.relation_oid
  where dependency.contype = 'f' and dependency.confdeltype = 'c'
    and not dependency.conrelid = any(parent.visited)
), delete_impact as (
  select distinct dependency.conrelid::regclass::text as relation_name,
    dependency.confrelid::regclass::text as referenced_relation,
    dependency.conname,
    case dependency.confdeltype when 'c' then 'CASCADE' when 'n' then 'SET NULL'
      when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'd' then 'SET DEFAULT' end as delete_action,
    pg_catalog.pg_get_constraintdef(dependency.oid, true) as definition
  from pg_catalog.pg_constraint as dependency
  join cascade_relations as parent on parent.relation_oid = dependency.confrelid
  where dependency.contype = 'f'
), trigger_check as (
  select
    trigger_row.tgname,
    trigger_row.tgenabled,
    trigger_row.tgfoid::regprocedure::text as function_name,
    pg_catalog.pg_get_triggerdef(trigger_row.oid, true) as trigger_definition
  from pg_catalog.pg_trigger as trigger_row
  where trigger_row.tgrelid = 'auth.users'::regclass
    and trigger_row.tgname = 'cleanup_owner_staff_signup_state_after_auth_delete'
    and not trigger_row.tgisinternal
), function_check as (
  select
    routine.oid::regprocedure::text as function_name,
    owner_role.rolname as function_owner,
    has_schema_privilege(routine.proowner, 'auth', 'USAGE')
      and has_schema_privilege(routine.proowner, 'public', 'USAGE') as function_owner_schema_usage,
    has_table_privilege(routine.proowner, 'auth.users', 'SELECT') as function_owner_auth_select,
    (not auth_relation.relrowsecurity or owner_role.rolsuper or owner_role.rolbypassrls
      or (auth_relation.relowner = routine.proowner and not auth_relation.relforcerowsecurity)) as function_owner_auth_full_row_visibility,
    routine.prosecdef as security_definer,
    routine.proconfig as function_settings,
    routine.proconfig in (array['search_path=""']::text[], array['search_path=']::text[]) as empty_search_path,
    md5(btrim(replace(routine.prosrc, E'\r', ''), E' \n\t')) as normalized_body_md5,
    has_function_privilege('anon', routine.oid, 'EXECUTE') as anon_can_execute,
    has_function_privilege('authenticated', routine.oid, 'EXECUTE') as authenticated_can_execute,
    has_function_privilege('service_role', routine.oid, 'EXECUTE') as service_role_can_execute,
    exists (
      select 1 from pg_catalog.aclexplode(coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))) as grant_row
      where grant_row.grantee = 0 and grant_row.privilege_type = 'EXECUTE'
    ) as public_execute_grant,
    (
      select bool_and(
        has_table_privilege(routine.proowner, state_table.table_name, 'SELECT')
        and has_table_privilege(routine.proowner, state_table.table_name, 'DELETE')
        and (
          not state_class.relrowsecurity or owner_role.rolsuper or owner_role.rolbypassrls
          or (state_class.relowner = routine.proowner and not state_class.relforcerowsecurity)
        )
      )
      from (values
        ('public.owner_staff_signup_requests'),
        ('public.owner_staff_email_signup_flows')
      ) as state_table(table_name)
      join pg_catalog.pg_class as state_class on state_class.oid = pg_catalog.to_regclass(state_table.table_name)
    ) as function_owner_can_cleanup_state
  from pg_catalog.pg_proc as routine
  join pg_catalog.pg_roles as owner_role on owner_role.oid = routine.proowner
  join pg_catalog.pg_class as auth_relation on auth_relation.oid = 'auth.users'::regclass
  where routine.oid = pg_catalog.to_regprocedure('public.cleanup_owner_staff_signup_state_after_auth_delete()')
), auth_delete_fk as (
  select
    constraint_row.conrelid::regclass::text as relation_name,
    constraint_row.conname,
    constraint_row.confdeltype,
    case constraint_row.confdeltype when 'c' then 'CASCADE' when 'n' then 'SET NULL' else constraint_row.confdeltype::text end as delete_action
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.contype = 'f'
    and constraint_row.confrelid = 'auth.users'::regclass
    and constraint_row.conrelid in ('public.profiles'::regclass, 'public.store_memberships'::regclass)
)
select 'trigger'::text as check_group, coalesce(to_jsonb(trigger_check), '{}'::jsonb) as details from trigger_check
union all
select 'function', coalesce(to_jsonb(function_check), '{}'::jsonb) from function_check
union all
select 'auth_delete_foreign_keys', jsonb_build_object('foreign_keys', coalesce((select jsonb_agg(to_jsonb(auth_delete_fk) order by relation_name) from auth_delete_fk), '[]'::jsonb))
union all
select 'auth_delete_data_impact', jsonb_build_object(
  'foreign_keys', coalesce((select jsonb_agg(to_jsonb(delete_impact) order by relation_name, conname) from delete_impact), '[]'::jsonb),
  'stores_and_manuals_preserved_by_fk', not exists (
    select 1 from cascade_relations where cardinality(visited) > 1
      and relation_oid in ('public.stores'::regclass, 'public.manuals'::regclass)
  )
)
union all
select 'signup_state_delete_side_effects', jsonb_build_object(
  'all_clear', count(*) = 0,
  'objects', coalesce(jsonb_agg(to_jsonb(side_effect)), '[]'::jsonb)
)
from (
  select 'trigger' as kind, tgrelid::regclass::text as relation_name, tgname::text as object_name,
    pg_catalog.pg_get_triggerdef(oid, true) as definition
  from pg_catalog.pg_trigger
  where tgrelid in (pg_catalog.to_regclass('public.owner_staff_signup_requests'), pg_catalog.to_regclass('public.owner_staff_email_signup_flows'))
    and not tgisinternal and tgenabled <> 'D' and (tgtype & 8) <> 0
  union all
  select 'rule', ev_class::regclass::text, rulename::text, pg_catalog.pg_get_ruledef(oid, true)
  from pg_catalog.pg_rewrite
  where ev_class in (pg_catalog.to_regclass('public.owner_staff_signup_requests'), pg_catalog.to_regclass('public.owner_staff_email_signup_flows'))
    and ev_type = '4' and ev_enabled <> 'D'
  union all
  select 'mutating_foreign_key', confrelid::regclass::text, conname::text, pg_catalog.pg_get_constraintdef(oid, true)
  from pg_catalog.pg_constraint
  where contype = 'f' and confrelid in (pg_catalog.to_regclass('public.owner_staff_signup_requests'), pg_catalog.to_regclass('public.owner_staff_email_signup_flows'))
    and confdeltype in ('c', 'n', 'd')
) as side_effect;

commit;
