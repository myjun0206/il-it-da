-- 프랜차이즈 도메인 디렉터리 + 본사/지점 매뉴얼 계층 구조를 단일 마이그레이션으로 통합 정의.

-- 1) 프랜차이즈 도메인 디렉터리 -----------------------------------------------------

create table if not exists public.franchises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique,
  logo_url text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.franchises enable row level security;

-- 테스트/개발용 기본 프랜차이즈 디렉터리 데이터.
insert into public.franchises (name, domain)
values
  ('일잇다', 'ilitda.com'),
  ('메가MGC커피', 'megamgc.com'),
  ('교촌치킨', 'kyochon.com'),
  ('BHC', 'bhc.com'),
  ('네네치킨', 'nene.com'),
  ('컴패니언그룹', 'companiongroup.com')
on conflict (domain) do nothing;

-- 2) 본사/지점 매뉴얼 계층 ----------------------------------------------------------
-- 001_initial_rag_schema.sql 없이도 바로 적용 가능하도록 전체 컬럼을 포함해 생성한다.
-- brand_name은 franchise_id 도입 이전부터 쓰이던 레거시 표시용 컬럼으로, 하위 호환을 위해 유지한다.
create table if not exists public.manuals (
  id uuid primary key default gen_random_uuid(),
  brand_name text,
  franchise_id uuid,
  store_id uuid,
  parent_manual_id uuid,
  category text not null,
  title text not null,
  content text not null,
  status text not null default 'approved',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- 기존 001 마이그레이션으로 생성된 테이블 대비 누락 컬럼 보강.
alter table public.manuals
  add column if not exists franchise_id uuid,
  add column if not exists store_id uuid,
  add column if not exists parent_manual_id uuid;

-- 001 스키마의 brand_name not null 제약으로 franchise_id 기반 insert가 23502 에러를 낼 수 있어 완화한다.
alter table public.manuals
  alter column brand_name drop not null;

-- scope_type: 일부 환경에는 이미 not null로 존재해 23502 에러를 낼 수 있어 기본값/not null을 모두 보강한다.
alter table public.manuals
  add column if not exists scope_type text;

alter table public.manuals
  alter column scope_type drop not null;

alter table public.manuals
  alter column scope_type set default 'hq';

-- scope_type CHECK 제약조건이 이미 좁은 값 집합으로 정의돼 있어 23514 에러를 낼 수 있어 재정의한다.
alter table public.manuals drop constraint if exists manuals_scope_type_check;
alter table public.manuals add constraint manuals_scope_type_check
  check (scope_type is null or scope_type in ('hq', 'store', 'HQ', 'STORE', 'common', 'shared'));

alter table public.manuals
  alter column status set default 'approved';

do $$
begin
  -- franchise_id: 본사(프랜차이즈) 삭제 시 소속 매뉴얼도 함께 삭제.
  if exists (
    select 1
    from pg_constraint
    where conname = 'manuals_franchise_id_fkey'
      and conrelid = 'public.manuals'::regclass
  ) then
    alter table public.manuals drop constraint manuals_franchise_id_fkey;
  end if;

  alter table public.manuals
    add constraint manuals_franchise_id_fkey
    foreign key (franchise_id) references public.franchises(id) on delete cascade;

  -- store_id: null이면 본사 공통 매뉴얼, 값이 있으면 특정 지점 전용/커스텀 매뉴얼.
  if not exists (
    select 1
    from pg_constraint
    where conname = 'manuals_store_id_fkey'
      and conrelid = 'public.manuals'::regclass
  ) then
    alter table public.manuals
      add constraint manuals_store_id_fkey
      foreign key (store_id) references public.stores(id) on delete cascade;
  end if;

  -- parent_manual_id: 지점이 본사 매뉴얼을 상속/커스텀할 때 원본 본사 매뉴얼을 참조.
  if not exists (
    select 1
    from pg_constraint
    where conname = 'manuals_parent_manual_id_fkey'
      and conrelid = 'public.manuals'::regclass
  ) then
    alter table public.manuals
      add constraint manuals_parent_manual_id_fkey
      foreign key (parent_manual_id) references public.manuals(id) on delete set null;
  end if;
end
$$;

create index if not exists manuals_franchise_id_idx
  on public.manuals (franchise_id);

create index if not exists manuals_store_id_idx
  on public.manuals (store_id);

create index if not exists manuals_parent_manual_id_idx
  on public.manuals (parent_manual_id);

alter table public.manuals enable row level security;

-- 3) manual_chunks -> manuals(id) FK 확인 -------------------------------------------
-- 001_initial_rag_schema.sql에서 만든 테이블이 그대로 이어지지만, 누락된 환경 대비 명시적으로 보강한다.
do $$
begin
  if to_regclass('public.manual_chunks') is null then
    return;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = 'manual_chunks_manual_id_fkey'
      and conrelid = 'public.manual_chunks'::regclass
  ) then
    alter table public.manual_chunks drop constraint manual_chunks_manual_id_fkey;
  end if;

  alter table public.manual_chunks
    add constraint manual_chunks_manual_id_fkey
    foreign key (manual_id) references public.manuals(id) on delete cascade;
end
$$;

