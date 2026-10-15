# 일잇다

본사·점주의 매뉴얼을 직원의 업무 답변으로 연결하는 웹 서비스입니다. 본사 공통 문서와 지점 문서를 분리 관리하고, 승인·색인된 현재 근거로 답변과 출처를 제공합니다. 근거가 부족한 업무 질문은 기록하고 해당 지점의 승인 점주에게 알립니다.

Next.js App Router, React, TypeScript, Supabase Auth/PostgreSQL/pgvector, OpenAI를 사용합니다. 지도·신규 매장 검색은 네이버 Maps/API HUB 선택 기능입니다. 실제 계정·매뉴얼·키는 저장소에 제공하지 않습니다.

## 확인 상태와 제약

| 범위 | 확인 결과 |
| --- | --- |
| main 코드 | CI의 RAG·평가 도구·lint·타입·production build 통과 |
| 로컬 정상 서비스 | 시험 preload 없이 역할별 매뉴얼 등록/ready, 같은 대화의 답변·출처·저장, 점주 알림·보완 후 재질문 확인 |
| Render 공급자 인증 | 키 교체 후 실제 임베딩·생성 HTTP 200과 새 대화 첫 답변·출처·저장 확인. 전체 연속 대화 검증은 별도 필요 |
| 과거 OpenAI 429 | 당시 상세 코드가 기록되지 않아 원인은 소급 확정하지 않음. 별도 조직의 과거 잔액 화면을 교체된 키의 사용 가능 여부로 간주하지 않음 |
| 신규 가입 | 점주/직원은 Supabase 메일 설정·OTP 준비 플래그 필요. HQ 레거시 이메일 발송은 production에서 503으로 차단 |
| 미검증 | 완전히 빈 DB의 전체 신규 설치, 실제 복원 INSERT, 다른 인증 계정의 전체 수명주기 반복, 실행 중 작업 강제 회수 |

ChatGPT 구독과 OpenAI API 프로젝트 결제는 별개입니다. 429 발생 시 프로젝트 Billing·Usage·Limits를 확인하고, 원인 수정 없이 요청을 반복하지 마세요. 기존 답변 기록을 읽은 것은 새 AI 호출 성공이 아닙니다. 공급자/검증/저장 오류를 근거 부족으로 간주하지 않습니다.

공급자 오류는 크레딧 부족·명시된 일시 한도·공급자 인증·프로젝트 권한·원인 미확정 장애로 구분합니다. 자동 재시도는 없으며, 결제/인증 실패는 기다려도 해결되지 않습니다. 직원 세션의 401은 공급자 인증 오류와 별개이므로 정상 재로그인을 확인하세요.

## 설치와 실행

검증 환경은 Node.js 24.18.0이며 CI는 Node 24를 사용합니다. npm과 Supabase 프로젝트, 해당 프로젝트의 승인 계정·DB 계약, 유효한 OpenAI API 프로젝트가 필요합니다.

```bash
git clone https://github.com/myjun0206/il-it-da.git
cd il-it-da
npm ci
```

[.env.example](.env.example)을 로컬 `.env.local`로 복사한 뒤 빈 값을 직접 설정합니다. 키를 채팅·PR·로그에 넣지 마세요.

```powershell
# Windows PowerShell
Copy-Item .env.example .env.local
npm run dev
```

```bash
# macOS / Linux
cp .env.example .env.local
npm run dev
```

기본 접속 주소는 http://localhost:3000/ 입니다. production 동작은 아래처럼 확인합니다. `typecheck`는 clean clone에 필요한 Next 타입 생성도 수행합니다.

```bash
npm run typecheck
npm run build
npm run start
```

이미 사용 중인 포트가 있으면 `npm run dev -- --port 3002` 또는 `npm run start -- --port 3002`를 사용합니다. 일반 서비스에는 시험 guard/preload/phase/원장 기반 요청 제한을 붙이지 않습니다. 서버는 Supabase 세션·역할·승인 소속·매장 범위를 계속 검사합니다.

## 환경변수

`NEXT_PUBLIC_` 값은 브라우저 번들에 포함되므로 빌드 전에 설정하고 변경 후 재빌드합니다. 서버 전용 키에는 이 접두사를 붙이면 안 됩니다. 예제에는 비밀값이 없으며 실제 `.env.local`은 Git에서 제외합니다.

