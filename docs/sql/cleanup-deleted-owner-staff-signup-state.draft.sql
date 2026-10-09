-- DRAFT ONLY. Never run before reviewing preview-deleted-owner-staff-signup-state.readonly.sql.
-- Targets exactly one normalized email + 039 request_id + confirmed old Auth user ID.
-- Set p_confirm_delete=true only after the preview was reviewed and all preconditions
-- still match. A default run is a no-op. This deletes no Auth/profile/membership/store/manual rows.
-- 038 has no user ID; it is deleted only after the exact 039 row links this email/request/user.

begin;

do $cleanup$
declare
  p_email text := lower(btrim('REPLACE_WITH_TEST_EMAIL@example.com'));
  p_request_id uuid := 'REPLACE_WITH_039_REQUEST_UUID'::uuid;
  p_old_user_id uuid := 'REPLACE_WITH_OLD_AUTH_USER_UUID'::uuid;
  p_confirm_delete boolean := false;
  flow public.owner_staff_email_signup_flows%rowtype;
  affected integer := 0;
begin
  if not p_confirm_delete then
    raise notice 'No deletion performed. Review the read-only preview, then explicitly set p_confirm_delete=true only if approved.';
    return;
  end if;
  if p_email = 'replace_with_test_email@example.com'
    or p_request_id = '00000000-0000-0000-0000-000000000000'::uuid
    or p_old_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Set exact test email, request_id, and confirmed old user ID.';
  end if;

  -- Serialize with 039 start/resend/verify/complete for this normalized email.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_email, 39));

  select * into flow
  from public.owner_staff_email_signup_flows
  where lower(btrim(email)) = p_email and request_id = p_request_id
  for update;
  if not found then raise exception 'The exact email/request_id 039 row no longer exists.'; end if;
  if (flow.verified_user_id is distinct from p_old_user_id and flow.completed_user_id is distinct from p_old_user_id)
    or (flow.verified_user_id is not null and flow.verified_user_id <> p_old_user_id)
    or (flow.completed_user_id is not null and flow.completed_user_id <> p_old_user_id) then
    raise exception '039 user IDs do not match the confirmed deleted Auth user ID.';
  end if;

  -- Repeat all safety checks immediately before deletion. Any account row, including a
  -- soft-deleted row, or any profile/membership relation means stop without cleanup.
  if exists (select 1 from auth.users where lower(btrim(email)) = p_email) then
    raise exception 'An Auth user row exists for this email; no signup history was deleted.';
  end if;
  if exists (
    select 1 from public.profiles as p
    where lower(btrim(coalesce(to_jsonb(p)->>'email', ''))) = p_email
       or p.id = p_old_user_id or p.user_id = p_old_user_id
       or p.id in (flow.verified_user_id, flow.completed_user_id)
       or p.user_id in (flow.verified_user_id, flow.completed_user_id)
  ) then raise exception 'A related profile exists; no signup history was deleted.'; end if;
  if exists (
    select 1 from public.store_memberships as m
    where m.user_id in (p_old_user_id, flow.verified_user_id, flow.completed_user_id)
  ) then raise exception 'A related store membership exists; no signup history was deleted.'; end if;

  delete from public.owner_staff_email_signup_flows
  where lower(btrim(email)) = p_email
    and request_id = p_request_id
    and (verified_user_id = p_old_user_id or completed_user_id = p_old_user_id);
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Expected exactly one 039 row; transaction aborted.'; end if;

  delete from public.owner_staff_signup_requests
  where lower(btrim(email)) = p_email;
  get diagnostics affected = row_count;
  if affected > 1 then raise exception 'Unexpected multiple 038 rows; transaction aborted.'; end if;
  raise notice 'Removed exactly one matching 039 flow and % matching 038 request row(s).', affected;
end
$cleanup$;

commit;

select
  lower(btrim('REPLACE_WITH_TEST_EMAIL@example.com')) as target_email,
  (select count(*) from auth.users where lower(btrim(email)) = lower(btrim('REPLACE_WITH_TEST_EMAIL@example.com'))) as remaining_auth_rows,
  (select count(*) from public.profiles where lower(btrim(coalesce(to_jsonb(profiles)->>'email', ''))) = lower(btrim('REPLACE_WITH_TEST_EMAIL@example.com'))
     or profiles.id = 'REPLACE_WITH_OLD_AUTH_USER_UUID'::uuid or profiles.user_id = 'REPLACE_WITH_OLD_AUTH_USER_UUID'::uuid) as remaining_profile_rows,
  (select count(*) from public.store_memberships where user_id = 'REPLACE_WITH_OLD_AUTH_USER_UUID'::uuid) as remaining_membership_rows,
  (select count(*) from public.owner_staff_email_signup_flows where lower(btrim(email)) = lower(btrim('REPLACE_WITH_TEST_EMAIL@example.com'))
     and request_id = 'REPLACE_WITH_039_REQUEST_UUID'::uuid) as remaining_target_039_rows,
  (select count(*) from public.owner_staff_signup_requests where lower(btrim(email)) = lower(btrim('REPLACE_WITH_TEST_EMAIL@example.com'))) as remaining_038_rows;
