-- Brand profile rows have independent profiles.id values. auth.users is
-- referenced through profiles.user_id, not through the brand row's id.
begin;

do $$
declare
  old_fk record;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'user_id'
  ) then
    raise exception 'profiles.user_id is missing; apply 023_multi_brand_owner_profiles.sql first';
  end if;

  if exists (
    select 1 from public.profiles as profile
    where profile.user_id is null
      or not exists (select 1 from auth.users as account where account.id = profile.user_id)
  ) then
    raise exception 'profiles.user_id has missing or invalid auth users; repair those rows before changing the FK';
  end if;

  alter table public.profiles alter column user_id set not null;

  -- Include databases where the legacy id FK has a nonstandard name.
  for old_fk in
    select constraint_row.conname
    from pg_constraint as constraint_row
    join pg_attribute as column_row
      on column_row.attrelid = constraint_row.conrelid
      and column_row.attname = 'id'
    where constraint_row.conrelid = 'public.profiles'::regclass
      and constraint_row.confrelid = 'auth.users'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.conkey = array[column_row.attnum]::smallint[]
  loop
    execute format('alter table public.profiles drop constraint %I', old_fk.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint as constraint_row
    join pg_attribute as column_row
      on column_row.attrelid = constraint_row.conrelid
      and column_row.attname = 'user_id'
    where constraint_row.conrelid = 'public.profiles'::regclass
      and constraint_row.confrelid = 'auth.users'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.conkey = array[column_row.attnum]::smallint[]
  ) then
    alter table public.profiles
      add constraint profiles_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end
$$;

commit;