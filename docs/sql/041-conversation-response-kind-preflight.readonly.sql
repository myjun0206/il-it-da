begin transaction read only;
set local statement_timeout = '10s';

select current_database() as database_name,
       to_regclass('public.conversation_messages') is not null as target_table_exists,
       to_regclass('supabase_migrations.schema_migrations') is not null as migration_history_table_exists;

select n.nspname as schema_name, c.relname as table_name,
       a.attname as column_name, format_type(a.atttypid, a.atttypmod) as data_type,
       a.attnotnull as not_null, pg_get_expr(d.adbin, d.adrelid) as default_expression
from pg_catalog.pg_attribute a
join pg_catalog.pg_class c on c.oid = a.attrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where n.nspname = 'public' and c.relname = 'conversation_messages'
  and a.attname = 'response_kind' and a.attnum > 0 and not a.attisdropped;

select con.conname as constraint_name, con.convalidated as validated,
       pg_get_constraintdef(con.oid) as definition
from pg_catalog.pg_constraint con
where con.conrelid = to_regclass('public.conversation_messages');

commit;

-- Run this separate read-only query only when migration_history_table_exists
-- was true above. Keep history unchanged and do not reapply Auth 040.
-- If the table is absent, inspect the manual deployment record instead.
begin transaction read only;
set local statement_timeout = '10s';

select version::text as version, name
from supabase_migrations.schema_migrations
order by version desc;

commit;