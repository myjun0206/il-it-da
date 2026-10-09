-- DRAFT ONLY — DO NOT APPLY.
-- Proposed versioned consent evidence for a future server-side signup flow.
-- Requires legal/operations decisions about retention after account deletion,
-- access requests, event idempotency, document version policy and account roles.
-- No current code writes this table; this file is not under supabase/migrations.

begin;

create table public.signup_consent_events (
  id uuid primary key default gen_random_uuid(),
  -- Nullable + SET NULL preserves an event without retaining a live Auth account link.
  -- This still remains personal/pseudonymous data and requires an approved retention period.
  user_id uuid references auth.users(id) on delete set null,
  signup_role text not null check (signup_role in ('hq', 'owner', 'staff')),
  document_key text not null check (document_key in (
    'service',
    'privacy_collection',
    'store_connection',
    'store_work'
  )),
  document_version text not null,
  accepted_at timestamptz not null,
  signup_flow text not null check (signup_flow in ('hq', 'owner_staff_email_first', 'owner_staff_legacy')),
  signup_request_id uuid,
  constraint signup_consent_event_version_nonempty check (length(btrim(document_version)) > 0)
);

create index signup_consent_events_user_accepted_idx
  on public.signup_consent_events(user_id, accepted_at desc);

alter table public.signup_consent_events enable row level security;
revoke all on public.signup_consent_events from public, anon, authenticated;
grant select, insert on public.signup_consent_events to service_role;

commit;

-- Before any production migration, decide whether account deletion should retain
-- consent evidence, set and implement category-specific retention/purge behavior,
-- and make consent event writes transactional/idempotent with the existing signup
-- completion boundary. Confirm least-privilege grants and RLS in a reviewed migration.
