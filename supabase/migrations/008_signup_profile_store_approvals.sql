alter table public.profiles
  add column if not exists phone varchar,
  add column if not exists company_email varchar,
  add column if not exists brand_id varchar;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      drop constraint profiles_role_check;
  end if;

  alter table public.profiles
    add constraint profiles_role_check
    check (role in ('hq', 'owner', 'boss', 'staff'));
end
$$;

create table if not exists public.store_approval_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  requester_role text not null check (requester_role in ('owner', 'boss', 'staff')),
  store_id text not null,
  store_name text,
  store_address text,
  franchise_name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  rejection_reason text
);

create index if not exists store_approval_requests_requester_id_idx
  on public.store_approval_requests (requester_id);

create index if not exists store_approval_requests_store_id_idx
  on public.store_approval_requests (store_id);

create index if not exists store_approval_requests_status_idx
  on public.store_approval_requests (status);

alter table public.store_approval_requests enable row level security;
