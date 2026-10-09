-- DRAFT ONLY — NOT AN APPLIED MIGRATION. Do not run in the shared project.
-- Scope: after a physical auth.users DELETE, remove only 038/039 signup-state rows
-- for OLD.email, and only when no auth.users row remains for that normalized email.
-- Existing 038 and 039 definitions are intentionally untouched.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
declare
  active_role oid := (select oid from pg_catalog.pg_roles where rolname = current_user);
  active_is_superuser boolean := coalesce((select rolsuper from pg_catalog.pg_roles where oid = active_role), false);
begin
  if to_regclass('auth.users') is null
    or to_regclass('public.owner_staff_signup_requests') is null
    or to_regclass('public.owner_staff_email_signup_flows') is null then
    raise exception using errcode = '55000', message = 'AUTH_DELETE_SIGNUP_CLEANUP_DEPENDENCY_MISSING';
  end if;
  if (select count(*) from pg_catalog.pg_roles where rolname in ('anon', 'authenticated', 'service_role')) <> 3
    or not has_schema_privilege(current_user, 'auth', 'USAGE')
    or not has_schema_privilege(current_user, 'public', 'USAGE')
    or not has_schema_privilege(current_user, 'public', 'CREATE')
    or not has_language_privilege(current_user, 'plpgsql', 'USAGE')
    or not has_table_privilege(current_user, 'auth.users', 'SELECT')
    or pg_catalog.row_security_active('auth.users'::regclass)
    or not has_table_privilege(current_user, 'auth.users', 'TRIGGER')
    or exists (
      select 1
      from (values
        ('public.owner_staff_signup_requests'),
        ('public.owner_staff_email_signup_flows')
      ) as state_table(table_name)
      join pg_catalog.pg_class as relation on relation.oid = pg_catalog.to_regclass(state_table.table_name)
      where not has_table_privilege(current_user, state_table.table_name, 'SELECT,DELETE')
        or (relation.relrowsecurity and not (
          active_is_superuser
          or coalesce((select rolbypassrls from pg_catalog.pg_roles where oid = active_role), false)
          or (relation.relowner = active_role and not relation.relforcerowsecurity)
        ))
    ) then
    raise exception using errcode = '55000', message = 'AUTH_DELETE_SIGNUP_CLEANUP_REQUIRED_PRIVILEGES_MISSING';
  end if;
  if exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'cleanup_owner_staff_signup_state_after_auth_delete'
  ) or to_regprocedure('public.cleanup_owner_staff_signup_state_after_auth_delete()') is not null then
    raise exception using errcode = '55000', message = 'AUTH_DELETE_SIGNUP_CLEANUP_OBJECT_EXISTS_REVIEW_REQUIRED';
  end if;
end
$preflight$;

-- Fail closed until an operator reviews every Auth.users trigger shown by the
-- separate read-only preflight in the target project. Never replace/drop them.
do $trigger_review$
declare
  auth_trigger_inventory_reviewed boolean := false;
begin
  if not auth_trigger_inventory_reviewed then
    raise exception using errcode = '55000', message = 'AUTH_DELETE_TRIGGER_INVENTORY_REVIEW_REQUIRED';
  end if;
end
$trigger_review$;

create function public.cleanup_owner_staff_signup_state_after_auth_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_email text := lower(btrim(old.email));
begin
  if target_email is null or target_email = '' then
    return old;
  end if;

  -- Serialize with the 039 prepare RPC, which uses the same email advisory lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_email, 39));

  -- Do not clear state if a different Auth row still owns this normalized email.
  if exists (select 1 from auth.users as account where lower(btrim(account.email)) = target_email) then
    return old;
  end if;

  delete from public.owner_staff_email_signup_flows as flow
  where lower(btrim(flow.email)) = target_email;

  -- 038 is only the legacy email cooldown row; it has no user/profile/store data.
  delete from public.owner_staff_signup_requests as request
  where lower(btrim(request.email)) = target_email;

  return old;
end
$function$;

revoke all on function public.cleanup_owner_staff_signup_state_after_auth_delete() from public, anon, authenticated;

create trigger cleanup_owner_staff_signup_state_after_auth_delete
after delete on auth.users
for each row
execute function public.cleanup_owner_staff_signup_state_after_auth_delete();

commit;
