-- 006: role unification + store membership/approval foundation.
--
-- Scope for this migration only: member roles, store membership, and approval
-- state. It intentionally does NOT create login accounts, does NOT touch
-- auth.users rows, and does NOT add email/password/token columns anywhere.
-- A teammate's planned 007 migration owns temporary verification-code
-- issuance/confirmation, and 008 owns registering real members/stores/
-- memberships once verification succeeds; this file must not pre-implement
-- either of those.
--
-- store_memberships rows are never inserted by a regular client. 008's signup
-- server API creates them with the service role: an owner signup creates the
-- store plus an owner/pending membership, and a staff signup creates a
-- staff/pending membership for the chosen store. Regular users may only read
-- their own profile and their own memberships here.
--
-- Existing data handling:
--   * No existing table is dropped.
--   * No existing row is deleted or truncated.
--   * No existing column is renamed or removed.
--   * stores.boss_id is left untouched for compatibility.
--   * manuals, manual_chunks, questions, question_logs, and the search
--     functions from 001/002/003/005 are not touched.
--   * The only existing-data change is profiles.role: 'boss' -> 'owner'.
--
-- Execution order (all in one transaction so a mid-failure leaves no partial
-- state applied):
--   1. Drop the existing profiles.role check (by its real name from
--      004_store_schema.sql: profiles_role_check) so legacy 'boss' values can
--      be updated without violating it.
--   2. Convert profiles.role = 'boss' to 'owner'.
--   3. Add the new profiles.role check limited to 'hq' | 'owner' | 'staff'.
--      004's original check only allowed ('boss', 'staff') or NULL, so after
--      step 2 the only possible existing values are 'owner', 'staff', or
--      NULL -- all satisfy the new check, so this cannot fail on legacy data.
--   4. Create public.store_memberships to record each user's requested/
--      approved/rejected relationship to a store.
--   5. Add indexes for the actual lookup patterns (per-user, per-store,
--      per-store-pending-queue, and global per-status).
--   6. Enable RLS and add only self-read policies for profiles and
--      store_memberships. Membership creation, approval, and rejection are
--      intentionally left to the future service-role APIs in 007/008.

begin;

set local search_path = public, auth;

-- Step 1-3: normalize profiles.role to the app's hq | owner | staff contract.
alter table public.profiles
  drop constraint if exists profiles_role_check;

update public.profiles
set role = 'owner'
where role = 'boss';

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('hq', 'owner', 'staff'));

-- Step 4: user <-> store membership/approval state.
-- No email, password, or token column exists here or elsewhere in this file.
create table if not exists public.store_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  role text not null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  rejected_at timestamptz,
  rejected_by uuid references auth.users(id),
  -- No trigger is added to auto-maintain this column: the project has no
  -- existing updated_at trigger function (manuals.updated_at follows the
  -- same manual-update convention), and this migration's scope is limited to
  -- role/membership data, not introducing new global trigger infrastructure.
  -- A future migration/API should set updated_at explicitly on status change.
  updated_at timestamptz not null default now(),
  constraint store_memberships_role_check
    check (role in ('owner', 'staff')),
  constraint store_memberships_status_check
    check (status in ('pending', 'approved', 'rejected')),
  constraint store_memberships_user_id_store_id_key
    unique (user_id, store_id),
  -- A requester cannot be recorded as their own approver/rejecter. Enforceable
  -- today as a plain data-integrity rule, independent of which future service
  -- role/API performs the approval.
  constraint store_memberships_approver_not_requester_check
    check (approved_by is null or approved_by <> user_id),
  constraint store_memberships_rejecter_not_requester_check
    check (rejected_by is null or rejected_by <> user_id),
  constraint store_memberships_decision_consistency_check
    check (
      (
        status = 'pending'
        and approved_at is null
        and approved_by is null
        and rejected_at is null
        and rejected_by is null
      )
      or (
        status = 'approved'
        and approved_at is not null
        and approved_by is not null
        and rejected_at is null
        and rejected_by is null
      )
      or (
        status = 'rejected'
        and rejected_at is not null
        and rejected_by is not null
        and approved_at is null
        and approved_by is null
      )
    )
);

-- Step 5: indexes for the real query patterns only.
-- The unique constraint above already creates a (user_id, store_id) index,
-- which fully serves "lookup by user_id" (user_id is the leading column), so
-- a separate standalone user_id index would be redundant and is omitted.
create index if not exists store_memberships_store_id_status_idx
  on public.store_memberships (store_id, status);

create index if not exists store_memberships_status_idx
  on public.store_memberships (status);

-- Step 6: RLS.
alter table public.profiles enable row level security;
alter table public.store_memberships enable row level security;

-- profiles: 004_store_schema.sql enabled RLS but never added a policy, so
-- profiles were unreadable by any non-service-role client. This migration
-- adds only a self-read SELECT policy. No INSERT/UPDATE/DELETE policy is
-- added for regular users, so a user can never change their own role (or any
-- other profile column); profile writes are left to a future service-role API.
drop policy if exists profiles_select_own_profile on public.profiles;

create policy profiles_select_own_profile
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- store_memberships: a user may see only their own rows (no recursive
-- subquery is used, so there is no self-referential RLS recursion risk).
-- No INSERT/UPDATE/DELETE policy is added for regular users: membership rows
-- are created only by 008's service-role signup API, and approval/rejection/
-- reapplication are handled only by a future service-role API, which bypasses
-- RLS entirely. A regular user therefore cannot create, approve, reject, or
-- otherwise modify any membership, including their own.
drop policy if exists store_memberships_select_own_memberships on public.store_memberships;

create policy store_memberships_select_own_memberships
  on public.store_memberships
  for select
  to authenticated
  using (auth.uid() = user_id);

commit;
