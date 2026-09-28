-- 023: Profile avatar image support
--
-- HQ/Owner/Staff이 Supabase Storage에 프로필 사진을 업로드할 수 있도록 지원.
-- - avatar_url: Storage 내 프로필 사진 파일의 공개 URL 또는 부분 경로 저장
-- - avatar_updated_at: 사진 업로드/삭제 시점 기록 (동기화 캐시용)

begin;

alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists avatar_updated_at timestamptz;

-- avatar_url 유효성 검증 (URL 문자열이거나 NULL)
alter table public.profiles
  add constraint profiles_avatar_url_check
  check (avatar_url is null or (avatar_url ~ '^[a-zA-Z0-9/_.-]+\.(?:jpg|jpeg|png|webp|JPG|JPEG|PNG|WEBP)$'));

commit;
