begin;

-- Keep profiles.id as the stable master-profile/auth-user ID. Brand rows get
-- their own profiles.id and point back to the same auth user through user_id.
alter table public.profiles
  add column if not exists user_id uuid;

update public.profiles
set user_id = id
where user_id is null;

alter table public.profiles
  alter column user_id set not null,
  alter column id set default gen_random_uuid();

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_user_id_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end
$$;

-- Re-evaluate store mappings by the same longest franchise-name prefix rule
-- used for new signup requests, then keep memberships aligned with their store.
with matched as (
  select distinct on (s.id)
    s.id as store_id,
    f.id as franchise_id
  from public.stores as s
  join public.franchises as f
    on f.name is not null
    and btrim(f.name) <> ''
    and left(lower(s.store_name), length(btrim(f.name))) = lower(btrim(f.name))
  order by s.id, length(btrim(f.name)) desc
)
update public.stores as s
set franchise_id = matched.franchise_id
from matched
where s.id = matched.store_id
  and s.franchise_id is distinct from matched.franchise_id;

update public.store_memberships as membership
set franchise_id = store.franchise_id
from public.stores as store
where membership.store_id = store.id
  and store.franchise_id is not null
  and membership.franchise_id is distinct from store.franchise_id;

-- Brand rows are derived from actual memberships, not copied blindly from a
-- potentially stale single-brand owner profile.
create unique index if not exists profiles_owner_master_user_key
  on public.profiles (user_id)
  where role in ('owner', 'staff') and brand_id is null;

create unique index if not exists profiles_owner_brand_user_key
  on public.profiles (user_id, brand_id)
  where role in ('owner', 'staff') and brand_id is not null;

-- Brand rows duplicate the login email, so email uniqueness belongs to auth.users.
alter table public.profiles drop constraint if exists profiles_email_key;
drop index if exists public.profiles_email_key;

insert into public.profiles (
  id,
  user_id,
  email,
  full_name,
  role,
  phone,
  company_email,
  brand_id,
  approval_status,
  approved_at,
  approved_by
)
select
  gen_random_uuid(),
  id,
  email,
  full_name,
  role,
  phone,
  company_email,
  memberships.franchise_id,
  approval_status,
  approved_at,
  approved_by
from public.profiles
join lateral (
  select distinct coalesce(store.franchise_id, membership.franchise_id) as franchise_id
  from public.store_memberships as membership
  join public.stores as store on store.id = membership.store_id
  where membership.user_id = public.profiles.id
    and membership.role in ('owner', 'staff')
    and membership.status = 'approved'
    and coalesce(store.franchise_id, membership.franchise_id) is not null
) as memberships on true
where public.profiles.role in ('owner', 'staff')
on conflict do nothing;

update public.profiles
set brand_id = null
where role in ('owner', 'staff')
  and id = user_id;

create index if not exists profiles_email_idx on public.profiles (email);

drop policy if exists profiles_select_own_profile on public.profiles;
create policy profiles_select_own_profile
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id or auth.uid() = user_id);

create or replace function public.email_exists_for_signup(check_email text)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.profiles as profile
    where lower(profile.email) = lower(trim(check_email))
      and profile.brand_id is null
  )
  or exists (
    select 1
    from auth.users as auth_user
    where lower(auth_user.email) = lower(trim(check_email))
  );
$$;

revoke all on function public.email_exists_for_signup(text) from public;

commit;