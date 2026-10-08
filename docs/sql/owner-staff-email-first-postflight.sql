begin transaction read only;
select c.relname, c.relrowsecurity, c.relforcerowsecurity,
  pg_catalog.pg_get_userbyid(c.relowner) as owner
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='owner_staff_email_signup_flows';

select a.attname, pg_catalog.format_type(a.atttypid,a.atttypmod) as type, a.attnotnull
from pg_catalog.pg_attribute a
where a.attrelid=pg_catalog.to_regclass('public.owner_staff_email_signup_flows')
  and a.attnum>0 and not a.attisdropped order by a.attnum;

select role.rolname,
  pg_catalog.has_table_privilege(role.oid,c.oid,'SELECT') as can_select,
  pg_catalog.has_table_privilege(role.oid,c.oid,'INSERT') as can_insert,
  pg_catalog.has_table_privilege(role.oid,c.oid,'UPDATE') as can_update,
  pg_catalog.has_table_privilege(role.oid,c.oid,'DELETE') as can_delete
from pg_catalog.pg_roles role cross join pg_catalog.pg_class c
where role.rolname in ('anon','authenticated','service_role')
  and c.oid=pg_catalog.to_regclass('public.owner_staff_email_signup_flows');

select p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  pg_catalog.pg_get_function_result(p.oid) as returns, p.prosecdef, p.proconfig,
  pg_catalog.md5(pg_catalog.btrim(pg_catalog.replace(p.prosrc,E'\r',''),E' \n\t')) as body_md5,
  pg_catalog.md5(pg_catalog.btrim(pg_catalog.replace(p.prosrc,E'\r',''),E' \n\t')) = '0bfddc800a7cc3bacb8175c57ea1a202' as matches_reviewed_body,
  pg_catalog.pg_get_userbyid(p.proowner) as owner
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='prepare_owner_staff_email_first_signup';

select role.rolname, pg_catalog.has_function_privilege(role.oid,p.oid,'EXECUTE') as can_execute
from pg_catalog.pg_roles role cross join pg_catalog.pg_proc p
where role.rolname in ('anon','authenticated','service_role')
  and p.oid=pg_catalog.to_regprocedure('public.prepare_owner_staff_email_first_signup(text,text,text,uuid,uuid)');

select 'function' as object_type, acl.grantee=0 as is_public, acl.privilege_type
from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
where p.oid=pg_catalog.to_regprocedure('public.prepare_owner_staff_email_first_signup(text,text,text,uuid,uuid)')
union all
select 'table', acl.grantee=0, acl.privilege_type
from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
where c.oid=pg_catalog.to_regclass('public.owner_staff_email_signup_flows');

select policyname, roles, cmd from pg_catalog.pg_policies
where schemaname='public' and tablename='owner_staff_email_signup_flows';
rollback;