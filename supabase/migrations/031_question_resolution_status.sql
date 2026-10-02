-- 031: 보류된 질문의 점주 처리 상태(open/in_progress/resolved) 및 처리 이력.
--
-- 배경:
-- question_logs(001, 022)는 status='insufficient'로 에스컬레이션된 질문의 매장만 연결했다.
-- 점주가 질문을 인지하고 처리 중이거나 처리를 완료했는지 추적할 별도 상태가 없었다.
--
-- 설계 요지:
-- 1) RAG의 status(answered/cautious/insufficient)는 매뉴얼 검색 판정이므로 덮어쓰지 않는다.
-- 2) resolution_status는 insufficient 질문에 대한 점주 처리 라이프사이클만 관리한다:
--    'open'(미처리), 'in_progress'(확인 중), 'resolved'(처리 완료).
-- 3) 기본값은 'open'이며, 기존 행도 미처리로 해석된다.
-- 4) resolution_revision은 상태 변경 시마다 1씩 증가하는 정수 버전으로,
--    낙관적 동시성 제어와 ABA 문제 방지에 사용된다 (기본값 1).
-- 5) resolution_updated_at, resolution_updated_by는 모든 상태 전이의 마지막 변경 시각과
--    Auth 사용자 ID를 기록한다.
-- 6) resolved_at, resolved_by는 가장 최근 'resolved'(처리 완료)로 전환된 시각과 처리자 ID를 기록한다.
--    ('in_progress'나 'open'으로 재열기 시 NULL로 리셋된다).
-- 7) resolution_updated_by, resolved_by는 auth.users(id)에 대한 FK(ON DELETE SET NULL)이다.
-- 8) 점주 화면에서 "매장별 + 처리 상태별 + 최신순" 필터링을 지원하기 위해 복합 인덱스를 추가한다.
--
-- 안전성:
-- 기존 데이터나 다른 테이블(notifications, manuals 등)은 일절 변경하지 않는다.

-- 1) 선행 구조 확인
do $$
begin
  if to_regclass('public.question_logs') is null then
    raise exception
      '031 requires table public.question_logs. Apply 001_initial_rag_schema.sql first.';
  end if;
end
$$;

-- 2) resolution_status 컬럼 추가 (기본값 'open')
alter table public.question_logs
  add column if not exists resolution_status text not null default 'open';

-- 3) resolution_status CHECK 제약
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'question_logs_resolution_status_check'
      and conrelid = 'public.question_logs'::regclass
  ) then
    alter table public.question_logs
      add constraint question_logs_resolution_status_check
      check (resolution_status in ('open', 'in_progress', 'resolved'));
  end if;
end
$$;

-- 4) resolution_revision 컬럼 추가 (기본값 1)
alter table public.question_logs
  add column if not exists resolution_revision integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'question_logs_resolution_revision_check'
      and conrelid = 'public.question_logs'::regclass
  ) then
    alter table public.question_logs
      add constraint question_logs_resolution_revision_check
      check (resolution_revision >= 1);
  end if;
end
$$;

-- 5) resolution_updated_at, resolution_updated_by 컬럼 추가
alter table public.question_logs
  add column if not exists resolution_updated_at timestamptz,
  add column if not exists resolution_updated_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'question_logs_resolution_updated_by_fkey'
      and conrelid = 'public.question_logs'::regclass
  ) then
    alter table public.question_logs
      add constraint question_logs_resolution_updated_by_fkey
      foreign key (resolution_updated_by) references auth.users(id) on delete set null;
  end if;
end
$$;

-- 6) resolved_at, resolved_by 컬럼 추가
alter table public.question_logs
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid;

-- 7) resolved_by FK 설정 (auth.users on delete set null)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'question_logs_resolved_by_fkey'
      and conrelid = 'public.question_logs'::regclass
  ) then
    alter table public.question_logs
      add constraint question_logs_resolved_by_fkey
      foreign key (resolved_by) references auth.users(id) on delete set null;
  end if;
end
$$;

-- 8) 매장 + 처리상태 + 생성일시 조회 최적화 인덱스
create index if not exists question_logs_store_resolution_created_at_idx
  on public.question_logs (store_id, resolution_status, created_at desc);
