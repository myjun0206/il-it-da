-- 035: 점주의 직원 소속 해제를 한 트랜잭션으로 처리하는 RPC.
--
-- 배경: 앱 코드(PostgREST)로 "멤버십 삭제"와 "마스터 profiles 승인 상태 재계산"을 따로 실행하면
-- 한쪽만 반영된 상태(소속은 남았는데 승인 상태만 바뀐 상태 등)가 남을 수 있다.
-- 이 함수는 점주 권한 확인 → 대상 검증 → 삭제 → 재계산을 하나의 트랜잭션으로 묶는다.
--
-- 승인 상태 계산 규칙은 lib/signup/approval-recovery.ts의 buildMasterApprovalUpdate와 같다.
--   - 계산 대상: 해당 사용자의 모든 store_memberships(역할 무관). JS 동기화도 역할을 거르지 않는다.
--   - approved가 하나라도 있으면 approved, 아니면 pending이 있으면 pending, 그 외(0건 포함) rejected.
--     (store_memberships_status_check가 pending/approved/rejected만 허용하므로 다른 값은 없다.)
--   - approved_at/approved_by: approved 행 중 approved_at이 가장 이른 행, 같으면 id가 작은 행.
--     승인 행은 006의 decision_consistency_check로 approved_at/approved_by가 NOT NULL이다.
--   - 갱신 대상: 마스터 프로필(profiles.id = 사용자 id). 행이 없거나 갱신이 0건이면 예외로 전체 롤백한다.
--
-- 잠금 순서(모든 호출이 같은 순서): 점주 멤버십(FOR SHARE) → 대상 멤버십(FOR UPDATE) → 마스터 프로필(FOR NO KEY UPDATE).
-- 프로필은 키를 바꾸지 않으므로 NO KEY UPDATE로 잠가, profiles를 참조하는 FK 삽입(FOR KEY SHARE)을 막지 않는다.
-- 교착은 완전히 배제되지 않는다. 예: 같은 사용자의 auth.users 삭제(cascade)나 매장 삭제(cascade)가 같은 행들을
-- 다른 순서로 잠그면 Postgres가 한 쪽을 40P01로 중단한다(이 함수가 중단되면 전체 롤백).
-- 앱의 다른 쓰기 경로(점주 승인/거절, 본사 승인, 직원 자진 탈퇴, 신청)는 이 잠금을 쓰지 않고 "조회 후 쓰기"로
-- 승인 상태를 덮어쓸 수 있어, 그 경합은 이 함수로 해결되지 않는다.
--
-- 기존 데이터·기존 마이그레이션은 변경하지 않는다. 실행 권한은 service_role만 갖는다.
BEGIN;

do $$
begin
  if to_regclass('public.store_memberships') is null or to_regclass('public.profiles') is null then
    raise exception '035 requires public.store_memberships (006) and public.profiles.';
  end if;
end
$$;

create or replace function public.remove_staff_membership_by_owner(
  p_owner_user_id uuid,
  p_membership_id uuid,
  p_store_id uuid
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target public.store_memberships%rowtype;
  v_status text;
  v_approved_at timestamptz;
  v_approved_by uuid;
  v_profile_id uuid;
  v_updated integer;
begin
  if p_owner_user_id is null or p_membership_id is null or p_store_id is null then
    return 'invalid_request';
  end if;

  -- 1) 점주 권한. FOR SHARE로 이 트랜잭션이 끝날 때까지 점주 멤버십의 상태 변경·삭제를 막는다.
  --    다른 트랜잭션이 이미 바꾸는 중이면 기다린 뒤 조건(approved)을 다시 평가한다.
  perform 1
  from public.store_memberships as owner_m
  where owner_m.user_id = p_owner_user_id
    and owner_m.store_id = p_store_id
    and owner_m.role = 'owner'
    and owner_m.status = 'approved'
  for share;

  if not found then
    return 'forbidden';
  end if;

  -- 2) 대상은 이 매장 범위에서만 찾는다. 다른 매장의 id는 "없음"과 구분되지 않는다.
  select m.*
    into v_target
  from public.store_memberships as m
  where m.id = p_membership_id
    and m.store_id = p_store_id
  for update;

  if not found then
    return 'already_removed';
  end if;
  if v_target.role <> 'staff' then
    return 'not_staff';
  end if;
  if v_target.user_id = p_owner_user_id then
    return 'self_removal';
  end if;
  if v_target.status <> 'approved' then
    return 'not_approved';
  end if;

  -- 3) 마스터 프로필 잠금. 없으면 승인 상태를 기록할 곳이 없으므로 아무것도 바꾸지 않고 실패한다.
  select p.id
    into v_profile_id
  from public.profiles as p
  where p.id = v_target.user_id
  for no key update;

  if not found then
    raise exception 'STAFF_PROFILE_MISSING' using errcode = 'P0001';
  end if;

  -- 4) 삭제
  delete from public.store_memberships as m
  where m.id = v_target.id;

  -- 5) 남은 멤버십으로 승인 상태 재계산 (buildMasterApprovalUpdate와 같은 규칙)
  select case
           when bool_or(m.status = 'approved') then 'approved'
           when bool_or(m.status = 'pending') then 'pending'
           else 'rejected'
         end
    into v_status
  from public.store_memberships as m
  where m.user_id = v_target.user_id;

  v_status := coalesce(v_status, 'rejected');

  if v_status = 'approved' then
    select m.approved_at, m.approved_by
      into v_approved_at, v_approved_by
    from public.store_memberships as m
    where m.user_id = v_target.user_id
      and m.status = 'approved'
    order by m.approved_at asc nulls last, m.id asc
    limit 1;

    v_approved_at := coalesce(v_approved_at, now());
  else
    v_approved_at := null;
    v_approved_by := null;
  end if;

  update public.profiles as p
  set approval_status = v_status,
      approved_at = v_approved_at,
      approved_by = v_approved_by
  where p.id = v_profile_id;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'STAFF_PROFILE_UPDATE_FAILED' using errcode = 'P0001';
  end if;

  return 'removed';
end;
$$;

revoke all on function public.remove_staff_membership_by_owner(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_staff_membership_by_owner(uuid, uuid, uuid) to service_role;

COMMIT;