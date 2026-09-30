# Supabase Single Session 설정

Supabase Pro의 사용자당 단일 세션 정책은 앱 코드나 SQL migration이 아니라 프로젝트 Auth 설정에서 활성화합니다.

1. Supabase Dashboard에서 대상 프로젝트를 선택합니다.
2. **Authentication → Sessions**로 이동합니다.
3. **Single session per user**를 켜고 변경사항을 저장합니다.

이 정책은 가장 최근 로그인 세션만 유지합니다. 기존 세션을 즉시 푸시 로그아웃하지 않으며, 기존 세션이 다음에 access token을 refresh할 때 폐기가 감지됩니다. 기본 JWT 만료 시간이 길면 이전 기기에서 만료 안내가 보이기까지 그만큼 지연될 수 있습니다. Supabase는 JWT 만료 시간을 5분 미만으로 낮추는 것을 권장하지 않습니다.

앱은 Auth refresh에서 `refresh_token_not_found`, `session_expired`, `session_not_found`가 돌아오면 로컬 세션을 정리하고 로그인 화면에 재로그인 안내를 표시합니다. 단일 세션 정책을 활성화하지 않으면 이 안내 흐름은 해당 정책의 세션 대체 이벤트를 만들지 않습니다.

공식 문서: [User sessions](https://supabase.com/docs/guides/auth/sessions)