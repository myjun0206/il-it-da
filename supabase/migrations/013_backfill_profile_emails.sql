-- Auth 사용자는 존재하지만 가입 승인 API의 과거 경로에서 profiles.email이 누락된 행을 복구한다.
alter table public.profiles
  add column if not exists email varchar;

update public.profiles as profile
set email = lower(trim(auth_user.email))
from auth.users as auth_user
where profile.id = auth_user.id
  and auth_user.email is not null
  and (profile.email is null or trim(profile.email) = '');

create unique index if not exists profiles_email_key
  on public.profiles (email)
  where email is not null;