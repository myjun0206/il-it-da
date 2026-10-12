# 점주·직원 비밀번호 가입 이메일 OTP 인계

## 최신 develop 통합 및 운영 경계 (2026-10-07)

- 원본 OTP worktree는 변경하지 않고 `3ae3cb978c85413f4e3f7d60aea596c18013a03b` 기반의 별도 `fix/develop-otp-integration-stabilization`에 통합했다. 아래 이전 브랜치·검증 기록은 당시의 이력이다. 최신 전체 파일·검사·PR 초안은 `docs/develop-otp-integration-stabilization-handover.md`를 기준으로 한다.
- **사용자 확인 사실:** 사용자가 공유 DB에 038을 적용했고 역할별 권한 결과도 확인했다고 보고했다. Copilot이 공유 DB를 독립 조회하거나 적용 결과를 재검증한 것은 아니다. 이번 통합에서 037/038을 재적용하지 않았다. SQL 파일은 원본과 동일한 내용을 보존했다.
- `OWNER_STAFF_EMAIL_OTP_READY`는 false/미설정으로 유지한다. 실제 로그인·메일 수신·Supabase Auth/SMTP·실제 검색 품질은 이번 mock 통과로 입증되지 않는다. 공유 DB 쓰기·Auth/SMTP 설정 변경·실제 메일·유료 AI 호출·commit/push는 하지 않았다.
- 최신 가입 API의 진단 ID·입력/브랜드 검증과 OTP 확인 후 지연 프로필 생성을 함께 보존했다. 기존 승인된 본사/소셜 경로에 새 OTP를 요구하지 않는다. 상세 충돌 해결과 실제 재현된 HQ 매장 선택/모바일 헤더 수정은 최신 인계 문서에 기록했다.

## 작업 상태 (2026-10-07)

- 브랜치: `feature/owner-staff-email-otp`, 기준 커밋 `1804992`.
- 2026-10-06 OTP 작업 시작 시 `git fetch origin develop` 후 `HEAD...origin/develop`은 `0 / 0`이었다. 2026-10-07에도 기존 전용 브랜치와 OTP 변경을 보존하고 검증 실패 수정만 이어갔다. 새 브랜치 생성·병합·rebase·reset은 하지 않았다.
- 기존 수정 5개와 전용 OTP API/라이브러리 초안을 보존하고 이어서 수정했다. stash `handoff: local login changes`와 미추적 `desktop.ini`는 건드리지 않았다.
- 기존 구현에는 signUp/verifyOtp 서비스와 가입·승인 화면 변경이 있었다. 미완료 상태였던 중복 확인 UI 참조, 재발송 버튼, 입력 검증, 안전한 가입 재개, 서버 설정 판정, 테스트와 배포 문서를 보완했다.
- git add/commit/push, 공유 DB 적용·Auth/SMTP 설정 변경, 실제 계정 생성·메일 발송·유료 호출은 수행하지 않았다. SQL 초안은 이번에 생성·폐기한 일회용 로컬 PostgreSQL에만 적용했다.
- 공유 Supabase 적용 준비 단계에서 저장소의 마지막 기존 migration이 `037_owner_manual_safe_edit.sql`이며 `038` 파일이 없음을 확인하고 `038_owner_staff_email_otp.sql`을 새로 준비했다. Git 명령은 status/stash 등 읽기만 사용했다. 공유 DB의 원격 migration 이력과 프로젝트 설정은 조회하지 않았다.

## 기존 실패의 기준 비교와 해결

2026-10-07 수정 전 아래 실패 파일들과 본사 레이아웃은 HEAD(`1804992`)와 diff가 없었다. HEAD 파일을 작업 폴더 밖 임시 디렉터리에 `git archive`로 추출하고 동일한 설치 의존성으로 실행해 본사 레이아웃 18/19 통과·1개 실패, lint 4개 실패를 그대로 재현했다. 현재 작업 파일을 교체하거나 stash를 pop하지 않았다. 이 5개 실패는 OTP 변경 이전 기준에도 있던 문제다.

| 실패 위치(수정 전 줄/열) | 정확한 오류 | 원인과 최소 수정 |
| --- | --- | --- |
| `tests/auth/protected-layouts.test.ts:65:18` | `AssertionError: /return\s*<>\{children\}<\/>/` 불일치 | HEAD의 `app/hq/layout.tsx`는 이미 HQShell을 사용한다. 실제 본사 레이아웃은 변경하지 않고 테스트가 정확한 HQShell import·단 한 번의 children 래핑을 요구하도록 강화했다. fragment/HQShell 어느 쪽이든 허용하는 검사는 추가하지 않았다. |
| `app/hq/approvals/page.tsx:56:5` | `react-hooks/set-state-in-effect`: Calling setState synchronously within an effect can trigger cascading renders | `setIsReady(true)`만 하는 마운트 effect를 공통 hydration snapshot hook으로 대체했다. |
| `app/hq/communication/page.tsx:81:5` | 동일한 `react-hooks/set-state-in-effect` 오류 | 같은 대체. |
| `app/hq/manuals/common/page.tsx:159:5` | 동일한 `react-hooks/set-state-in-effect` 오류 | 같은 대체. |
| `app/hq/manuals/stores/page.tsx:56:5` | 동일한 `react-hooks/set-state-in-effect` 오류 | 같은 대체. |

`lib/hq/use-client-ready.ts`는 useSyncExternalStore의 서버 snapshot false·클라이언트 snapshot true를 사용한다. 기존 서버/초기 hydration의 빈 화면과 이후 화면·로딩 표시를 유지한다. 네 본사 화면의 JSX·스타일·이벤트·API와 본사 권한 가드는 변경하지 않았다. SSR 빈 렌더와 네 화면의 gate 유지 테스트를 추가했다. 테스트 삭제·제외·규칙 비활성화·임의 timer로 lint 회피를 하지 않았다.

## 유효성 요구사항 대조 (2026-10-07)

| 요구사항 | 현재 서버/화면 및 검사 |
| --- | --- |
| 이름·연락처 기존 규칙 | 이름 trim 후 2글자 이상, 연락처 숫자 10자리 이상을 공통 검증한다. 인증 후 다음 단계에도 이를 적용하도록 누락을 보완했다. 새 길이·국가·통신사 제한은 없다. |
| 이메일 공백·형식·서비스 비제한 | 기존 정규화와 일반 형식·254자 경계를 사용한다. 재발송의 클라이언트 검사도 같은 함수로 맞췄다. 254/255자·공백·zero-width·일반 도메인·잘못된 자료형을 검사했다. 실제 수신 인증을 형식 검사로 대체하지 않는다. |
| 비밀번호·확인 입력 | 8글자 이상과 정확한 확인값 일치, 원문 비밀번호 유지, SDK 추가 정책 오류 안내. 서버 검증 우회와 확인값 불일치에 Auth 호출이 없는지 검사했다. 비밀번호 복원/저장은 없다. |
| 필수 약관·허용 역할 | start와 최초 신청에서 boolean 필수 동의·owner/staff를 검증한다. 역할별 필수 동의 각각의 누락/false를 검사했다. marketing은 선택으로 유지한다. |
| OTP·만료·사용·제한 | 설정 길이의 숫자 문자열을 검사하고 0을 보존한다. 실제 확인은 verifyOtp에 맡기며 서버 요청 제한·재발송 대기·오류 안내를 유지한다. |
| 인증 후 이메일 변경 | 화면의 완료/발송/번호/이전 신청 상태를 지우고 첫 신청 서버에서 실제 Auth 이메일과 비교한다. 브라우저 mock에 인증 완료 후 변경도 추가했다. |
| 매장 선택·프로필 생성·권한 | 서버의 매장/브랜드/승인 점주 검사 후 pending 신청만 생성하고 기존 신청을 재사용한다. 인증 표시나 body의 역할만으로 권한을 부여하지 않는다. 기존 서버 테스트를 보존했다. |
| 오류 안내·입력 유지·중복 제출 | 한국어 field 오류·blur/제출 검사·fieldset/busy 제어를 유지한다. 잘못된 인증 프로필 이름/연락처가 다음 단계로 넘어가지 않는 browser mock도 추가했다. |

