-- READ ONLY: inspect one email's 039 completion state and related account rows.
-- Replace the placeholder with the exact normalized test email, then run in SQL Editor.
begin transaction read only;

with target as (
  select lower(btrim('REPLACE_WITH_TEST_EMAIL@example.com')) as email
), flow_row as (
  select f.*
  from public.owner_staff_email_signup_flows as f
  cross join target
  where lower(btrim(f.email)) = target.email
), auth_rows as (
  select
    u.id,
    u.email,
    case when nullif(to_jsonb(u)->>'deleted_at', '') is null then 'present' else 'soft_deleted' end as row_state
  from auth.users as u
  cross join target
  where lower(btrim(u.email)) = target.email
), flow_user_ids as (
  select verified_user_id as user_id from flow_row where verified_user_id is not null
  union
  select completed_user_id from flow_row where completed_user_id is not null
), profile_rows as (
  select p.id, p.user_id, p.role, p.approval_status, p.brand_id
  from public.profiles as p
  cross join target
  where lower(btrim(coalesce(to_jsonb(p)->>'email', ''))) = target.email
     or p.id in (select id from auth_rows)
     or p.user_id in (select id from auth_rows)
     or p.id in (select user_id from flow_user_ids)
     or p.user_id in (select user_id from flow_user_ids)
), membership_rows as (
  select m.user_id, m.store_id, m.role, m.status
  from public.store_memberships as m
  where m.user_id in (select id from auth_rows)
     or m.user_id in (select user_id from flow_user_ids)
), request_rows as (
  select r.email, r.requested_at, r.available_at
  from public.owner_staff_signup_requests as r
  cross join target
  where lower(btrim(r.email)) = target.email
)
select
  target.email as target_email,
  flow_row.role as flow_role,
  flow_row.request_id,
  flow_row.requested_at,
  flow_row.available_at,
  flow_row.expires_at,
  flow_row.sent_at,
  flow_row.verified_user_id,
  flow_row.verified_at,
  flow_row.completed_user_id,
  flow_row.completed_at,
  (flow_row.completed_at is not null) as start_rpc_returns_complete,
  case when flow_row.completed_at is not null then '039 complete -> app EMAIL_EXISTS'
       else '039 completed_at is null; this row alone does not map to EMAIL_EXISTS' end as 039_start_effect,
  coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from auth_rows as a), '[]'::jsonb) as auth_rows,
  coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from profile_rows as p), '[]'::jsonb) as profile_rows,
  coalesce((select jsonb_agg(to_jsonb(m) order by m.user_id, m.store_id) from membership_rows as m), '[]'::jsonb) as store_membership_rows,
  coalesce((select jsonb_agg(to_jsonb(r) order by r.requested_at) from request_rows as r), '[]'::jsonb) as 038_rate_limit_rows
from target
left join flow_row on true;

commit;
