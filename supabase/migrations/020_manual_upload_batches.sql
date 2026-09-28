-- 020: 매뉴얼 업로드 중복 저장 방지(idempotency + content fingerprint).
--
-- 배경: 미리보기에서 확정 저장을 누르면 saveManualGroupsWithChunks가 항상 새 manuals 행을
-- 만든다. 클라이언트의 isSaving/isSubmittingRef는 같은 탭의 연속 클릭만 막을 뿐,
-- 새로고침 후 재시도·네트워크 재전송·같은 파일 재업로드는 막지 못해 동일한 부모·자식 쌍이
-- 여러 번 생성됐다. 이 마이그레이션은 저장 요청 자체를 식별하는 batch 테이블을 추가한다.
--
-- 설계 요지
--   1) idempotency_key: 미리보기 1회당 1개. 같은 key의 재전송은 새 manuals 행을 만들지 않는다.
--   2) content_hash: 서버가 최종 확정 데이터를 정규화해 계산한 SHA-256. 같은 범위에서 같은
--      내용이 이미 처리 중/완료이면 새 key로 와도 차단한다.
--   3) 범위(scope)가 다르면 같은 내용이어도 허용한다. HQ는 franchise 단위, store는 store 단위로
--      각각 partial unique index를 둔다(둘을 한 인덱스로 합치면 store_id NULL 때문에
--      PostgreSQL이 NULL을 서로 다른 값으로 취급해 HQ 중복이 걸러지지 않는다).
--   4) manuals.title에는 unique 제약을 두지 않는다. 같은 제목이라도 다른 지점/범위/개정판이면
--      정상적인 별개 매뉴얼이다.
--
-- 기존 데이터는 건드리지 않는다. 백필도, 삭제도, 정리도 하지 않는다
-- (기존 중복 행 진단은 docs/manual-upload-duplicate-prevention.md의 SELECT 전용 쿼리 참고).
-- 재실행해도 안전하도록 모든 DDL을 if not exists / pg_constraint 확인으로 감싼다.