대조에서 발견한 누락은 재발송 이메일의 클라이언트 길이 검사와 인증 후 기본정보 재검사 두 가지였다. 본사와 소셜 입력 검증 분기는 이번 보완에서 바꾸지 않았다. 인증된 기존 계정의 잘못된 기본정보가 발견돼도 임의로 Auth 비밀번호·메타데이터를 수정하지 않고 필드 오류로 중단한다.

## 구현 흐름

1. 역할·필수 약관 동의 후 이름·연락처·이메일·비밀번호·비밀번호 확인을 입력한다.
2. `POST /api/auth/signup/owner-staff/start`가 같은 Origin, JSON, 입력값, 설정을 검사한다.
3. 서비스 롤 전용 `prepare_owner_staff_signup` RPC가 Auth 계정 존재 여부와 역할을 확인하고 DB 행 잠금으로 같은 이메일의 발송 요청을 제한한다. 설정이나 RPC가 준비되지 않으면 실패로 닫힌다.
4. 신규 이메일은 세션을 영속화하지 않는 anon 클라이언트의 **비밀번호 기반 signUp**으로 생성한다. 프로필·매장 신청은 이 단계에서 생성하지 않는다. 기존 미인증 점주·직원 계정은 **resend(type: signup)**만 호출하며 입력한 새 비밀번호·이름·연락처로 기존 계정을 수정하지 않는다.
5. 화면에서 번호를 입력하면 `POST /api/auth/signup/owner-staff/verify`가 정확한 길이의 숫자 문자열을 확인한 뒤 **verifyOtp(type: email)**를 호출한다. 앞자리 0을 유지한다. 실제 일치·만료·사용 여부는 Supabase가 판단한다.
6. 기존 서버 Supabase 클라이언트의 세션 쿠키·서명된 세션 정책을 사용한다. 가입 인증은 로그인 유지 미체크 정책(`rememberMe: false`)이며 기존 로그인에서 체크한 유지 정책은 로그인 재개 시 보존한다. 비밀번호 없는 signInWithOtp는 사용하지 않는다.
7. `GET /api/auth/signup/owner-staff/status`가 실제 getUser와 프로필을 확인한다. 인증 후 이탈·새로고침·확인 링크 재개는 이 응답으로만 인증 상태를 복원한다. 인증 완료 후 매장 신청 전 이탈한 사용자는 기존 비밀번호 로그인으로 가입 정보 화면부터 이어간다.
8. 기존 매장 선택·신청 화면으로 이동한다. 최초 이메일 신청 서버는 실제 확인된 Auth 이메일, 화면의 대상 이메일, 허용 역할, 이름·연락처, 필수 약관을 검증한다. 신청 가능한 매장·브랜드·직원 신청을 받을 승인 점주를 확인한 뒤 pending 프로필과 pending membership을 만든다.
9. 기존 승인 대기 화면으로 이동한다. 기존 멤버십은 재사용하고 승인·거절 상태를 덮어쓰지 않는다. 이메일 인증 자체로 매장 승인이나 본사 권한을 부여하지 않는다.

## 검증·저장 규칙

- 기존 이름 2글자 이상, 연락처의 숫자 10자리 이상, 비밀번호 8글자 이상 정책을 보존했다. 연락처의 새 국가·통신사·최대 길이 제한과 비밀번호 복잡도·72자 상한은 임의로 추가하지 않았다.
- 비밀번호는 trim·변형하지 않으며 확인 입력과 정확히 비교한다. Supabase 프로젝트의 더 강한 정책에 따른 weak_password 오류는 비밀번호 입력칸에 안내한다. 실제 프로젝트 비밀번호 설정 값은 이번 작업에서 조회·변경하지 않았다.
- 기존 이메일 정규화(앞뒤 공백·zero-width 문자 제거, 소문자화)를 유지한다. 일반 형식과 254자 경계를 검사하며 특정 메일 서비스로 제한하지 않는다. 형식 검사는 수신 인증을 대체하지 않는다.
- OTP 길이는 `NEXT_PUBLIC_SIGNUP_EMAIL_OTP_LENGTH`(기본 6)이다. 허용 설정 범위 6~10, 입력은 설정 길이의 숫자 문자열만 허용한다. 잘못된 설정으로 발송·인증을 열지 않는다.
- 필수 약관은 `service`, `privacy`, 점주 `store_connection` 또는 직원 `store_work`의 boolean true다. marketing은 선택이며 필수로 바꾸지 않았다. 기존 계정 재개 시 Auth 메타데이터의 동의 정보를 임의로 수정하지 않고 첫 신청 요청에서 다시 필수 동의를 확인한다.
- 점주·직원 비밀번호·OTP는 sessionStorage에 기록하지 않는다. 기존 signupPassword를 로그인·가입·신청 화면에서 제거하고 옛 signupProfile에 섞인 민감값은 허용 필드만 남기는 초안으로 정리한다. 새 전용 경로는 비밀번호·OTP·키·토큰을 로깅하거나 응답하지 않는다.
- 이메일 변경은 인증 완료·번호·발송 상태·이전 신청 표시를 초기화한다. 초기 신청 서버에서도 실제 Auth 이메일과 대상 이메일 불일치를 차단한다.
- 한국어 필드 오류, blur/제출 검증, 비동기 처리 중 입력·중복 제출 차단, 오류 후 재시도, 원래 입력값 유지와 이미 가입된 계정 안내를 연결했다.
- 화면 타이머 외에 DB 요청 제한과 Supabase의 발송·검증 제한이 적용된다. 신규 시작은 미완료/동시 생성 충돌을 줄이기 위한 5분 예약, 기존 계정 재발송은 60초 예약이다. UI는 이 서버 대기를 표시한다. 실패한 발송 예약을 즉시 풀지 않는다.
- 실제 email_confirmed_at과 최초 가입의 confirmation_sent_at 및 Confirm email ON 상태를 요구한다. signUp이 즉시 세션을 반환하면 인증 성공으로 처리하거나 쿠키로 저장하지 않는다. 기존 계정을 삭제해서 복구하는 동작도 제거했다.

## 보존 범위·공용 영향

