-- 021: HQ notices (본사 → 지점/점주 공지사항)
--
-- 본사(HQ) 관리자가 자기 프랜차이즈의 전체 지점 또는 특정 지점 하나에 공지를 작성한다.
-- - target_type = 'all'   : franchise 전체 지점 대상 (target_store_id = null)
-- - target_type = 'store' : target_store_id 지점 하나 대상
--
-- 읽기/쓰기는 서버 API(/api/hq/notices)가 service role로 HQ 권한과 franchise 범위를 검증한 뒤 수행한다.
-- 그래서 RLS만 켜 두고 anon/authenticated 직접 접근 정책은 만들지 않는다.

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  franchise_id uuid not null references public.franchises(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  target_type text not null default 'all'
    check (target_type in ('all', 'store')),
  target_store_id uuid references public.stores(id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  content text not null check (length(btrim(content)) > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint notices_target_store_check check (
    (target_type = 'all' and target_store_id is null)
    or (target_type = 'store' and target_store_id is not null)
  )
);

create index if not exists notices_franchise_created_at_idx
  on public.notices (franchise_id, created_at desc);

create index if not exists notices_target_store_id_idx
  on public.notices (target_store_id);

alter table public.notices enable row level security;
