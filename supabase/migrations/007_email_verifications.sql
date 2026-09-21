create table if not exists public.email_verifications (
  id uuid primary key default gen_random_uuid(),
  email varchar not null,
  code varchar(6) not null check (code ~ '^[0-9]{6}$'),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  is_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists email_verifications_email_idx
  on public.email_verifications (email);

create index if not exists email_verifications_email_created_at_idx
  on public.email_verifications (email, created_at desc);

create index if not exists email_verifications_expires_at_idx
  on public.email_verifications (expires_at);

alter table public.email_verifications enable row level security;

do $$
begin
  if to_regclass('public.profiles') is not null then
    alter table public.profiles
      add column if not exists email varchar;

    if not exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'profiles_email_key'
    ) then
      create unique index profiles_email_key
        on public.profiles (email)
        where email is not null;
    end if;
  end if;
end
$$;