- 본사는 기존 `/api/auth/send-verification`, `/api/auth/verify-code`, `/api/auth/signup`와 email_verifications 테이블을 계속 사용한다. 테이블·본사 분기·기존 관리자 계정 생성·로그인 동작은 유지한다.
- 기존 signup API에서는 점주·직원·boss 별칭만 새 인증번호 가입으로 안내하고 거부한다. 본사 API 자체를 새 OTP API로 대체하지 않았다.
- **본사 메일은 현재 별도 발송 서비스 미연결 상태다.** 기존 send-verification은 development 외 환경에서 503이며 Supabase SMTP 설정만으로 이 커스텀 API가 발송 가능해지지 않는다. 이를 우회하거나 본사 발송 구현을 이번 범위에서 새로 만들지 않았다. 본사의 기존 개발 전용 고정번호·저장소 경로는 유지한다.
- 소셜 OAuth·onboarding 코드는 수정하지 않았다. 소셜 사용자에게 비밀번호·새 OTP·최초 이메일 가입 검증을 요구하지 않는다.
- 공용 변경은 로그인 재개, callback 허용 목적지에 가입 정보 화면 추가, 매장 서비스의 선택적 프로필 생성 훅, 서버 역할 가드의 미인증 이메일 차단이다. 기존 role 판정은 profiles가 기준이고 pending/rejected 매장 권한은 기존 매장별 승인 가드가 계속 담당한다. 인증된 본사·소셜 사용자의 역할 판정은 유지한다.
- 기존 code(PKCE)·token_hash 확인 콜백 처리와 이전 pendingStores 링크 동작은 그대로다. 새 가입의 링크 목적지는 `/signup/profile?auth=email`이며 매장 신청을 자동 생성하는 목적지로 보내지 않는다.
- Supabase Single session per user는 기존 프로젝트 Auth 설정에 맡긴다. 이번 작업은 켜거나 변경하지 않았다. 실제 다른 기기의 세션 교체는 refresh 시 감지되므로 즉시 강제 로그아웃으로 설명하지 않는다.

## 운영자가 준비할 항목

실제 파일 위치:

```text
C:\Users\farew\Desktop\il-it-da\docs\owner-staff-email-otp-handover.md
C:\Users\farew\Desktop\il-it-da\docs\sql\owner-staff-email-otp-migration-draft.sql
```

준비 플래그의 정확한 이름은 서버 전용 `OWNER_STAFF_EMAIL_OTP_READY`다. 값이 문자열 `true`일 때만 전용 가입을 열며 기본은 비활성이다. 공개 길이 설정 `NEXT_PUBLIC_SIGNUP_EMAIL_OTP_LENGTH`와 혼동하지 않는다. 비밀값은 이 문서에 포함하지 않는다.

운영 적용 순서(이번 작업에서는 실행하지 않음):

1. 준비 플래그를 미설정/false로 유지하고 기존 DB·Auth 설정과 본사·소셜·callback 동작을 기록한다.
2. SQL 초안을 검토하고 실제 배포 스키마·역할을 반영한 격리 환경에서 실행·grants/RLS·동시 요청·중복/재개를 검증한다. 이번 일회용 PostgreSQL 검증은 아래에 기록했으나 공유 Supabase 스키마 검증을 대체하지 않는다. 승인 후에만 배포 DB에 별도 정식 migration으로 적용한다. email_verifications는 보존한다.
3. 격리 환경부터 Email provider ON·가입 허용·Confirm email ON·OTP 길이/만료/요청 제한·Confirm signup의 Token·기존 링크·SMTP·Site/Redirect URL을 준비하고 공용 영향 회귀를 확인한다. 본사 커스텀 발송 서비스는 별도 미연결 상태임을 유지한다.
4. 공개 OTP 길이를 프로젝트 설정과 맞추고 서버 전용 키/세션 설정을 안전하게 준비한다. 새 앱을 **준비 플래그가 꺼진 채** 빌드·배포한다. 기존 Auth hook/trigger가 인증 전에 프로필·신청을 만들지 않는지 검토한다.
5. 승인된 격리 환경에서만 준비 플래그를 true로 켜 실제 수신·인증·재발송·기존 본사/소셜/링크/세션·승인 권한 회귀를 확인한다. 이 실제 메일 검증은 이번 작업에서 수행하지 않았다.
6. 위 검증과 배포 승인이 끝난 뒤 운영 환경의 준비 플래그를 **마지막에** `OWNER_STAFF_EMAIL_OTP_READY=true`로 설정한다. 길이 설정은 빌드 시, 준비 플래그는 서버 배포/환경 설정 시 적용한다. 실패하면 플래그를 끄고 설정/SQL 문제를 해결하며 인증 성공으로 우회하지 않는다.

세부 점검 목록:

