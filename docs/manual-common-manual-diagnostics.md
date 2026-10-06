# 본사 공통 매뉴얼 조회 진단

## 기대 데이터

직원 공통 매뉴얼 API는 승인된 `store_memberships` 행을 확인한 뒤, 해당 지점의 `stores.franchise_id`를 서버에서 읽습니다. 조회되는 HQ 공통 매뉴얼은 아래 조건을 모두 만족해야 합니다.

- `manuals.franchise_id = stores.franchise_id`
- `manuals.store_id IS NULL`
- `manuals.status = 'approved'`

현재 스키마에서 `manuals.store_id`와 `stores.id`는 UUID입니다. 따라서 정상적인 UUID 컬럼에는 빈 문자열을 저장할 수 없습니다. `scope_type`은 현재 이 API의 WHERE 조건이 아니므로 값이 다르더라도 직접적인 빈 결과 원인은 아닙니다.

## DB 상태 확인 SQL

아래 `<STORE_UUID>`를 실제 지점 UUID로 바꿔 Supabase SQL Editor에서 실행합니다.

```sql
select
  s.id as store_id,
  s.store_name,
  s.franchise_id as store_franchise_id,
  f.name as franchise_name,
  sm.user_id,
  sm.role as membership_role,
  sm.status as membership_status,
  sm.franchise_id as membership_franchise_id
from public.stores s
left join public.franchises f on f.id = s.franchise_id
left join public.store_memberships sm on sm.store_id = s.id
where s.id = '<STORE_UUID>'::uuid
order by sm.user_id;
```

이 결과에서 `store_franchise_id`가 NULL이면 API는 의도적으로 `{"manuals":[]}`를 반환합니다. 직원 membership도 `role='staff'`, `status='approved'`여야 하며 API는 점주 role을 직원으로 간주하지 않습니다.

```sql
with target as (
  select s.franchise_id, f.name as franchise_name
  from public.stores s
  left join public.franchises f on f.id = s.franchise_id
  where s.id = '<STORE_UUID>'::uuid
)
select
  m.id,
  m.brand_name,
  m.franchise_id,
  m.store_id,
  m.store_id::text as store_id_text,
  case
    when m.store_id is null then 'NULL (공통 후보)'
    when btrim(m.store_id::text) = '' then 'EMPTY (UUID 컬럼에서는 비정상)'
    else 'NON_NULL (지점 범위)'
  end as store_scope,
  m.scope_type,
  m.status,
  m.parent_manual_id,
  m.category,
  m.title,
  m.content
from public.manuals m
cross join target t
where m.franchise_id = t.franchise_id
   or (m.franchise_id is null and lower(btrim(m.brand_name)) = lower(btrim(t.franchise_name)))
order by m.franchise_id, m.store_id, m.status, m.created_at;
```

정상적인 공통 행은 `store_scope='NULL (공통 후보)'`이고 `status='approved'`여야 합니다. 결과가 브랜드명 후보에만 나오고 `franchise_id`가 NULL이면 029의 정확한 브랜드명 보정 조건과 실제 이름을 비교합니다. `store_id::text`가 빈 문자열로 나오면 운영 DB의 실제 컬럼 타입이 tracked UUID 스키마와 다른지 확인해야 합니다.

## API 진단 로그

서버 환경에 `MANUAL_LOOKUP_DEBUG=1`을 설정하고 서버를 재시작한 뒤 직원 공통 매뉴얼 화면을 다시 조회합니다. `[MANUAL_LOOKUP_DEBUG]` 로그는 요청 store ID/scope, 세션 user ID, 실제 membership role/status/franchise, stores 행, 적용한 필터, 쿼리 원본 결과와 빈 결과 시 해당 franchise 및 레거시 브랜드명 후보 행을 출력합니다. 원본 `content`도 포함되므로 조사 후 이 환경변수를 제거하고 로그 접근/보존을 제한해야 합니다.

이 API는 `createAdminClient()`의 service-role 클라이언트를 사용하므로 Supabase RLS는 API 쿼리 결과에 적용되지 않습니다. RLS는 브라우저의 authenticated 직접 조회에만 영향을 주며, 이 화면의 실제 접근 판정은 API의 세션 및 membership 검증입니다.