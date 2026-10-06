-- 034 (formerly 030_notice_reads.sql): Per-user first-read state for notices.
-- Renumbered only to remove the duplicate 030 prefix (030_remove_keyword_boost_score_floor.sql).
-- ALREADY APPLIED on the shared Supabase project (public.notice_reads exists, verified 2026-10-02).
-- Do NOT re-run because of the rename; verify with the read-only checks before any manual action.
-- Notice read/write access remains server-only and is authorized by the API.

begin;

create table if not exists public.notice_reads (
  notice_id uuid not null references public.notices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  constraint notice_reads_pkey primary key (notice_id, user_id)
);

-- The primary key supports notice-first lookups; this index supports loading
-- a user's read state across a list of notices.
create index if not exists notice_reads_user_notice_idx
  on public.notice_reads (user_id, notice_id);

alter table public.notice_reads enable row level security;

commit;
