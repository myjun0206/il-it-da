begin transaction read only;
with required(schema_name, table_name, column_name, allowed_types) as (values
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
)
select r.schema_name, r.table_name, r.column_name, r.allowed_types,
  pg_catalog.format_type(a.atttypid,a.atttypmod) as actual_type,
  a.attnotnull as not_null,
  case when a.attnum is null then 'MISSING'
    when c.relkind not in ('r','p') or t.typnamespace <> 'pg_catalog'::regnamespace
      or not t.typname=any(r.allowed_types) then 'INCOMPATIBLE'
    else 'OK' end as result
from required r
left join pg_catalog.pg_namespace n on n.nspname=r.schema_name
left join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=r.table_name
left join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attname=r.column_name
  and a.attnum>0 and not a.attisdropped
left join pg_catalog.pg_type t on t.oid=a.atttypid
order by r.schema_name,r.table_name,r.column_name;

select rolname, rolcanlogin, rolsuper, rolbypassrls
from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role');

select n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
  pg_catalog.pg_get_userbyid(c.relowner) as owner
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='owner_staff_email_signup_flows';

select n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) as owner
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='prepare_owner_staff_email_first_signup';

select con.conname, pg_catalog.pg_get_constraintdef(con.oid) as definition
from pg_catalog.pg_constraint con
where con.conrelid in (pg_catalog.to_regclass('public.profiles'),pg_catalog.to_regclass('public.store_memberships'))
  and con.contype in ('p','f','u');
rollback;