1. SQL 초안 `docs/sql/owner-staff-email-otp-migration-draft.sql`을 운영자가 검토·격리 환경에서 검증한다. 실제 적용·migration 번호 부여는 별도 승인 작업이다. 기존 email_exists boolean RPC만으로는 미인증/확인 완료/소셜/역할 불일치를 구분하고 발송을 직렬화할 수 없어 서비스 롤 전용 조회와 요청 제한 테이블을 제안했다. email_verifications·기존 프로필·멤버십 스키마는 변경하지 않는다.
2. Email provider ON, 신규 가입 허용, **Confirm email ON**을 확인한다. OFF나 설정 조회 실패를 정상 번호 인증으로 처리하지 않는다. 전체 프로젝트에 영향을 주므로 기존 계정·초대·이메일 변경 흐름도 격리 환경에서 확인한다. 본사 admin.createUser(email_confirm: true)와 OAuth는 그대로 둔다.
3. Supabase **Confirm signup** 템플릿에서 점주·직원 가입에는 `{{ .Token }}`을 표시한다. Magic link 템플릿으로 대체하지 않는다. `.Data.role`에 따른 조건부 템플릿으로 본사/기타 사용자의 원래 내용을 유지하는 것을 권장한다. 기존 ConfirmationURL 또는 커스텀 링크를 프로젝트 전체에서 무조건 제거하지 않는다.
4. 새 ephemeral signUp은 브라우저 PKCE verifier를 만들지 않는다. 번호 인증이 기본이다. 새 메일에 링크도 제공하려면 fragment 세션이 필요한 기본 링크 대신 아래 token_hash 서버 콜백 링크를 사용하고 Site URL을 정확히 설정한다. 기존 브라우저 PKCE 링크는 기존 callback의 code 처리와 함께 유지한다.

   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=%2Fsignup%2Fprofile%3Fauth%3Demail`

5. Site URL·Redirect URL allow list에 배포 주소와 `/auth/callback` 및 개발 주소를 명시한다. 외부 목적지/임의 callback query로 권한을 부여하지 않는다. reverse proxy에서 Origin과 앱 외부 URL이 일치하는지도 확인한다.
6. Custom SMTP의 공급자·발신 주소·도메인 인증(SPF/DKIM/DMARC)·발송 한도·반송·스팸함 수신을 점검한다. 기본 SMTP 수신자 제한을 일반 사용자 발송 지원으로 오인하지 않는다. 인증번호만 표시한 메일의 실제 수신이 필요하다. 링크 추적·보안 링크 미리읽기의 영향도 확인한다.
7. 프로젝트 Email OTP 길이와 공개 `NEXT_PUBLIC_SIGNUP_EMAIL_OTP_LENGTH`를 동일하게 설정하고 앱을 다시 빌드한다. OTP 만료, 발송 간격, 검증/프로젝트 요청 한도는 Supabase 설정을 확인한다. 서버 간 공유되는 DB 제한 외에 IP 단위 abuse 제한/WAF도 운영 검토한다.
8. 서버 전용 Supabase 서비스 키와 기존 세션 정책 키를 준비한다. 키·토큰 값을 문서/브라우저/로그에 넣지 않는다. `AUTH_SESSION_POLICY_SECRET`과 기존 단일 세션 정책은 기존 세션 설정 문서를 따른다. 유료 플랜 설정을 이번 작업에서 활성화하지 않았다.
9. 배포 DB에 signUp만으로 프로필·매장 신청을 생성하는 별도 trigger/hook이 없는지 확인한다. 저장소 migration에는 해당 Auth 자동 생성 trigger가 발견되지 않았으나 공유 DB의 실제 상태는 조사하지 않았다.
10. 위 항목이 검증된 뒤 서버에 `OWNER_STAFF_EMAIL_OTP_READY=true`를 설정한다. 기본은 비활성이다. 이 수동 배포 준비 선언만으로 인증을 성공시키지 않으며 런타임에서도 공개 Auth 설정을 no-store로 확인한다. 설정/SQL이 없으면 503으로 안내한다.

요청 제한 테이블에는 이메일과 요청 시각만 저장한다. 운영자는 오래된 행의 보존 기간/정리 정책을 검토해야 한다. 앱 경로 간 동시 요청은 행 잠금으로 제어하지만 Supabase의 공개 Auth API를 직접 호출하는 외부 클라이언트까지 이 SQL로 잠글 수는 없다. 프로젝트의 직접 Auth 호출·외부 동시 가입과 느린/시간 초과 발송은 별도 운영 테스트 대상이다.

## 검사 결과

- OTP·입력·설정·미인증/자동 확인 차단 mock 단위 테스트, 프로필·매장 적격성·중복 신청 테스트, 기존 callback·역할·승인 대기 RAG/매뉴얼 권한 테스트를 실행했다.
- Playwright Edge: 점주 1280px/직원 390px, 2개 통과. 모든 API 발송/검증은 mock이고 외부 브라우저 요청은 차단했다. 빈 값·발송 실패·입력 유지·저장 비밀번호 제거·재발송 대기·새로고침 재개·잘못된 길이·만료 오류·앞자리 0·이메일 변경 초기화·인증 후 매장 선택 이동·가로 넘침을 확인했다. 스크린샷은 git 무시 대상 `.next/signup-otp-owner.png`, `.next/signup-otp-staff.png`에 있다.
- `typecheck`: 최종 통과. 변경 파일 집중 lint: 오류 0으로 통과. 편집 파일 VS Code 진단도 오류 없다.
- `test:auth`: 2026-10-07 최종 **261/261 통과**. 이전 256개 중 실패한 본사 레이아웃 계약을 현재 HQShell 구조로 엄격히 검증하고 hydration/유효성 테스트 5개를 추가했다. 테스트는 삭제·제외하지 않았다.
- `check:integration`: 통과(오류 0, 경고 0; 기존 migration 번호 014/015 누락은 info).
- `check:frontend`: 2026-10-07 **5/5 통과**. 전체 lint·typecheck·production build·git diff 공백·test:frontend 102개를 모두 실행했다. 기존 lint 경고는 남아 있으나 오류는 없다. 규칙을 끄지 않았다.
- 본사 승인/브랜드 범위 회귀: `tests/hq/approval-scope.test.ts` **11/11 통과**.
- 유효성 보완 후 Playwright mock: **2/2 통과**. 기존 검사에 긴 이메일 재발송 차단, 인증 후 이메일 변경 초기화, 인증된 프로필의 잘못된 이름/연락처 차단을 추가했다. 실제 발송으로 검증하지 않았다.
- `git diff --check`: 통과. 공유 DB·SMTP·실제 메일·실제 공급자 인증은 실행하지 않았다. 실제 로컬 SQL 실행 결과는 다음 절에 별도로 기록한다.

## SQL 보완과 실제 격리 검증 (2026-10-07)

이번 수정은 SQL 초안·독립적인 로컬 검증 파일·이 인계 문서에 한정된다. 본사/소셜 가입 흐름과 기존 OTP 앱 구현은 변경하지 않았다. `OWNER_STAFF_EMAIL_OTP_READY`는 비활성/미설정 상태를 유지하며 프로세스 환경과 로컬 환경 파일에서 활성화되지 않았음을 값 출력 없이 확인했다.

- `p_role is null or p_action is null`을 검증 조건 맨 앞에 넣어 SQL의 NULL/3값 논리로 허용되는 경로를 없앴다. 잘못된 입력은 잠금/INSERT/UPDATE 전에 unavailable로 반환한다.
- request 행의 `FOR UPDATE` 잠금을 얻은 직후 `request_time := clock_timestamp()`를 다시 계산한다. 제한 판정·Retry-After·requested_at·available_at은 모두 이 잠금 후 시각을 사용한다.
- inspect는 기존처럼 요청 제한 행을 INSERT/UPDATE하거나 잠그지 않는다. 없는 행·기존 제한 행 모두에서 쓰기 없음을 실제 행 값·xmin·ctid 스냅샷으로 확인했다.
- 실제 psql 실행에서 CURRENT_TIME 예약 이름과 변수 대입의 구문 충돌을 발견해 변수 이름을 `request_time`으로 바꿨다.
- 실제 SQL 파일은 ASCII 검사와 한국어/Markdown 표식 검사에 통과했다. 원본 파일을 psql의 `ON_ERROR_STOP=1`로 직접 읽어 적용했으며 전달 과정의 한국어 문장·Markdown fence·표/제목은 없다.

### 검증 환경과 재현

- 실제 엔진: **PostgreSQL 16.15**, Windows x64. EDB 공식 ZIP 바이너리를 `%TEMP%/ilitda-postgres-tools-16/pgsql/bin`에만 추출했다. 서비스 설치·관리자 권한 변경은 하지 않았다.
- 매 실행마다 새 임시 클러스터와 `otp_test`, `otp_rollback` DB를 만든다. 127.0.0.1과 자동 선택된 별도 포트에서만 시작하며 실제 data_directory가 새 클러스터인지 검사한다. 기존 PG 접속 환경변수는 자식 프로세스에서 제거한다.
- auth.users/auth.identities/profiles는 함수가 읽는 컬럼만 갖춘 **합성 fixture**다. 사용자 주소는 example.invalid이며 실제 Supabase 사용자/키/비밀번호/토큰/메일 서비스는 사용하지 않았다.
- anon/authenticated는 NOLOGIN, service_role은 NOLOGIN BYPASSRLS 역할로 생성해 실제 SET ROLE 및 SQLSTATE로 접근 권한을 검사했다. 운영 프로젝트의 역할 상속·기존 grant까지 복제한 것은 아니다.
- 재현: `node --test tests/auth/owner-staff-signup-postgres.test.mjs`. 다른 설치 경로는 `OTP_TEST_POSTGRES_BIN`에 **로컬** PostgreSQL bin 경로를 지정한다. 외부 DB URL을 받는 옵션은 없다. 기본 바이너리가 없으면 실패하며 검사를 skip하지 않는다. 현재 테스트는 정식 038과 사전/사후 조회 SQL도 검증한다.
- 최초 SQL 초안 검증 결과: **11개 SQL 시나리오 전부 통과**, 클러스터 생성·정리를 포함한 Node 집계 **12/12 통과**, 실패/취소/skip 0. 이후 정식 적용 준비 검증은 아래 **19/19** 결과로 별도 기록한다. 각 검증 완료 후 서버를 종료하고 데이터 디렉터리를 삭제했다. 바이너리 ZIP/배포 폴더는 재현을 위해 임시 tools 경로에 남아 있다.

| 실제 검사 | 결과와 확인 방법 |
| --- | --- |
| 신규/미인증 재개 | owner/staff 신규는 new, 원래 역할의 미인증 계정은 resume. 실제 SQL 결과 확인. |
| 확인 완료/소셜/프로필 존재/역할 불일치 | 확인 완료, 기본 Google provider, email 계정의 Google identity, 기존 profiles 행은 exists. 기존 staff를 owner로 요청하면 role_mismatch. |
| NULL·잘못된 입력·데이터 변경 없음 | 이메일/역할/동작의 NULL, 전체 NULL, hq/boss/빈 역할/대문자 역할, 빈/알 수 없는 동작, 빈/공백/잘못된 형식/과도한 길이 이메일은 unavailable. Auth·identity·profile·request 전체의 값/xmin/ctid 스냅샷이 동일했다. |
| 동일 이메일 동시 요청 | 첫 요청의 트랜잭션을 유지한 채 대소문자·공백으로 표현만 다른 동일 이메일을 두 번째 연결에서 요청했다. pg_stat_activity로 실제 Lock 대기를 확인한 뒤 첫 요청을 commit했다. 하나만 new, 두 번째는 rate_limited, 행은 1개였다. |
| 신규 5분·재발송 60초 | available_at - requested_at이 각각 정확히 300초/60초. 제한 중 요청은 rate_limited이며 행과 Auth fixture를 변경하지 않았다. |
| 잠금 대기 후 제한 만료 판정·갱신 | 잠금 보유 세션이 대기 요청을 확인한 후 available_at을 그 시점의 clock_timestamp로 바꾸고 해제했다. 대기 요청은 new로 허용됐으며 새 requested_at은 해제 경계 시각 이후, 새 예약은 정확히 300초였다. 잠금 전 시각/임의 sleep에 의존하지 않았다. |
| 잠금 대기 후 Retry-After | 잠금 보유 세션이 대기 확인 후 available_at을 현재 +60초로 바꿨다. 대기 요청의 Retry-After는 1~60초이며 제한 행을 다시 쓰지 않았다. |
| inspect 쓰기 없음 | 제한 행이 없는 이메일, 기존 신규 제한 행, 기존 미인증 재발송 제한 행을 조회했다. request와 Auth fixture의 값/xmin/ctid가 동일했다. |
| anon/authenticated 거부 | 각 역할에서 함수 실행 및 request 테이블 SELECT/INSERT/UPDATE/DELETE가 모두 **42501 insufficient_privilege**로 실패하고 데이터는 불변이었다. |
| service_role 허용 | RLS 활성화 상태에서 실제 역할 전환 후 RPC 실행과 request 테이블 CRUD가 성공했다. 테스트 쓰기는 rollback했다. |
| 재적용 | 원본 SQL 파일을 두 번 적용했다. 기존 데이터·함수 OID·anon/authenticated/service_role 실행 권한이 유지됐다. |
| 트랜잭션 롤백 | 함수가 만든 request 행을 rollback하면 전체 스냅샷이 원복됐다. 별도 DB에서 commit 직전 의도적인 22012 오류를 넣으면 새 테이블·함수 모두 없고 기존 fixture는 유지됐다. 수정한 실패용 SQL은 메모리에서만 사용해 실제 초안 파일을 바꾸지 않았다. |

첫 실행은 Windows pg_ctl 상속 출력 핸들로 시작 도우미가 대기해 취소됐으며 SQL 통과로 집계하지 않았다. 임시 서버만 종료하고 프로세스 종료 감지·외부 명령 30초 제한을 보완했다. 두 번째 실행의 실제 SQL 예약 이름 충돌 역시 실패로 기록하고 수정한 뒤 새 클러스터의 최종 통과를 얻었다. 이 실패를 공유 DB에 적용하거나 Auth 설정으로 우회하지 않았다.

앞선 `test:auth` 261/261, `check:frontend` 5/5, 브라우저 mock 2/2는 앱 검증 결과이며 이 실제 PostgreSQL 검사와 별개다. SQL/검증 파일 변경만으로 실제 메일 수신·Supabase Auth 통합까지 통과했다고 선언하지 않는다.

## 공유 Supabase 적용 준비 (2026-10-07)

**준비만 완료했다. Copilot은 공유 DB 조회·정식 migration 적용·Auth/SMTP 변경·메일 발송을 하지 않았다. 사용자가 실행한 사전 읽기 전용 조회의 제공 결과는 아래에 별도로 기록한다. 준비 플래그는 계속 비활성이다.** 아래 실제 프로젝트 작업은 사용자가 별도 승인과 환경 확인 후 수행한다.

### 사용자 제공 공유 DB 사전 결과 (2026-10-07)

출처는 **사용자가 Supabase SQL Editor에서 실행하고 전달한 사전 조회 결과**다. Copilot이 공유 DB에 접속해 독립적으로 재조회한 결과가 아니며, 정식 038 적용 결과 또는 실제 메일 검증 결과로 해석하지 않는다.

| 확인 항목 | 사용자 제공 결과 | 판정과 후속 조건 |
| --- | --- | --- |
| 의존 테이블·컬럼 | auth.users/auth.identities/public.profiles 존재, 사전 SQL의 Auth/앱 의존 9개 컬럼과 자료형 일치 | 보고된 의존 스키마 일치. confirmation_sent_at을 포함한 9개이며 RPC 자체의 의존 컬럼은 8개다. |
| 신규 OTP 객체 | public.owner_staff_signup_requests와 public.prepare_owner_staff_signup 없음 | 신규 객체 적용 후보. 기존 객체 구조/본문 충돌은 보고된 시점에 없으며 적용 직전 변경 여부는 다시 확인한다. |
| 역할 상속 | anon/authenticated/service_role 대상 역할 상속 조회 0행 | 보고된 조회 범위에서 직접 역할 상속 관계 없음. |
| RLS 우회·스키마 사용 | 세 역할 중 service_role만 RLS 우회, 세 역할 모두 public USAGE 가능 | 필요한 service_role 우회·스키마 사용 조건 일치. public USAGE는 새 요청 테이블 접근 권한을 의미하지 않는다. |
| 기본 ACL | anon/authenticated에도 새 객체 권한을 부여하는 default privileges 존재 | **적용 후 객체별 권한 철회 확인 필수.** 038은 새 테이블·함수에서 PUBLIC/anon/authenticated 권한을 REVOKE하고 유효 접근을 검사한다. 전역 default privileges는 바꾸지 않는다. |
| Auth 트리거 | 조회된 트리거는 모두 내부 제약조건 트리거이며 INSERT 대상 아님 | 보고된 DB 트리거 목록에서 인증 전 자동 프로필/신청 생성 근거 없음. Dashboard Auth Hooks/Send Email Hook까지 검증됐다는 뜻은 아니다. |

사전 결과는 **신규 적용 후보의 보고된 기본 조건 충족**으로 기록한다. 아직 공유 DB 적용을 승인하거나 준비 플래그를 활성화하지 않는다. 기본 ACL이 새 객체에 적용된 뒤 anon/authenticated의 RPC EXECUTE·요청 테이블 SELECT/INSERT/UPDATE/DELETE가 실제로 false인지 postflight로 확인해야 한다. 다른 grantee·상속 접근이 남으면 038의 권한 guard가 전체 트랜잭션을 중단해야 하며, 이를 우회해서 진행하지 않는다.

아직 전달되지 않은/미검증 항목: 대상 PostgreSQL 버전·적용 실행자/함수 소유자의 Auth schema USAGE·의존 테이블 SELECT 및 RLS 무필터 읽기·공유 프로젝트 migration 번호 이력·정식 038 적용 및 postflight 결과·Dashboard Auth Hooks·SMTP/Confirm email/템플릿/OTP 설정·실제 메일 수신과 기존 본사/소셜/세션 회귀. 원본 결과 전체를 독립 재검증한 것으로 기록하지 않는다.

### 준비 파일

```text
C:\Users\farew\Desktop\il-it-da\docs\sql\owner-staff-email-otp-preflight.sql
C:\Users\farew\Desktop\il-it-da\supabase\migrations\038_owner_staff_email_otp.sql
C:\Users\farew\Desktop\il-it-da\docs\sql\owner-staff-email-otp-postflight.sql
```

- preflight/postflight는 `BEGIN TRANSACTION READ ONLY` 안에서 시스템 카탈로그를 조회하고 `ROLLBACK`한다. RPC 호출·사용자 행 조회·설정 변경·DDL/DML은 없다. 역할·컬럼·제약·권한·함수 지문·트리거 메타데이터만 반환한다. 함수/트리거 본문, trigger 인수, 메일·키·토큰·실제 가입 데이터는 출력하지 않는다.
- 관리 권한을 갖춘 SQL 클라이언트로 **대상 프로젝트를 확인한 후** 파일을 읽기 전용으로 실행한다. 여러 SELECT 결과셋이 표시되지 않는 SQL Editor에서는 모든 결과를 볼 수 있는 신뢰된 DB 클라이언트를 사용한다. 접속 비밀값은 사용자의 비밀 저장소/도구 안에서만 입력하고 채팅·로그에 넣지 않는다.
- 정식 파일은 저장소의 기존 최대 `037` 뒤 `038`을 사용한다. 적용 직전에 저장소와 공유 프로젝트의 migration 이력을 다시 확인한다. 원격에 같은 번호가 있거나 다른 미검토 migration이 남아 있으면 중단한다. 무조건 전체 `db push`로 다른 파일까지 함께 적용하지 않는다.
- 초안과 정식 파일을 둘 다 적용하지 않는다. 향후 승인된 적용 대상은 **정식 038 하나**다. 초안은 이전 검증 이력으로 남겨둔다.

### 사전 대조와 중단 기준

1. 요청 테이블과 같은 이름의 함수/overload 존재 여부를 확인한다. 객체가 없으면 신규 적용 후보이며, 있으면 아래 계약을 모두 대조한다.
2. RPC 의존 컬럼: auth.users의 id(uuid), email(text 또는 varchar), email_confirmed_at(timestamptz), raw_app_meta_data/jsonb, raw_user_meta_data/jsonb; auth.identities의 user_id(uuid), provider(text 또는 varchar); public.profiles의 id(uuid). confirmation_sent_at(timestamptz)은 SQL RPC와 별개로 앱의 실제 인증 이력 판정에 필요하므로 조회 결과에서 확인한다.
3. 요청 테이블은 email(text)·requested_at(timestamptz)·available_at(timestamptz)의 정확한 3개 컬럼과 NOT NULL, 기본값/identity/generated 없음, email의 즉시(non-deferrable) PK가 필요하다. 추가 제약·특수/unique index·RLS policy·사용자 trigger·column ACL·다른 grantee·다른 소유자는 자동 정리하지 않는다. **CREATE TABLE IF NOT EXISTS는 기존 컬럼/키/제약의 호환성을 보장하지 않는다.** 정식 파일의 catalog guard가 불일치 시 트랜잭션을 중단한다.
4. 기존 RPC가 있으면 (text,text,text) 서명·p_email/p_role/p_action 인수명·jsonb 단일 반환·PL/pgSQL·SECURITY DEFINER·빈 search_path·적용 실행자와 같은 소유자·검증된 본문 지문이 필요하다. 지문은 `39cfceb5774c224e6671f421211e5d4e`다. 이는 정규화된 본문 비교용이며 비밀값이 아니다. 다른 함수/overload를 무조건 CREATE OR REPLACE로 덮어쓰지 않는다. 같은 동작으로 보이는 다른 본문도 승인된 별도 검토가 필요하다.
5. anon/authenticated/service_role의 존재, 직접·상속·PUBLIC·column·default privileges를 확인한다. 함수 소유자는 Auth 의존 테이블을 RLS 필터 없이 읽을 수 있어야 한다. service_role은 public schema USAGE와 RLS 우회 권한이 필요하다. 일반 클라이언트에 상속 접근이 남거나 예상하지 못한 grantee가 있으면 정식 파일은 전체 트랜잭션을 rollback한다. 다른 전역 권한이나 역할 속성을 자동 변경하지 않는다.
6. auth.users 트리거 목록의 `on_insert=true`, `tgisinternal=false` 항목은 반드시 검토한다. 인증 전 profiles/매장 신청 생성·권한 부여 등 부작용이 있으면 준비 플래그를 켜지 않는다. 조회는 본문을 공개하지 않으므로 소유자가 안전한 환경에서 본문·간접 호출을 별도로 검토한다. Supabase Auth Hooks/Send Email Hook 등 DB trigger가 아닌 Dashboard 설정도 따로 확인해야 한다.

정식 파일은 5초 lock_timeout·30초 statement_timeout을 사용한다. `OTP_*_REVIEW_REQUIRED`, `OTP_*_INCOMPATIBLE`, 역할 누락 또는 timeout이 발생하면 멈추고 대상 객체/권한을 조사한다. DROP/CASCADE, 자동 데이터 변환, 기존 객체 덮어쓰기, Auth 사용자 변경으로 통과시키지 않는다.

### 적용 후 조회 기준

승인된 정식 적용 뒤 postflight를 실행한다. 첫 결과의 **11개 check 모두 true**여야 한다. anon/authenticated의 RPC EXECUTE와 요청 테이블 SELECT/INSERT/UPDATE/DELETE는 모두 false, service_role은 모두 true이며 public schema USAGE도 true여야 한다. 마지막 결과의 함수 소유자 dependency SELECT·Auth schema USAGE·RLS 무필터 읽기도 true여야 한다. 결과가 다르면 준비 플래그를 OFF로 유지하고 배포를 중단한다. 이 조회로 번호 발송/실제 인증 성공을 검증하지 않는다.

### 사용자가 수행할 SMTP·Email 설정 순서

1. **격리 프로젝트에서 먼저 준비한다.** `OWNER_STAFF_EMAIL_OTP_READY`는 미설정/false로 둔다. 현재 본사·소셜·확인 링크·복구 메일 설정을 보관하고, DB 사전 대조와 원격 migration 번호 검토를 완료한다. 승인된 격리 환경에만 정식 038을 적용하고 postflight를 확인한다.
2. **SMTP 공급자와 발신 도메인 준비:** 공급자 계정에서 발신 주소/도메인을 인증하고 SPF·DKIM·DMARC를 설정한다. 발신 주소·발신 이름·SMTP host·port·user·password를 준비하되 비밀번호는 사용자만 비밀 입력칸에 입력한다. Auth 메일의 링크 추적은 비활성화하고 공급자의 수신자 제한·일/시간 한도·반송 처리를 확인한다.
3. **Supabase Authentication > Email > SMTP Settings**(환경에 따라 Authentication settings/Custom SMTP)에서 Custom SMTP를 설정한다. 공식 설정 주소는 `https://supabase.com/dashboard/project/_/auth/smtp`다. 기본 SMTP는 팀 구성원 주소와 낮은 한도로 제한되므로 일반 사용자용 발송으로 간주하지 않는다. 저장은 사용자가 승인된 프로젝트에서만 수행하며 이 작업은 저장/메일 테스트를 하지 않았다.
4. **Authentication > Sign In / Providers > Email**에서 Email provider 활성화·신규 가입 허용·Confirm email ON을 확인한다. Confirm email ON은 mailer_autoconfirm=false다. OTP length와 Email OTP expiration을 확인한다. 기본 길이 6을 사용할 경우 앱도 6으로 맞춘다. 이 앱은 6~10 길이만 지원하며 프로젝트 UI에서 바꾸는 옵션이 없으면 지원되는 기본 길이를 사용하거나 운영자가 공식 설정 지원 범위를 별도 확인한다. 만료 시간은 확인/복구/이메일 변경/초대 링크에도 영향을 준다.
5. **Authentication > Email Templates > Confirm signup**에서 점주·직원 메일에 `{{ .Token }}`을 표시한다. Magic link 템플릿/비밀번호 없는 signInWithOtp로 바꾸지 않는다. 예를 들어 기존 템플릿의 적절한 위치에 아래 조건부 번호 영역을 추가하되 기존 본사/기타 내용과 확인 링크는 검토 없이 삭제하지 않는다.

   ```html
   {{ if or (eq .Data.role "owner") (eq .Data.role "staff") }}
   <p>Verification code: {{ .Token }}</p>
   {{ end }}
   ```

   새 가입은 번호 인증이 기본이다. 새 ephemeral 가입에 링크도 제공할 때는 앞 절의 token_hash 서버 callback 링크를 격리 환경에서 검증한다. 기존 PKCE/code 콜백 링크는 유지하며 전체 프로젝트 템플릿을 임의로 전면 교체하지 않는다.
