-- 030: Per-user first-read state for notices.
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
