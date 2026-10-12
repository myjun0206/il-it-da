# Integration Readiness Check

이 도구는 팀원 PR 병합 전후에 저장소의 충돌 흔적, 필수 파일과 스크립트, 마이그레이션 이름, RAG 임계값 및 명백한 비밀정보 노출 위험을 읽기 전용으로 점검합니다.

```bash
npm run check:integration
npm run test:integration
```

종료 코드는 다음과 같습니다.

- `0`: 필수 검사를 통과했습니다. warning은 있을 수 있습니다.
- `1`: 병합 또는 배포 전에 해결해야 할 error가 있습니다.
- `2`: CLI 인자나 점검 실행 자체에 문제가 있습니다.

`error`는 통합 차단 문제이며, `warning`은 확인이 필요하지만 검사 실패로 처리하지 않는 항목입니다. `info`는 현재 저장소 상태를 안내합니다. 도구는 어떤 파일도 자동 수정하지 않습니다.

이 검사는 실제 DB 스키마, Supabase/OpenAI 연결 또는 API 동작을 검증하지 않습니다. 환경 파일의 값은 읽거나 출력하지 않고, Git이 추적하는 환경 파일의 이름만 확인합니다. 팀원 작업 범위인 007, 008, 009 마이그레이션은 현재 필수 파일이나 필수 번호로 검사하지 않습니다.

팀원 PR을 병합한 뒤에는 다음 순서를 권장합니다.

1. `npm run check:integration`
2. `npm run test:integration`
3. `npm run test:rag`
4. `npm run test:rag-eval`
5. `npm run lint`
6. `npm run typecheck`
7. `npm run build`

`npm run typecheck`는 `next typegen`을 먼저 실행해 라우트/레이아웃 전역 타입(`LayoutProps` 등)을 생성한 뒤 `tsc --noEmit`을 실행합니다. `.next`가 없는 clean clone에서 `next typegen` 없이 바로 `npx tsc --noEmit`만 실행하면 `Cannot find name 'LayoutProps'` 오류가 발생하므로, 항상 `npx tsc --noEmit` 대신 `npm run typecheck`를 사용하세요.

## PoC 통합 검증 한 번에 실행하기 (`npm run verify:poc`)

위 7단계를 개발자가 매번 순서대로 직접 입력하지 않도록, `scripts/verify-poc.mjs`가 동일한 순서를
자동으로 실행합니다.

```bash
npm run verify:poc
```

- 단계는 반드시 `check:integration → test:integration → test:rag → test:rag-eval → lint → typecheck(npm run typecheck) → build` 순서로 하나씩 실행되며, 이전 단계가 성공해야 다음 단계가 실행됩니다. `typecheck` 단계는 `next typegen`과 `tsc --noEmit`을 함께 포함하므로 clean clone에서도 별도 준비 없이 통과합니다.
- 어떤 단계든 실패하면 그 즉시 중단하고 실패한 단계 이름과 종료 코드만 표준 에러에 출력합니다. 이후 단계는 실행되지 않고, 실패한 단계의 종료 코드가 그대로 프로세스 종료 코드로 보존됩니다.
- 모든 단계가 성공하면 통과한 단계 수와 `PASS`만 표준 출력에 남습니다.
- 이 러너는 각 단계의 명령 전체 문자열, 환경변수 값, 파일 내용, 질문·답변 원문, UUID, API 키, 토큰을 별도로 출력하지 않습니다. 각 자식 프로세스(예: 테스트, 빌드)의 정상 출력은 그대로 콘솔에 표시됩니다.
- Windows PowerShell, macOS, Linux, GitHub Actions에서 동일하게 동작하도록 Node.js `child_process`만 사용하며 셸 전용 문법에 의존하지 않습니다.
- 이 명령은 실제 Supabase/OpenAI 호출을 추가하지 않으며, 기존 `check:integration`/`test:integration`/`test:rag`/`test:rag-eval`/`lint`/`build`가 하던 동작만 순서대로 실행합니다.

## 프론트엔드 품질 게이트 (`npm run check:frontend`)

프론트엔드 작업자(예: UI/페이지/컴포넌트 변경)가 PR을 올리기 전에 로컬에서 미리 실행하는 명령입니다.
`scripts/check-frontend.mjs`는 `scripts/verify-poc.mjs`의 단계 실행기(fail-fast, 실패 단계 종료 코드
보존, `Passed steps: N/N` + `PASS` 출력 계약)를 그대로 재사용합니다.

```bash
npm run check:frontend
```

단계는 반드시 다음 순서로 하나씩 실행되며, 이전 단계가 성공해야 다음 단계가 실행됩니다.

1. `lint`
2. `typecheck` (`npm run typecheck`: `next typegen` → `tsc --noEmit`)
3. `build` (`next build`)
4. `git diff --check` (현재 작업트리의 trailing whitespace/충돌 마커 검사)
5. `test:frontend` (라우트 엔트리 파일 존재, `/hq`·`/boss`·`/staff` 레이아웃의 `requireServerRole`+
   `force-dynamic` 유지, client component가 server-only 역할 가드를 import하지 않는지, 저장소에
   Git 충돌 마커가 없는지 확인하는 정적 구조 테스트)

`git diff --check` 단계는 커밋 전 작업트리 상태만 검사합니다. 이미 커밋된 내용에 남아있는 공백
문제는 잡지 못하므로, 커밋하기 직전에 로컬에서 실행하는 것이 가장 효과적입니다. GitHub Actions는
PR과 develop push 시 동일한 `npm run check:frontend`를 실행해 로컬과 같은 방식으로 검증합니다.

### 프론트엔드 작업 절차

1. 항상 최신 `develop`에서 새 작업 브랜치를 만듭니다. `develop`에 직접 push하지 않습니다.
2. UI 변경과 DB/RAG migration 변경을 같은 PR에 섞지 않습니다.
3. PR을 올리기 전에 `npm run check:frontend`를 실행해 통과를 확인합니다.
4. GitHub Actions의 Quality Gate가 성공한 뒤에만 `develop`에 병합합니다.

## PR 템플릿 사용하기

GitHub에서 develop을 대상으로 PR을 생성하면 `.github/pull_request_template.md`가 자동으로
채워집니다. PR 설명에서 `npm run verify:poc` 통과 여부를 대표 검증으로 기록하고, 개별 명령은
`verify:poc`가 실패했거나 특정 단계만 다시 확인해야 할 때만 추가로 기록하세요. 마이그레이션·환경변수·
보안 점검 항목은 해당 사항이 없어도 지우지 말고 "N/A"로 표시합니다.

## develop 통합 확인과 발표 배포 계획 (2026-10-11)

대상은 원격 develop의 `ceba24ebaf2ce33ea8ca439c5f14b54e811e08ff`다. 이번 확인은 DB 쓰기, 모델 호출, Vercel Import/Deploy, 설정 변경, 추가 commit/push를 포함하지 않는다. 아래 계획은 과거 로컬 미커밋 snapshot 배포안을 대체한다. 기존 비공개/제외 문서는 업로드하지 않는다.

### CI와 로컬 확인

