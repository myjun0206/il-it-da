-- Read-only diagnosis for one owner/staff signup email.
-- Replace the placeholder with the exact test email, then run in the Supabase SQL editor.
-- This does not change auth, profiles, memberships, or signup request/flow rows.
begin transaction read only;

with target as (
  select lower(btrim('REPLACE_WITH_TEST_EMAIL@example.com')) as email
), auth_rows as (
  select
    u.id,
    u.email,
    to_jsonb(u) as user_json,
    u.raw_app_meta_data->>'provider' as app_provider,
    u.raw_user_meta_data->>'role' as signup_role
  from auth.users as u
  cross join target
  where lower(btrim(u.email)) = target.email
), flow_rows as (
  select flow.*
  from public.owner_staff_email_signup_flows as flow
  cross join target
  where lower(btrim(flow.email)) = target.email
), profile_rows as (
  select p.id, p.user_id, to_jsonb(p) as profile_json
  from public.profiles as p
  cross join target
  where lower(btrim(coalesce(to_jsonb(p)->>'email', ''))) = target.email
     or p.id in (select id from auth_rows)
     or p.user_id in (select id from auth_rows)
     or p.id in (select verified_user_id from flow_rows where verified_user_id is not null)
     or p.user_id in (select verified_user_id from flow_rows where verified_user_id is not null)
     or p.id in (select completed_user_id from flow_rows where completed_user_id is not null)
     or p.user_id in (select completed_user_id from flow_rows where completed_user_id is not null)
), candidate_user_ids as (
  select id from auth_rows
  union select verified_user_id from flow_rows where verified_user_id is not null
  union select completed_user_id from flow_rows where completed_user_id is not null
  union select id from profile_rows
  union select user_id from profile_rows where user_id is not null
), findings as (
  select 'target'::text as source, jsonb_build_object('normalized_email', target.email) as details
  from target
  union all
  select 'auth.users', jsonb_build_object(
    'id', auth.id,
    'email', auth.email,
    'row_state', case when nullif(auth.user_json->>'deleted_at', '') is null then 'present' else 'soft_deleted' end,
    'deleted_at', auth.user_json->>'deleted_at',
    'email_confirmed_at', auth.user_json->>'email_confirmed_at',
    'last_sign_in_at', auth.user_json->>'last_sign_in_at',
    'provider', auth.app_provider,
    'identity_providers', coalesce((
      select jsonb_agg(identity.provider order by identity.provider)
      from auth.identities as identity where identity.user_id = auth.id
    ), '[]'::jsonb),
    'signup_role', auth.signup_role,
    'has_password', coalesce(auth.user_json->>'encrypted_password', '') <> ''
  ) from auth_rows as auth
  union all
  select 'profiles', jsonb_build_object(
    'id', profile.id,
    'user_id', profile.user_id,
    'email', profile.profile_json->>'email',
    'role', profile.profile_json->>'role',
    'approval_status', profile.profile_json->>'approval_status'
  ) from profile_rows as profile
  union all
  select 'store_memberships', jsonb_build_object(
    'user_id', membership.user_id,
    'store_id', membership.store_id,
    'role', membership.role,
    'status', membership.status
  )
  from public.store_memberships as membership
  where membership.user_id in (select id from candidate_user_ids)
  union all
  select 'owner_staff_signup_requests', jsonb_build_object(
    'email', request.email,
    'requested_at', request.requested_at,
    'available_at', request.available_at
  )
  from public.owner_staff_signup_requests as request
  cross join target
  where lower(btrim(request.email)) = target.email
  union all
  select 'owner_staff_email_signup_flows', jsonb_build_object(
    'email', flow.email,
    'role', flow.role,
    'requested_at', flow.requested_at,
    'available_at', flow.available_at,
    'expires_at', flow.expires_at,
    'request_id', flow.request_id,
    'sent_at', flow.sent_at,
    'verified_user_id', flow.verified_user_id,
    'verified_at', flow.verified_at,
    'completed_user_id', flow.completed_user_id,
    'completed_at', flow.completed_at
  ) from flow_rows as flow
)
select source, details
from findings
order by source, details::text;

commit;
