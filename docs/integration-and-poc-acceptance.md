# 통합 및 PoC 인수 테스트 가이드

## 1. 문서 목적

이 문서는 팀원별 결과물을 `develop`에 병합하기 전후의 검증 절차와 최종 서비스 흐름의 수동 인수 기준을 제공한다. 실제 DB 마이그레이션 적용, 배포, API 호출 또는 데이터 수정을 자동 수행하지 않는다.

문서와 테스트 증거에는 실제 계정, 비밀번호, 인증번호, UUID, 토큰, Cookie, Authorization 헤더 또는 환경변수 값을 기록하지 않는다.

상태 표기는 다음과 같다.

- **READY**: 저장소 코드 또는 자동 테스트로 현재 확인 가능
- **PARTIAL**: 기반은 있으나 연결 또는 실환경 검증이 남음
- **BLOCKED**: 선행 구현이나 외부 준비가 없어 현재 실행 불가
- **TBD**: 계약 또는 담당자 인계자료 확인 필요

## 2. 현재 확인된 시스템 범위

| 영역 | 현재 구현 상태 | 확인 근거 | 외부 의존성 | 상태 |
|---|---|---|---|---|
| 로그인 | 로그인 UI와 Supabase 비밀번호 로그인 호출 존재 | `app/page.tsx`, `/login` 라우트 | 실제 계정, Supabase Auth | PARTIAL |
| 회원가입 | 역할·프로필·매장 선택·승인 UI 라우트 존재 | `app/(auth)/signup/**` | 007·008 및 실제 가입 API 계약 | BLOCKED |
| 역할 | `profiles.role`이 `hq \| owner \| staff`로 제한됨 | `006_auth_store_memberships.sql` | 적용된 DB 확인 | PARTIAL |
| 매장 | `stores`, `manuals.store_id`, 매장 검색 API 존재 | 004 migration, `/api/stores/search` | 실제 DB와 권한 정책 | PARTIAL |
| 매장 소속 | `store_memberships`와 self-read RLS 정의 | 006 migration | 실제 row 생성은 008 범위 | BLOCKED |
| 승인 | `pending \| approved \| rejected` 제약 존재, 일부 UI는 session storage 사용 | 006 migration, 가입 승인 UI | 승인 API와 실제 권한 계약 | BLOCKED |
| 매뉴얼 | 승인 매뉴얼 조회, 청크 upsert 및 매장별 검색 코드 존재 | `index-approved-manual.ts`, 005 migration | 실제 Supabase 데이터와 OpenAI embedding | PARTIAL |
| RAG 질문 | `{ question, storeId }` 검증, 검색·3단계 응답 구현 | `/api/rag/query`, RAG 테스트 | Supabase/OpenAI 및 인덱싱 데이터 | PARTIAL |
| 질문 로그 | 독립 저장 helper와 단위 테스트 존재 | `save-question-log.ts` | query route에 아직 미연결 | PARTIAL |
| QA 평가 도구 | 변환·검증·평가·비교·분석 명령과 테스트 존재 | `package.json`, `scripts/rag-eval/**` | 실평가 시 실행 중인 RAG API | READY |
| 통합 점검 도구 | 정적 점검 CLI와 테스트 존재 | `npm run check:integration` | Git 실행 가능 환경 | READY |

현재 API route는 `/api/rag/query`, `/api/rag/upload`, `/api/stores/search`, `/api/webhooks/index-manual`이다. 007·008·009 migration은 현재 저장소에서 확인되지 않는다.

## 3. 팀원별 인계 항목