| 이름 | 필수 조건·용도 | 빌드 전 설정 | 서버 전용 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 필수·Supabase 프로젝트 주소 | 예 | 아니오 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 필수·공개 Auth 클라이언트 | 예 | 아니오 |
| `SUPABASE_SERVICE_ROLE_KEY` | 필수·관리 DB 및 매뉴얼 색인 | 아니오 | 예 |
| `OPENAI_API_KEY` | AI/색인 필수·OpenAI 발급 키. Supabase 키와 혼용 금지 | 아니오 | 예 |
| `NEXT_PUBLIC_NAVER_MAP_KEY_ID` | 지도 사용 시·현 Maps 공개 키 ID | 예 | 아니오 |
| `NEXT_PUBLIC_NAVER_MAP_CLIENT_ID` | 지도 키의 대체 이름. KEY_ID가 우선 | 예 | 아니오 |
| `NAVER_SEARCH_CLIENT_ID`, `NAVER_SEARCH_CLIENT_SECRET` | 매장 외부 검색 시·NAVER API HUB 지역검색 인증 | 아니오 | 예 |
| `OWNER_STAFF_EMAIL_OTP_READY` | 신규 점주/직원 가입·메일 설정 확인 후 활성화 | 아니오 | 예 |
| `OWNER_STAFF_EMAIL_FIRST_OTP_POLICY_READY` | 이메일 우선 OTP 가입 정책 확인 후 활성화 | 아니오 | 예 |
| `NEXT_PUBLIC_SIGNUP_EMAIL_OTP_LENGTH` | OTP 정책·현재 6자리. 생략 시 기본 6 | 예 | 아니오 |
| `AUTH_SESSION_POLICY_SECRET` | 선택·세션 정책 서명 전용 비밀값. 생략 시 admin 키 사용 | 아니오 | 예 |
| `SUPABASE_SECRET_KEY` | 선택·일부 admin 경로 대체 키. 모든 색인 경로를 대체하지 않음 | 아니오 | 예 |
| `RAG_INDEXING_SECRET` | 선택·외부 `/api/rag/upload` 사용 시 인증 | 아니오 | 예 |
| `WEBHOOK_SECRET` | 선택·`/api/webhooks/index-manual` 사용 시 인증 | 아니오 | 예 |
| `RAG_RECIPE_SUPPORT_STORAGE` | 선택·대응 DB 저장 계약 확인 후 사용 | 아니오 | 예 |

SMTP/OAuth 공급자 비밀값은 Supabase 콘솔에서 설정합니다. 현재 앱은 별도 SMTP/Resend 환경변수로 HQ 메일 발송을 활성화하지 않습니다. 준비 플래그만 켜도 메일이 발송되는 것은 아닙니다. Maps secret·Tavily·Pinecone 키는 현재 main 서비스 경로에서 사용하지 않습니다.

배포에는 `ILITDA_MANUAL_*`, 시험용 `NODE_OPTIONS`, `POC_ISOLATED_BUILD`, `RAG_TRACE`, `MANUAL_LOOKUP_DEBUG`, `DEBUG_PROFILE_INSERT`를 복사하지 않습니다. 도구별 로컬 진단 설정을 운영 설정으로 취급하지 마세요.

## Supabase와 정상 계정 준비

1. 프로젝트 담당자에게 실제 migration history·현재 스키마·백업 상태를 확인합니다. [supabase/migrations](supabase/migrations)의 **존재하는 파일만** 번호와 의존성 순서로 검토하고, 승인된 누락 migration만 적용합니다. 번호가 건너뛰어 있어도 임의 파일을 만들지 않습니다.
2. Supabase Auth, profiles, franchises, stores, approved store_memberships와 매뉴얼·청크·배치·대화·질문·알림 계약이 필요합니다. vector 확장과 scoped search RPC도 확인합니다. [SQL 읽기 점검 문서](docs/sql/owner-manual-schema-inspection.readonly.sql), [manual write contract 점검](docs/sql/owner-manual-postdeploy.readonly.sql)을 참고합니다. 쓰기 계약 버전 2가 없으면 매뉴얼 쓰기는 안전하게 차단됩니다.
3. 신규 점주/직원 OTP에는 migration 038·039, 이메일 공급자·Confirm Email·발송 템플릿 및 가입 정책 점검이 필요합니다. [OTP 인계](docs/owner-staff-email-otp-handover.md), [이메일 우선 가입 인계](docs/owner-staff-email-first-otp-ux.md)를 참고하고 설정이 검증된 뒤 준비 플래그를 활성화합니다. 기본 예제는 비활성입니다.
4. 선택적인 응답 종류 저장은 migration 041과 [사전 점검](docs/sql/041-conversation-response-kind-preflight.readonly.sql)을 확인합니다. `docs/sql`의 draft/cleanup/demo SQL을 정식 migration처럼 일괄 실행하지 않습니다.
5. 기존 승인 HQ 계정으로 로그인하거나 담당자에게 정상 계정 준비를 요청합니다. HQ는 연결된 브랜드를 사용하고, 점주 요청은 해당 HQ가, 직원 소속은 승인 점주가 정상 UI로 승인합니다. Auth 비밀번호·전역 역할을 SQL로 임의 변경하거나 시험 계정을 사칭하지 않습니다.

**빈 프로젝트의 최초 HQ 계정 생성·메일 발송을 포함한 완전 신규 provisioning은 미검증이며 자동 준비 명령을 제공하지 않습니다.** `supabase/seed.sql`은 QA 자료이며 실제 로그인 계정을 만들지 않습니다. 운영 DB 초기화, seed 일괄 실행, migration 재적용, 권한 우회는 설치 절차가 아닙니다.

