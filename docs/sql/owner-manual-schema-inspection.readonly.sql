begin read only;

select namespaces.nspname as table_schema, tables.relname as table_name,
  triggers.tgname as trigger_name, triggers.tgenabled, triggers.tgisinternal,
  row_number() over(partition by triggers.tgrelid order by triggers.tgname) as name_order,
  functions_namespace.nspname as function_schema, functions.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(functions.oid) as function_signature,
  functions.prosecdef as security_definer,
  array(select setting from unnest(functions.proconfig) as options(setting) where setting like 'search_path=%') as search_path,
  triggers.tgnargs as argument_count, triggers.tgqual is not null as has_when_condition,
  format('CREATE TRIGGER %I %s %s ON %I.%I FOR EACH %s%s EXECUTE FUNCTION %I.%I(%s);',
    triggers.tgname,
    case when (triggers.tgtype & 2) <> 0 then 'BEFORE' when (triggers.tgtype & 64) <> 0 then 'INSTEAD OF' else 'AFTER' end,
    array_to_string(array_remove(array[
      case when (triggers.tgtype & 4) <> 0 then 'INSERT' end,
      case when (triggers.tgtype & 16) <> 0 then 'UPDATE' || case when triggers.tgattr <> ''::int2vector then
        ' OF ' || (select string_agg(quote_ident(attribute.attname), ', ' order by columns.position)
          from unnest(triggers.tgattr) with ordinality as columns(attnum,position)
          join pg_catalog.pg_attribute attribute on attribute.attrelid = tables.oid and attribute.attnum = columns.attnum) else '' end end,
      case when (triggers.tgtype & 8) <> 0 then 'DELETE' end,
      case when (triggers.tgtype & 32) <> 0 then 'TRUNCATE' end
    ],null), ' OR '), namespaces.nspname, tables.relname,
    case when (triggers.tgtype & 1) <> 0 then 'ROW' else 'STATEMENT' end,
    case when triggers.tgqual is not null then ' WHEN (<condition omitted>)' else '' end,
    functions_namespace.nspname, functions.proname,
    case when triggers.tgnargs > 0 then '<arguments omitted>' else '' end) as redacted_definition
from pg_catalog.pg_trigger triggers
join pg_catalog.pg_class tables on tables.oid = triggers.tgrelid
join pg_catalog.pg_namespace namespaces on namespaces.oid = tables.relnamespace
join pg_catalog.pg_proc functions on functions.oid = triggers.tgfoid
join pg_catalog.pg_namespace functions_namespace on functions_namespace.oid = functions.pronamespace
where namespaces.nspname = 'public' and tables.relname in ('manuals','manual_chunks')
order by table_name, trigger_name;

select constraints.conname, constraints.contype, constraints.condeferrable, constraints.condeferred,
  indexes.relname as supporting_index,
  array(select attribute.attname from unnest(constraints.conkey) with ordinality as keys(attnum,position)
    join pg_catalog.pg_attribute attribute on attribute.attrelid = constraints.conrelid and attribute.attnum = keys.attnum
    order by keys.position) as columns
from pg_catalog.pg_constraint constraints
left join pg_catalog.pg_class indexes on indexes.oid = constraints.conindid
where constraints.conrelid = to_regclass('public.manual_chunks') and constraints.contype in ('u','p')
order by constraints.conname;

select index_names.relname as index_name, indexes.indisunique, indexes.indisvalid,
  indexes.indisready, indexes.indimmediate, indexes.indnkeyatts,
  indexes.indpred is not null as is_partial, indexes.indexprs is not null as has_expressions,
  array(select attribute.attname from unnest(indexes.indkey) with ordinality as keys(attnum,position)
    left join pg_catalog.pg_attribute attribute on attribute.attrelid = indexes.indrelid and attribute.attnum = keys.attnum
    where keys.position <= indexes.indnkeyatts order by keys.position) as key_columns
from pg_catalog.pg_index indexes join pg_catalog.pg_class index_names on index_names.oid = indexes.indexrelid
where indexes.indrelid = to_regclass('public.manual_chunks') order by index_name;