| 담당자 | 담당 범위 | 받아야 할 파일/PR | 반드시 확인할 계약 | 충돌 가능 파일 | 현재 상태 |
|---|---|---|---|---|---|
| 공태현 | 007·008, 인증·회원등록 및 백엔드 기능 | 브랜치명·PR·파일 목록 TBD | 006 역할/소속 제약, Auth 처리, RLS, service role 서버 한정 | 인증 route, migration, Supabase server 코드 | BLOCKED |
| 송채현 | 프론트엔드 UI | 브랜치명·PR·파일 목록 TBD | API 요청/응답, 역할별 이동, 승인 전 접근 제한 | `app/**`, `components/**` | TBD |
| 양재헌 | Supabase 매뉴얼 등록 및 연동 | 브랜치명·PR·DB 인계자료 TBD | 실제 scope 컬럼, `store_id`, 승인·인덱싱 흐름 | manual 관련 migration/API/lib | TBD |
| 반영민 | QA 질문셋 | 브랜치명·PR·질문셋 파일 TBD | 질문 ID, schema, 매장 격리, 기대 상태/키워드 | QA dataset 및 평가 fixture | TBD |
| 팀장/통합 담당 | 병합, 계약 검증, 테스트, 안정화 | 각 PR과 commit SHA | 변경 범위, CI, DB/API 계약, P0/P1 | 공유 설정·route·migration | PARTIAL |

## 4. PR 병합 전 공통 절차

작업 트리가 dirty이면 변경 소유자를 확인하기 전에는 pull 또는 merge하지 않는다. 타인의 변경을 `git restore`로 제거하거나 `reset --hard`로 정리하지 않는다.

```powershell
git status
git fetch origin
git diff --check
npm run check:integration
npm run lint
npx tsc --noEmit
npm run test:rag
npm run test:rag-eval
npm run test:integration
npm run build
```

| 명령 | 성공 기준 |
|---|---|
| `git status` | 예상한 파일과 브랜치만 표시되고 소유 불명 변경이 없음 |
| `git fetch origin` | 원격 참조 갱신 성공. 로컬 파일을 자동 병합하지 않음 |
| `git diff --check` | 공백 오류나 충돌 잔여물 없음 |
| `npm run check:integration` | `PASS`, exit 0. warning은 담당자가 검토 |
| `npm run lint` | error 0. 기존 warning은 별도 추적 |
| `npx tsc --noEmit` | exit 0 |
| `npm run test:rag` | 모든 RAG 테스트 통과 |
| `npm run test:rag-eval` | 모든 QA 평가 도구 테스트 통과 |
| `npm run test:integration` | 모든 통합 점검 테스트 통과 |
| `npm run build` | production build와 TypeScript 단계 성공 |

환경변수 값이 보이는 화면은 캡처하거나 공유하지 않는다.

## 5. 권장 병합 순서와 게이트

실제 순서는 PR 의존성과 담당자 합의에 따라 변경할 수 있다.

| 단계 | 병합 전 확인 | 병합 후 검사 | 중단 기준 | 다음 단계 조건 |
|---|---|---|---|---|
| 1. 인증·회원등록 기반 | 006 호환성, 007·008 리뷰, Auth/RLS 경계 | 공통 명령 전체, 역할별 최소 smoke test | migration 중복, 인증 우회, P0/P1 | 가입·로그인 계약 확정 |
| 2. 매뉴얼 DB 연동 | 실제 컬럼·scope·승인 계약 | 통합 검사, RAG 테스트, 매뉴얼 수동 검증 | 다른 매장 노출, draft 인덱싱 | 승인 데이터의 검색 가능 확인 |
| 3. 프론트 UI | API 계약과 route 이동표 | lint, typecheck, build, 역할별 브라우저 테스트 | 잘못된 role/store 접근 | 주요 UI 흐름 통과 |
| 4. QA 데이터 | schema와 개인정보 검토 | 변환, validator, RAG-eval | 중복 ID, 민감정보, schema 오류 | 핵심 질문셋 확정 |
| 5. 통합 담당 기반 코드 | 질문 로그·통합 CLI 변경 보존 | 모든 자동 검사 | 응답 계약 변경, 보안 경고 | 독립 모듈 회귀 없음 |
| 6. 최종 연결·안정화 | 남은 TBD/BLOCKED 목록 | 전체 자동·수동 인수 테스트와 CI | P0/P1 또는 데이터 격리 실패 | 완료 기준 전부 충족 |