6. **URL Configuration/Rate Limits**에서 Site URL·허용 Redirect URL·프로젝트 이메일 발송 한도·요청 간격을 확인한다. 운영/격리 주소와 /auth/callback을 구분한다. 코드의 신규 300초·재발송 60초 제한은 Supabase 자체 제한을 대체하지 않는다. SMTP 한도와 abuse/IP 보호도 별도다.
7. **앱 환경 설정 후 재빌드:** 프로젝트 길이와 동일한 `NEXT_PUBLIC_SIGNUP_EMAIL_OTP_LENGTH`를 설정한다(기본 6). 서버 키·세션 정책 비밀값은 서버 비밀 저장소에만 둔다. 앱은 준비 플래그 OFF 상태로 빌드·배포한다. 본사 커스텀 send-verification은 별도 미연결이므로 Supabase SMTP 설정만으로 해결됐다고 보고하지 않는다.
8. **별도 승인된 실제 검증:** 격리 프로젝트의 플래그만 true로 켜 지정된 테스트 수신자에게 실제 가입/재발송·만료/오사용 번호·이탈 재개·기존 본사/소셜/링크/세션·승인 권한을 확인한다. 메일 수신·스팸함·반송을 확인한 뒤에만 운영 적용 승인을 검토한다. 현재 작업에서는 이 단계와 운영 플래그 활성화를 하지 않았다.
9. **운영 활성화는 마지막:** 사용자 승인, 공유 DB 호환성 확인, 정식 적용·postflight, 공용 설정 회귀와 실제 수신 검증이 모두 끝난 뒤에만 `OWNER_STAFF_EMAIL_OTP_READY=true`를 설정한다. 실패하면 OFF로 유지한다. 번호/링크 인증을 우회하거나 Confirm email을 끄지 않는다.

