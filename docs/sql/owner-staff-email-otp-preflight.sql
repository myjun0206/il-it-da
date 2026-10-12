begin transaction read only;
set local statement_timeout = '15s';

select current_setting('server_version') as server_version,
       current_user as review_role,
       current_setting('transaction_read_only') as transaction_read_only;

with expected(schema_name, object_name) as (
  values ('public', 'owner_staff_signup_requests'), ('auth', 'users'),
         ('auth', 'identities'), ('public', 'profiles')
)
select expected.*, relation.oid is not null as exists,
       relation.relkind, pg_catalog.pg_get_userbyid(relation.relowner) as owner,
       relation.relrowsecurity as rls_enabled, relation.relforcerowsecurity as force_rls
from expected
left join pg_catalog.pg_namespace as namespace on namespace.nspname = expected.schema_name
left join pg_catalog.pg_class as relation
  on relation.relnamespace = namespace.oid and relation.relname = expected.object_name
order by schema_name, object_name;

with expected(schema_name, table_name, column_name, allowed_types, required_by_rpc) as (
  values
    ('auth', 'users', 'id', array['uuid'], true),
    ('auth', 'users', 'email', array['text', 'varchar'], true),
    ('auth', 'users', 'email_confirmed_at', array['timestamptz'], true),
    ('auth', 'users', 'raw_app_meta_data', array['jsonb'], true),
    ('auth', 'users', 'raw_user_meta_data', array['jsonb'], true),
    ('auth', 'users', 'confirmation_sent_at', array['timestamptz'], false),
    ('auth', 'identities', 'user_id', array['uuid'], true),
    ('auth', 'identities', 'provider', array['text', 'varchar'], true),
    ('public', 'profiles', 'id', array['uuid'], true),
    ('public', 'owner_staff_signup_requests', 'email', array['text'], true),
    ('public', 'owner_staff_signup_requests', 'requested_at', array['timestamptz'], true),
    ('public', 'owner_staff_signup_requests', 'available_at', array['timestamptz'], true)
)
select expected.*, attribute.attnum is not null as exists,
       pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as actual_type,
       coalesce(type.typname = any(expected.allowed_types), false) as type_matches,
       attribute.attnotnull as not_null, attribute.atthasdef as has_default,
       attribute.attidentity as identity_kind, attribute.attgenerated as generated_kind
from expected
left join pg_catalog.pg_namespace as namespace on namespace.nspname = expected.schema_name
left join pg_catalog.pg_class as relation
  on relation.relnamespace = namespace.oid and relation.relname = expected.table_name
left join pg_catalog.pg_attribute as attribute
  on attribute.attrelid = relation.oid and attribute.attname = expected.column_name
  and attribute.attnum > 0 and not attribute.attisdropped
left join pg_catalog.pg_type as type on type.oid = attribute.atttypid
order by schema_name, table_name, column_name;

select attribute.attname as request_column,
       pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as actual_type,
       attribute.attnotnull, attribute.atthasdef, attribute.attidentity, attribute.attgenerated,
      column_collation.collname as collation_name
from pg_catalog.pg_attribute as attribute
    left join pg_catalog.pg_collation as column_collation on column_collation.oid = attribute.attcollation
where attribute.attrelid = pg_catalog.to_regclass('public.owner_staff_signup_requests')
  and attribute.attnum > 0 and not attribute.attisdropped
order by attribute.attnum;

select constraint_row.conname, constraint_row.contype, constraint_row.condeferrable,
       constraint_row.convalidated,
       array(select attribute.attname from unnest(constraint_row.conkey) with ordinality as key(attnum, position)
             join pg_catalog.pg_attribute as attribute
               on attribute.attrelid = constraint_row.conrelid and attribute.attnum = key.attnum
             order by key.position) as columns
from pg_catalog.pg_constraint as constraint_row
where constraint_row.conrelid = pg_catalog.to_regclass('public.owner_staff_signup_requests');

select index_relation.relname as index_name, index_row.indisunique, index_row.indisprimary,
       index_row.indisvalid, index_row.indimmediate,
       index_row.indpred is not null as partial_index,
       index_row.indexprs is not null as expression_index
from pg_catalog.pg_index as index_row
join pg_catalog.pg_class as index_relation on index_relation.oid = index_row.indexrelid
where index_row.indrelid = pg_catalog.to_regclass('public.owner_staff_signup_requests');

select procedure.oid::regprocedure::text as signature,
       pg_catalog.pg_get_userbyid(procedure.proowner) as owner,
       procedure.proargnames as argument_names, procedure.pronargdefaults as default_argument_count,
       pg_catalog.format_type(procedure.prorettype, null) as return_type,
       procedure.proretset as returns_set, procedure.prokind, language.lanname as language,
       procedure.prosecdef as security_definer,
       array(select setting from unnest(procedure.proconfig) as setting where setting like 'search_path=%') as search_path_settings,
       md5(btrim(replace(procedure.prosrc, E'\r', ''), E' \n\t')) as normalized_body_md5
from pg_catalog.pg_proc as procedure
join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
join pg_catalog.pg_language as language on language.oid = procedure.prolang
where namespace.nspname = 'public' and procedure.proname = 'prepare_owner_staff_signup'
order by signature;