- [develop push CI #232](https://github.com/myjun0206/il-it-da/actions/runs/38125381393): **Success**, 1분 26초. workflow 없음이나 대기 상태가 아니다. annotations에는 이미지 최적화/미사용 변수 경고와 runner 이미지 변경 안내가 있으나 실패 단계는 없다.
- [별도 PR #108 CI #233](https://github.com/myjun0206/il-it-da/actions/runs/38125487567): **Failure**, 1분 46초. 앞선 RAG/평가/fixture 검사는 진행했고 frontend quality gate의 4/5 `git diff --check`가 exit 2로 실패했다. PR 비교 범위에서 `app/hq/manuals/common/page.tsx:221`, `app/hq/settings/page.tsx:66`의 trailing whitespace가 보고됐다. develop push 성공과 별개이며, 이 확인에서 수정/재실행/병합하지 않았다.
- localhost:3000은 현재 통합 checkout의 Next 개발 서버다. 346개 runtime 파일을 HEAD와 비교했고 Windows CRLF 정규화 후 차이가 없으며 Git runtime diff도 없다. root GET은 200이었다. 운영 배포 artifact를 검증했다는 뜻은 아니다.
- 쓰기/외부 요청을 차단한 브라우저에서 직원 챗봇, 공통 매뉴얼, 알림 GET은 200이었다. 가입 profile GET도 200이고 이메일 폼을 확인했다. 질문, 신청, 승인, 파일 업로드는 제출하지 않았다. 직원 세션으로 점주 화면의 전체 기능을 인증 검증한 것은 아니다.
- 가입 UI mock 회귀는 기본 테스트 URL 3100 서버 부재로 실패했으나 process-only `SIGNUP_UI_TEST_URL=http://localhost:3000` 지정 후 통과했다. 기존 환경은 복원했다. HQ/store의 분리된 매뉴얼 업로드 계약도 통과했다. 모든 테스트 API/외부 요청은 mock/차단이다.
- 별도 owner Chromium smoke는 카테고리 화면에서 고정 `지점 매뉴얼 관리` H1을 기다리다 timeout됐다. 최신 화면은 카테고리 view에 그 H1이 없고 detail view에서만 동적 제목을 렌더링한다. stale smoke 기대값은 후속 정비 대상이며, 전체 owner browser smoke가 통과했다고 주장하지 않는다. 이번에는 코드/테스트를 수정하지 않았다.

### 발표 모드

현재 shell과 `.env.local`의 `PRESENTATION_MODE`는 활성화되지 않았다. 기본 정책은 모든 요청을 기존 서비스 권한 검사로 넘기며 가입/일반 서비스에 새 발표 제한을 적용하지 않는다. 로컬 정책/세션 mock 회귀가 통과했다. 실제 현재 서버의 유료 endpoint를 호출해 확인하지 않았다.

발표 모드의 정확한 두 계정/매장/종료시간이 설정돼도 quota RPC가 없거나 응답 오류/불명 상태이면 세션 middleware는 유료 route 실행 전에 **503**을 반환한다. 무료 mock 회귀로 확인한 계약이며 현재 공유 DB에서 RPC를 조회/실행하지 않았다. 성공 예약에만 chat/manual 작업을 허용하고 quota 소진은 429다. 원격 SQL 실행/동시성 검증은 미완료다.

### 배포 소스와 environment

배포 소스는 `myjun0206/il-it-da`의 develop **고정 SHA ceba24e**로 선택한다. 이제 해당 커밋에 검토된 코드가 있으므로 로컬 snapshot/CLI upload가 필요하지 않다. branch 최신값만 선택하지 말고 승인 직전 develop HEAD가 이 SHA인지 확인하고 배포 상세의 commit SHA도 검증한다. 이후 develop이 변경되면 그 새 커밋은 별도 CI/승인 대상이다. 저장소 전체 tracked 파일을 Vercel에 제출하므로 기존 커밋의 문서/fixture/공개 asset도 담당자가 노출 범위를 검토해야 한다.

현재 일잇다 Vercel project/Git 연결/branch mapping은 **미설정**이다. 기존 SMUniverse Hobby와 두 Vibegram 프로젝트는 변경하지 않는다. 공식 [Vercel environments](https://vercel.com/docs/deployments/environments) / [Git 설정](https://vercel.com/docs/git)에 따르면:

1. 새 프로젝트의 첫 배포는 develop에서 생성해도 **Production**이다. Import의 기본 main을 그대로 배포하면 대상 ceba24e가 아니므로 진행하지 않는다.
2. 첫 배포 이후 Production Branch가 main이면 develop은 Preview다. 전용 발표 project의 Production Branch를 develop으로 승인 설정하면 develop은 Production이다. 명칭은 hosting scope이며 실제 고객 출시를 뜻하지 않는다.
3. 전용 발표 project에서 develop/ceba24e를 Production으로 사용하는 안을 권고한다. 기본 stable `*.vercel.app` URL을 사용하고 첫 배포부터 **demo DB/키만 Production scope**에 넣는다. Preview를 병행하면 Preview도 별도 확인한 demo 자원만 연결하고 shared DB key를 복사하지 않는다.
4. Import는 source 선택뿐 아니라 첫 배포를 시작할 수 있다. source/branch, 보호 설정, demo DB/env를 먼저 승인·검토하고, UI에서 정확한 branch/SHA 선택이 불가능하면 멈춘다. 프로젝트 생성 후 Git reference의 SHA로 수동 배포하는 절차도 별도 승인 대상이다. 자동 develop 배포가 이후 미승인 커밋을 노출하지 않도록 trigger/promotion 정책을 확인한다.

필요 이름만 기록한다. public/build: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. server-only: `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SESSION_POLICY_SECRET`, `OPENAI_API_KEY`, `PRESENTATION_MODE`, `PRESENTATION_USER_IDS`, `PRESENTATION_STORE_ID`, `PRESENTATION_EXPIRES_AT`. 이 발표 경로는 Naver/map/Pinecone/Tavily/webhook/indexing secret을 제공하지 않는다. `POC_ISOLATED_BUILD`는 unset, build는 `npm run build` / 일반 `.next`다. 비밀값을 문서/CLI 인자/chat에 쓰지 않는다.

지정된 기존 직원/점주 계정은 email/password로 로그인한다. 발표 모드는 OAuth와 `/auth/callback`을 차단하므로 **Naver/소셜 callback 시연을 약속하지 않는다**. demo DB Site URL은 승인된 stable origin과 일치시키고, 이메일 링크/OAuth를 나중에 별도 허용할 때만 정확한 `/auth/callback` redirect와 정책 변경을 함께 검토한다. 기존 shared Auth/SMTP/provider 설정은 그대로 둔다. 발표 중 앱 계정 제한·만료·호출 제한은 유지하며, host protection을 쓰면 production alias와 immutable URL의 범위를 모두 확인한다. 첫 release 실패 시 이전 건강한 일잇다 배포가 없으므로 중지/철회한다; Vibegram으로 rollback하지 않는다.

### 담당자: 기존 격리 Supabase 프로젝트 확인

- 조직/프로젝트 이름과 비밀이 아닌 project reference, 책임자, 접근 권한, region, 실제 plan을 확인한다. 운영/shared 프로젝트와 다른지 소유자가 명시해야 한다. 빈 store만 있다는 것으로 DB 격리를 판단하지 않는다.
- Free 슬롯/현재 active project 수, pause 상태, DB/egress/storage 사용량, 백업·복구 가능성을 확인한다. dashboard/key 값을 chat으로 보내지 않는다.
- customer 개인정보/운영 매뉴얼 없이 synthetic 자료만 사용하는지 확인한다. demo staff/owner Auth identities와 canonical/brand profiles, 단일 synthetic store의 approved memberships를 확인한다. 새 계정/프로필/승인·seed는 DB/Auth 쓰기이므로 별도 승인 작업이다.
- 필요한 search/atomic manual-write/indexing RPC, manuals/chunks/batches, conversations/messages, question logs/notifications/resolution 계약을 read-only로 대조한다. RLS/SQL grants/storage 접근을 점검하고 service-role 권한이 demo 범위를 우회하지 않는지 확인한다.
- 올바른 프로젝트의 migration history와 실제 schema에서 **041 사용/존재 여부** 및 quota table/function/grants/signature 존재 여부를 확인한다. 읽기 결과 없이 number만 믿거나 재적용하지 않는다. 041과 quota SQL은 **각각 별도 DDL 승인** 전 실행하지 않는다.
- OpenAI key 소유 프로젝트, 사용 모델/실제 요금/허용 범위/사용량·중지 권한을 확인한다. 발표 한도 20 chat/2 manual과 10초 간격은 요청 수 제한이며 US$5 hard cap 보장이 아니다. fixture indexing·입력/context·조건부 해석·embedding·재시도까지 예산에 포함한다.

기존 격리 project 보유 여부는 **미확인**이다. 없다면 신규 project 생성, 검토된 필수 schema/RPC를 의존 순서대로 준비, 두 Auth 계정/프로필/멤버십과 synthetic 매뉴얼/embedding, quota 계약 검증·설정을 별도 승인해야 한다. bulk migration push나 shared dump 복사를 기본값으로 하지 않는다. 041 없이 지원되는 legacy response-kind fallback과 기록 재조회 배지 제한은 유지되며, 발표 live quota RPC는 별도 준비 없으면 503이다.

[Supabase 공식 가격표](https://supabase.com/pricing) 기준 Free는 $0·활성 project 최대 2개·1주 비활성 pause·자동 백업 미포함이며, Pro는 월 $25부터와 $10 compute credit(한 Micro project), 추가 Micro project는 대략 월 $10 compute가 더해진다. 세금·초과 사용·추가 기능은 별도이고 account 실제 요금은 미확인이다. 새 project/계정/자료 생성은 기존 사용자에 승인 소속을 붙이지 않고 demo 안에서만 처리한다. shared DB 대안은 schema 작업을 줄일 수 있어도 로그·알림·색인·요금과 고객 데이터 위험을 공유하므로 이번 승인에 포함하지 않는다.

다음 결정은 Hobby 비상업/교육 적합성, 기존 격리 DB 유무와 담당자, 041/quota read-only 결과와 DDL 허용 범위, API 예산·stop operator, source SHA/Production Branch/환경·보호 정책이다. 이 결정 뒤 별도로 Vercel project/Git 연결·환경 provisioning·1회 배포·모바일 유료 smoke를 승인받는다. main 병합, 새 push, 유료 가입, DB/원격 설정 변경은 이번 확인에서 하지 않았다.

### 출력 잘림 수정과 예약 예산 재검토 (로컬 전용)

2026-10-11 기존 실패 자료에서 공급자 HTTP 200, finish_reason=length, 최초 구조 검증 response_truncated가 확인됐다. 로컬 `app/api/rag/query/route.ts`의 답변 생성 max_tokens를 500에서 **2000**으로 변경했다. 직원 chat은 같은 RAG 함수를 사용하고 답변 모델 생성 경로는 하나다. 조건부 질문 해석은 별도 **300**토큰이다. 위치를 근거로 결정적으로 구성하거나 근거가 없는 경우 답변 모델을 호출하지 않을 수 있다. 잘림 거부, 인용/대상/권한 검증과 자동 생성 재시도 없음은 유지한다. 마지막까지 잘리면 여전히 안전한 500이며 부분 JSON을 답변으로 채택하지 않는다.

사용자 answer는 기존 간결한 해요체/핵심 우선/출처 별도 표시 지침을 유지한다. 필수 supportAssessment 필드를 삭제하지 않고 같은 요구 항목의 동일 chunkId/quote 반복을 피하며 각 요청 항목을 입증하는 최소 원문 구절을 유지하도록 prompt를 보완했다. 실제 출력 길이 감소나 유료 요청의 성공은 아직 측정하지 않았다.

[공식 Standard 가격](https://developers.openai.com/api/docs/pricing) 확인: gpt-4o 입력 $2.50/백만 토큰, 출력 $10/백만 토큰; text-embedding-3-small 입력 $0.02/백만 토큰. cached 할인은 예약에 사용하지 않는다. 공급자 실제 프로젝트/추가 요금 조건은 실행 전에 확인한다.

발표 20질문 예약 예시는 아래와 같다. **입력/색인 값은 검증해야 할 계획 가정이지 현재 코드가 강제하는 최대값이 아니다.** 로컬 tokenizer로 기존 답변 system prompt만 약 3261토큰(schema/chat framing 제외)이었고 prompt 보완으로 입력이 소폭 증가한다. 전체 근거와 schema까지 넣은 token 수를 실행 전 재측정한다.

| 예약 항목 | 계획 상한 | 비용 |
| --- | --- | --- |
| 답변 출력 | 20 x 2000 = 40000 tokens | $0.4000 |
| 해석 출력 | 최악 조건 20 x 300 = 6000 tokens | $0.0600 |
| 답변 입력 | 20 x 12000 = 240000 tokens (schema/framing 포함 예약) | $0.6000 |
| 해석 입력 | 20 x 4000 = 80000 tokens (최근 대화 포함 예약) | $0.2000 |
| 질문 검색 embedding | 20 x 1000 = 20000 tokens | $0.0004 |
| 초기 fixture 색인 + 매뉴얼 쓰기 2회 색인 | 합산 10000 embedding tokens | $0.0002 |
| 합계 | GPT 입력 320000 / 출력 46000 / embedding 30000 | **$1.2606** |

동일 입력/해석/색인 예약에서 이전 답변 500토큰 가정은 $0.9606이었다. 답변 출력 예약 증가분은 30000토큰/$0.30다. **한도가 4배여도 실제 사용량이나 총 비용이 항상 4배라는 뜻은 아니다.** 짧게 종료하면 실제 출력은 한도보다 적고 입력/색인 비용은 별도다. 기존 US$5 예산 제안에는 이 예시 기준 $3.7394가 남지만, 임의의 prompt/색인/동시 실행에 대한 hard cap 보장은 아니다. 20회 quota는 요청 수를 제한할 뿐 달러/토큰 한도를 강제하지 않는다. 입력 또는 전체 색인 예약을 초과하면 실행 전 중단하거나 별도 재승인한다. 색인 HTTP 건수는 chunk/batch 계획을 확정해야 하며 10000토큰을 초과하는 대량 색인·자동 재시도는 포함하지 않는다.

동일 입력의 유료 재검증 **1회 승인안**:

- 정확한 질문: 현재 안전 로그와 브라우저 대화에 실패 질문 원문이 남아 있지 않다. 추측 문구로 대체하지 않는다. 사용자가 원문과 원래 conversation 유무/대상 매장을 확인해야 동일 입력 검증이 된다. 계정·실제 ID는 비공개로 담당자가 대조한다. 기존 성공 질문을 다시 실행하지 않는다.
- 제출: 공식 `/api/staff/chat` POST **1회**, 재시도 0. 답변 생성 최대 1회(출력 2000), 조건부 해석 최대 1회(출력 300), 검색 embedding 최대 1회(입력 예약 1000). 최대 공급자 HTTP 3회, DB 검색/권한 확인은 별도다. 원래 문맥의 질문이라면 동일 문맥을 확인하고 입력 예약 내에서만 실행한다.
- 입력 예약: 답변 12000 + 해석 4000 GPT tokens; 출력 2300; embedding 1000. 위 공식 요금 기준 최대 계획 예약 **$0.06302**, 승인 금액 제안 **$0.10**. 이것은 측정된 원래 요청 비용이 아니며 입력 token 확인 전 실행 승인이 완성된 것이 아니다. 이 1회가 20회 안에 포함되면 이중 가산하지 않는다. 별도라면 발표 총 예약은 $1.32362/질문21회가 되어 quota/승인을 변경해야 한다.
- 데이터 영향: 질문 로그, 기존 대화 메시지 2행/updated_at 또는 새 대화 1행+메시지 2행이 생길 수 있다. insufficient이면 승인된 점주들에게 에스컬레이션 알림과 반복 질문 알림이 발생할 수 있다. 매뉴얼 색인/수정, 회원 신청/승인, 041, quota reset, 자동 cleanup은 포함하지 않는다. 저장 실패 시 부분 효과가 가능하므로 POST를 재시도하지 않고 읽기 감사로 확인한다.
- 성공 기준: 공급자 finish_reason=stop, HTTP/안전 코드 기록, 구조·인용·범위 검사 통과, 간결한 answer와 별도 출처 표시. 요청이 여전히 length로 종료되면 중단하고 원문 출력 없이 안전 metadata만 조사한다. 제한을 계속 늘리거나 자동 재호출하지 않는다.

현재 로컬 변경은 답변 route, answer-prompt, 관련 route/prompt 회귀 및 이 문서다. 기존 owner smoke/문서 변경도 보존되어 있다. 원격 develop `ceba24e`는 여전히 답변 **500**토큰과 이전 prompt이며 이번 지시로 commit/push하지 않았다. 권고 순서는 무료 회귀 완료 -> 별도 승인한 로컬 실제 재검증 1회 -> 결과 확인 -> 별도 commit/push 승인과 CI 확인 -> 새 SHA를 배포 대상으로 확정이다. 사전에 원격 통합이 필요한 팀 정책이면 별도 승인 후 먼저 CI로 보존할 수 있으나 유료 검증 성공으로 표시하지 않는다. ceba24e 배포가 로컬 수정본을 포함한다고 가정하지 않는다.

### 승인된 대표 재검증 1회 결과 (2026-10-11)

US$0.10 승인으로 숭실 승인 직원의 독립 새 대화에서 "아이스 카페라떼 만들 때 우유 몇 ml 넣어?"를 공식 `/api/staff/chat` POST **1회** 제출했다. 이는 원문/문맥이 불명인 과거 `response_truncated` 실패의 동일 재현이 아니라 **대표 재검증**이다. 해석0, 검색 embedding1, 답변 생성1, 재시도0. 매뉴얼 수정/색인, 신청/승인, 041, 설정, 배포, commit/push는 없었다.

제출 전 로컬 개발 전용 `X-RAG-Retest: latte-once` 요청에만 토큰 guard를 연결했다. 정확한 문항/독립 새 대화를 검사하고, 실제 생성 후보의 messages/schema/요청 설정 전체 JSON을 tokenizer로 계산했다. JSON 직렬화 token 수에 **20% + 256 tokens**의 API framing/추정 오차 여유를 더했으며, 여유 포함 입력12000 또는 US$0.10 초과면 답변 모델 호출 전 중단한다. 이미 필요한 검색 embedding 비용도 예약에 합산한다. 이 margin은 공급자 tokenization과 완전히 동일하다는 보장이 아니라 보수적 사전 추정이며 이번 usage와 사후 대조했다. 출력 상한2000과 잘림/인용/권한 fail-closed 검증은 유지했다. tokenizer는 이미 설치된 js-tiktoken1.0.21을 offline/ignore-scripts로 직접 의존성 등록했다. 환경 파일은 바꾸지 않았다.

| 항목 | 실제 결과 |
| --- | --- |
| 생성 후보 | 5개 |
| 로컬 전체 요청 token 추정 | 5429 |
| 여유 포함 생성 입력 예약 | 6771 (<12000) |
| 검색 embedding 입력 | tokenizer39, embedding usage 별도 기록은 없음 |
| 출력 예약 | 2000 |
| 생성 전 합산 비용 예약 | US$0.03692828 (<0.10) |
| 공급자 answer usage | 입력5225 / 출력177 |
| usage 기준 추정 비용 | US$0.01483328 (GPT actual usage + embedding39 추정, Standard 단가; 실제 invoice 아님) |
| 공급자/앱 HTTP | 200 / 200 |
| 완료/판정 | finish_reason=stop, SUPPORTED_ANSWER, cautious |
| 답변 | 아이스 카페라떼를 만들 때 우유는 240ml를 넣어야 해요. 기존 cautious 안내가 별도로 덧붙었다. |

비식별 `[RAG_RETEST_BUDGET]` / `[RAG_RETEST_USAGE]` 진단은 기존 로컬 Next 로그에 기록됐으며 사용자/매뉴얼 ID·질문/근거 원문·키는 이 진단에 넣지 않았다. usage 기록을 위해 추가 호출하지 않았다. 전체 구조·대상·인용 검사 통과 후만 SUPPORTED_ANSWER가 반환됐다.

읽기 감사: 같은 숭실 매장/같은 franchise의 approved **HQ** 매뉴얼 `음료 제조 및 레시피 관리`, category `음료제조`, store_id null, 240ml 본문과 질문 로그의 source를 확인했다. 이번 시간창의 질문 로그1건, 대화 목록 증가1건, 새 대화 메시지2건의 질문/답변이 일치했다. cautious 응답이라 질문 로그 관련 알림0건, 직원 알림 증가0건이었다. 조건부 알림 경로의 성공을 실행한 것으로 확대하지 않는다. 화면의 240ml/출처 표시, 새로고침 후 최신 대화 재조회에서 답변/출처 유지도 확인했다. 같은 문항의 과거 대화 대신 이번 새 대화 ID를 읽기 대조했다. 이 한 문항 성공으로 모든 출력 잘림 또는 모바일 PoC가 해결됐다고 보고하지 않는다.

임시 브라우저 single-use handler와 response observer는 종료 후 제거됐고 POST 수1/남은 route handler0이었다. guard/usage 코드와 token 회귀는 로컬 미커밋 변경이다. 원격 develop은 아직 ceba24e의500토큰이므로 배포 전 별도 반영/CI 승인이 필요하다. 후속 질문·cleanup·quota 적용 또는 추가 유료 호출 승인은 포함되지 않는다.

### 필수 기능 전체 E2E 우선: 준비만, 실행 미승인

우선순위는 **회원가입/인증/승인/매뉴얼/챗봇/에스컬레이션/알림/권한 E2E -> 최종 develop 반영/CI -> Vercel 테스트 배포 -> 실제 모바일 검증**이다. 기존 UI를 새로 만들거나 배포를 먼저 하지 않는다. 이번 준비에는 새 실제 가입/메일/승인/DB 쓰기/AI 호출이 없다. 발표 모드는 정상 서비스 가입/파일업로드 경로를 제한하므로 전체 E2E는 승인된 격리 DB의 정상 서비스 모드에서 먼저 진행해야 한다. 공유 DB를 자동으로 테스트 대상으로 삼지 않는다.

대표 질문 실제 출력177토큰 성공은 **2000 설정의 정상 경로** 증거다. 과거 length 실패의 동일 입력/문맥은 없으므로 과거 잘림 해결 입증이 아니다. 별도 무료 API mock은 tokenizer로 **500 초과/2000 이하**인 유효 synthetic JSON을 구성해 stop 응답200과 짧은 사용자 answer, 요청 max_tokens2000을 확인한다. 같은 JSON이어도 finish=length이면500/GENERATION_UNPARSABLE/저장0/자동 재시도0을 검증했다. 인용1200자·대상·schema 검사는 그대로 유지한다.

공태현의 기존 모바일 기반은 Git blame에서 `d6205c99`의 `components/staff/StaffSidebar.tsx` 모바일 열기/닫기, aria-expanded, lg:hidden, h-dvh sidebar, 로고/축소 배치를 확인했다. 공통 `StaffShell`의 고정 header/main 스크롤은 `baf670e8`(songc6125-code)로 귀속돼 있으므로 이를 공태현 작업으로 잘못 보고하지 않는다. 직원/mobile 제품 코드에는 이번 변경이 없고 기존 sidebar/shell과 반응형 기반을 보존했다. 새 모바일 화면은 만들지 않았다.

#### 재사용 증거와 미검증 연결

| 영역 | 재사용 가능한 기존 자료 | 아직 필요한 연결 |
| --- | --- | --- |
| 챗봇 | 숭실 직원 대표 문항 HTTP200/stop, usage5225/177, HQ240ml source, 로그/대화/새로고침 | 새 가입 직원이 synthetic 매뉴얼을 승인 후 검색하는 동일-run 연결; 177토큰 결과로 긴 응답/모든 질문을 보증하지 않음 |
| 가입/OTP | 현재 가입/OTP validation/resume/re-auth browser mock, Auth 회귀 | 실제 mailbox 수신/재전송/코드 확인 -> password/profile 완성 -> 실제 login까지 최신 설정의 연결 |
| 신청/승인 | 기존 점주 매장 신청/HQ 승인, 직원 추가 신청/점주 승인과 scope GET 마감자료 | 신규 E2E 계정으로 pending 접근거부 -> 정확한 membership 승인 -> profile/권한 갱신 연결 |
| 매뉴얼 | 과거 수동 저장/CSV preview-confirm/child 수정/색인 및 별도 정리 마감 | 최신 팀원 dropzone/review modal에서 실제 신규 synthetic 파일 확인/저장 -> ready -> 직원 검색 연결 |
| 에스컬레이션 | 기존 별도 성공 로그/점주 알림/중복 억제 및 resolution 무료 회귀 | 신규 synthetic 부족 질문 -> 같은 점주 알림 -> 본문 보완 -> 명시 resolution -> 직원 후속 답변 연결 |
| 권한/알림 | 기존 approved store GET·scope guards·mock cross-user/store tests | 신규 pending/다른 role·매장·대화의 live GET 거부와 신규 직원/점주 알림 수신·읽음 반영 |
| 화면 | 가입/owner header/followup 무료 UI 회귀, 팀원 업로드 계약 | owner-pages 전체 mock에 남은 pagination/검색/뒤로가기 fixture 실패; 실제 모바일 Safari/Chrome은 배포 이후 |

최신 로컬 무료 검증: verify:poc, test:auth, test:owner-escalation, test:frontend, retest-budget, signup browser mock, owner-followup UI가 exit0. owner-header UI는 최신 메뉴 `지점 매뉴얼`과 stale 기대 문자열을 맞춘 뒤 exit0. 전체 owner-pages suite의 기존 잔여 실패는 숨기지 않으며 이 준비에서 테스트를 삭제/skip하거나 제품 UI를 변경하지 않았다. 원격 develop ceba24e의500토큰은 미반영 상태 그대로다.

#### 한 번에 승인받을 최소 실제 실행 묶음

1. **선행 자원:** owner-designated 격리 DB의 정확한 프로젝트/region/plan, 필요한 기존 schema/RPC/grants, synthetic 브랜드/매장1개와 승인 HQ1계정을 먼저 확인한다. 있으면 재사용하고 없으면 DB/fixture provisioning을 별도 승인한다. HQ fixture가 없으면 전체 최소 identity는3개(HQ fixture1 + 실제 가입2)다. 041와 발표 quota SQL 적용은 이 승인에 자동 포함하지 않는다.
2. **신규 계정:** 점주/직원 신규 이메일2개(실제 수신 가능한 승인 mailbox), 각1회 signup. 이름/전화/비밀번호는 지정 test data만 쓰고 직접 브라우저 입력한다. 실제 기존 직원/점주에게 test 가입 상태를 덮어쓰지 않는다. 신규 signup/profile/membership 쓰기와 감사 보존을 승인한다.
3. **메일/인증:** start2회 + 직원 resend1회 = 발송 요청3회/메일 최대3통. OTP verify는 owner 정상1 + staff 잘못된 코드1 + staff 정상1 = 최대3회. profile/password complete2회. cooldown은 UI 상태로 확인하고 조기 무제한 resend/expired-flow 반복을 하지 않는다. 실제 SMTP 비용/한도는 공급자 계정에서 사전 확인하며 금액은 미확정이다. SMTP/Auth/provider 설정 변경은 별도 승인 전 금지다.
4. **권한/승인:** 동일 synthetic store로 owner 신청 POST1/직원 신청 POST1. 기존 승인 HQ가 owner membership1회, 승인된 신규 owner가 staff membership1회만 결정한다(결정 PUT 총2). pending 전후 GET과 canonical/brand profile 동기화를 대조한다. 정상 login POST는 최대6회(역할전환/재로그인 포함), 잘못된 password login1회; session 설정/종료는 전환 횟수 내에서만 수행한다. 실제 API 내부 Auth 작업은 이 UI 동작과 별개로 생기므로 요청 ledger로 기록한다.
5. **매뉴얼:** 신규 owner의 category-only POST1, 단일 title/child 수동 POST1, synthetic CSV preview POST1/confirm POST1, 그 CSV child 본문 PATCH1. category1 + 수동parent/child2 + CSVparent/child2 = manual 신규 최대5행, child chunk 초기 최대2개와 수정1회 색인. 파일은 운영 자료가 아닌 별도 TEST 표식1항목 CSV로 준비한다. count/revision/ready를 확인하고 bulk indexing·기존 manual 변경·추가 업로드는 금지한다.
6. **AI/에스컬레이션:** 기존 카페라떼 질문은 재제출0. 새로운 synthetic 질문만 chat POST 최대3회: 등록한 fictional 물품 위치 -> 다른 fictional 물품의 명시되지 않은 기준(부족 근거) -> 점주 보완 뒤 같은 신규 기준 확인. 부족 질문1건의 점주 알림 수신과 알림 read mutation1회, 질문 resolution PATCH1회만 허용한다. 자동 resolution은 성공으로 취급하지 않는다. 반복 알림 threshold를 채우려고 추가 질문하지 않고 기존 성공/회귀를 재사용한다.
7. **GET 권한/복원:** 미인증·pending·wrong role·타 매장·타 사용자 conversation GET 거부, 정상 approved resource GET, browser refresh를 읽기 확인한다. 운영 사용자 내용을 열거나 권한을 변경하지 않는다. 같은 새 대화/로그/source를 연결해 확인하며 실패한 POST를 blind retry하지 않는다.

#### 비용/데이터/정리 상한

모델 최대 예약 제안: chat3회에서 generation<=3 / interpretation<=3 / query embedding<=3, manual 생성/확인/수정의 indexing batch<=3. 실제 해석 불필요 질문을 선택하면 해석은 줄어든다. embedding batch당1회의 조건은 단일 child/chunk preflight로 확인해야 하며 추가 batch/retry가 필요하면 중단한다. 초기 fixture embedding은 별도 자원 준비 비용이며 기존 ready fixture가 없으면 추가 토큰을 예약해야 한다.

입력 예약(answer12000+interpretation4000) x3 = GPT48000, 출력(2000+300) x3 =6900, 검색3000 + 색인5000 = embedding8000 가정이면 Standard 단가 기준 **US$0.18916**이다. 승인 제안은 **AI US$1.00**(초기 fixture indexing도 이 안에 별도 측정/할당)이며 SMTP/Supabase/host 요금은 별도다. 이는 실제 강제 dollar cap이 아니다. 현재 latte-once guard는 승인됐던 대표 문항 전용이므로 새 E2E3문항에 자동 적용된다고 가정하지 않는다. 실제 실행 전에 각 generation의 후보/schema/token+20%/256 margin과 embedding 전체량을 계산하고 세션 누적 예약을 보장하는 실행 방식을 확정해야 한다. input/색인 예약 또는 총 비용을 초과하면 호출 전에 중단한다. 같은 성공 문항을 반복해 예산을 사용하지 않는다.

신규 영향: Auth users2/profile 및 signup-flow 상태, membership2, request/decision notifications(수신자는 승인된 fixture HQ/owner만; 정확한 fan-out은 사전 GET으로 확정), manuals<=5/chunks<=2 초기+revision/index변경1, 업로드 batch 감사 최대2, chat conversations<=3/messages<=6/question_logs<=3, 부족 질문 관련 알림/읽음/resolution 상태. 추가 callback/config/schema 변경 없이 현재 설정이 지원하는 범위만 검증한다. 준비 대상 DB가 없거나 메일이 제한되면 E2E 시작 자체를 막는다.

정리 대상은 이 run의 ledger가 기록한 **정확한 신규 ID와 parent-child/revision**뿐이다. 점주 회원/직원 계정2·membership2·manual<=5/child chunks·신규 conversation/message/log·파생 알림·signup-flow 상태를 dependency 순서로 정리할 권한과 보존 정책을 **별도 cleanup 승인**받는다. 전체 category/이메일패턴 삭제, 기존 데이터 삭제, 테스트가 만든 batch audit의 자동 삭제는 금지한다. 같은 비용 호출을 cleanup 확인용으로 반복하지 않는다. 기존 실제 성공 record와 원장/stash/env는 보존한다.

실행 전 한 묶음 결정: 격리 DB/HQ/synthetic store, 실제 mailbox2와 직접 입력할 테스트 자격정보, 정상 서비스 모드와 role별 scope, 위 mail/signup/decision/manual/chat/read/resolution 횟수, provider 요금/token reservation/AI US$1.00 및 SMTP 상한, 실패 중단 담당자와 별도 cleanup 허용/보존 범위. 이 문서는 실행 승인 요청이며 **전체 E2E를 실행한 결과가 아니다**. 필수 연결의 통합 증거와 남은 무료 fixture gate를 마감한 뒤에만 최종 develop 반영/CI 승인과 Vercel 배포/모바일 검수로 넘어간다.

#### 최신 무료 UI 연결 조사: 5/6, 잔여 gate 미완료

배포보다 필수 기능 검증을 우선하는 후속 조사에서 owner-pages mock을 현재 API의 query/pagination 응답, question origin, 돌아가기 접근성 이름에 맞췄다. 삭제된 HQ store selector를 복원하지 않고 현재 알림/프로필 header controls를 검증한다. 제품 기능·테스트를 삭제하거나 skip하지 않았다. 실제 점주 공지320px flex 자식의 축소가 막힌 것은 loading/loaded wrapper의 `min-w-0`만 보완했고, 같은 Chromium 검사에서 overflow가 사라졌다. 공태현의 직원/mobile shell/sidebar 코드와 기존 반응형 기반은 수정하지 않았다.

현재 suite 결과 **5/6**: HQ loading/error/empty/count/detail, 모든 owner 화면의 header/sidebar/content/overflow, store-switch 및 approval control·question chip·manual drill-down·알림 filter mock, 지점 매뉴얼 본문 저장/재색인 retry, dark surfaces는 통과했다. 남은 한 테스트는 공통 매뉴얼 카드 `shadow:none`을 직원 공지 카드 shadow와 정확히 같게 요구하는 styling assertion이다. 반경8px/border1px는 같고 기능 로딩 오류는 아니지만 전체 suite PASS는 아니다. 세 차례 좁은 보정 이후 추가 편집을 멈췄으며 shadow의 제품 계약을 확인하는 후속 검토가 필요하다. 전체 실제 E2E 실행, 새 메일·가입·승인·AI·DB 쓰기는0이고 기존 대표 성공은 재사용했다. 다음은 이 잔여 무료 gate와 격리 DB/계정/예산 승인을 마감하는 것이며 develop push나 Vercel 배포가 아니다.

후속 명시 승인으로 shadow 근거를 검토했다. 팀원 commit0562cdc가 공통 매뉴얼에 기본 shadow 없음/hover:shadow-md, 직원 공지에 기본 shadow-sm를 각각 명시했고 shared Card의 shadow는 옵션이다. 제품을 통일하지 않고 테스트가 각 계약 및 점주 NoticeCard article 프레임을 측정하도록 수정했다. 최신 owner/HQ Chromium **6/6**, 320px 공지 overflow 재발0, 변경 파일 lint/typecheck 통과. 위5/6은 이전 조사 시점 기록이다. 기존 UI/모바일 코드의 shadow는 바꾸지 않았고 테스트 삭제/skip은 없다.

### 정상 점주 가입 중단: 잔여 완료 flow 중복 안내 조사

2026-10-11T10:54:04.966Z 브라우저에서 점주 `/api/auth/signup/owner-staff/start` POST1이 HTTP409/EMAIL_EXISTS로 끝났다. 서버 로그의 OWNER_STAFF_SIGNUP_START_EMAIL_EXISTS와 연결됐고 정상 verify0/complete0이었다. 이메일/비밀번호/OTP/원본 오류는 이 문서에 기록하지 않는다. 임시 signup guard가 요청을 차단한 건수0으로 실제 서버409이며, 조사 중 guard를 중지한 후 제거해 route0으로 복원했다. 추가 발송/가입 재시도는 하지 않는다.

읽기 확인: 브라우저 Supabase resource host, 서버 환경 host와 사용자 Dashboard project가 같았다. 제공 이메일 정규화 기준 Auth user0(관리 사용자 목록 읽기 완료), canonical/brand profiles0, legacy 요청/OTP record0인데 owner_staff_email_signup_flows의 과거 완료 record1이 남아 있었다. 그 record의 verified/completed 참조 Auth ID를 직접 GET한 결과404, 연결 profile0이었다. 해당 행의 완료 시점/개인 ID/이메일은 비공개로 유지한다. Auth 조회 실패를 '사용자0'으로 처리하지 않았으며 성공적인 목록조회/직접404로 구분했다.

저장소039 SQL은 account_exists=false여도 잔여 flow.completed_at이 있으면 complete를 반환할 수 있고, email-first send 경로는 이를 EMAIL_EXISTS로 매핑한다. 원격 함수 본문을 변경/실행하지 않았으므로 코드와 실제 읽기 자료가 지지하는 원인은 'Auth 삭제 뒤 남은 완료 flow의 중복 안내 오판'이다. 일반 RPC 실패는 이미 unavailable이며 이메일 trim/lowercase/zero-width 정규화도 확인했다.

최소 로컬 수정: start/resend가 complete를 받으면 그 Auth 계정과 정규화 이메일이 실제로 일치하는지 확인한다. 계정404/조회오류/불일치면503/EMAIL_OTP_UNAVAILABLE로 닫아 기존 사용자라는 잘못된 안내와 메일 발송을 방지한다. 실제 계정이 있는 완료 flow는 기존 동작을 유지한다. 이 수정은 잔여 DB state를 제거하거나 새 가입을 자동 허용하지 않는다. 해당 이메일 가입 재시도/flow삭제/계정삭제/설정변경은 별도 결정 전 금지다.

이메일 가입 mock 회귀·수정파일 lint·typecheck 통과. 기존 데이터/환경/stash/팀원 UI는 보존하며 commit/push·SMTP/Auth 설정·메일·DB 변경은 하지 않았다. 실제 가입 E2E는 이 실패에서 중단돼 직원 단계도 시작하지 않았다.

### 삭제된 계정의 정상 재가입 지원안: RPC 초안, 원격 미적용

문구 변경만으로 재가입을 허용하지 않고 기존 start/cooldown/발송 acknowledgement 계약에 연결하는 로컬 변경을 준비했다. 공유 DB의 기존 완료 flow는 삭제/수정하지 않았고 추가 start/메일은0이다.

정확한 적용 후보는 [재가입 SQL 초안](sql/restart-deleted-email-signup.draft.sql)이다. 번호 있는 migration을 추가하거나039/040/041을 재실행하지 않는다. 기존 `prepare_owner_staff_email_first_signup(text,text,text,uuid,uuid)` 정의는 변경하지 않는다. 새 객체는 `owner_staff_email_signup_flow_archive` 테이블1개와 `restart_deleted_owner_staff_email_signup(text,text,uuid)` 함수1개다. 전자는 과거 flow의 요청/완료 상태 JSON을 보관하며 RLS·PUBLIC/anon/authenticated 접근거부, service_role SELECT만 허용한다. 이메일/과거 ID가 포함될 수 있어 audit snapshot을 공개 출력하지 않는다. 함수는 security_definer/search_path 빈값·service_role EXECUTE만 허용한다.

전환 조건: 공식 start의 prepare 응답이 complete이고 이전 completed Auth ID의 admin 조회가 **404 및 user 없음**인 경우에만 서버가 새 RPC를 요청한다. 503/403/transport 오류 또는 성공 응답의 user 없음은 계정 부재로 취급하지 않으며503으로 닫는다. resend는 복구를 시도하지 않는다. 실제 같은 이메일의 완료 계정은 기존 중복차단/정상 완료계정 처리 계약을 유지한다.

새 RPC는 기존039와 같은 normalized email advisory lock39와 flow row lock 안에서 다시 확인한다: 완료 flow/예상 completed ID 일치, 완료·expiry·cooldown이180초 이상 경과한 오래된 상태, 같은 이메일 Auth 및 이전 verified/completed ID Auth 부재, 해당 ID/같은 이메일 profile와 이전 ID 소속 부재. 조건 미충족이면 old flow를 바꾸지 않는다. 통과하면 old request_id 기준 snapshot을 archive에1건 보관하고 active row의 완료/인증/발송 상태를 종료한 뒤 기존 prepare의 start를 호출한다. 기존 start가 새 request ID와60초 cooldown을 예약하며 발송 이후에만180초 verification 창이 열린다. 새 예약이 new가 아니면 SQL exception으로 archive+row 변경을 함께 rollback한다. 예전 request ID의 sent/verify/complete는 새 요청을 진행시키지 못한다.

동시 두 start는 DB에서 예약1개만 얻고 다른 요청은 unavailable/rate_limited로 닫힌다. 앱 send mock에서는 OTP1회만 호출됨을 검증했다. 이 잠금은 **해당 앱/RPC 요청 간** 직렬화를 제공한다. 다른 Auth signup API는 같은 advisory lock을 쓰지 않으므로 SQL 예약 뒤 외부 계정 생성과의 경쟁을 전부 막는다고 주장하지 않는다. 그 경우 실제 공급자 중복/실패 응답을 처리하고 즉시 중단하며, 기존 Auth/profile를 삭제·덮어쓰거나 자동재시도하지 않는다. 공급자 exactly-once delivery 보장이 아니라 이 경로의 중복 앱발송 억제다.

검사: local PGlite SQL에서 old snapshot 보존·fresh request/cooldown·중복 예약 거부·이전 request 무효·기존/이름변경 Auth 보호·ID 및 같은 이메일 profile 보호·소속 보호·새 완료 보호·RLS/EXECUTE·예약 실패 rollback 통과. 앱 무료 mock에서 Auth503시 복구/메일0,404 동시start시메일1·조회실패/없는RPC시발송0·기존계정 보호 통과. 독립 PostgreSQL 프로세스 경쟁 회귀도 기존 테스트에 준비했으나 **로컬 initdb 실행 파일 부재로 미실행/실패**다. PGlite의 동시 호출은 직렬화 engine 검사이며 실제 PostgreSQL 독립 세션 잠금 검증을 대체하지 않는다. 이 검증을 PASS라고 표시하거나 skip으로 숨기지 않는다.

적용 전에 담당자는 실제 대상 RPC body/signature/owner/search_path/grants·039 flow schema·Auth/profile/membership 의존성을 읽기 대조하고 동명 신규 객체가 이미 있으면 중단한다. 초안은 CREATE이므로 blind 재실행하지 않는다. 원격 적용/테스트 start/메일 재시도는 각각 명시 승인 전 금지다. 현재 서버에서 RPC가 없으면503 보호가 남으므로 이번 이메일은 자동 재가입되지 않는다. 직원 가입도 계속 중단 상태다.

영향/복구: 신규 테이블·함수 생성만으로 모든 과거 flow를 일괄 갱신하지 않는다. 승인된 새 start에 대해 조건을 충족하는 flow1개만 전환하며 Auth 사용자를 이 RPC가 생성/삭제하지 않는다. 생성·메일은 그 뒤 기존 Auth 경로다. 실패시 transaction rollback으로 old active row/감사가 원자 보존된다. rollout을 되돌릴 때는 먼저 서버 복구호출을 이전503 보호 코드로 되돌리고/함수 EXECUTE를 별도 승인으로 차단하되 audit table은 보존한다. 전환된 row를 과거 snapshot으로 무조건 덮어쓰지 않는다. 새 Auth/mail/verify/complete가 생겼으면 복원은 새 가입을 훼손하므로 금지한다. 새 예약만 있고 Auth부재·sent/verified/completed가 모두null인 경우에만 담당자가 current request ID/expected state·참조관계 확인 후 별도 transaction/승인으로 대상1행 복원을 검토한다. 감사/flow 삭제·테이블DROP·SMTP/Auth 변경·041 적용은 이 준비 범위에 없다.

### 실제 PostgreSQL 확인 및 재가입 복구 단일 검토표

후속 로컬 확인에서 기존 portable ZIP에 Windows PostgreSQL 실행 파일이 있지만 기존 추출 bin은 비어 있음을 확인했다. 전체 ZIP 추출 시도는 실행 파일을 생성하지 못해 Missing local initdb로 실패했다. 같은 ZIP의 bin/lib/share만 별도 임시 폴더에 추출하고 **PostgreSQL16.15** 실행을 확인했다. 새 loopback-only 임시 cluster의 독립 psql 프로세스로 수정된 경쟁 회귀를 실행해 **1/1 PASS**: 병렬 복구 요청에서 new1/unavailable1, 새 request ID1·archive1, 이어진 기존 start는 rate_limited, 같은 이메일의 실제 Auth 계정은 exists/변경0, 강제 후속예약 실패 시 flow/archive 전체 rollback. Auth/메일 공급자 접속은0이며 cluster/fixture는 테스트가 정리했다. 추출한 도구는 기존 ZIP/폴더를 덮어쓰지 않는 임시 도구 자료다. 앞선 initdb 미검증 기록은 당시 상태이고 이제 해소됐다.

DB 검사는 예약 직렬화와 rollback을 증명하며 실제 공급자 메일 전달을 발생시키지 않는다. 앱의 병렬 start mock에서 send1·조회실패시send0 검증과 함께 재사용한다. 공급자의 delivery exactly-once나 다른 Auth 경로의 동시 계정생성까지 완전히 막는다고 확대하지 않는다. 기존 실제 가입/메일 기록은 반복하지 않았다.

| 검토 항목 | 정확한 변경·순서/권한·영향 | 적용/복구 경계 |
| --- | --- | --- |
| SQL 파일 | `docs/sql/restart-deleted-email-signup.draft.sql` | 초안 그대로 보존, 공유DB 미적용. 번호 migration/041/040 실행 없음 |
| 적용 전 읽기 | 승인된 project에서039 flow schema와 prepare RPC signature/body/owner/grants, Auth/profile/membership 참조·동명 archive/RPC 존재 확인 | 현재 배포함수가 로컬039와 다르면 중단/차이 검토. 새 객체 이미 있으면 blind CREATE/재실행 금지 |
| 적용 순서 | 별도 DDL 승인 후 SQL transaction1: archive table→RLS/grants→restart RPC→execute grants→COMMIT. 그 뒤 서버 start 복구 연결 코드 배포/활성 확인 | 기존 prepare RPC는 재적용/변경하지 않음. 코드가 먼저 존재하고 새 RPC가 없으면503이며 발송하지 않음. 실제 start/메일은 별도 실행 승인 |
| 기존RPC 호환 | prepare_owner_staff_email_first_signup(text,text,text,uuid,uuid) 유지; 새 restart(text,text,uuid)는 같은 email advisory lock39에서 기존 start를 재사용 | new/requestId/expiresAt·60초cooldown/발송후180초창 계약 유지. 기존 complete/verify/resend 계약/정상 계정 보호 유지 |
| 복구 조건 | 앱 Auth getUserById에서404+user없음, start만. DB 재검사로 오래된 완료·예상ID·현재Auth/연결profile/소속 부재 확인 | 조회오류/계정존재/새 완료/상태경쟁은 거부, 재시도 없음. 기존 이메일·변경된 이름의 원계정도 보호 |
| 감사 개인정보 | snapshot은 기존 flow 전체: email,role,request_id,verified_user_id/completed_user_id,requested/available/expires/sent/verified/completed 시각. 추가 archived_at·종료reason | 이메일/사용자ID/인증상태·시간은 개인정보/연결가능 자료. 기존flow schema에는password/OTP/access-refresh token 없음; 실제column 추가 여부를 적용 전 확인. snapshot 전문 공유/로그 금지, 보관기간·관리책임은 승인에서 명시 |
| archive 권한 | RLS 활성; PUBLIC/anon/authenticated ALL revoke, service_role SELECT. restart의 definer만 archive INSERT/active flow UPDATE | table owner/superuser 및 BYPASSRLS 역할은 추가 특권을 가짐. FORCE RLS·기본privileges/다른 role grants는 별도 실제catalog 확인. '누구도 직접 접근 불가'라고 단정하지 않음 |
| 함수 권한 | security_definer/search_path='', PUBLIC/anon/authenticated EXECUTE revoke, service_role EXECUTE grant | 실제 함수owner와 default ACL 확인; 브라우저에service key 노출 금지. 익명사용자가 직접 복구RPC 호출하도록 허용하지 않음 |
| 데이터 영향 | 적용자체는 신규table/function 생성, 기존flow일괄삭제/변경0. 승인된 복구start는oldsnapshot1·active flow1 종료/새예약 | Auth 사용자 생성/삭제는RPC가 하지 않음. 이어진 실제 메일/가입은기존Auth 경로 및 별도승인; 이번에는0 |
| 실패 rollback | archive INSERT/flow UPDATE/prepare start를 같은transaction에 수행; prepare가new아니면55000→전부rollback | 실제PostgreSQL·PGlite로검증. client timeout시임의재호출 대신읽기감사 |
| 운영 rollback | 우선 서버를이전503보호코드로복귀, 필요시RPC execute회수별도승인. archive보존 | 새Auth/메일/verify/complete가있으면oldsnapshot으로덮어쓰기금지. 아무후속상태없는새예약만expectedID/상태잠금대조후별도1행복원검토. tableDROP/기록삭제자동실행0 |
| 다른이메일점주화면 | 기존 `/signup/profile`, role=owner, 조사route0. 사용자직접 새test email/password/OTP 입력 | 입력값/기존브라우저상태를읽거나삭제하지않음. 가입이력없는지입력후기존duplicate검증으로확인; 미리계정부재보장하지않음. 이번에는start/verify/complete자동클릭0 |

공유DB적용·flow삭제·SMTP/Auth설정·commit/push는계속미승인이다. UI/모바일기반·환경파일·stash·기존제외변경을보존한다. 새로운이메일로실제발송을시작하려면현재승인범위와중단조건을확인하고사용자가직접진행하며, 이번환경/화면준비가추가발송승인으로해석되지않는다.

이어진 읽기 전용 Supabase 지도는 [테이블/기능 지도](supabase-feature-map-20261011.md)와 [catalog SQL](sql/supabase-feature-map.readonly.sql)에 기록했다. 현재 환경의 OpenAPI GET200에서 테이블23/RPC36을 확인했으나 application rows/비밀값은 읽지 않았다. 원격에 추가 HQ hierarchy/undo 구조가 있어 코드 literal 참조가 없다고 삭제 대상으로 삼지 않는다. signup_profiles 코드참조/metadata 부재와 response_kind/quota metadata 부재는 담당자 확인 항목이다. DDL/DML/RPC 실행·테이블 삭제는0이고 실제 신규 전체 E2E는 여전히 승인 대기다.