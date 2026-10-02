-- 032: 반복 질문 알림 (같은 매장·같은 정규화 질문이 최근 7일 3건 이상).
--
-- 배경:
-- lib/owner/repeated-questions.ts에 탐지·집계 함수는 있었지만 런타임 호출과 점주 알림·화면 연결이 없었다.
-- 근거 부족 단건 알림(022, type='manual_question_escalation')은 question_logs 행 하나 단위라
-- "질문 그룹" 단위의 재발송 억제(7일)를 표현할 수 없다. 이 마이그레이션은 그 최소 구조만 만든다.
--
-- 설계 요지
--   1) repeated_question_alerts: 매장·정규화 키(group_key)별 "알림 회차" 1행. 발송 시점의
--      반복 횟수·집계 기간·대표 질문·분류(manual_gap/guidance_gap/mixed 후보)를 스냅샷으로 남긴다.
--      question_logs.status(RAG 판정)와 resolution_status(031, 보류 질문 처리 상태)는 건드리지 않는다.
--   2) claim_repeated_question_alert(): 같은 매장·그룹에 최근 p_window_days 안의 회차가 있으면
--      그 id를 claimed=false로 돌려주고, 없을 때만 새 회차를 만든다. 매장·그룹 단위 advisory lock으로
--      동시 요청이 회차를 두 개 만들지 못하게 한다.
--   3) notifications partial unique index: 같은 회차(related_id)·같은 점주에게는 한 번만 보낸다.
--      재시도·동시 실행은 23505로 떨어지고 호출 코드가 "이미 보냄"으로 처리한다.
--      type을 한정했으므로 다른 알림 유형에는 영향이 없다.
--
-- 기존 데이터는 건드리지 않는다. 백필·삭제·정리를 하지 않는다. 기존 마이그레이션도 수정하지 않는다.
-- 사용자 식별자는 저장하지 않는다(question_logs에도 없다).

do $$
begin
  if to_regclass('public.stores') is null then
    raise exception '032 requires table public.stores. Apply 004_store_schema.sql first.';
  end if;

  if to_regclass('public.notifications') is null then
    raise exception '032 requires table public.notifications. Apply 013_notifications.sql first.';
  end if;
end
$$;

create table if not exists public.repeated_question_alerts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  group_key text not null check (length(group_key) > 0),
  representative_question text not null,
  repeat_count integer not null check (repeat_count >= 1),
  answered_count integer not null default 0 check (answered_count >= 0),
  cautious_count integer not null default 0 check (cautious_count >= 0),
  insufficient_count integer not null default 0 check (insufficient_count >= 0),
  category text not null
    check (category in ('manual_gap_candidate', 'guidance_gap_candidate', 'mixed_candidate')),
  window_days integer not null check (window_days > 0),
  window_start timestamptz not null,
  window_end timestamptz not null,
  alerted_at timestamptz not null default now()
);

create index if not exists repeated_question_alerts_store_group_alerted_idx
  on public.repeated_question_alerts (store_id, group_key, alerted_at desc);

-- 정책 없이 RLS만 켠다: 서버(service role) API가 점주 권한을 검증한 뒤에만 읽는다.
alter table public.repeated_question_alerts enable row level security;

create or replace function public.claim_repeated_question_alert(
  p_store_id uuid,
  p_group_key text,
  p_representative_question text,
  p_repeat_count integer,
  p_answered_count integer,
  p_cautious_count integer,
  p_insufficient_count integer,
  p_category text,
  p_window_days integer,
  p_window_start timestamptz,
  p_window_end timestamptz
)
returns table (alert_id uuid, claimed boolean)
language plpgsql
set search_path = public
as $$
declare
  existing_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || ':' || p_group_key, 32));

  select a.id
    into existing_id
  from public.repeated_question_alerts a
  where a.store_id = p_store_id
    and a.group_key = p_group_key
    and a.alerted_at > now() - make_interval(days => p_window_days)
  order by a.alerted_at desc
  limit 1;

  if existing_id is not null then
    return query select existing_id, false;
    return;
  end if;

  insert into public.repeated_question_alerts (
    store_id, group_key, representative_question, repeat_count,
    answered_count, cautious_count, insufficient_count, category,
    window_days, window_start, window_end
  ) values (
    p_store_id, p_group_key, p_representative_question, p_repeat_count,
    p_answered_count, p_cautious_count, p_insufficient_count, p_category,
    p_window_days, p_window_start, p_window_end
  )
  returning id into existing_id;

  return query select existing_id, true;
end;
$$;

revoke all on function public.claim_repeated_question_alert(
  uuid, text, text, integer, integer, integer, integer, text, integer, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_repeated_question_alert(
  uuid, text, text, integer, integer, integer, integer, text, integer, timestamptz, timestamptz
) to service_role;

-- 이미 같은 이름의 인덱스가 다른 정의로 있으면 중복 방지 보장을 잃으므로 실패한다(행은 지우지 않는다).
do $$
declare
  index_definition text;
begin
  select pg_get_indexdef(c.oid)
    into index_definition
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'notifications_repeated_question_alert_idx';

  if index_definition is not null then
    if position('UNIQUE INDEX' in index_definition) = 0
      or position('(recipient_user_id, related_id)' in index_definition) = 0
      or position('repeated_question_alert' in index_definition) = 0
    then
      raise exception
        'Index notifications_repeated_question_alert_idx exists but does not enforce the expected unique scope. Found: %',
        index_definition;
    end if;
    return;
  end if;

  create unique index notifications_repeated_question_alert_idx
    on public.notifications (recipient_user_id, related_id)
    where type = 'repeated_question_alert' and related_id is not null;
end
$$;