-- 4) match_manual_chunks: 010 계층 구조(franchise_id/store_id)를 인식하도록 재정의 ----
-- 파라미터가 늘어나 반환 타입도 바뀌므로 기존 2-인자 버전을 먼저 제거한 뒤 새로 만든다.
drop function if exists public.match_manual_chunks(extensions.vector(1536), integer);

create function public.match_manual_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 5,
  p_franchise_id uuid default null,
  p_store_id uuid default null
)
returns table (
  chunk_id uuid,
  manual_id uuid,
  franchise_id uuid,
  store_id uuid,
  title text,
  category text,
  content text,
  similarity_score double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    mc.id as chunk_id,
    m.id as manual_id,
    m.franchise_id,
    m.store_id,
    m.title,
    m.category,
    mc.content,
    1 - (mc.embedding <=> query_embedding) as similarity_score
  from public.manual_chunks as mc
  join public.manuals as m on m.id = mc.manual_id
  where m.status = 'approved'
    and mc.embedding is not null
    and (p_franchise_id is null or m.franchise_id = p_franchise_id)
    and (p_store_id is null or m.store_id = p_store_id or m.store_id is null)
  order by mc.embedding <=> query_embedding asc
  limit greatest(least(coalesce(match_count, 5), 10), 0);
$$;

-- 5) 초기 매뉴얼 시드 ----------------------------------------------------------------
-- 재실행해도 중복 삽입되지 않도록 각 CTE의 insert에 "where not exists" 가드를 둔다.
-- 브랜드별로 매뉴얼이 섞이지 않도록 title에 브랜드/지점명을 포함해 franchise_id별로 독립 생성한다.

-- 본사 공통 매뉴얼(store_id IS NULL): 등록된 프랜차이즈마다 개별 환불 규정을 시드한다.
with new_hq_manuals as (
  insert into public.manuals (franchise_id, store_id, brand_name, scope_type, category, title, content, status)
  select
    f.id,
    null,
    f.name,
    'hq',
    '고객 응대',
    f.name || ' 환불 규정',
    '제조 오류 또는 상품 이상으로 인한 환불 요청은 영수증이나 결제 내역을 확인한 후 처리한다. 고객 변심에 따른 환불은 상품 상태와 결제 수단을 확인하고 매장 책임자에게 먼저 문의한다.',
    'approved'
  from public.franchises f
  where not exists (
    select 1
    from public.manuals m
    where m.franchise_id = f.id
      and m.store_id is null
      and m.title = f.name || ' 환불 규정'
  )
  returning id, title, content
)
insert into public.manual_chunks (manual_id, chunk_index, content, embedding)
select id, 0, title || ' - ' || content, null
from new_hq_manuals
on conflict (manual_id, chunk_index) do nothing;

-- 지점 전용 매뉴얼: stores.boss_id -> profiles.brand_id로 지점이 속한 프랜차이즈를 찾아 franchise_id/store_id를 함께 채운다.
-- 지점이 없거나 소속 프랜차이즈를 정확히 매칭할 수 없으면(레거시 brand_id 등) 아무 것도 생성하지 않는다.
with new_store_manuals as (
  insert into public.manuals (franchise_id, store_id, brand_name, scope_type, category, title, content, status)
  select
    f.id,
    s.id,
    f.name,
    'store',
    '위생',
    s.store_name || ' 마감 위생 점검',
    '마감 전 작업대와 손잡이를 세척 및 소독하고, 사용한 도구를 세척해 건조한다. 음식물 쓰레기와 일반 쓰레기를 분리 배출하며, 냉장 보관 식재료의 밀폐 상태와 소비기한을 확인한다.',
    'approved'
  from public.stores s
  join public.profiles p on p.id = s.boss_id
  join public.franchises f
    on p.brand_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and f.id = p.brand_id::uuid
  where not exists (
    select 1
    from public.manuals m
    where m.store_id = s.id
      and m.category = '위생'
      and m.title = s.store_name || ' 마감 위생 점검'
  )
  returning id, title, content
)
insert into public.manual_chunks (manual_id, chunk_index, content, embedding)
select id, 0, title || ' - ' || content, null
from new_store_manuals
on conflict (manual_id, chunk_index) do nothing;

-- 메가MGC커피(megamgc.com) 전용 본사 공통 매뉴얼: domain으로 franchise_id를 핀포인트 매칭한다.
with new_megamgc_manual as (
  insert into public.manuals (franchise_id, store_id, brand_name, scope_type, category, title, content, status)
  select
    f.id,
    null,
    f.name,
    'hq',
    '재고/발주',
    '원두 발주 기준',
    '원두 재고가 영업일 기준 3일분 이하로 남으면 발주 대상이다. 발주 전 현재 재고와 예정 입고량을 확인하고, 발주 수량은 최근 일주일 평균 사용량을 기준으로 계산한다.',
    'approved'
  from public.franchises f
  where f.domain = 'megamgc.com'
    and not exists (
      select 1
      from public.manuals m
      where m.franchise_id = f.id
        and m.store_id is null
        and m.title = '원두 발주 기준'
    )
  returning id, title, content
)
insert into public.manual_chunks (manual_id, chunk_index, content, embedding)
select id, 0, title || ' - ' || content, null
from new_megamgc_manual
on conflict (manual_id, chunk_index) do nothing;

