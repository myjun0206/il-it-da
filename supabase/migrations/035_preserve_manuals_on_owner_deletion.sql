-- 035: 점주 계정 삭제 때 매장과 매뉴얼을 보존하고 소유권을 시스템 계정으로 이전한다.
--
-- 시스템 프로필은 점주 탈퇴 API가 Supabase Auth Admin API로 지연 생성한다.
-- Auth 사용자를 SQL migration에서 직접 생성하지 않아 Auth 내부 스키마에 의존하지 않는다.
--
-- stores.boss_id FK는 방어적으로 ON DELETE SET NULL로 변경한다. 앱의 정상 탈퇴 흐름은
-- RPC로 먼저 시스템 프로필에 이전하지만, Supabase 대시보드 등에서 Auth 사용자를 직접
-- 삭제하거나 삭제와 동시 쓰기가 발생해도 stores/manuals가 cascade 삭제되는 것은 막는다.

do $$
declare
  existing_fk record;
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.stores') is null
    or to_regclass('public.store_memberships') is null
    or to_regclass('public.manuals') is null
  then
    raise exception '035 requires profiles, stores, store_memberships, and manuals tables.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'stores' and column_name = 'boss_id'
  ) then
    raise exception '035 requires public.stores.boss_id.';
  end if;

  if exists (
    select required.table_name, required.column_name
    from (values
      ('profiles', 'user_id'),
      ('profiles', 'email'),
      ('profiles', 'role'),
      ('profiles', 'brand_id'),
      ('store_memberships', 'approved_by'),
      ('store_memberships', 'rejected_by')
    ) as required(table_name, column_name)
    where not exists (
      select 1
      from information_schema.columns as actual
      where actual.table_schema = 'public'
        and actual.table_name = required.table_name
        and actual.column_name = required.column_name
    )
  ) then
    raise exception '035 requires multi-brand owner profiles and membership approval columns.';
  end if;

  for existing_fk in
    select constraint_row.conname
    from pg_constraint as constraint_row
    join pg_attribute as column_row
      on column_row.attrelid = constraint_row.conrelid
      and column_row.attname = 'boss_id'
    where constraint_row.conrelid = 'public.stores'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.conkey = array[column_row.attnum]::smallint[]
  loop
    execute format('alter table public.stores drop constraint %I', existing_fk.conname);
  end loop;

  alter table public.stores
    add constraint stores_boss_id_fkey
    foreign key (boss_id) references public.profiles(id) on delete set null;
end
$$;

create or replace function public.transfer_owner_data_to_system_account(
  p_owner_user_id uuid,
  p_system_user_id uuid,
  p_system_profile_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_profile_ids uuid[];
  owner_store_ids uuid[];
  transferred_store_count integer;
begin
  if p_owner_user_id is null or p_system_user_id is null or p_system_profile_id is null
    or p_owner_user_id = p_system_user_id
  then
    raise exception 'Invalid owner/system account identifiers.';
  end if;

  if not exists (
    select 1
    from public.profiles as system_profile
    where system_profile.id = p_system_profile_id
      and system_profile.user_id = p_system_user_id
      and system_profile.email = 'system-unassigned@il-it-da.internal'
      and system_profile.role = 'owner'
      and system_profile.brand_id is null
  ) then
    raise exception 'System orphan-owner profile was not found.';
  end if;

  select array_agg(distinct owner_profile.id)
    into owner_profile_ids
  from public.profiles as owner_profile
  where owner_profile.role = 'owner'
    and (owner_profile.user_id = p_owner_user_id or owner_profile.id = p_owner_user_id);

  if owner_profile_ids is null or cardinality(owner_profile_ids) = 0 then
    raise exception 'Owner profiles were not found.';
  end if;

  -- Current owner access is membership-based; legacy stores may have a NULL boss_id.
  select array_agg(distinct membership.store_id)
    into owner_store_ids
  from public.store_memberships as membership
  where membership.user_id = p_owner_user_id
    and membership.role = 'owner';

  -- These audit foreign keys use NO ACTION and otherwise block auth.users deletion.
  -- Preserve the decisions while recording the system account as the retained actor.
  update public.store_memberships
  set approved_by = p_system_user_id
  where approved_by = p_owner_user_id
    and user_id <> p_system_user_id;

  update public.store_memberships
  set rejected_by = p_system_user_id
  where rejected_by = p_owner_user_id
    and user_id <> p_system_user_id;

  update public.stores
  set boss_id = p_system_profile_id
  where boss_id = any(owner_profile_ids)
    or (owner_store_ids is not null and id = any(owner_store_ids));

  get diagnostics transferred_store_count = row_count;
  return transferred_store_count;
end;
$$;

revoke all on function public.transfer_owner_data_to_system_account(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.transfer_owner_data_to_system_account(uuid, uuid, uuid)
  to service_role;