## 역할별 사용 순서

| 역할 | 화면 | 정상 사용 |
| --- | --- | --- |
| HQ | `/hq` | 본사 공통 매뉴얼 업로드 → 미리보기/분리 검토 → 확정 → 승인·하위 항목 ready 확인 |
| 점주 | `/boss` | 현재 운영 매장 선택 → 지점 매뉴얼 등록/편집 → ready 확인 → 보류 질문·알림 확인 후 지침 보완 |
| 직원 | `/staff` | 승인된 업무 매장 선택 → 새 대화/기존 기록 → 질문 → 현재 매뉴얼 근거·출처·저장 상태 확인 |

서로 다른 매장의 문서를 섞지 않습니다. 부모의 `parent_only`는 정상이고, 본문 `saved`만으로 검색 완료가 아닙니다. 하위 항목 `ready`, 실패·임베딩 누락 0을 확인하세요. 미색인 항목은 정상 검색 준비 UI에서 재색인하고 중복 업로드로 해결하지 않습니다.

매뉴얼 없음은 정상 근거 부족, 미색인은 준비 안내, 공급자/검증 실패는 시스템 오류입니다. 이전 대화는 질문 해석에만 사용하며 삭제된 근거로 새 사실을 확정하지 않습니다. 실제 근거 부족 질문은 저장 후 해당 매장의 승인 점주에게 연결됩니다. 점주 보완 후 같은 질문을 다시 확인할 수 있습니다. 삭제는 실제 문서·청크에 영향을 주므로 기존 자료를 비우는 것을 기본 시연/설치 단계로 삼지 마세요.

## 검사와 배포

```bash
npm run test:rag
npm run test:rag-eval
npm run check:frontend
```

이 검사는 로컬 mock/정적/빌드 검사이며 공급자 결제·메일 도착·실제 신규 DB 설치·배포 AI 성공을 보장하지 않습니다. 공개 서비스에서 질문하거나 색인하면 API 비용이 발생할 수 있습니다. 사용량 기록은 비차단이며 알 수 없는 토큰을 0으로 만들어 기록하지 않습니다.

- [Render production 설정](docs/render-production-setup.md): Node Web Service, 빌드/실행 명령, HTTPS 로그인/콜백 설정.
- [매뉴얼 수명주기와 검증 경계](docs/manual-lifecycle-stability-20261015.md)
- [매뉴얼 형식 계약](docs/manual-file-format-contract.md), [색인 파이프라인](docs/manual-indexing-pipeline.md)
- [통합 검사 도구](docs/integration-readiness.md): 과거 실행 이력은 당시 상태이며 현재 장애 해소를 의미하지 않습니다.

Render URL은 https://il-it-da.onrender.com/ 이며 서비스 정상화 완료 표시는 아닙니다. 마지막 실제 검사에서는 OpenAI 임베딩 429가 남아 있습니다. Supabase Site URL과 허용 `/auth/callback`, 네이버 Maps Web 서비스 URL을 최종 배포 주소에 맞추세요. `NEXT_PUBLIC_SUPABASE_URL`은 Render 주소가 아니라 Supabase 프로젝트 주소로 유지합니다.
## Naver Maps: Desktop and Mobile

- Set `NEXT_PUBLIC_NAVER_MAP_KEY_ID` to the public key ID for the NCP Maps application. The existing `NEXT_PUBLIC_NAVER_MAP_CLIENT_ID` name remains supported as a fallback; both names use the current `ncpKeyId` SDK parameter. Do not put the secret key in either variable.
- Enable **Web Dynamic Map** for that application in the NCP console. Use a key issued for the current Maps product, not a key from an unrelated service or the legacy Maps product.
- Under **Application > API settings > Web Service URL**, register the actual URLs used to open the app, including the scheme and any development port where required by the console. Desktop `http://localhost:3000` registration does not authorize a phone opening `http://192.168.0.153:3000`. Register your current LAN address, HTTPS deployment URL, or ngrok URL separately; update the registration when that address changes.
- The phone and development machine must be on a reachable network. Open the app using the computer's LAN address, not `localhost` on the phone. Do not use wildcard origins to bypass authentication.
- `NEXT_PUBLIC_` variables are embedded by `next build`. Set the key in the build environment, restart `next dev` after changing local env files, and rebuild/redeploy after changing a production key. Runtime env changes cannot repair a bundle built without the key.
- The SDK is always loaded over HTTPS. A script HTTP 200/onload does not prove successful authentication: the component also handles `navermap_authFailure`, missing SDK constructors, network errors, and loading timeouts. Retry reloads a failed script; an unauthorized URL or incorrect key still needs to be corrected in NCP.
- If the browser reports an authentication failure, check the application/key pairing, Web Dynamic Map activation, the registered URL against the address bar, and whether the failed network request sends that same site as its Referer. Ensure your proxy does not strip Referer or block the HTTPS Maps SDK and tile requests.