### 준비 산출물 실제 로컬 검사 결과

- PostgreSQL 16.15 일회용 클러스터에서 **19/19 통과**: 원래 분기/동시성/권한/롤백 검사 외에 신규·기존 객체의 preflight 무쓰기, 정식 038 신규 적용·재적용, postflight 11개 true, 구조 불일치 6종 보존, 다른 RPC/overload 보존, 상속 권한 및 default table/function grant 충돌 시 전체 rollback을 확인했다.
- SQL RPC 본문은 기존 12/12 검증본과 동일한 정규화 지문을 유지한다. 정식 파일의 추가 부분은 적용 전 호환성/권한 guard와 적용 후 중단 조건이다.
- 검증 파일에는 외부 DB URL 옵션이 없으며 합성 Auth fixture만 사용한다. 일회용 클러스터는 종료·삭제했다. 공유 Supabase 사전 카탈로그의 일부 결과는 사용자가 제공했고 위에 출처를 구분해 기록했다. 공유 정식 적용·postflight·실제 SMTP 수신 성공으로 판정하지 않는다.

### 최종 038 원본 공백·파일 해시 확인 (2026-10-07)

- 대상 원본: `C:\Users\farew\Desktop\il-it-da\supabase\migrations\038_owner_staff_email_otp.sql`.
- 실제 UTF-8 원본의 `orrolsuper`는 **0회**, 마지막 권한 검사의 `(rolbypassrls or rolsuper)`는 **1회**다. 전달된 표현에만 공백 누락이 있으며 이번 확인에서 SQL 파일을 수정하지 않았다. PowerShell 자체가 공백을 제거했다고 확인한 것은 아니다.
- 전체 파일 SHA-256: **62B2F22A555C2F12966E74369D90DAC527066BD5F5A3F3BDBE8D2842A25EFC32**. 직전 원본 문자/바이트 확인에서 기록한 해시와 동일하다.
- 이번 확인 결과는 파일 원본 문자열·해시 검사다. 기존 로컬 PostgreSQL 19/19 통과는 앞선 실행 결과이며, 그 실행 당시 전체 파일 SHA-256을 기록하지 않았으므로 당시 파일과 현재 파일의 전체 바이트 동일성을 소급 입증하는 해시라고 설명하지 않는다.
- 현재 기본 로컬 PostgreSQL 경로의 initdb 바이너리가 없고 PATH에서도 initdb/pg_ctl/psql을 찾지 못했다. 직전 재실행 시도는 바이너리 부재로 DB 초기화 전에 실패했다. 원본에 오타가 없어 이번에는 SQL 변경·PostgreSQL 재실행을 하지 않았으며 새로운 19/19 통과로 집계하지 않는다. 앞 절의 임시 바이너리 경로는 검증 당시 위치로, 재현하려면 실행 도구를 다시 준비해야 한다.
- 공유 DB 실행·Auth/SMTP 설정 변경·메일 발송·Git 쓰기는 하지 않았다. 준비 플래그도 변경하지 않았다.