select namespaces.nspname as vector_schema, types.typname, extensions.extname, extensions.extversion
from pg_catalog.pg_type types join pg_catalog.pg_namespace namespaces on namespaces.oid = types.typnamespace
left join pg_catalog.pg_depend dependencies on dependencies.classid = 'pg_type'::regclass
  and dependencies.objid = types.oid and dependencies.refclassid = 'pg_extension'::regclass and dependencies.deptype = 'e'
left join pg_catalog.pg_extension extensions on extensions.oid = dependencies.refobjid
where types.typname = 'vector';

select namespaces.nspname as table_schema, tables.relname as table_name, attribute.attname as column_name,
  pg_catalog.format_type(attribute.atttypid,attribute.atttypmod) as column_type,
  types_namespace.nspname as type_schema, attribute.atttypmod as type_modifier, attribute.attnotnull
from pg_catalog.pg_attribute attribute
join pg_catalog.pg_class tables on tables.oid = attribute.attrelid
join pg_catalog.pg_namespace namespaces on namespaces.oid = tables.relnamespace
join pg_catalog.pg_type types on types.oid = attribute.atttypid
join pg_catalog.pg_namespace types_namespace on types_namespace.oid = types.typnamespace
where namespaces.nspname = 'public' and attribute.attnum > 0 and not attribute.attisdropped and (
  (tables.relname = 'manuals' and attribute.attname in ('id','updated_at','title','category','content','brand_name','status','franchise_id','store_id','scope_type','parent_manual_id'))
  or (tables.relname = 'manual_chunks' and attribute.attname in ('manual_id','chunk_index','content','embedding'))
  or (tables.relname = 'stores' and attribute.attname in ('id','franchise_id'))
  or (tables.relname = 'store_memberships' and attribute.attname in ('user_id','store_id','role','status'))
) order by table_name, column_name;

select roles.rolname, namespaces.nspname as schema_name,
  has_schema_privilege(roles.oid,namespaces.oid,'USAGE') as can_use
from pg_catalog.pg_roles roles cross join pg_catalog.pg_namespace namespaces
where roles.rolname in ('anon','authenticated','service_role') and namespaces.nspname in ('public','extensions');

select roles.rolname, roles.rolbypassrls, tables.relname as table_name, tables.relrowsecurity, tables.relforcerowsecurity,
  has_table_privilege(roles.oid,tables.oid,'SELECT') as can_select,
  has_table_privilege(roles.oid,tables.oid,'INSERT') as can_insert,
  has_table_privilege(roles.oid,tables.oid,'UPDATE') as can_update,
  has_table_privilege(roles.oid,tables.oid,'DELETE') as can_delete
from pg_catalog.pg_roles roles cross join pg_catalog.pg_class tables
join pg_catalog.pg_namespace namespaces on namespaces.oid = tables.relnamespace
where roles.rolname in ('anon','authenticated','service_role') and namespaces.nspname = 'public'
  and tables.relname in ('manuals','manual_chunks','stores','store_memberships');

select functions.proname, pg_get_function_identity_arguments(functions.oid) as signature,
  pg_get_function_result(functions.oid) as result_type, functions.prosecdef,
  array(select setting from unnest(functions.proconfig) as options(setting) where setting like 'search_path=%') as search_path,
  roles.rolname, has_function_privilege(roles.oid,functions.oid,'EXECUTE') as can_execute
from pg_catalog.pg_proc functions join pg_catalog.pg_namespace namespaces on namespaces.oid = functions.pronamespace
cross join pg_catalog.pg_roles roles
where namespaces.nspname = 'public' and roles.rolname in ('anon','authenticated','service_role')
  and functions.proname in ('check_manual_write_contract','edit_store_manual_if_current','replace_manual_chunks_if_current',
    'invalidate_changed_manual_chunks','invalidate_manual_parent_chunks','lock_manual_hierarchy_write')
order by functions.proname, roles.rolname;

commit;