-- 구형 HQ 공통 매뉴얼은 franchises 도입 전 brand_name만 저장했으므로,
-- 이름이 유일하게 일치하는 프랜차이즈만 franchise_id를 보정한다.
update public.manuals as m
set franchise_id = f.id
from public.franchises as f
where m.franchise_id is null
  and m.store_id is null
  and lower(btrim(m.brand_name)) = lower(btrim(f.name))
  and btrim(coalesce(m.brand_name, '')) <> ''
  and (
    select count(*)
    from public.franchises as matching
    where lower(btrim(matching.name)) = lower(btrim(m.brand_name))
  ) = 1;

-- 직원 앱 API는 service_role로 동작하지만, authenticated 클라이언트의 직접 조회도
-- 승인된 본인 프랜차이즈의 HQ 공통 매뉴얼로 한정해 허용한다.
drop policy if exists manuals_select_approved_staff_common on public.manuals;

create policy manuals_select_approved_staff_common
  on public.manuals
  for select
  to authenticated
  using (
    status = 'approved'
    and store_id is null
    and franchise_id is not null
    and exists (
      select 1
      from public.store_memberships as membership
      where membership.user_id = auth.uid()
        and membership.role = 'staff'
        and membership.status = 'approved'
        and membership.franchise_id = manuals.franchise_id
    )
  );