원본 조회 명령:

```powershell
Get-Content -LiteralPath 'C:\Users\farew\Desktop\il-it-da\supabase\migrations\038_owner_staff_email_otp.sql' -Raw -Encoding UTF8
```

재현 명령: `npm run typecheck`, `npm run test:auth`, `npm run check:integration`, `npm run check:frontend`, `git diff --check`.

브라우저 검사: 로컬 dev 서버 3100을 실행한 후 `node --test tests/auth/owner-staff-signup-ui.test.mjs`. Windows는 설치된 Edge를 사용한다. 다른 OS는 Playwright Chromium이 필요하다. 다른 포트는 `SIGNUP_UI_TEST_URL`로 지정할 수 있으며 localhost만 허용한다.

## 미검증·배포 보류 항목

- 로컬 PostgreSQL의 실행·기본 grants/RLS·동시 요청·잠금 대기·재적용·롤백은 위 결과로 검증됐다. 공유 DB의 의존 테이블/9개 컬럼·OTP 객체 부재·역할 상속 조회 0행·service_role RLS 우회·public USAGE·기본 ACL·내부/비 INSERT Auth 트리거는 **사용자 제공 사전 결과**로 기록했다. **공유 버전·실행자 권한·Auth Hooks·정식 적용·적용 후 권한/호환성은 미검증**이다.
- 실제 발송 시간 초과·부분 성공·네트워크 단절·외부 클라이언트의 직접 Auth 동시 가입, SQL 예약 보존/정리 정책, 운영 재시도·롤백 절차는 미검증이다. 이번 검증은 함수의 DB 동작이며 실제 Auth 발송을 실행하지 않았다.
- 공유 프로젝트의 Confirm email, OTP 길이·만료·비밀번호 정책·SMTP·템플릿·Dashboard Auth Hooks 및 제공된 DB 트리거 목록 밖의 부작용.
- 실제 메일 수신과 스팸함, 최신 번호만 유효한지, 사용/만료 번호 거절, 실제 요청 제한.
- 실제 Supabase 세션 쿠키·서명·refresh·브라우저 종료·두 기기 단일 세션 대체. 기존 mock 세션 테스트 통과와 구분한다.
- 실제 Google/Kakao/Apple/Naver 제공자 로그인 및 이전에 발송된 code/token_hash 링크. 공식 SDK/URL/역할 mock 검증을 실제 공급자 검증으로 부르지 않는다.
- 본사 커스텀 이메일 서비스 미연결. 이전 전체 lint/레이아웃 회귀 실패는 해결했지만 실제 수신을 확인하기 전 운영 인증 완료라고 선언하지 않는다.

