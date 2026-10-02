-- 033 (formerly 029_notice_audience.sql): notice audience and franchise-level target scope.
-- Renumbered only to remove the duplicate 029 prefix (029_staff_hq_manual_read_access.sql).
-- ALREADY APPLIED on the shared Supabase project (notices.audience exists, verified 2026-10-02).
-- Do NOT re-run because of the rename: notices_target_scope_check is added without
-- "drop ... if exists", so a second run fails and rolls back.
-- Preserve legacy "all" rows/API clients while allowing the explicit
-- "franchise" value used by the audience-aware API.

begin;

alter table public.notices
  add column if not exists audience text;

-- Existing notices were visible to both owners and staff, so preserve that
-- behavior when assigning their audience.
update public.notices
set audience = 'all_members'
where audience is null;

alter table public.notices
  alter column audience set default 'all_members',
  alter column audience set not null;

alter table public.notices
  drop constraint if exists notices_audience_check,
  drop constraint if exists notices_target_type_check,
  drop constraint if exists notices_target_store_check;

alter table public.notices
  add constraint notices_audience_check
    check (audience in ('owner', 'all_members', 'staff')),
  add constraint notices_target_scope_check
    check (
      (target_type in ('all', 'franchise') and target_store_id is null)
      or (target_type = 'store' and target_store_id is not null)
    );

commit;