create table if not exists public.manual_upload_batches (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  content_hash text not null,
  scope_type text not null,
  franchise_id uuid,
  store_id uuid,
  requested_by uuid,
  -- processing: 저장 진행 중, completed: 저장 완료, failed: 저장 실패
  status text not null default 'processing',
  -- 이 batch가 실제로 만든 manuals 행 수. 실패했더라도 0보다 크면 부분 저장이 남아 있다는 뜻이라
  -- 아래 partial unique index가 계속 중복을 차단한다(자동 삭제/복구를 하지 않기 위한 장치).
  manual_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'manual_upload_batches_scope_type_check'
      and conrelid = 'public.manual_upload_batches'::regclass
  ) then
    alter table public.manual_upload_batches
      add constraint manual_upload_batches_scope_type_check
      check (scope_type in ('hq', 'store'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'manual_upload_batches_status_check'
      and conrelid = 'public.manual_upload_batches'::regclass
  ) then
    alter table public.manual_upload_batches
      add constraint manual_upload_batches_status_check
      check (status in ('processing', 'completed', 'failed'));
  end if;

  -- store 범위는 store_id가 반드시 있어야 하고, hq 범위는 store_id를 가지면 안 된다.
  if not exists (
    select 1 from pg_constraint
    where conname = 'manual_upload_batches_scope_store_check'
      and conrelid = 'public.manual_upload_batches'::regclass
  ) then
    alter table public.manual_upload_batches
      add constraint manual_upload_batches_scope_store_check
      check (
        (scope_type = 'store' and store_id is not null)
        or (scope_type = 'hq' and store_id is null)
      );
  end if;

  -- manual_count는 partial unique index의 판정 근거이므로 음수가 들어오면 안 된다.
  if not exists (
    select 1 from pg_constraint
    where conname = 'manual_upload_batches_manual_count_check'
      and conrelid = 'public.manual_upload_batches'::regclass
  ) then
    alter table public.manual_upload_batches
      add constraint manual_upload_batches_manual_count_check
      check (manual_count >= 0);
  end if;

  -- 완료/실패한 요청은 종료 시각이 있어야 하고, 처리 중인 요청은 없어야 한다.
  if not exists (
    select 1 from pg_constraint
    where conname = 'manual_upload_batches_completed_at_check'
      and conrelid = 'public.manual_upload_batches'::regclass
  ) then
    alter table public.manual_upload_batches
      add constraint manual_upload_batches_completed_at_check
      check (
        (status = 'processing' and completed_at is null)
        or (status <> 'processing' and completed_at is not null)
      );
  end if;
end
$$;

-- FK는 모두 on delete set null이다. 프랜차이즈/매장/사용자를 지운다고 해서 업로드 이력까지
-- 사라지면 중복 판정 근거가 없어지고, cascade가 연쇄적으로 manuals를 지울 위험도 생긴다.
do $$
begin
  if to_regclass('public.franchises') is not null
    and not exists (
      select 1 from pg_constraint
      where conname = 'manual_upload_batches_franchise_id_fkey'
        and conrelid = 'public.manual_upload_batches'::regclass
    )
  then
    alter table public.manual_upload_batches
      add constraint manual_upload_batches_franchise_id_fkey
      foreign key (franchise_id) references public.franchises(id) on delete set null;
  end if;

  if to_regclass('public.stores') is not null
    and not exists (
      select 1 from pg_constraint
      where conname = 'manual_upload_batches_store_id_fkey'
        and conrelid = 'public.manual_upload_batches'::regclass
    )
  then
    alter table public.manual_upload_batches
      add constraint manual_upload_batches_store_id_fkey
      foreign key (store_id) references public.stores(id) on delete set null;
  end if;

  if to_regclass('public.profiles') is not null
    and not exists (
      select 1 from pg_constraint
      where conname = 'manual_upload_batches_requested_by_fkey'
        and conrelid = 'public.manual_upload_batches'::regclass
    )
  then
    alter table public.manual_upload_batches
      add constraint manual_upload_batches_requested_by_fkey
      foreign key (requested_by) references public.profiles(id) on delete set null;
  end if;
end
$$;

-- 같은 저장 요청(재전송 포함)은 언제나 같은 batch 한 행으로 수렴한다.
create unique index if not exists manual_upload_batches_idempotency_key_idx
  on public.manual_upload_batches (idempotency_key);

-- "살아 있는" 요청의 정의: 처리 중이거나, 완료됐거나, 실패했지만 부분 저장이 남아 있는 경우.
-- 실패 + 저장된 행 0건만 hash를 놓아줘서 깨끗한 재시도를 허용한다.
--
-- franchise_id가 없는 레거시 HQ 계정도 걸러지도록 coalesce로 고정 UUID를 채워 넣는다
-- (NULL끼리는 서로 다른 값으로 취급돼 unique index가 동작하지 않기 때문).
create unique index if not exists manual_upload_batches_hq_active_hash_idx
  on public.manual_upload_batches (
    coalesce(franchise_id, '00000000-0000-0000-0000-000000000000'::uuid),
    content_hash
  )
  where scope_type = 'hq'
    and (status in ('processing', 'completed') or (status = 'failed' and manual_count > 0));

create unique index if not exists manual_upload_batches_store_active_hash_idx
  on public.manual_upload_batches (store_id, content_hash)
  where scope_type = 'store'
    and store_id is not null
    and (status in ('processing', 'completed') or (status = 'failed' and manual_count > 0));

-- manuals -> batch 역참조. 기존 행은 NULL로 남는다(백필하지 않는다).
-- on delete set null: batch 이력을 지우더라도 실제 매뉴얼은 절대 사라지지 않아야 한다.
alter table public.manuals
  add column if not exists upload_batch_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'manuals_upload_batch_id_fkey'
      and conrelid = 'public.manuals'::regclass
  ) then
    alter table public.manuals
      add constraint manuals_upload_batch_id_fkey
      foreign key (upload_batch_id) references public.manual_upload_batches(id) on delete set null;
  end if;
end
$$;

create index if not exists manuals_upload_batch_id_idx
  on public.manuals (upload_batch_id);

-- manuals/manual_chunks와 동일하게 RLS만 켜고 정책은 두지 않는다.
-- 이 테이블은 service-role 서버 코드(lib/supabase/admin.ts)에서만 접근한다.
alter table public.manual_upload_batches enable row level security;