## 공식 근거

- https://supabase.com/docs/reference/javascript/auth-signup
- https://supabase.com/docs/reference/javascript/auth-verifyotp
- https://supabase.com/docs/reference/javascript/auth-resend
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/auth/sessions
- 설치/소스 확인: supabase-js 2.115.0, auth-js 2.115.0, ssr 0.12.5. signUp의 password/data 전달, resend의 signup 타입, verifyOtp의 email 타입을 설치 SDK와 대조했다. Next 16.3.4의 설치된 Route Handler 가이드를 읽었다.

## 변경 파일 전체 경로

```text
C:\Users\farew\Desktop\il-it-da\app\(auth)\signup\profile\page.tsx
C:\Users\farew\Desktop\il-it-da\app\(auth)\signup\approval\page.tsx
C:\Users\farew\Desktop\il-it-da\app\api\auth\signup\owner-staff\start\route.ts
C:\Users\farew\Desktop\il-it-da\app\api\auth\signup\owner-staff\verify\route.ts
C:\Users\farew\Desktop\il-it-da\app\api\auth\signup\owner-staff\resend\route.ts
C:\Users\farew\Desktop\il-it-da\app\api\auth\signup\owner-staff\status\route.ts
C:\Users\farew\Desktop\il-it-da\app\api\auth\signup\route.ts
C:\Users\farew\Desktop\il-it-da\app\api\auth\login\route.ts
C:\Users\farew\Desktop\il-it-da\app\api\signup\store-membership\route.ts
C:\Users\farew\Desktop\il-it-da\app\page.tsx
C:\Users\farew\Desktop\il-it-da\lib\auth\auth-email-settings.ts
C:\Users\farew\Desktop\il-it-da\lib\auth\owner-staff-signup.ts
C:\Users\farew\Desktop\il-it-da\lib\auth\owner-staff-signup-server.ts
C:\Users\farew\Desktop\il-it-da\lib\auth\auth-callback.ts
C:\Users\farew\Desktop\il-it-da\lib\auth\server-role-guard-core.ts
C:\Users\farew\Desktop\il-it-da\lib\signup\store-membership-service.ts
C:\Users\farew\Desktop\il-it-da\tests\auth\owner-staff-signup.test.ts
C:\Users\farew\Desktop\il-it-da\tests\auth\owner-staff-signup-ui.test.mjs
C:\Users\farew\Desktop\il-it-da\tests\auth\owner-staff-signup-postgres.test.mjs
C:\Users\farew\Desktop\il-it-da\tests\auth\signup-profile-membership.test.ts
C:\Users\farew\Desktop\il-it-da\tests\auth\require-server-role.test.ts
C:\Users\farew\Desktop\il-it-da\tests\auth\auth-callback.test.ts
C:\Users\farew\Desktop\il-it-da\tests\auth\protected-layouts.test.ts
C:\Users\farew\Desktop\il-it-da\app\hq\approvals\page.tsx
C:\Users\farew\Desktop\il-it-da\app\hq\communication\page.tsx
C:\Users\farew\Desktop\il-it-da\app\hq\manuals\common\page.tsx
C:\Users\farew\Desktop\il-it-da\app\hq\manuals\stores\page.tsx
C:\Users\farew\Desktop\il-it-da\lib\hq\use-client-ready.ts
C:\Users\farew\Desktop\il-it-da\docs\sql\owner-staff-email-otp-migration-draft.sql
C:\Users\farew\Desktop\il-it-da\docs\sql\owner-staff-email-otp-preflight.sql
C:\Users\farew\Desktop\il-it-da\supabase\migrations\038_owner_staff_email_otp.sql
C:\Users\farew\Desktop\il-it-da\docs\sql\owner-staff-email-otp-postflight.sql
C:\Users\farew\Desktop\il-it-da\docs\owner-staff-email-otp-handover.md
```