## 6. DB·마이그레이션 통합 확인

- [ ] 숫자 접두사 중복이 없다.
- [ ] 006과 새 007·008의 테이블·컬럼·제약이 중복되지 않는다.
- [ ] 애플리케이션 코드가 `auth.users`를 직접 insert/update/delete하지 않는다.
- [ ] `profiles.role`은 `hq | owner | staff` 계약을 유지한다.
- [ ] `store_memberships.role`은 `owner | staff`이다.
- [ ] `store_memberships.status`는 `pending | approved | rejected`이다.
- [ ] 점주와 직원의 승인 주체 및 권한을 007·008 실제 코드에서 확인한다. **BLOCKED**
- [ ] 매장 생성 주체와 생성 시 membership 처리를 실제 코드에서 확인한다. **BLOCKED**
- [ ] profiles와 membership의 self-read RLS 및 추가 정책을 리뷰한다.
- [ ] service role은 서버 내부에서만 사용한다.
- [ ] 실제 DB 적용 전에 SQL과 실행 순서를 리뷰한다.
- [ ] 운영 DB에서 임의 롤백 SQL을 실행하지 않는다.
- [ ] Git에 migration 파일이 존재하는지와 대상 DB에 적용됐는지를 별도로 확인한다.

007·008·009가 현재 없으므로 구체적인 신규 테이블·함수·endpoint는 **TBD**이다.

## 7. 매뉴얼 통합 확인

- [ ] Supabase 실제 등록 건수는 양재헌 팀원 인계자료와 DB에서 확인한다. **TBD**
- [ ] M Coffee와 B Burger 데이터가 구분된다. **TBD**
- [ ] 공통 매뉴얼과 매장별 매뉴얼의 실제 표현 방식을 확인한다. **TBD**
- [ ] `scope_type` 또는 대체 scope 컬럼이 실제 DB에 있는지 확인한다. 현재 migration에서는 확인되지 않는다.
- [ ] `manuals.store_id`와 대상 매장이 논리적으로 일치한다.
- [ ] 상태가 `draft | approved` 제약과 일치한다.
- [ ] 승인된 매뉴얼만 `indexApprovedManual`에서 조회된다.
- [ ] 001 초기 M Coffee 데이터와 팀원 데이터가 중복되지 않는다.
- [ ] 승인 후 `manual_chunks`가 생성 또는 upsert된다.
- [ ] 재인덱싱 후 남은 오래된 청크가 제거된다.
- [ ] 매장별 검색 RPC에서 다른 매장의 매뉴얼이 섞이지 않는다.

## 8. QA 질문셋 통합 확인

- [ ] `question_id`가 고유하다.
- [ ] 실제 고유 질문 수를 확인한다.
- [ ] 상황 번호만 바꾼 의미상 중복을 제거한다.
- [ ] `target_store`, `question_type`, `expected_status`가 채워져 있다.
- [ ] `expected_keywords`, `forbidden_content`, `manual_scope`, `category`를 검토한다.
- [ ] 매장 격리 질문이 포함된다.
- [ ] answered/cautious/insufficient 분포가 의도와 맞는다.
- [ ] 실제 개인정보·계정정보가 포함되지 않는다.

```powershell
npm run convert:rag-dataset -- --input <input.csv> --output <output.json>
npm run validate:rag-dataset -- --input <question-set.json>
npm run analyze:rag-dataset -- --input <question-set.json>
npm run eval:rag-dataset -- --input <question-set.json> --stores <store-map.json>
npm run compare:rag-reports -- --baseline <baseline.json> --candidate <candidate.json>
```

경로 placeholder는 비민감 로컬 파일로 대체한다. 실제 평가 전 각 명령의 `--help`로 현재 옵션을 재확인한다.

## 9. PoC 인수 테스트 환경 준비

