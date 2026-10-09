-- READ ONLY preview for one already-deleted test Auth account.
-- Fill all three placeholders from the current 039 diagnostics: normalized email,
-- exact flow request_id, and the old Auth user ID stored in verified/completed fields.
-- A missing/ambiguous relationship means stop; do not guess an identifier.
begin transaction read only;

with target as (
  select
    lower(btrim('REPLACE_WITH_TEST_EMAIL@example.com')) as email,
    'REPLACE_WITH_039_REQUEST_UUID'::uuid as request_id,
    'REPLACE_WITH_OLD_AUTH_USER_UUID'::uuid as old_user_id
), auth_rows as (
  select u.id, u.email, to_jsonb(u)->>'deleted_at' as deleted_at
  from auth.users as u cross join target
  where lower(btrim(u.email)) = target.email
), flow_rows as (
  select f.* from public.owner_staff_email_signup_flows as f cross join target
  where lower(btrim(f.email)) = target.email and f.request_id = target.request_id
), profile_rows as (
  select p.id, p.user_id, to_jsonb(p)->>'email' as email, to_jsonb(p)->>'role' as role,
    to_jsonb(p)->>'approval_status' as approval_status
  from public.profiles as p cross join target
  where lower(btrim(coalesce(to_jsonb(p)->>'email', ''))) = target.email
     or p.id = target.old_user_id or p.user_id = target.old_user_id
     or p.id in (select verified_user_id from flow_rows where verified_user_id is not null)
     or p.user_id in (select verified_user_id from flow_rows where verified_user_id is not null)
     or p.id in (select completed_user_id from flow_rows where completed_user_id is not null)
     or p.user_id in (select completed_user_id from flow_rows where completed_user_id is not null)
), membership_rows as (
  select to_jsonb(m) as membership_row
  from public.store_memberships as m cross join target
  where m.user_id = target.old_user_id
     or m.user_id in (select verified_user_id from flow_rows where verified_user_id is not null)
     or m.user_id in (select completed_user_id from flow_rows where completed_user_id is not null)
), request_rows as (
  select r.email, r.requested_at, r.available_at
  from public.owner_staff_signup_requests as r cross join target
  where lower(btrim(r.email)) = target.email
)
select
  target.email as target_email,
  target.request_id as target_request_id,
  target.old_user_id as confirmed_old_user_id,
  coalesce((select jsonb_agg(to_jsonb(a)) from auth_rows as a), '[]'::jsonb) as auth_rows,
  coalesce((select jsonb_agg(to_jsonb(p)) from profile_rows as p), '[]'::jsonb) as profile_rows,
  coalesce((select jsonb_agg(m.membership_row) from membership_rows as m), '[]'::jsonb) as membership_rows,
  coalesce((select jsonb_agg(to_jsonb(f)) from flow_rows as f), '[]'::jsonb) as exact_039_flow_rows,
  coalesce((select jsonb_agg(to_jsonb(r)) from request_rows as r), '[]'::jsonb) as matching_038_request_rows,
  (select count(*) from auth_rows) = 0 as no_auth_rows,
  (select count(*) from profile_rows) = 0 as no_profile_rows,
  (select count(*) from membership_rows) = 0 as no_membership_rows,
  (select count(*) from flow_rows) = 1 as exactly_one_039_request_match,
  exists (
    select 1 from flow_rows as f
    where (f.verified_user_id = target.old_user_id or f.completed_user_id = target.old_user_id)
      and (f.verified_user_id is null or f.verified_user_id = target.old_user_id)
      and (f.completed_user_id is null or f.completed_user_id = target.old_user_id)
  ) as flow_user_ids_match_confirmed_old_user
from target;

commit;
