-- 022: 보류된 직원 질문을 해당 매장 점주에게 알리기 위한 최소 구조.
--
-- 배경: question_logs(001)는 question/answer/similarity_score/status/source_manual_id만 남긴다.
-- 어느 매장에서 나온 질문인지가 없어서, status='insufficient'(매뉴얼 근거 부족으로 보류)인
-- 질문을 "그 매장의 점주"에게 전달할 방법이 없었다. 이 마이그레이션은 그 연결 고리만 만든다.
--
-- 설계 요지
--   1) question_logs.store_id는 nullable이다. 기존 행은 어느 매장인지 알 수 없으므로 NULL로 남기고
--      백필하지 않는다(추측으로 매장을 채우면 엉뚱한 점주에게 알림이 갈 수 있다).
--      에스컬레이션 코드는 store_id가 NULL인 행을 대상에서 제외한다.
--   2) FK는 on delete set null이다. 매장을 지운다고 질문 이력까지 사라지면 안 되고,
--      cascade가 질문 로그를 연쇄 삭제할 위험도 피한다.
--   3) 중복 알림 차단은 notifications의 partial unique index로 DB에서 보장한다.
--      type을 한정했으므로 기존 알림 데이터와 다른 알림 유형(staff_pending_approval,
--      owner_pending_approval, approval_decision, staff_approval_decision, new_notice,
--      manual_update)에는 아무 영향이 없다.
--
-- 실패 정책: 선행 구조가 없거나 이미 있는 구조가 기대와 다르면 조용히 건너뛰지 않고 raise한다.
-- "FK 없이 컬럼만 생긴 상태"나 "이름만 같고 unique가 아닌 인덱스"는 매장 범위·중복 방지
-- 보장을 잃은 채 성공한 것처럼 보이므로, 그런 상태로 끝내지 않는다.
--
-- 기존 데이터는 건드리지 않는다. 백필도, 삭제도, 정리도 하지 않는다.
-- 001의 question_logs 컬럼과 013의 notifications 컬럼은 전혀 수정하지 않는다.
-- 020(manual_upload_batches)은 참조도 수정도 하지 않는다.

-- 1) 선행 구조 확인. 없으면 즉시 실패한다.
do $$
begin
  if to_regclass('public.question_logs') is null then
    raise exception
      '022 requires table public.question_logs. Apply 001_initial_rag_schema.sql first.';
  end if;

  if to_regclass('public.stores') is null then
    raise exception
      '022 requires table public.stores for the question_logs.store_id foreign key. Apply 004_store_schema.sql first.';
  end if;

  if to_regclass('public.notifications') is null then
    raise exception
      '022 requires table public.notifications for the escalation unique index. Apply 013_notifications.sql first.';
  end if;
end
$$;

-- 2) store_id 컬럼. 기존 행은 NULL로 남는다(백필하지 않는다).
alter table public.question_logs
  add column if not exists store_id uuid;

-- add column if not exists는 이름만 같고 타입이 다른 컬럼을 조용히 통과시키므로 여기서 확인한다.
do $$
declare
  column_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into column_type
  from pg_attribute a
  where a.attrelid = 'public.question_logs'::regclass
    and a.attname = 'store_id'
    and a.attnum > 0
    and not a.attisdropped;

  if column_type is distinct from 'uuid' then
    raise exception
      'question_logs.store_id must be uuid but found %. Resolve the column type manually, then re-run 022.',
      coalesce(column_type, '(missing)');
  end if;
end
$$;

-- 3) FK. stores가 없으면 위에서 이미 실패했으므로 조용히 건너뛰는 경로는 없다.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'question_logs_store_id_fkey'
      and conrelid = 'public.question_logs'::regclass
  ) then
    alter table public.question_logs
      add constraint question_logs_store_id_fkey
      foreign key (store_id) references public.stores(id) on delete set null;

  -- 이름만 같고 대상 테이블이나 삭제 동작이 다르면 매장 범위 보장이 깨진 것이다. confdeltype 'n' = SET NULL.
  elsif not exists (
    select 1 from pg_constraint
    where conname = 'question_logs_store_id_fkey'
      and conrelid = 'public.question_logs'::regclass
      and contype = 'f'
      and confrelid = 'public.stores'::regclass
      and confdeltype = 'n'
  ) then
    raise exception
      'Constraint question_logs_store_id_fkey exists but is not a FK to public.stores(id) ON DELETE SET NULL. Drop it manually, then re-run 022.';
  end if;
end
$$;

-- 점주 화면이 생기면 "이 매장의 보류된 질문을 최신순으로" 조회하게 된다.
create index if not exists question_logs_store_status_created_at_idx
  on public.question_logs (store_id, status, created_at desc);

-- 4) 중복 알림 차단 인덱스.
-- 같은 질문 로그에 대해 같은 점주에게는 알림이 한 번만 생긴다.
-- 재시도/동시 실행은 23505로 떨어지고, 호출 코드가 이를 "이미 보냄"으로 처리한다.
-- partial index라 이 type 외의 알림은 여전히 중복 생성이 가능하다(기존 동작 유지).
--
-- create unique index if not exists는 이름만 같고 unique가 아니거나 범위가 다른 인덱스를
-- 조용히 통과시켜 중복 방지 보장을 잃게 하므로, 이미 있으면 정의를 확인한다.
-- 인덱스가 없는데 중복 행이 이미 있으면 원인을 알 수 있게 raise한다(행을 지우지 않는다).
do $$
declare
  index_definition text;
  duplicate_group_count integer;
begin
  select pg_get_indexdef(c.oid)
    into index_definition
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'notifications_manual_question_escalation_idx';

  if index_definition is not null then
    if position('UNIQUE INDEX' in index_definition) = 0
      or position('(recipient_user_id, related_id)' in index_definition) = 0
      or position('manual_question_escalation' in index_definition) = 0
    then
      raise exception
        'Index notifications_manual_question_escalation_idx exists but does not enforce the expected unique scope. Found: %. Drop it manually, then re-run 022.',
        index_definition;
    end if;

    return;
  end if;

  select count(*)
    into duplicate_group_count
  from (
    select 1
    from public.notifications
    where type = 'manual_question_escalation'
      and related_id is not null
    group by recipient_user_id, related_id
    having count(*) > 1
  ) as duplicates;

  if duplicate_group_count > 0 then
    raise exception
      'Found % duplicate (recipient_user_id, related_id) group(s) with type manual_question_escalation. 022 never deletes notification rows - review and remove the duplicates manually, then re-run 022.',
      duplicate_group_count;
  end if;

  create unique index notifications_manual_question_escalation_idx
    on public.notifications (recipient_user_id, related_id)
    where type = 'manual_question_escalation' and related_id is not null;
end
$$;