- [ ] 로컬·공유 개발·운영 중 대상 환경을 기록한다.
- [ ] `npm run dev`로 개발 서버를 실행한다.
- [ ] 필요한 환경변수 **이름의 존재 여부만** 확인하고 값은 문서에 쓰지 않는다.
- [ ] 테스트 계정은 별도 보안 채널에서 관리한다.
- [ ] 역할·매장별 테스트 계정을 준비한다. **BLOCKED: 007·008 계약 필요**
- [ ] 승인 매뉴얼 인덱싱 완료 여부를 확인한다.
- [ ] 브라우저 시크릿 창 또는 깨끗한 세션을 사용한다.
- [ ] DevTools Network에서 상태 코드와 응답 shape만 확인한다.
- [ ] 테스트 결과 캡처 위치: **TBD**

## 10. 역할·가입·승인 테스트

| ID | 사전 조건 | 실행 절차 | 기대 결과 | 실제 결과 | 상태 | 증거 |
|---|---|---|---|---|---|---|
| AUTH-001 | 007·008 적용 및 본사 가입 계약 | 본사 가입 흐름 수행 | 실제 계약에 따른 계정·profile 생성 | 미실행 | BLOCKED | TBD |
| AUTH-002 | 등록된 본사 계정 | 로그인 후 본사 route 접근 | 세션과 역할에 맞는 화면 이동 | 미실행 | BLOCKED | 상태 코드·경로 |
| AUTH-003 | 007·008 및 점주 가입 계약 | 점주 가입과 매장 정보 제출 | owner pending 소속 생성 여부 확인 | 미실행 | BLOCKED | TBD |
| AUTH-004 | 승인 전 점주 | 보호 화면 직접 접근 | 실제 접근 정책에 따른 제한 | 미실행 | BLOCKED | 상태 코드·경로 |
| AUTH-005 | 승인 권한 본사 계정 | 점주 승인 수행 | membership이 일관된 approved 상태 | 미실행 | BLOCKED | 상태 변화 |
| AUTH-006 | 승인된 점주 | 재로그인 후 점주 화면 접근 | 승인된 역할·소속만 접근 | 미실행 | BLOCKED | 경로 |
| AUTH-007 | 기존 매장과 007·008 | 직원 가입 및 매장 선택 | staff pending 소속 생성 여부 확인 | 미실행 | BLOCKED | TBD |
| AUTH-008 | 승인 전 직원 | 직원 보호 화면 접근 | 실제 접근 정책에 따른 제한 | 미실행 | BLOCKED | 상태 코드·경로 |
| AUTH-009 | 승인된 점주와 pending 직원 | 직원 승인 수행 | 같은 매장 권한 내 승인 | 미실행 | BLOCKED | 상태 변화 |
| AUTH-010 | 승인된 직원 | 재로그인 후 직원 화면 접근 | 승인된 매장 범위 접근 | 미실행 | BLOCKED | 경로 |
| AUTH-011 | 인증 흐름 준비 | 잘못된 인증번호 제출 | 상세 오류 계약은 007 확인 후 확정 | 미실행 | TBD | error code |
| AUTH-012 | 만료 가능한 인증 흐름 | 만료 후 번호 제출 | 만료 기준·응답은 007 확인 후 확정 | 미실행 | TBD | error code |
| AUTH-013 | 개발 인증 정책 확인 | 등록되지 않은 개발 테스트 이메일 사용 | 허용/거부 계약은 실제 구현 확인 | 미실행 | TBD | 상태 코드 |
| AUTH-014 | 운영 환경 | 개발 전용 인증 경로 시도 | 개발 우회가 운영에서 동작하지 않음 | 미실행 | BLOCKED | 상태 코드 |
| AUTH-015 | 로그인된 테스트 계정 | 로그아웃 후 재로그인 | 세션 제거 후 정상 재인증 | 미실행 | PARTIAL | 경로 |
| AUTH-016 | 로그인된 테스트 계정 | 새로고침 | 세션 유지 계약대로 동작 | 미실행 | PARTIAL | 경로 |

## 11. 매장·소속 테스트

