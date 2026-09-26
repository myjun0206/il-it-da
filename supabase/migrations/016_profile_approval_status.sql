-- 016: Profile-level approval status for franchise-domain signup.
--
-- HQ users are available immediately. Owner/staff users start pending until
-- the appropriate approval endpoint changes both profiles.approval_status and
-- store_memberships.status.

begin;

alter table public.profiles
  add column if not exists approval_status text not null default 'pending',
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null;

alter table public.profiles
  drop constraint if exists profiles_approval_status_check;

alter table public.profiles
  add constraint profiles_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected'));

update public.profiles
set
  approval_status = 'approved',
  approved_at = coalesce(approved_at, now())
where role = 'hq'
  and approval_status <> 'approved';

update public.profiles as p
set
  approval_status = 'approved',
  approved_at = coalesce(p.approved_at, sm.approved_at, now()),
  approved_by = coalesce(p.approved_by, sm.approved_by)
from public.store_memberships as sm
where sm.user_id = p.id
  and sm.status = 'approved'
  and p.role in ('owner', 'staff')
  and p.approval_status <> 'approved';

commit;