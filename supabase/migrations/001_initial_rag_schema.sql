-- 일잇다 PoC: 승인된 프랜차이즈 매뉴얼 기반 RAG 스키마

create extension if not exists vector with schema extensions;

create table if not exists public.manuals (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  title text not null,
  category text not null,
  content text not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.manual_chunks (
  id uuid primary key default gen_random_uuid(),
  manual_id uuid not null references public.manuals(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  constraint manual_chunks_manual_id_chunk_index_key unique (manual_id, chunk_index)
);

create table if not exists public.question_logs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  similarity_score double precision
    check (similarity_score is null or similarity_score between -1 and 1),
  status text not null
    check (status in ('answered', 'cautious', 'insufficient')),
  source_manual_id uuid references public.manuals(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists manuals_status_idx
  on public.manuals (status);

create index if not exists manual_chunks_manual_id_idx
  on public.manual_chunks (manual_id);

-- Cosine distance (<=>) 기반 근접 검색용 인덱스입니다.
create index if not exists manual_chunks_embedding_hnsw_idx
  on public.manual_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

create or replace function public.match_manual_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 5
)
returns table (
  chunk_id uuid,
  manual_id uuid,
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
    m.title,
    m.category,
    mc.content,
    1 - (mc.embedding <=> query_embedding) as similarity_score
  from public.manual_chunks as mc
  join public.manuals as m on m.id = mc.manual_id
  where m.status = 'approved'
    and mc.embedding is not null
  order by mc.embedding <=> query_embedding asc
  limit greatest(match_count, 0);
$$;

alter table public.manuals enable row level security;
alter table public.manual_chunks enable row level security;
alter table public.question_logs enable row level security;

-- 이번 PoC에는 공개 anon 정책을 만들지 않습니다. 서버의 service_role 사용을 전제로 합니다.

insert into public.manuals (brand_name, title, category, content, status)
values
  (
    'M Coffee',
    '에스프레소 머신 청소',
    '마감',
    '마감 시 에스프레소 머신의 그룹헤드와 포터필터를 세척한다. 전용 세제를 사용하고 세척 후 잔여물이 남지 않았는지 확인한다. 세척 완료 후 머신 외부 물기를 닦고 전원을 확인한다.',
    'approved'
  ),
  (
    'M Coffee',
    '오픈 체크리스트',
    '오픈',
    '오픈 근무자는 영업 시작 전 출입문과 조명을 확인하고, POS와 결제 단말기를 켠다. 냉장고 온도를 확인한 뒤 당일 사용할 원재료를 준비하고 매장과 화장실의 청결 상태를 점검한다.',
    'approved'
  ),
  (
    'M Coffee',
    '원두 발주 기준',
    '재고/발주',
    '원두 재고가 영업일 기준 3일분 이하로 남으면 발주 대상이다. 발주 전 현재 재고와 예정 입고량을 확인하고, 발주 수량은 최근 일주일 평균 사용량을 기준으로 계산한다.',
    'approved'
  ),
  (
    'M Coffee',
    '환불 규정',
    '고객 응대',
    '제조 오류 또는 상품 이상으로 인한 환불 요청은 영수증이나 결제 내역을 확인한 후 처리한다. 고객 변심에 따른 환불은 상품 상태와 결제 수단을 확인하고 매장 책임자에게 먼저 문의한다.',
    'approved'
  ),
  (
    'M Coffee',
    '마감 위생 점검',
    '위생',
    '마감 전 작업대와 손잡이를 세척 및 소독하고, 사용한 도구를 세척해 건조한다. 음식물 쓰레기와 일반 쓰레기를 분리 배출하며, 냉장 보관 식재료의 밀폐 상태와 소비기한을 확인한다.',
    'approved'
  );