| ID | 사전 조건 | 실행 절차 | 기대 결과 | 실제 결과 | 상태 | 증거 |
|---|---|---|---|---|---|---|
| STORE-001 | 008 매장 생성 계약 | 점주 가입 중 매장 생성 | store와 owner membership의 원자적 생성 | 미실행 | BLOCKED | TBD |
| STORE-002 | 기존 매장 | 직원 가입에서 매장 선택 | 선택 매장의 pending membership 생성 | 미실행 | BLOCKED | TBD |
| STORE-003 | 서로 다른 점주·매장 | 타 점주 매장 승인 시도 | 권한 밖 승인 거부 | 미실행 | BLOCKED | 상태 코드 |
| STORE-004 | 점주와 타 매장 직원 | 타 매장 직원 승인 시도 | 권한 밖 승인 거부 | 미실행 | BLOCKED | 상태 코드 |
| STORE-005 | 승인된 직원 | 서버가 확인한 소속 조회 | 승인 membership의 store 식별자 일치 | 미실행 | BLOCKED | 비식별 증거 |
| STORE-006 | 소속 없는 직원 | 매장 보호 기능 접근 | 접근 거부 | 미실행 | BLOCKED | 상태 코드 |
| STORE-007 | 매장 변경 기능 계약 | 소속 변경 후 기존/신규 접근 | 권한 재검증 계약대로 동작 | 미실행 | TBD | 상태 코드 |

## 12. 매뉴얼·RAG 테스트

**현재 코드 기준** 임계값은 answered $\ge 0.60$, cautious $\ge 0.40$이면서 $< 0.60$, insufficient $< 0.40$ 또는 검색 근거 없음이다. 발표자료의 다른 값보다 현재 코드를 기준으로 판정한다.

| ID | 사전 조건 | 실행 절차 | 기대 결과 | 실제 결과 | 상태 | 증거 |
|---|---|---|---|---|---|---|
| RAG-001 | 승인된 공통 매뉴얼 | 해당 업무 질문 전송 | 실제 scope 계약에 맞는 근거 응답 | 미실행 | BLOCKED | status·matchCount |
| RAG-002 | 승인된 매장 전용 매뉴얼 | 소속 매장 ID로 질문 | 해당 매장 근거만 사용 | 미실행 | PARTIAL | source 범주 |
| RAG-003 | 두 매장의 구분 데이터 | 같은 질문을 매장별 실행 | 005 RPC의 `store_id` 필터대로 격리 | 미실행 | PARTIAL | matchCount |
| RAG-004 | 최종 similarity가 answered 범위인 데이터 | 질문 전송 | `status=answered`, source 제공 | 미실행 | PARTIAL | status·similarity |
| RAG-005 | 최종 similarity가 cautious 범위인 데이터 | 질문 전송 | `status=cautious`, 주의 문구 포함 | 미실행 | PARTIAL | status·similarity |
| RAG-006 | 최종 similarity가 낮은 데이터 | 질문 전송 | `status=insufficient`, source null | 미실행 | PARTIAL | status·similarity |
| RAG-007 | 검색 결과 없는 매장/질문 | 질문 전송 | similarity/source null, matches 빈 배열 | 미실행 | PARTIAL | 응답 shape |
| RAG-008 | 유효한 매장 ID | 공백 질문 전송 | HTTP 400 | 미실행 | READY | 상태 코드 |
| RAG-009 | 잘못된 매장 식별자 | 질문 전송 | HTTP 400 | 미실행 | READY | 상태 코드 |
| RAG-010 | 유효한 매장 ID | 2000자와 초과 입력 각각 전송 | 2000자 허용, 초과는 HTTP 413 | 미실행 | READY | 상태 코드 |
| RAG-011 | 인젝션 문구가 포함된 매뉴얼 | 질문 전송 | 매뉴얼 내 지시를 신뢰하지 않음 | 미실행 | PARTIAL | 테스트 ID |
| RAG-012 | 인젝션 문구가 포함된 질문 | 질문 전송 | 시스템 규칙을 변경하지 않음 | 미실행 | PARTIAL | 테스트 ID |
| RAG-013 | draft 매뉴얼 | 인덱싱 또는 검색 시도 | 승인되지 않은 매뉴얼은 대상에서 제외 | 미실행 | READY | 상태 코드 |
| RAG-014 | approved 매뉴얼 | 승인 후 인덱싱 실행 | 청크 생성 후 검색 가능 | 미실행 | PARTIAL | chunkCount |
| RAG-015 | 이미 인덱싱된 매뉴얼 | 재인덱싱 | 동일 키 upsert 및 오래된 청크 정리 | 미실행 | PARTIAL | chunkCount |
| RAG-016 | 외부 서비스 오류 조건 | query 실행 | HTTP 500 일반 오류, 키·토큰 비노출 | 미실행 | PARTIAL | 상태 코드·error code |

