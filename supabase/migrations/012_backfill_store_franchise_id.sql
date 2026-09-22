-- 012: 011 적용 이전에 생성된 stores/store_memberships 행의 franchise_id 백필.
--
-- 문제: 마이그레이션 011 이전에 만들어진 매장(seed 데이터 포함)과, 그 매장으로 접수된
-- store_memberships 행은 franchise_id가 비어 있다. 본사 승인 큐(/api/hq/approvals)는
-- franchise_id로 스코핑하므로, 이 값이 비어 있으면 실제로 존재하는 pending 요청이
-- 어떤 HQ 화면에도 보이지 않게 된다. 아래는 매장명으로 franchises.name과 다시 매칭해
-- 누락된 값만 채워 넣는다(이미 값이 있는 행은 절대 덮어쓰지 않는다).

-- 1) stores.franchise_id가 비어있는 행을 매장명 접두 매칭으로 백필한다.
--    "BHC"/"BHC 치킨"처럼 이름이 겹치는 브랜드가 있으면 더 긴(구체적인) 이름을 우선한다.
with matched as (
  select distinct on (s.id)
    s.id as store_id,
    f.id as franchise_id
  from public.stores as s
  join public.franchises as f
    on s.store_name ilike f.name || '%'
  where s.franchise_id is null
  order by s.id, length(f.name) desc
)
update public.stores as s
set franchise_id = matched.franchise_id
from matched
where s.id = matched.store_id;

-- 2) store_memberships.franchise_id가 비어있는 행을 (백필된) stores.franchise_id로 채운다.
update public.store_memberships as m
set franchise_id = s.franchise_id
from public.stores as s
where m.store_id = s.id
  and m.franchise_id is null
  and s.franchise_id is not null;
