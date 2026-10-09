-- READ ONLY preflight for the proposed 040 Auth-delete signup-state trigger.
-- This file is one read-only SELECT so SQL Editor shows its result as the final result set.

with expected(schema_name, table_name, column_name, allowed_types) as (
  values
    ('auth', 'users', 'id', array['uuid']),
    ('auth', 'users', 'email', array['text', 'varchar']),
    ('public', 'profiles', 'id', array['uuid']),
    ('public', 'profiles', 'user_id', array['uuid']),
    ('public', 'store_memberships', 'user_id', array['uuid']),
    ('public', 'stores', 'boss_id', array['uuid']),
    ('public', 'manuals', 'store_id', array['uuid']),
    ('public', 'owner_staff_signup_requests', 'email', array['text', 'varchar']),
    ('public', 'owner_staff_email_signup_flows', 'email', array['text', 'varchar']),
    ('public', 'owner_staff_email_signup_flows', 'request_id', array['uuid']),
    ('public', 'owner_staff_email_signup_flows', 'verified_user_id', array['uuid']),
    ('public', 'owner_staff_email_signup_flows', 'completed_user_id', array['uuid'])
), columns_check as (
  select
    expected.schema_name,
    expected.table_name,
    expected.column_name,
    expected.allowed_types,
    actual_type.typname as actual_type,
    actual_type.typname = any(expected.allowed_types) as matches
  from expected
  left join pg_catalog.pg_namespace as namespace on namespace.nspname = expected.schema_name
  left join pg_catalog.pg_class as relation on relation.relnamespace = namespace.oid and relation.relname = expected.table_name
  left join pg_catalog.pg_attribute as attribute on attribute.attrelid = relation.oid
    and attribute.attname = expected.column_name and attribute.attnum > 0 and not attribute.attisdropped
  left join pg_catalog.pg_type as actual_type on actual_type.oid = attribute.atttypid
), relevant_fk as (
  select
    constraint_row.conrelid::regclass::text as relation_name,
    constraint_row.confrelid::regclass::text as referenced_relation,
    constraint_row.conname,
    constraint_row.confdeltype,
    case constraint_row.confdeltype
      when 'a' then 'NO ACTION'
      when 'r' then 'RESTRICT'
      when 'c' then 'CASCADE'
      when 'n' then 'SET NULL'
      when 'd' then 'SET DEFAULT'
      else constraint_row.confdeltype::text
    end as delete_action
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.contype = 'f'
    and constraint_row.confrelid in (
      select relation_oid from (values
        (pg_catalog.to_regclass('auth.users')),
        (pg_catalog.to_regclass('public.profiles')),
        (pg_catalog.to_regclass('public.stores'))
      ) as expected_relations(relation_oid)
      where relation_oid is not null
    )
), expected_trigger as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'trigger_name', trigger_row.tgname,
    'is_internal', trigger_row.tgisinternal,
    'enabled', trigger_row.tgenabled,
    'function', trigger_row.tgfoid::regprocedure::text
  ) order by trigger_row.tgname), '[]'::jsonb) as existing_triggers
  from pg_catalog.pg_trigger as trigger_row
  where trigger_row.tgrelid = pg_catalog.to_regclass('auth.users')
), expected_function as (
  select pg_catalog.to_regprocedure('public.cleanup_owner_staff_signup_state_after_auth_delete()') is not null as already_exists
), expected_fk_contract as (
  select * from (values
    ('public.profiles', 'user_id', 'auth.users', 'id', 'CASCADE', 'c'),
    ('public.store_memberships', 'user_id', 'auth.users', 'id', 'CASCADE', 'c'),
    ('public.stores', 'boss_id', 'public.profiles', 'id', 'SET NULL', 'n')
  ) as expected(relation_name, column_name, referenced_relation, referenced_column, expected_action, action_code)
), fk_contract_check as (
  select
    expected.relation_name,
    expected.column_name,
    expected.referenced_relation,
    expected.referenced_column,
    expected.expected_action,
    actual.conname as constraint_name,
    actual.action_code as actual_action_code,
    actual.conname is not null as matches
  from expected_fk_contract as expected
  left join lateral (
    select constraint_row.conname, constraint_row.confdeltype as action_code
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.contype = 'f'
      and constraint_row.conrelid = pg_catalog.to_regclass(expected.relation_name)
      and constraint_row.confrelid = pg_catalog.to_regclass(expected.referenced_relation)
      and constraint_row.conkey = array[(
        select attribute.attnum from pg_catalog.pg_attribute as attribute
        where attribute.attrelid = pg_catalog.to_regclass(expected.relation_name)
          and attribute.attname = expected.column_name and not attribute.attisdropped
      )]::smallint[]
      and constraint_row.confkey = array[(
        select attribute.attnum from pg_catalog.pg_attribute as attribute
        where attribute.attrelid = pg_catalog.to_regclass(expected.referenced_relation)
          and attribute.attname = expected.referenced_column and not attribute.attisdropped
      )]::smallint[]
      and constraint_row.confdeltype = expected.action_code
    limit 1
  ) as actual on true
), role_and_privileges as (
  select jsonb_build_object(
    'current_user', current_user,
    'required_roles_present', (select count(*) = 3 from pg_catalog.pg_roles where rolname in ('anon', 'authenticated', 'service_role')),
    'auth_schema_usage', has_schema_privilege(current_user, 'auth', 'USAGE'),
    'public_schema_usage', has_schema_privilege(current_user, 'public', 'USAGE'),
    'public_schema_create', has_schema_privilege(current_user, 'public', 'CREATE'),
    'auth_users_select', has_table_privilege(current_user, 'auth.users', 'SELECT'),
    'auth_users_full_row_visibility', not pg_catalog.row_security_active('auth.users'::regclass),
    'plpgsql_usage', has_language_privilege(current_user, 'plpgsql', 'USAGE'),
    'auth_users_owner', auth_owner.rolname,
    'current_user_is_auth_owner_or_superuser', active_role.rolsuper or active_role.oid = auth_relation.relowner
      or pg_catalog.pg_has_role(current_user, auth_relation.relowner, 'MEMBER'),
    'auth_users_delete', has_table_privilege(current_user, 'auth.users', 'DELETE'),
    'auth_users_trigger_privilege', has_table_privilege(current_user, 'auth.users', 'TRIGGER'),
    'can_create_auth_delete_trigger', has_schema_privilege(current_user, 'auth', 'USAGE')
      and has_schema_privilege(current_user, 'public', 'USAGE')
      and has_schema_privilege(current_user, 'public', 'CREATE')
      and has_language_privilege(current_user, 'plpgsql', 'USAGE')
      and has_table_privilege(current_user, 'auth.users', 'TRIGGER'),
    'signup_table_privileges_and_rls_access', (
      select bool_and(
        has_table_privilege(current_user, state_relation.table_name, 'SELECT,DELETE')
        and (
          not state_class.relrowsecurity or active_role.rolsuper or active_role.rolbypassrls
          or (state_class.relowner = active_role.oid and not state_class.relforcerowsecurity)
        )
      )
      from (values
        ('public.owner_staff_signup_requests'),
        ('public.owner_staff_email_signup_flows')
      ) as state_relation(table_name)
      join pg_catalog.pg_class as state_class on state_class.oid = pg_catalog.to_regclass(state_relation.table_name)
    )
  ) as details
  from pg_catalog.pg_roles as active_role
  join pg_catalog.pg_class as auth_relation on auth_relation.oid = pg_catalog.to_regclass('auth.users')
  join pg_catalog.pg_roles as auth_owner on auth_owner.oid = auth_relation.relowner
  where active_role.rolname = current_user
)
select
  'column_contract' as check_group,
  jsonb_build_object(
    'columns', coalesce((select jsonb_agg(to_jsonb(columns_check) order by schema_name, table_name, column_name) from columns_check), '[]'::jsonb),
    'all_columns_match', coalesce((select bool_and(matches) from columns_check), false)
  ) as details
union all
select
  'related_foreign_keys',
  jsonb_build_object('foreign_keys', coalesce((select jsonb_agg(to_jsonb(relevant_fk) order by relation_name, conname) from relevant_fk), '[]'::jsonb))
union all
select
  'expected_account_delete_fk_contracts',
  jsonb_build_object(
    'foreign_keys', coalesce((select jsonb_agg(to_jsonb(fk_contract_check) order by relation_name, column_name) from fk_contract_check), '[]'::jsonb),
    'all_match', coalesce((select bool_and(matches) from fk_contract_check), false)
  )
union all
select
  'existing_auth_users_triggers_review_required',
  expected_trigger.existing_triggers
from expected_trigger
union all
select
  'execution_role_and_privileges',
  coalesce(role_and_privileges.details, '{}'::jsonb)
from role_and_privileges
union all
select
  'new_object_names_available',
  jsonb_build_object(
    'trigger_name_available', not exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = pg_catalog.to_regclass('auth.users')
        and tgname = 'cleanup_owner_staff_signup_state_after_auth_delete'
    ),
    'function_name_available', not expected_function.already_exists
  )
from expected_function;