실제 similarity 값을 사전에 만들지 말고 실행 결과를 기록한다.

## 13. 질문 로그 테스트

현재 저장 helper는 존재하지만 `/api/rag/query`에서 호출하지 않는다. 현재 `question_logs` 계약에는 `user_id`, `store_id`, idempotency 식별자가 없다.

| ID | 사전 조건 | 실행 절차 | 기대 결과 | 실제 결과 | 상태 | 증거 |
|---|---|---|---|---|---|---|
| LOG-001 | helper 단위 테스트 | answered 입력 테스트 실행 | 정확한 snake_case payload | 자동 검증 | READY | 테스트 결과 |
| LOG-002 | helper 단위 테스트 | cautious 입력 테스트 실행 | status 보존 후 1회 writer 호출 | 자동 검증 | READY | 테스트 결과 |
| LOG-003 | helper 단위 테스트 | insufficient null 입력 실행 | similarity/source null 저장 가능 | 자동 검증 | READY | 테스트 결과 |
| LOG-004 | route 연결 완료 | 저장 실패를 주입해 query 실행 | 정상 RAG 답변 유지 | 미실행 | BLOCKED | route 미연결 |
| LOG-005 | helper 및 query 로그 검토 | console 출력 관찰 | 질문·답변 원문 미출력 | 부분 검증 | PARTIAL | 정적 검사·테스트 |
| LOG-006 | route 연결 및 재시도 | 동일 요청 재시도 | 중복 가능성을 기록하고 수량 확인 | 미실행 | BLOCKED | 중복 방지 계약 없음 |
| LOG-007 | 007·008 및 로그 schema 확장 | 사용자·매장 연결 검증 | 실제 추가 계약에 따라 검증 | 미실행 | BLOCKED | TBD |

## 14. 보안 테스트

| ID | 확인 방법 | 기대 결과 | 자동/수동 | 상태 |
|---|---|---|---|---|
| SEC-001 | 브라우저 bundle과 Network 확인 | service role이 노출되지 않음 | 수동 + 정적 검사 | PARTIAL |
| SEC-002 | `npm run check:integration` | 공개 변수명에 service role 없음 | 자동 | READY |
| SEC-003 | 정적 검사와 서버 로그 검토 | Authorization/Cookie 원문 미출력 | 자동 + 수동 | PARTIAL |
| SEC-004 | 정적 검사와 helper 테스트 | 질문·답변 원문 console 미출력 | 자동 | READY |
| SEC-005 | `npm run check:integration` | 실제 환경 파일이 Git에 추적되지 않음 | 자동 | READY |
| SEC-006 | 두 매장 계정으로 접근 | 다른 매장 데이터 접근 거부 | 수동 | BLOCKED |
| SEC-007 | 미승인 계정으로 보호 route 접근 | 접근 거부 | 수동 | BLOCKED |
| SEC-008 | API 오류 응답과 서버 로그 확인 | 키·토큰 비노출 | 자동 + 수동 | PARTIAL |

## 15. 실패 원인 분류표

