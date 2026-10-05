begin read only;

select functions.proname,
  pg_catalog.pg_get_function_identity_arguments(functions.oid) as signature,
  pg_catalog.pg_get_function_result(functions.oid) as result_type,
  functions.prosecdef as security_definer,
  array(select setting from unnest(functions.proconfig) as options(setting)
    where setting like 'search_path=%') as search_path,
  has_function_privilege('service_role', functions.oid, 'EXECUTE') as service_can_execute,
  has_function_privilege('anon', functions.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', functions.oid, 'EXECUTE') as authenticated_can_execute
from pg_catalog.pg_proc functions
where functions.pronamespace = 'public'::regnamespace
  and functions.proname in ('check_manual_write_contract', 'edit_store_manual_if_current',
    'replace_manual_chunks_if_current', 'invalidate_changed_manual_chunks',
    'invalidate_manual_parent_chunks', 'lock_manual_hierarchy_write')
order by functions.proname;

select triggers.tgname, triggers.tgenabled, triggers.tgtype,
  functions.proname as function_name,
  triggers.tgqual is not null as has_when_condition
from pg_catalog.pg_trigger triggers
join pg_catalog.pg_proc functions on functions.oid = triggers.tgfoid
where triggers.tgrelid = 'public.manuals'::regclass and not triggers.tgisinternal
order by triggers.tgname;

set local role service_role;
select public.check_manual_write_contract() as manual_write_contract_version;

rollback;