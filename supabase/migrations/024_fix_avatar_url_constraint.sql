-- 024: Fix avatar_url constraint to allow full public URLs
--
-- 이전 constraint가 너무 엄격해서 Supabase Storage public URL을 거부함.
-- (constraint가 ':' 문자를 허용하지 않음)
--
-- 새 constraint는 URL 끝이 지원되는 이미지 확장자로 끝나는지만 확인.
-- - 상대 경로: /avatars/{userId}/avatar.jpg
-- - 절대 경로: https://project.supabase.co/storage/.../avatar.jpg
-- 모두 허용

begin;

-- 기존 constraint 제거
alter table public.profiles
  drop constraint if exists profiles_avatar_url_check;

-- 새 constraint: URL 끝이 지원 확장자로 끝나야 함
alter table public.profiles
  add constraint profiles_avatar_url_check
  check (avatar_url is null or avatar_url ~ '\.(jpg|jpeg|png|webp)$');

commit;