| 증상 | 가능 원인 | 확인 위치 | 안전한 조치 | 담당 |
|---|---|---|---|---|
| 로그인 400/401 | 요청 계약, 계정 상태, Auth 설정 | Network 상태 코드, 로그인 코드 | 비민감 error code 확인 후 인증 담당에게 전달 | 공태현 |
| 로그인 200 후 루트 이동 | role/profile 또는 route guard 불일치 | 세션 상태, profile 조회, 이동 경로 | 계약과 실제 role만 대조 | 공태현·송채현 |
| 가입 인증 실패 | 007 인증 계약 또는 만료 | 007 PR, 응답 error code | 재현 정보만 기록하고 구현 계약 확인 | 공태현 |
| 승인 후 접근 불가 | membership 상태·세션 갱신 불일치 | 006 제약, 승인 API, guard | DB를 직접 고치지 말고 승인 흐름 추적 | 공태현 |
| RAG 결과 항상 insufficient | 인덱싱 누락, 매장 불일치, 낮은 검색 점수 | status·matchCount·인덱싱 결과 | 승인·청크·store 연결 순서로 확인 | 양재헌·통합 담당 |
| 다른 매장 결과 노출 | `store_id` 또는 요청 매장 검증 문제 | 005 RPC, query 요청 계약 | 테스트 중단 후 권한·필터 코드 리뷰 | 공태현·양재헌 |
| 매뉴얼 승인 후 검색 안 됨 | webhook/upload 실패 또는 청크 미생성 | indexing 상태 코드·chunkCount | 승인과 인덱싱 단계를 각각 재검증 | 양재헌 |
| 질문 로그 미저장 | route 미연결 또는 writer 실패 | query 연결부, helper 결과 code | route 연결 여부부터 확인 | 통합 담당 |
| build 실패 | 타입·환경 이름·route compile 오류 | build의 비밀정보 없는 오류 요약 | 해당 변경 파일만 최소 수정 | 해당 PR 담당 |
| CI 실패 | 로컬/CI 명령 또는 fixture 차이 | 실패 step과 commit SHA | 동일 명령 로컬 재현 후 담당 PR 격리 | 통합 담당 |
| 마이그레이션 충돌 | 번호 중복 또는 schema 중복 | 통합 CLI, migration diff | 적용 전 담당자와 새 forward 순서 합의 | 공태현·양재헌 |

## 16. 증거와 완료 기준

비민감 증거로 상태 코드, 이동 경로, error code, RAG status, matchCount, similarity, 테스트 케이스 ID, commit SHA, CI 결과를 남길 수 있다.

다음은 남기지 않는다.

- 비밀번호와 인증번호
- 토큰, Cookie, Authorization
- service role key
- 전체 질문·답변 원문
- 실제 개인정보
- 전체 환경변수 값

최종 PoC 완료 조건:

- [ ] 역할별 가입·로그인 성공
- [ ] 승인 구조 성공
- [ ] 매장 소속 격리 성공
- [ ] approved 매뉴얼 인덱싱 성공
- [ ] 3단계 RAG 응답 성공
- [ ] 질문 로그 연결 완료 또는 보류 사유·책임자·후속 일정 명확화
- [ ] QA 핵심 테스트 통과
- [ ] lint, TypeScript, tests, build, CI 통과
- [ ] P0/P1 미해결 문제 없음

## 17. 롤백과 복구 원칙

- 병합 전 브랜치와 commit SHA를 기록한다.
- GitHub PR 단위로 변경과 책임 범위를 추적한다.
- 문제 발생 시 해당 PR의 diff와 계약부터 확인한다.
- 공유 브랜치에서 `reset --hard`를 사용하지 않는다.
- 운영 DB migration을 임의로 되돌리지 않는다.
- 데이터 복구가 필요하면 관리자 확인 후 별도 forward migration을 사용한다.
- 사용자 로컬 변경을 임의로 restore하지 않는다.
- 비밀키가 노출되면 코드 삭제로 끝내지 않고 즉시 키를 회전하고 영향 범위를 확인한다.