select role.rolname, role.rolsuper, role.rolinherit, role.rolbypassrls,
       pg_catalog.has_schema_privilege(role.oid, 'public', 'USAGE') as public_schema_usage,
       case when pg_catalog.to_regprocedure('public.prepare_owner_staff_signup(text,text,text)') is not null
         then pg_catalog.has_function_privilege(role.oid, pg_catalog.to_regprocedure('public.prepare_owner_staff_signup(text,text,text)'), 'EXECUTE')
       end as rpc_execute,
       case when pg_catalog.to_regclass('public.owner_staff_signup_requests') is not null
         then pg_catalog.has_table_privilege(role.oid, pg_catalog.to_regclass('public.owner_staff_signup_requests'), 'SELECT') end as request_select,
       case when pg_catalog.to_regclass('public.owner_staff_signup_requests') is not null
         then pg_catalog.has_table_privilege(role.oid, pg_catalog.to_regclass('public.owner_staff_signup_requests'), 'INSERT') end as request_insert,
       case when pg_catalog.to_regclass('public.owner_staff_signup_requests') is not null
         then pg_catalog.has_table_privilege(role.oid, pg_catalog.to_regclass('public.owner_staff_signup_requests'), 'UPDATE') end as request_update,
       case when pg_catalog.to_regclass('public.owner_staff_signup_requests') is not null
         then pg_catalog.has_table_privilege(role.oid, pg_catalog.to_regclass('public.owner_staff_signup_requests'), 'DELETE') end as request_delete
from pg_catalog.pg_roles as role
where role.rolname in ('anon', 'authenticated', 'service_role')
order by role.rolname;

select member.rolname as member_role, parent.rolname as granted_role,
       membership.admin_option
from pg_catalog.pg_auth_members as membership
join pg_catalog.pg_roles as member on member.oid = membership.member
join pg_catalog.pg_roles as parent on parent.oid = membership.roleid
where member.rolname in ('anon', 'authenticated', 'service_role')
order by member_role, granted_role;

select 'table' as object_kind, coalesce(grantee.rolname, 'PUBLIC') as grantee,
       grant_row.privilege_type, grant_row.is_grantable
from pg_catalog.pg_class as relation
cross join lateral pg_catalog.aclexplode(coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) as grant_row
left join pg_catalog.pg_roles as grantee on grantee.oid = grant_row.grantee
where relation.oid = pg_catalog.to_regclass('public.owner_staff_signup_requests')
union all
select 'function', coalesce(grantee.rolname, 'PUBLIC'), grant_row.privilege_type, grant_row.is_grantable
from pg_catalog.pg_proc as procedure
cross join lateral pg_catalog.aclexplode(coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) as grant_row
left join pg_catalog.pg_roles as grantee on grantee.oid = grant_row.grantee
where procedure.oid = pg_catalog.to_regprocedure('public.prepare_owner_staff_signup(text,text,text)');

select pg_catalog.pg_get_userbyid(default_acl.defaclrole) as creator_role,
       coalesce(namespace.nspname, '(all schemas)') as schema_name,
       default_acl.defaclobjtype as object_kind,
       coalesce(grantee.rolname, 'PUBLIC') as grantee, grant_row.privilege_type, grant_row.is_grantable
from pg_catalog.pg_default_acl as default_acl
left join pg_catalog.pg_namespace as namespace on namespace.oid = default_acl.defaclnamespace
cross join lateral pg_catalog.aclexplode(default_acl.defaclacl) as grant_row
left join pg_catalog.pg_roles as grantee on grantee.oid = grant_row.grantee
where default_acl.defaclobjtype in ('r', 'f')
  and (default_acl.defaclnamespace = 0 or namespace.nspname = 'public')
order by creator_role, schema_name, object_kind, grantee;

select column_grant.column_name, column_grant.grantee, column_grant.privilege_type
from information_schema.column_privileges as column_grant
where column_grant.table_schema = 'public' and column_grant.table_name = 'owner_staff_signup_requests'
order by column_grant.column_name, column_grant.grantee;

select policy.polname, policy.polcmd, policy.polpermissive,
       array(select coalesce(role.rolname, 'PUBLIC') from unnest(policy.polroles) as role_id
             left join pg_catalog.pg_roles as role on role.oid = role_id) as roles,
       policy.polqual is not null as has_using_expression,
       policy.polwithcheck is not null as has_check_expression
from pg_catalog.pg_policy as policy
where policy.polrelid = pg_catalog.to_regclass('public.owner_staff_signup_requests');

select namespace.nspname as table_schema, relation.relname as table_name,
       trigger.tgname, trigger.tgenabled, trigger.tgisinternal,
       (trigger.tgtype & 4) <> 0 as on_insert,
       (trigger.tgtype & 1) <> 0 as for_each_row,
       (trigger.tgtype & 2) <> 0 as before_event,
       trigger_namespace.nspname as function_schema, procedure.proname as function_name,
       procedure.prosecdef as security_definer,
       pg_catalog.pg_get_userbyid(procedure.proowner) as function_owner,
       md5(btrim(replace(procedure.prosrc, E'\r', ''), E' \n\t')) as function_body_md5,
       case when namespace.nspname = 'auth' and relation.relname = 'users'
                  and (trigger.tgtype & 4) <> 0 and not trigger.tgisinternal
         then 'REVIEW_AUTH_INSERT_SIDE_EFFECTS' else 'REVIEW_IF_UNEXPECTED' end as review_action
from pg_catalog.pg_trigger as trigger
join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
join pg_catalog.pg_proc as procedure on procedure.oid = trigger.tgfoid
join pg_catalog.pg_namespace as trigger_namespace on trigger_namespace.oid = procedure.pronamespace
where trigger.tgrelid in (pg_catalog.to_regclass('auth.users'), pg_catalog.to_regclass('public.owner_staff_signup_requests'))
order by table_schema, table_name, trigger.tgname;

rollback;