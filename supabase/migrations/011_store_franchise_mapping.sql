-- 011: stores <-> franchises 브랜드 매핑 + store_memberships 브랜드 스코핑.
--
-- 목적: 매장 선택만으로 해당 매장의 소속 브랜드(franchise)를 자동 인식해서,
-- 오너/스태프의 가입 승인 요청이 그 브랜드의 본사 승인 큐에만 노출되도록 한다.
-- 기존 데이터는 전혀 지우거나 바꾸지 않고, nullable 컬럼만 보강한다(레거시 행은 franchise_id가 null로 남는다).

-- 1) stores.franchise_id: 매장이 속한 프랜차이즈(브랜드) FK.
alter table public.stores
  add column if not exists franchise_id uuid;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'stores_franchise_id_fkey'
      and conrelid = 'public.stores'::regclass
  ) then
    alter table public.stores drop constraint stores_franchise_id_fkey;
  end if;

  alter table public.stores
    add constraint stores_franchise_id_fkey
    foreign key (franchise_id) references public.franchises(id) on delete set null;
end
$$;

create index if not exists stores_franchise_id_idx
  on public.stores (franchise_id);

-- 2) store_memberships.franchise_id: 가입 승인 요청이 생성되는 시점에 stores.franchise_id에서
-- 그대로 복사해 저장한다. 본사 승인 큐(GET/PUT /api/hq/approvals)가 이 컬럼으로 필터링해
-- 다른 브랜드의 요청이 섞여 보이지 않도록 한다.
alter table public.store_memberships
  add column if not exists franchise_id uuid;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'store_memberships_franchise_id_fkey'
      and conrelid = 'public.store_memberships'::regclass
  ) then
    alter table public.store_memberships drop constraint store_memberships_franchise_id_fkey;
  end if;

  alter table public.store_memberships
    add constraint store_memberships_franchise_id_fkey
    foreign key (franchise_id) references public.franchises(id) on delete set null;
end
$$;

create index if not exists store_memberships_franchise_id_status_idx
  on public.store_memberships (franchise_id, status);
