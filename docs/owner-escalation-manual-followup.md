# 점주 에스컬레이션과 기존 매뉴얼 수정 보완

## 2026-10-04 항목 선택·보조 링크 개선

- 매뉴얼 관리 화면의 `parent_manual_id` 그룹과 자식의 원문 본문 표시를 확인했다. 기존 `manualId` deep link는 부모 그룹을 선택한 뒤 해당 자식 ID의 편집 폼을 연다. 이 경로와 매장/질문 복귀 파라미터는 변경하지 않았다.
- 선택 목록은 부모별 `optgroup`으로 구분하며 원문 번호·세부 제목·부모 제목을 표시한다. 선택 요약은 동일한 표시 제목과 부모를 사용하고 실제 자식 ID로 편집 URL을 만든다. 기존 항목 분할 함수와 번호 판별 패턴을 읽기 전용 표시 함수에서 재사용했으며 기존 파싱 결과나 저장된 본문은 변경하지 않았다.
- 번호 없는 자료는 저장된 제목으로 선택할 수 있다. 부모 제목을 그대로 저장한 자식은 본문의 첫 항목 첫 줄을 사용한다. 같은 표시 제목·부모까지 중복되면 원래 행 ID를 추가해 구별하며 임의 항목 번호를 만들지 않는다. 부모·placeholder·타 매장 행은 선택하지 못한다. 재조회 후 유효한 선택은 유지한다.
- 전체 매장 매뉴얼/본사 매뉴얼 확인 링크는 기존 테마·보조 버튼 스타일의 테두리형 링크로 표시한다. native Link/a 의미, 44px 이상 클릭 높이, 키보드 초점과 모바일 줄바꿈을 유지한다. 매장 링크의 `storeId`/`questionId`를 보존하며 본사 링크는 기존 `/boss/manuals` 그대로다. 본사 수정 권한은 추가하지 않았다.
- 기존 GET 응답에 부모/자식 ID·제목·본문이 모두 있어 API 응답 보완은 불필요했다. API/DB/SQL/RPC/저장/검색/임베딩/임계점은 변경하지 않았다. SQL 재적용은 필요 없다.
- 집중 선택/기존 분할 회귀 18/18, 점주 관련 회귀 440/440, mock 브라우저 8/8 PASS. `check:frontend`의 typecheck/build 포함 5/5 PASS(프런트엔드 101/101, lint 오류0/기존 경고65), `check:integration` 오류0/경고0이다.
- Chromium mock에서 1280×900, 390×844, 320×740의 서로 다른 자식 ID·선택 요약·번호 없음·중복 제목·부모 그룹·재조회 선택 유지·로딩/빈 목록/실패·보조 버튼 경로/초점/클릭 높이·가로 넘침을 확인했다. 실제 계정의 공유 매뉴얼/편집 화면 진입·질문 복귀와 모바일 OS native 선택 목록은 이번 작업에서 재검증하지 않았다. 공유 DB 변경·유료 호출·git add/commit/push 없이 기존 브랜치/변경/stash와 dev 서버를 유지했다.

이번 추가 개선에서 변경한 파일의 전체 경로:

```text
C:/Users/myeon/il-it-da/components/owner/QuestionManualFollowup.tsx
C:/Users/myeon/il-it-da/lib/manuals/manual-selection.ts
C:/Users/myeon/il-it-da/lib/manuals/detect-manual-item.ts
C:/Users/myeon/il-it-da/tests/owner/question-manual-context.test.ts
C:/Users/myeon/il-it-da/tests/owner/question-followup-ui.test.mjs
C:/Users/myeon/il-it-da/docs/owner-escalation-manual-followup.md
```

## 2026-10-04 질문 상세 UI 개선: 최신 상태

사용자 확인 결과: 공유 Supabase에 037을 적용했고 `check_manual_write_contract()=2`다. 보류 질문 → 기존 매장 매뉴얼 수정 → 검색 반영 → 직원 재질문 답변을 실제로 확인했다고 전달했다. 이번 UI 작업에서 공유 DB나 실제 계정으로 이를 재검증한 것은 아니다. 아래 이전 절의 공유 DB 미적용 표현은 당시 이력이다.

### 정보와 행동 배치

- 질문 원문을 상세 화면의 첫 제목으로 표시한다. 선택 매장·접수 시각·원인 배지·반복 횟수·처리 상태를 함께 유지한다.
- 관련 매뉴얼 확인·수정을 질문 다음에 배치한다. 선택 전/조회 중/빈 목록/조회 실패를 구분하며 선택한 제목·카테고리·매장 전용 범위와 편집 버튼을 표시한다. 타 매장 행과 부모 카드는 기존 필터로 제외한다.
- 기존 답변·근거 후보는 `aria-expanded`/`aria-controls`가 있는 버튼으로 펼친다. 근거의 현재 본문/과거 전체 근거 아님 설명과 본사 읽기 전용 안내를 유지한다. 편집 가능한 근거가 현재 매장 목록에 있으면 명시적으로 선택할 수 있으며 자동 선택하지 않는다.
- 질문 원문 복사는 보조 버튼이다. 기존 '같은 질문 확인' 핸들러는 안내문만 열었으므로 '직원 재질문 안내'로 이름을 바꿨다. RAG/직원 재질문/직원 답변 전송을 실행하지 않는다.
- 긴 설명은 처리 도움말로 묶는다. 조회 실패·복사 실패·처리 상태 변경 실패/충돌은 접힌 도움말이나 사라지는 토스트에만 넣지 않는다.
- 처리 완료는 본문 스크롤 밖의 하단 행동 영역에 배치해 모바일에서도 콘텐츠를 덮지 않는다. 직원 안내/재질문 결과 확인 안내와 기존 확인창을 유지한다. 처리 중 버튼 비활성화, 수동 시작/완료/다시 처리하기를 보존한다. 가짜 진행률이나 자동 완료는 없다.
- 기존 편집 화면의 저장 성공과 검색 반영 성공 구분, 실패/충돌/미확인 지속 안내, 재처리·최신 내용 조회·질문 복귀는 변경하지 않았다. API/RPC/권한/상태 규칙·파싱/저장/임베딩/검색 계약은 변경하지 않았다. 반복 화면은 동일 후속 처리 컴포넌트를 사용하지 않아 이번 UI 변경에서는 수정하지 않았다.

### 검사와 한계

- `npm run typecheck`: PASS. `npm run test:owner-escalation`: 타입 검사 포함 438/438 PASS.
- `npm run check:integration`: 오류0/경고0, 기존 014/015 번호 누락 안내2.
- `npm run check:frontend`: lint 오류0/기존 경고65, typecheck, production build, diff 공백, frontend 101/101, 5/5 PASS.
- `npm run test:owner-followup-ui`: 실제 상세/후속 처리/공용 Button/Sidebar 코드의 Chromium mock 동작 검사 7/7 PASS. 1280×900, 390×844, 320×740에서 선택·편집 URL·키보드/접기·근거 선택·복사·실패/빈 목록/로딩·재조회·본사 읽기 전용·완료 확인/충돌·중복 클릭 차단·편집/완료 가시성·가로 넘침을 확인했다. 캡처는 OS 임시 디렉터리에 생성하며 저장소에는 추가하지 않는다.
- mock은 인증·현재 매장·API 응답·라우팅 및 Header 경계를 대체한다. 실제 로그인/권한 서버 렌더링/공용 Header의 매장 전환·알림·프로필 동작, 실제 편집 화면 저장/검색 생성·직원 챗봇 품질은 이번 브라우저 검사 대상이 아니다. 실제 계정의 모바일 Safari/Android 및 데스크톱에서 최종 화면·질문 복귀를 추가 확인해야 한다.
- 브라우저 검사 준비: Node 22+와 로컬 Chromium 필요. `npx playwright install chromium` → `npm run check:frontend` → `npm run test:owner-followup-ui`. 기존 설치 버전 Playwright 1.62.1을 devDependency로 명시했다. 검사 HTTP 서버는 loopback 임시 포트만 사용하고 공유 DB/외부 요청을 차단한다.
- SQL은 변경하지 않았으므로 **037 재적용 불필요**다. 공유 DB 변경·유료 API·git add/commit/push를 수행하지 않았고 기존 변경과 stash를 보존했다.

이번 UI 작업에서 변경한 파일의 전체 경로:

```text
C:/Users/myeon/il-it-da/app/boss/questions/[id]/BossQuestionDetailView.tsx
C:/Users/myeon/il-it-da/components/owner/QuestionManualFollowup.tsx
C:/Users/myeon/il-it-da/tests/owner/question-manual-context.test.ts
C:/Users/myeon/il-it-da/tests/owner/question-followup-ui.test.mjs
C:/Users/myeon/il-it-da/package.json
C:/Users/myeon/il-it-da/package-lock.json
C:/Users/myeon/il-it-da/docs/owner-escalation-manual-followup.md
```

## 2026-10-04 부모·범위 및 PostgreSQL 검증 보완: 현재 계약

현재 기준 HEAD는 `420ec1bbe590bfc6e65ee3901ebd8015742f42fd`이다. 브랜치 `fix/owner-escalation-manual-followup`, 기존 변경과 `stash@{0}` 백업을 보존했다. SQL을 정식 037로 승격하고 검증기/관련 테스트/읽기 전용 확인 SQL/이 문서를 갱신했다. 공유 DB 접속·SQL 실행·데이터 변경, 유료 API, 모델/점수/임계점/엑셀 파싱/50문항 QA 변경, add/commit/push/stash 삭제는 하지 않았다.

### 원본과 검증의 구분

- 원본 SQL의 `new\.title`, `select \*`와 검증기 백틱 앞 역슬래시는 모두 없었다. 전달 과정 표시로 판단하며 이를 이유로 파일을 수정하지 않았다.
- `node --check scripts/verify-manual-postgres.mjs` 통과. JavaScript 문법만 확인한 결과다.
- 사용자 제공 실행 결과는 실제 임시 PostgreSQL 17/17 PASS다. 이후 Copilot도 정식 037과 새 배포 후 확인 SQL을 대상으로 검증기를 재실행해 17/17 PASS를 확인했다. SQL 생성/재적용, 트리거, 권한/catalog 판정, 경합/롤백은 아래 합성 fixture 범위에서 검증했다.
- 이전 Docker 부재 `NOT RUN` 기록은 과거 이력이다. 현재 결과로 대체한다. 공유 Supabase 전체 스키마/실제 데이터 검증과는 구분한다.

### 공유 Supabase 구조: 사용자 확인 결과 (2026-10-04)

사용자가 공유 Supabase에서 읽기 전용으로 확인하고 전달한 결과다. Copilot이 공유 DB에 연결하거나 조회한 결과로 보고하지 않는다. 원본 결과를 별도로 재조회하지 않았으며, 확인 시점 이후의 구조 변화는 검증하지 않았다.

| 항목 | 사용자 확인 결과 |
| --- | --- |
| manuals/manual_chunks 사용자 정의 트리거 | 0행 |
| 필수 컬럼 21개 | 모두 존재, 자료형 일치 |
| embedding | extensions.vector(1536) |
| UNIQUE(manual_id, chunk_index) | 존재. 고유 인덱스 유효/준비/즉시 적용 확인. 앞서 사용자 확인한 partial/expression 아님도 포함 |
| service_role | 대상 4개 테이블 CRUD 및 BYPASSRLS, public/extensions USAGE 확인 |
| 초안 관련 함수 6개 | 모두 0행: check_manual_write_contract, edit_store_manual_if_current, replace_manual_chunks_if_current, invalidate_changed_manual_chunks, invalidate_manual_parent_chunks, lock_manual_hierarchy_write |

필수 구조·권한 전제는 사용자 확인 결과상 037 요구와 일치하고, 기존 사용자 정의 트리거와의 충돌 대상은 확인 시점에 없었다. 다만 함수 6개는 확인 당시 없었으므로 공유 DB 쓰기 계약은 미준비로 취급한다. 정식 037은 이번 작업에서 공유 DB에 적용하지 않았다. 구조 확인이나 로컬 PASS를 공유 DB 적용 승인으로 해석하지 않는다.

로컬 PostgreSQL **17개 실제 임시 DB 시나리오 모두 PASS**다. 실제 임베딩 생성·챗봇 답변 품질·로그인 브라우저 검증은 이 17개 검사로 입증되지 않았다. 공유 DB 적용이나 데이터 변경은 하지 않았다.

### 확인한 결함과 변경 규칙

기존 초안은 `UPDATE OF parent_manual_id`와 parent ID만 비교하는 조기 return 때문에, 부모 ID를 유지한 자식의 store/franchise/scope 변경을 검사하지 않았다. 부모의 범위 변경에 따른 기존 자식 불일치와 자기 부모/간접 순환도 막지 않았다. 이는 코드 제어 흐름에서 확인한 결함이며 실DB로 재현 완료한 결함으로 보고하지 않는다.

부모 검사 이벤트와 조기 return을 parent_manual_id/store_id/franchise_id/scope_type 전체로 확장했다. 새 자식→부모 관계와 부모→기존 자식 관계를 모두 대조하고 store의 실제 franchise도 검사한다. ancestor 순회에는 visited ID를 사용해 자기 참조와 간접 순환을 거부한다. NULL 조건도 false로 처리해 모호한 상속이 SQL 삼중 논리로 통과하지 않게 했다.

| 변경 | 허용/거부 근거 |
| --- | --- |
| 같은 store/franchise 내 관계 유지·변경 | 허용. 기존 부모/자식 저장 계약이며 metadata·형제·승인을 임의 변경하지 않음 |
| 같은 franchise HQ 공통 부모 → 매장 자식 상속 | 허용. 010의 기존 상속 관계. hq/HQ/common/shared 표시와 store/STORE를 정규화해 관계를 보존하되 기존 검색 RPC의 scope 조건 자체는 변경하지 않음 |
| 자식 store만 변경, parent는 다른 store로 유지 | 거부. 같은 브랜드여도 타 매장 부모 연결 불가 |
| 자식 franchise만 변경, store/parent 유지 | 거부. stores.franchise_id 및 부모 범위와 일치해야 함 |
| HQ 표시인데 store_id가 있거나 store 표시인데 store_id가 없음 | 거부. 010/018의 본사 공통/매장 전용 업무 의미를 기준으로 함 |
| 자식이 있는 부모의 scope 변경 | 모든 기존 자식이 새 범위에 맞는 경우만 허용. 같은 브랜드 store 부모를 HQ 공통으로 바꾸고 store 자식을 유지하는 전환은 가능 |
| 부모 범위를 옮겨 자식과 불일치 | 거부. 한 번의 변경을 롤백. 필요하면 별도 검토된 동일 트랜잭션에서 연결 해제→범위 변경→유효한 재연결 절차가 필요 |
| 자기 부모·간접 순환 | 거부. FK만으로 순환을 막을 수 없어 명시 검사 |

범위 실패는 해당 문장 전체를 롤백한다. 먼저 삭제한 청크/변경한 timestamp도 롤백된다. 유효한 관계·범위 변경은 새 버전과 청크 무효화를 커밋하고 old snapshot 게시는 거부한다. no-op 범위 UPDATE는 관계 검사 후 동일 범위이므로 불필요한 부모 무효화를 수행하지 않는다.

### 잠금·실행 순서·한계

`lock_manual_hierarchy_write`는 manuals INSERT/UPDATE/DELETE의 BEFORE STATEMENT에서 공통 transaction advisory lock을 얻는다. 수정/게시 RPC도 같은 lock을 행 잠금보다 먼저 얻는다. 그 다음 대상 행, 정렬된 old/new 부모 행을 잠근다. 임베딩 생성은 이 DB 트랜잭션 밖이므로 유료 작업 동안 lock을 유지하지 않는다.

이 방식은 관계 변경의 write skew와 변경→부모 lock 대 게시→대상 lock의 역순 위험을 줄이는 보수적 계약이다. 매뉴얼 전체 쓰기·게시를 트랜잭션 동안 직렬화하므로 처리량/오래 열린 트랜잭션 영향은 적용 전 확인해야 한다. 임의 SQL이 먼저 다른 행을 FOR UPDATE하고 이후 이 계약으로 진입하거나, 미검토 trigger/writer가 다른 잠금 순서를 쓰면 교착 가능성은 남는다. 40P01/40001/timeout은 롤백·최신 버전 재조회·제한된 재시도 대상이며 교착 없음으로 보고하지 않는다.

statement lock은 row trigger보다 먼저 실행된다. 같은 BEFORE ROW UPDATE에서는 PostgreSQL trigger 이름 순서에 따라 `invalidate_changed_manual_chunks`가 버전·자기 청크를 먼저 바꾸고 `invalidate_manual_parent_chunks`가 범위·순환·부모/자식을 검사한다. 후자가 실패하면 전자의 변경도 롤백된다. FK 내부 제약 trigger는 별개이며 정상적으로 유지한다. 검토되지 않은 외부 writer/direct chunk 쓰기를 자동으로 보호한다고 주장하지 않는다.

### 기존 DB 호환성: 확인한 저장소 사실과 미확인

- `supabase/migrations/001_initial_rag_schema.sql`: 청크 UUID PK, non-null manual_id, ON DELETE CASCADE FK, chunk_index>=0, vector(1536), `manual_chunks_manual_id_chunk_index_key UNIQUE(manual_id,chunk_index)` 정의.
- `010_franchises_and_hq_manuals.sql`: 브랜드/매장/부모 FK, scope의 nullable/legacy 표시 허용, 본사 공통→매장 상속 설명.
- `019_manuals_parent_cascade_delete.sql`: 부모 FK를 ON DELETE CASCADE로 변경. 내부 RI constraint trigger가 생성되는 것을 이번 gate에서 거부하지 않는다.
- `006_auth_store_memberships.sql`: 자동 updated_at trigger를 추가하지 않는다고 명시. 전체 저장소 migration 검색에서도 manuals/manual_chunks의 사용자 정의 DML trigger 생성은 없었다. profile/owner 삭제용 함수가 존재하는 것과 매뉴얼 DML trigger가 실제 연결된 것은 다르다.
- 사용자 읽기 전용 확인 결과상 공유 DB의 manuals/manual_chunks 사용자 정의 트리거는 0행이다. 이후 timestamp/audit/webhook trigger가 추가되면 준비 검사0을 만들 수 있다. 기존 트리거를 삭제하거나 일괄 허용하지 않았다. 새 트리거는 동일 단계/이벤트 이름 순서, 변경 컬럼, 함수 동작, OLD/NEW 처리, 예외·잠금·외부 side effect를 별도 검토해야 한다.
- 준비 검사의 own trigger 목록에는 새로운 statement lock을 명시 포함했다. 다른 활성 사용자 trigger는 계속 fail-closed 한다.
- 고유성은 이름/pg_get_constraintdef 문자열 대신 pg_index의 unique/valid/ready/immediate, 두 key 컬럼, predicate/expression 없음으로 판정한다. 순서가 반대이거나 INCLUDE가 있는 동일 key 고유 인덱스도 인정한다. 일반 비고유/부분/표현식/추가 key/무효/지연 unique는 인정하지 않는다. UNIQUE 제약은 동일한 backing index 조건으로 인정한다.

공유 DB 확인 SQL: [docs/sql/owner-manual-schema-inspection.readonly.sql](sql/owner-manual-schema-inspection.readonly.sql). 사용자가 직접 실행할 파일이며 이번 작업에서 실행하지 않았다. `BEGIN READ ONLY`에서 catalog만 조회한다. 실제 테이블 데이터·매뉴얼 본문·개인정보·role password는 읽지 않는다. trigger 정의는 event/timing/대상 컬럼/연결 함수를 재구성하고 인자/WHEN 조건은 생략한다. 연결 함수의 이름·signature·보안 옵션·search_path·권한만 보여 주며 함수 본문을 출력하지 않는다. 비밀값을 포함할 수 있는 pg_get_triggerdef/tgargs/pg_get_functiondef/prosrc를 출력하지 않는다. 따라서 이 결과만으로 알 수 없는 trigger 본문의 호환성이 증명되지는 않는다.

### 검증 도구: 기존 11개 + 추가 6개

기존 시나리오는 삭제하지 않았다. 추가한 6개는 (1) parent 유지 child store/franchise/scope 변경 거부, (2) 자식이 있는 parent 범위 변경 거부/허용과 NULL/legacy scope, (3) 자기·간접 순환 롤백, (4) 관계 변경 트랜잭션과 old 게시 lock 경합, (5) 동일 unique index 허용/partial·deferrable 거부, (6) 미검토 timestamp trigger의 준비 차단이다. 기존 결과에 더해 실패 뒤 본문/버전/관계/청크 불변, 유효 변경 뒤 old 게시 거부를 확인하도록 작성했다.

로컬 unix/npipe endpoint만 인정하고 모든 Docker 명령에 해당 --host를 고정한다. 원격 Docker/원격 DOCKER_HOST는 거부한다. 새 UUID 이름과 소유권 label의 생성 성공한 컨테이너만 정리한다. label 불일치 시 정리를 거부하며 기존 컨테이너·볼륨을 삭제하는 명령은 없다. 이미지가 없으면 다운로드 예정 메시지를 표시한다. 시작은 30초, lock 대기는 15초, 재시도 간격은 200ms이며 psql session/문장에도 제한 시간이 있다.

fixture에는 가능한 관련 기존 UUID PK/default, 청크 UNIQUE/FK/CHECK, parent/store/franchise CASCADE FK, membership role/status/unique, scope의 legacy CHECK, service_role BYPASSRLS와 manuals/chunks RLS를 반영했다. 저장소 migration 전체를 실행하는 것은 아니다. 합성 auth.users/franchises/stores에는 ID/관계만 있고 실 Supabase auth/storage/role 설정·모든 RLS 정책·HNSW/검색 함수/질문/업로드 배치·외부 webhook은 포함하지 않는다. 합성 미검토 timestamp trigger는 준비 검사를 차단하는 테스트용이며 기존 migration에 있었다고 보고하지 않는다.

“임베딩 실패” DB 시나리오는 실제 생성 함수를 실패시키지 않는다. 게시를 생략해 청크0인 상태와 가짜 1536차원 벡터 게시 후 복구만 검사한다. 실제 생성 실패/부분 성공 응답은 가짜 client 앱 테스트의 별도 범위다. PostgreSQL 도구로 API/인증 UI/브라우저 E2E/답변 품질을 입증하지 않는다.

### 이번 검사·실행 결과와 적용 차단 사항

- node --check: 통과. 전달 이스케이프 원본 확인: 모두 없음.
- 집중 SQL/가짜 client 회귀: 15개 통과. test:owner-escalation: 438/438 통과. typecheck 및 check:integration(오류0/경고0), git diff --check 통과.
- 로컬 PostgreSQL: **17/17 PASS**. 정식 037 생성·재적용 및 배포 후 읽기 전용 확인 SQL도 검증기에 포함해 재실행했다. 가짜 1536차원 벡터를 사용했고 외부 임베딩 API는 호출하지 않았다.
- 재현: 로컬 Docker에서 `node scripts/verify-manual-postgres.mjs`. 원격 Docker나 공유 Supabase로 대체하지 않는다. 경합 세션도 선택된 로컬 `--host`를 명시한다.
- 남은 배포 gate: 레거시 관계/cycle 검사, global lock 처리량·모든 writer 잠금 순서 검토, 실제 Supabase/PostgREST 연동과 인증 API/E2E. schema/권한/vector/unique/사용자 트리거는 적용 직전 최신 상태를 다시 확인한다. 승인된 유지보수 창 밖에서 공유 QA DB에 적용하지 않는다.
- 최신 migration이 036이고 037이 미사용임을 확인했다. [정식 037](../supabase/migrations/037_owner_manual_safe_edit.sql)로 원문을 이동했다. SQL 본문 변경 없이 검증기/테스트 참조를 갱신했으며 번호 없는 초안 사본은 남기지 않았다. 모델/점수/임계점/매뉴얼/청크/임베딩/50문항 기준은 변경하지 않았다.

이번에 수정/추가한 정확한 파일 경로:

```text
C:/Users/myeon/il-it-da/supabase/migrations/037_owner_manual_safe_edit.sql
C:/Users/myeon/il-it-da/docs/sql/owner-manual-schema-inspection.readonly.sql
C:/Users/myeon/il-it-da/docs/sql/owner-manual-postdeploy.readonly.sql
C:/Users/myeon/il-it-da/scripts/verify-manual-postgres.mjs
C:/Users/myeon/il-it-da/tests/manuals/manual-write-contract.test.ts
C:/Users/myeon/il-it-da/tests/manuals/atomic-manual-index.test.ts
C:/Users/myeon/il-it-da/docs/owner-escalation-manual-followup.md
```

### 공유 DB 적용 및 코드 배포 Runbook

배포 산출물은 준비되었지만 공유 환경의 무조건 배포 승인은 아니다. 아래 절차는 승인된 운영자가 수행하며 이번 작업에서 실행하지 않았다. 코드만 먼저 배포하면 기존 쓰기도 503으로 차단된다. DB만 적용하고 구버전 direct chunk writer를 계속 운영하면 버전 게시 계약을 우회하므로 금지한다.

1. 공유 QA 담당자와 유지보수 창을 승인하고 DB 백업/복원 가능성, 이전 코드 artifact, migration 이력을 확보한다. 적용 직전 037 충돌/미적용과 001~036 전제를 다시 확인한다. pending migration 전체를 무검토 `db push`로 실행하지 않는다.
2. [구조 확인 SQL](sql/owner-manual-schema-inspection.readonly.sql)과 아래 데이터 확인 SQL을 읽기 전용으로 실행한다. invalid/cycle 건수는 0이어야 한다. legacy scope는 별도 검토하며 자동 정규화/삭제/재임베딩하지 않는다. 함수/트리거 충돌, 타 범위 연결, 예상 외 trigger/ACL/vector/unique가 있으면 중단한다. 기존 청크와 현재 본문의 소급 일치는 이 검사로 증명되지 않는다.
3. 구버전 인스턴스, 웹 쓰기, webhook, 외부/배치 direct chunk writer를 모두 중단하고 진행 중 트랜잭션을 drain한다. global advisory lock의 처리량/timeout과 모든 writer의 lock-before-row 순서를 검토한다. 매뉴얼 삭제를 포함한 쓰기를 중단한다.
4. 운영자가 [037 전체 SQL](../supabase/migrations/037_owner_manual_safe_edit.sql)을 전용 DB 세션에서 실행한다. 파일의 `BEGIN`부터 `COMMIT`까지 한 단위이며 새 컬럼/테이블/백필은 없다. migration 도구 사용 시 transaction 처리와 037 이력 등록을 해당 도구 절차에 맞춘다. SQL Editor 수동 실행은 migration 이력을 자동 등록하지 않으므로 사용한 파일/hash와 적용 이력을 별도 대조한다.
5. 성공 후 별도 세션에서 `NOTIFY pgrst, 'reload schema';`를 실행한다. 이는 읽기 전용 검사가 아니라 승인 후 수행하는 schema cache 갱신이다. [배포 후 읽기 전용 확인 SQL](sql/owner-manual-postdeploy.readonly.sql)을 실행한다. 함수 6행(오버로드 없음), service EXECUTE=true/anon·authenticated=false, 활성 자체 트리거 3행, 최종 `manual_write_contract_version=2`를 확인한다. 무효화 함수 2개만 DEFINER, 나머지는 INVOKER, 모두 `search_path=pg_catalog, extensions`여야 한다. 오류/0이면 중단한다. 확인 SQL은 SET ROLE 가능한 관리 세션에서 실행하며 권한을 임의 확대하지 않는다.
6. 호환 API/인덱서/UI를 함께 배포하되 쓰기를 아직 재개하지 않는다. 서버 측 service client로 읽기 전용 PostgREST `check_manual_write_contract` RPC를 호출해 정수 2가 오는지 확인한다. DB 세션 PASS는 PostgREST cache/네트워크/자격 증명을 증명하지 않는다. service key는 브라우저/로그에 노출하지 않는다.
7. 독립 Supabase 환경에서 승인 계정으로 업로드/확정/HQ·점주·일괄 수정/항목 추가/카테고리/재처리/webhook 및 409/503/부분 성공 안내를 검증한다. 로그인 모바일·데스크톱과 직원 답변/근거 품질은 별도 gate다. 실제 임베딩/챗봇 비용 검사는 별도 승인 후 수행하며 이번 작업에는 포함되지 않는다. gate 완료 후 새 writer만 재개하고 오류율/409/503/잠금 대기/검색 미준비 상태를 관찰한다.

적용 전 데이터 확인 SQL(운영자 실행용, 본문/개인정보 출력 없음, 이번 작업에서 미실행):

```sql
begin read only;
select count(*) as invalid_scope_or_store_count
from public.manuals m left join public.stores s on s.id = m.store_id
where (lower(m.scope_type) = 'store' and m.store_id is null)
	 or (lower(m.scope_type) in ('hq','common','shared') and m.store_id is not null)
	 or (m.store_id is not null and (s.id is null or s.franchise_id is distinct from m.franchise_id));
select count(*) as legacy_scope_review_count from public.manuals
where scope_type is null or lower(scope_type) not in ('store','hq','common','shared');
select count(*) as invalid_parent_count
from public.manuals c left join public.manuals p on p.id = c.parent_manual_id
where c.parent_manual_id is not null and (p.id is null
	or p.franchise_id is distinct from c.franchise_id
	or not (c.store_id is not distinct from p.store_id
		or coalesce(p.store_id is null and lower(p.scope_type) in ('hq','common','shared')
			and lower(c.scope_type) = 'store', false)));
with recursive ancestry as (
	select id as origin, id, parent_manual_id, array[id] as path, false as cyclic
	from public.manuals
	union all
	select a.origin, p.id, p.parent_manual_id, a.path || p.id, p.id = any(a.path)
	from ancestry a join public.manuals p on p.id = a.parent_manual_id
	where not a.cyclic
)
select count(distinct origin) as cycle_affected_count from ancestry where cyclic;
rollback;
```

### 실패 시 대응

- SQL 오류/lock timeout: 전용 세션에서 `ROLLBACK`하고 적용 상태를 확인한다. 037은 트랜잭션이므로 일부 DDL 적용을 추측하지 않는다. 충돌/권한/데이터/트리거 원인을 해결하기 전 재실행하지 않는다. 연결 유실 시 커밋 여부는 읽기 전용 catalog/계약 조회로 판단한다.
- 계약0/오류 또는 PostgREST 실패: 쓰기를 계속 중단한다. schema cache/ACL/시그니처/트리거/서비스 설정을 확인하고 호환 artifact로 복구한다. 준비 gate 우회나 구버전 direct writer fallback은 금지한다.
- 코드 rollback: DB 계약을 유지한 채 쓰기 차단/읽기 전용 운영 또는 호환 코드로 roll-forward한다. 이전 비원자 writer를 켜는 일반 rollback은 금지한다. SQL 제거는 자동 수행하지 않으며 백업·적용 후 쓰기 내역·의존성을 검토한 별도 승인 계획이 필요하다.
- 저장 응답 유실/409/40001/40P01/timeout: 최신 본문·버전·청크 상태를 먼저 읽는다. 응답 오류가 DB 롤백을 뜻하지 않는다. 최신 버전으로 제한된 재시도만 허용하고 유료 생성 전체를 무조건 반복하지 않는다. 일괄 일부 저장은 성공/실패 항목과 batch id를 대조한다.
- 저장 성공·검색 실패: 새 본문을 유지하고 청크0인 항목은 검색에서 제외한다. 최신 snapshot 재처리는 별도 비용 승인 후 수행한다. 옛 청크 복원/자동 질문 완료/전체 자동 재임베딩은 금지한다. 단순 재색인 게시 실패는 기존 유효 청크를 유지한다.

### 최종 회귀 결과

2026-10-04 정식 037 승격 후 실행 결과:

| 검사 | 결과 |
| --- | --- |
| 정식 037 경로 집중 회귀 | 15/15 PASS |
| node scripts/verify-manual-postgres.mjs | 실제 임시 PostgreSQL 17/17 PASS, 배포 후 확인 SQL 포함 |
| npm run test:owner-escalation | 타입 검사 포함 438/438 PASS |
| npm run test:rag | 타입 검사 포함 1,361/1,361 PASS |
| npm run test:auth | 241/241 PASS, 로그인 브라우저 검증 아님 |
| npm run test:integration | 79/79 PASS |
| npm run test:rag-eval | 239/239 PASS, 실제 AI 품질 평가 아님 |
| npm run check:integration | 9 checks, 오류0/경고0, 기존 014/015 번호 누락 안내2 |
| npm run check:frontend | 5/5 PASS: lint 오류0/경고65, typecheck, production build, diff 공백, frontend 101/101 |
| 인계 문서 링크/초안 경로 참조 | 로컬 링크 유효, 삭제된 초안 참조0 |

정식 037 SHA-256: `EC0A04E59CA036A9AEB8311790B1B28B53A817B9CA239BE94E86958156A84BE7`. 이동 시 원문과 해시 동일을 확인했으며 SQL 내용은 변경하지 않았다. stash 식별자는 `stash@{0}` / `9523bdca041e777cf045ac65c6d036bfe8862144`이며 기존 변경을 보존했다.

최종 판정: 정식 배포 산출물과 로컬 회귀는 준비되었다. 공유 DB의 최신 데이터·writer·잠금 처리량·PostgREST 연동과 실환경 gate는 미완료이므로 무조건 배포 승인으로 보고하지 않는다. **실제 임베딩 생성·챗봇 답변 품질·로그인 브라우저 검증은 이번 17개 검사로 입증되지 않았다.** 공유 DB SQL 실행, 유료 API, git add/commit/push는 하지 않았다.

이 절 아래의 미실행/번호 없는 초안 표현과 이전 테스트 수치는 당시 이력이며 현재 판정은 이 최상단 절을 따른다.

## 이전 작업 기록: 버전2 계약

이 절은 이전 보완 이력이다. 현재 SQL/검증 도구의 계약은 최상단 절을 기준으로 한다. 당시 브랜치 `fix/owner-escalation-manual-followup`, HEAD `83c6610ad384100a9a18a62dc99592aa50a3ac42`와 기존 작업을 보존했다. 공유 데이터, 모델, 검색 점수/임계점, 엑셀 파싱, 50문항 QA 자료는 변경하거나 실행하지 않았다.

### 영향 경로: 수정 전과 현재

모든 경로는 아래 정확한 파일의 명시된 함수에서 제어된다. 경로의 루트는 `C:/Users/myeon/il-it-da/`이다.

| 경로·함수 | 수정 전 | 현재 본문/청크/임베딩/응답 |
| --- | --- | --- |
| app/api/store-manuals/[id]/route.ts PATCH -> lib/manuals/save-store-manual-edit.ts saveStoreManualEdit | 누락 RPC는 저장 단계에서 발견 | 검증·권한 확인 후 준비 검사, 수정 RPC/원자 무효화, 저장 버전 인덱싱. 503/409/500 또는 저장 성공+ready/failed/not_searchable/parent_only |
| app/api/manuals/[id]/route.ts PATCH | UPDATE -> 직접 DELETE/INSERT -> 임베딩 실패 숨김 | UPDATE 전에 준비 검사. 기존 HQ 권한/범위 유지. 트리거 무효화 후 indexSavedManuals. 200의 saveStatus/searchStatus/searchResults/message로 검색 실패 명시 |
| app/api/manuals/batch-update/route.ts POST | 항목별 UPDATE·청크 직접 쓰기·오류 숨김 | 준비 후 범위 제한 UPDATE, 공용 버전 게시. failedIds 및 saveStatus:partial로 일부 저장 실패도 명시 |
| app/api/store-manuals/batch-update/route.ts POST | 위와 동일, store 범위 | 승인 owner/store 범위 유지. 위와 같은 부분 성공 응답 |
| app/api/manuals/preview/confirm/route.ts POST | 배치 가드 -> 부모/자식 INSERT -> null 청크 -> 오류 숨김 | saveManualGroupsWithBatchGuard가 batch claim보다 먼저 준비 확인. 직접 청크 쓰기 없음. manuals 배열 유지+검색 결과/안내 추가 |
| app/api/store-manuals/preview/confirm/route.ts POST | 위와 동일, 검증된 store 범위 | 위와 동일, store/franchise/중복 계약 유지 |
| app/api/manuals/upload/route.ts POST | 즉시 저장 후 검색 실패 숨김 | 같은 배치 가드/결과 계약. 파싱 규칙은 그대로 |
| app/api/store-manuals/batch-create/route.ts POST | 같은 그룹 저장 경로 | 같은 준비/부분 성공 계약 |
| app/api/manuals/route.ts POST 및 PATCH(rename-category) | 신규/placeholder INSERT, 카테고리 UPDATE | 신규는 배치 가드, placeholder는 직접 준비 검사. rename은 준비 확인 -> UPDATE -> indexSavedManuals. 삭제/조회 경로는 그대로 |
| app/api/store-manuals/route.ts POST 및 PATCH(rename-category) | 위와 동일, store 범위 | 같은 계약. owner/store 권한 유지 |
| app/api/manuals/[id]/items/route.ts POST | addItemsToManualGroup -> INSERT/null 청크/실패 숨김 | addItemsToManualGroup가 INSERT 전에 준비 확인. 자식만 인덱싱하고 결과 반환 |
| app/api/store-manuals/[id]/items/route.ts POST | 위와 동일 | 같은 계약, 승인 owner/store 범위 유지 |
| app/api/manuals/search-readiness/reindex/route.ts POST | 유료 생성 후 누락 게시 함수 발견 | indexManualById -> indexApprovedManual의 준비 검사 후 생성. 미준비 503, 실행 실패 500. 기존 청크는 게시 전까지 유지 |
| app/api/store-manuals/search-readiness/reindex/route.ts POST | 위와 동일 | 같은 계약, 매장/승인/부모 가드 유지 |
| app/api/rag/upload/route.ts POST | indexApprovedManual 호출, 뒤늦은 게시 실패 | 준비 검사 우선, 503 준비 중/500 실행 실패 |
| app/api/webhooks/index-manual/route.ts POST | 공용 인덱싱, 200+success:false | 준비 확인 우선, 미준비는 503. 실행 실패는 기존 200+success:false 유지. 본문 저장 동작은 없음 |
| lib/rag/manual-indexing/supabase-deps.ts createSupabaseManualIndexingDeps | 미연결 어댑터에 직접 upsert/tail 삭제 경로 | persistManual 사전 검사, 변경 범위/부모 조건 유지, 저장 snapshot을 pipeline -> persistManualChunks -> 원자 RPC로 전달 |

### DB 준비 확인과 일관성

- `lib/manuals/manual-write-contract.ts`의 `requireManualWriteContract`는 데이터 변경 없는 `check_manual_write_contract()`를 호출한다. 버전2가 아니거나 RPC/권한/네트워크 오류이면 고정된 기능 준비 중 안내로 차단한다. 데이터/임베딩을 probe로 쓰지 않는다.
- SQL 검사 범위: 함수 시그니처/인자명/반환 타입/버전 표식/search_path/SECURITY 옵션/오버로드/역할 실행 권한, service_role의 schema/table 권한, 활성 트리거 이벤트/대상 컬럼/함수/조건, 필요한 컬럼 타입과 vector(1536)/청크 unique 제약. 함수 이름 존재만으로 준비 완료로 보지 않는다.
- 검토되지 않은 다른 manuals INSERT/UPDATE 트리거나 manual_chunks 쓰기 트리거가 있으면 준비 완료를 반환하지 않는다. 이것은 기존 트리거를 삭제하거나 무시하는 대신 독립 검토를 요구하는 fail-closed 정책이다. 기존 트리거와의 호환성은 아직 미검증이다.
- 영구/global 캐시는 없다. 그룹/일괄 요청은 해당 요청에서 확인한 client/context를 자식 인덱싱에 전달해 외부 RPC를 항목마다 반복하지 않는다. 독립 재처리는 다시 검사한다. DB 계약의 동시 변경 가능성은 남으므로 유지보수 중 DDL과 사용자 쓰기를 경합시키지 않아야 한다. 실행 단계의 DB 오류 처리도 유지한다.
- 애플리케이션 저장 경로의 manual_chunks 직접 DELETE/INSERT/upsert는 제거했다. 구버전 애플리케이션 인스턴스나 외부 SQL writer가 별도로 직접 쓰는 경우까지 자동 보호한다고 주장하지 않는다. 적용 전 모든 writer를 확인해야 한다.
- 본문/메타데이터/승인/scope/부모 관계 변경은 동일 UPDATE 트랜잭션에서 기존 청크를 무효화한다. DB가 updated_at을 생성하므로 서버 시간 또는 문자열 정밀도 차이로 버전이 뒤로 가지 않는다. 동일 내용의 no-op 수정은 유효 청크를 삭제하지 않는다.
- 자식 INSERT/부모 관계 변경은 부모를 정렬된 순서로 잠그고, 같은 store/franchise 또는 같은 franchise의 본사 공통 부모 상속인지 확인한 뒤 부모 버전과 청크도 무효화한다. 다른 매장 부모/다른 브랜드는 거부한다. 단독 매뉴얼이 부모로 바뀔 때 기존 부모 청크가 남는 것을 방지한다. 레거시 scope 표기/부모 데이터 호환성 검토는 적용 전 조건이다.
- 모든 새 청크는 immutable snapshot과 전체 교체 RPC를 거친다. updated_at뿐 아니라 id/status/title/category/content/brand_name/store/franchise/scope_type/parent_manual_id도 검사한다. 부모 카드 게시를 거부하며, 잘못된 행/차원/숫자가 있으면 전체 교체가 롤백되는 계약이다.
- 기존 승인 상태는 유지한다. 본문 변경 후 생성 실패하면 해당 항목은 청크가 없어 검색에서 제외된다. 단순 재색인 실패는 기존 유효 청크를 보존한다. 구버전 본문에 맞춘 청크를 복원하지 않는다.

### 응답과 화면 안내

기존 manual/manuals 필드를 유지했다. 생성/본사 수정/일괄/카테고리는 saveStatus: saved 또는 partial, searchStatus: complete 또는 incomplete, 항목별 searchResults, message를 추가한다. 항목은 ready/failed/not_searchable/parent_only/unknown으로 구분된다. 배치 replay에는 과거 응답의 검색 성공을 추정하지 않고 unknown으로 안내한다. 미승인/부모를 검색 완료 항목으로 오인하지 않도록 안내한다.

점주 단건은 기존 ready/failed/not_searchable/parent_only 응답을 유지한다. 준비 실패는 쓰기 전에 503, 버전 충돌은 409, 저장 실패는 500이다. 저장 뒤 검색 실패는 200의 명시적 부분 성공이며 실패/미확인 안내는 사라지는 토스트만으로 끝내지 않는다.

- app/boss/store-manuals/page.tsx: 기존 본문 폼/선택 범위를 유지하고 모든 생성·수정·추가·업로드에 지속 안내와 검색 준비 패널 재조회를 연결했다.
- app/hq/manuals/common/page.tsx: 본문/카테고리/부모/신규/항목/일괄 응답 안내를 지속 표시하고 패널을 재조회한다. 일괄 모달은 항목별 결과 안내를 전달한다.
- app/hq/manuals/onboarding/page.tsx: 저장 응답 안내를 sessionStorage로 전달하고 기존 검색 준비 UI가 있는 공통 화면으로 복귀한다. 저장소 전달 실패 시에도 saved 쿼리를 통해 미확인 안내가 남는다.
- 저장/재색인 성공은 question_logs를 완료시키지 않는다. 직원 안내/개별 대응의 기존 완료 기능과 직원 권한을 우회하지 않는 수동 질문 확인 경로를 유지한다.

### SQL 초안·권한·미적용 동작

당시 번호 없는 초안은 현재 [정식 037](../supabase/migrations/037_owner_manual_safe_edit.sql)로 이동했다. 공유 DB에는 적용하지 않았다. 새 테이블/컬럼/데이터 백필은 없다. 두 무효화 트리거 함수만 SECURITY DEFINER로 관련 청크/부모의 제한된 무효화를 수행한다. 편집/게시/준비 RPC는 SECURITY INVOKER이며 service_role만 실행한다. 공용/public·anon·authenticated 실행은 revoke한다. 모든 함수의 search_path는 pg_catalog,extensions이고 테이블은 public으로 명시한다.

동명 트리거가 다른 함수에 연결되어 있으면 트랜잭션을 실패시킨다. 알려진 자체 트리거만 drop/create하여 반복 실행이 가능하도록 설계했다. 다른 기존 트리거를 자동 삭제하지 않는다. 부모의 scope 일치를 확인하고 UPDATE/게시의 행 잠금·버전 비교·오류 시 롤백을 유지했다.

SQL 미적용 환경에서는 점주 단건뿐 아니라 본사 수정·일괄·신규 저장·항목 추가·카테고리·재처리·유효 webhook을 모두 쓰기/임베딩 전에 준비 중으로 차단한다. 기존 GET/파싱/preview/질문 조회와 상태 변경/기존 청크 검색/삭제는 준비 RPC에 의존하지 않는다. 구식 비원자 쓰기로 fallback하지 않는다. 따라서 코드만 먼저 배포하면 기존 쓰기 기능도 준비 중이 되며, 기존 기능 유지의 전제는 독립 검증을 통과한 DB 계약의 준비다.

### 검증 결과와 실DB 절차

| 실행한 검사 | 결과 |
| --- | --- |
| npm run typecheck | 통과 |
| npm run test:owner-escalation | 테스트 타입 검사 + 435/435 통과 |
| npm run test:rag | 테스트 타입 검사 + 1,354/1,354 통과 |
| npm run test:auth | 241/241 통과 |
| npm run test:integration | 79/79 통과 |
| npm run test:rag-eval | 239/239 통과, 실제 AI 평가 호출이 아닌 평가 도구 회귀 검사 |
| npm run check:integration | 9 checks, 오류0/경고0, 기존 번호 누락 안내2 |
| npm run check:frontend | lint/typecheck/build/diff/frontend 5/5 통과, frontend 100/100, lint 오류0/기존 경고68 |
| git diff --check 및 미추적 파일 공백 검사 | 통과, 새 파일 공백 위반0 |
| 전체 변경 경로/기존 테스트 보존 대조 | 57개 경로 누락0, 기존 test:rag 파일 모두 유지, 중복 등록0 |
| node --check scripts/verify-manual-postgres.mjs | 문법 검사 통과 |
| node scripts/verify-manual-postgres.mjs | 실제 DB 검증 미실행: 로컬 Docker 엔진이 없어 DB 접근 전 중단 |

build 전 현재 Next dev가 .next/dev에서 실행 중임을 확인했고 종료하지 않았다. Next 16.3.4의 build 정리가 dev 경로를 보존함을 확인한 기존 검증 절차를 사용했다. HEAD와 stash 상태를 보존했고 add/commit/push하지 않았다. 공유 DB·QA 매뉴얼·청크·임베딩이나 외부 AI/유료 API는 호출/변경하지 않았다.

관련 가짜 client/순수 함수/fixture/SQL 정적 검사를 추가·보강했다. 모든 기존 test:rag 파일을 유지했으며 새 검사도 같은 게이트에 등록했다. 기존 null placeholder/upsert 구현을 고정한 검사는 원자 게시·구버전 방지·명시적 검색 결과 검사로 강화했고 삭제/제외하지 않았다.

실제 PostgreSQL은 실행하지 못했다. PATH와 Program Files에서 docker/psql/postgres/initdb/podman 실행 환경이 없고, 실행 도구도 로컬 Docker 부재로 DB 접근 전 종료했다. 가짜 RPC나 SQL 문자열 검사를 실DB 안전성 증명으로 보고하지 않는다.

재현 명령: `node scripts/verify-manual-postgres.mjs`. 먼저 별도 로컬 PC/CI에 Docker Engine을 준비한다. 도구는 로컬 unix/npipe endpoint만 허용하고 원격 Docker를 거부한다. pgvector/pgvector:pg16 새 컨테이너를 network:none으로 만들며 호스트 DB URL이나 .env를 읽지 않는다. 내부 psql로 최소 합성 스키마/역할과 초안을 적용하고 가짜 1536차원 벡터만 사용한다. 종료 시 자신이 만든 컨테이너만 제거한다. 이미지 pull/로컬 Docker 실행 승인과 시간을 확보해야 한다.

작성된 실제 검증 시나리오와 기대 결과:

1. 함수/트리거 생성·재적용·service_role 실행: 계약2. 트리거 비활성화: 계약0. anon/authenticated 준비/수정/게시: 권한 거부.
2. 동일 버전의 두 수정 연결: 첫 연결 행 잠금, 두 번째는 pg_stat_activity에서 Lock 대기 확인 후 첫 커밋. 한 건 성공·다른 건 MANUAL_EDIT_CONFLICT.
3. 수정 뒤 늦은 old snapshot 게시: MANUAL_INDEX_CONFLICT, 새 본문 보존·청크0.
4. 임베딩 실패를 게시 생략으로 재현: 청크0/검색 제외. 새 snapshot으로 재처리하면 유효 청크 복구.
5. 두 번째 청크의 잘못된 차원: INVALID_EMBEDDING_DIMENSION, 첫 새 청크도 롤백되어 기존 청크 집합 유지. 실패한 단순 재색인의 보존 계약.
6. 본문 수정 뒤 강제 SQL 오류: 본문과 무효화가 함께 롤백.
7. 부모·형제·승인·store/franchise/scope 불변, 타 매장/브랜드 수정 거부, 부모 카드 게시 거부.
8. 본사/일괄 직접 UPDATE의 행 잠금과 기다리는 old webhook 게시: 커밋 후 구버전 거부. 새 버전 게시만 성공.
9. 범위/부모 변경 후 old 게시 거부. 동일 시각의 Z/+09:00은 동일, 1 microsecond 차이는 충돌.
10. 단독 매뉴얼에 자식 추가: 기존 부모 청크0·부모 버전 증가·구버전 게시 거부.
11. 같은 프랜차이즈 HQ 부모 상속/연결 해제 보존, 다른 브랜드 부모 연결 거부.

도구는 문법 검사만 통과했으며 이 11개 PostgreSQL 시나리오를 실제로 통과했다고 보고하지 않는다. Supabase의 실제 스키마/ACL/RLS/확장 schema/기존 트리거/webhook 설정/타 writer/부모 상속 데이터와 PostgREST schema cache 호환성, 장애/중단 시 커밋 여부, 모바일/데스크톱 인증 화면, 실제 50문항 검색 품질은 아직 확인해야 한다.

### 배포 순서와 실패 복구

1. 공유 QA 중 배포/SQL 적용하지 않는다. 독립 DB에서 위 실DB 검증과 기존 업로드/HQ/일괄/재처리/동시 실행 회귀를 먼저 통과시킨다.
2. 기존 트리거/권한/parent 범위와 모든 direct chunk writer를 검토한다. 예상 외 트리거가 있으면 계약0을 무시하지 말고 호환성을 해결한다. 기존 행의 청크가 현재 본문과 맞는지 소급 입증하는 컬럼은 없으므로 별도 표본 검토가 필요하다.
3. 승인된 유지보수 창에서 구버전 writer와 webhook/쓰기 트래픽을 중단한다. 이것은 이번 작업에서 수행하지 않은 배포 절차다. 백업과 버전별 복구 계획을 확보한다.
4. 초안을 정식 배포 대상으로 별도 승인한 뒤 DB 계약을 준비하고 PostgREST schema cache를 갱신·읽기 전용 계약2 확인 후 호환 코드와 UI를 함께 배포한다. 구버전 direct chunk writer를 다시 켜지 않는다. 이번 작업에서는 정식 migration 번호를 부여하지 않았다.
5. 준비 검사0/오류: 데이터·청크·임베딩 호출 없이 기능 준비 중. 검토/배포를 복구한 뒤 재시도한다.
6. 본문 저장 실패/응답 유실: 본문·버전·검색 준비 상태를 먼저 재조회한다. 커밋 여부를 추측하여 바로 덮어쓰지 않는다. 일부 저장된 그룹은 기존 batch 복구 안내를 따른다.
7. 저장 성공·검색 실패: 새 본문은 유지하고 해당 매뉴얼은 제외 상태로 둔다. 최신 버전으로 검색 준비 재처리를 실행한다. 옛 청크 복원 금지. 자동 큐/자동 완료는 없다.
8. 게시 커밋 후 응답 유실: 최신 상태를 읽어 확인한다. 클라이언트 오류가 DB 롤백을 의미하지 않는다. SQL/코드를 되돌릴 때도 구버전 비원자 writer를 활성화하지 않는 fail-closed 방식으로 운영한다.

### 전체 변경 파일 절대경로

기존 작업을 포함한 현재 HEAD 대비 전체 파일은 다음 57개다.

```text
C:/Users/myeon/il-it-da/app/api/boss/question-logs/[id]/context/route.ts
C:/Users/myeon/il-it-da/app/api/manuals/[id]/items/route.ts
C:/Users/myeon/il-it-da/app/api/manuals/[id]/route.ts
C:/Users/myeon/il-it-da/app/api/manuals/batch-update/route.ts
C:/Users/myeon/il-it-da/app/api/manuals/preview/confirm/route.ts
C:/Users/myeon/il-it-da/app/api/manuals/route.ts
C:/Users/myeon/il-it-da/app/api/manuals/search-readiness/reindex/route.ts
C:/Users/myeon/il-it-da/app/api/manuals/upload/route.ts
C:/Users/myeon/il-it-da/app/api/rag/upload/route.ts
C:/Users/myeon/il-it-da/app/api/store-manuals/[id]/items/route.ts
C:/Users/myeon/il-it-da/app/api/store-manuals/[id]/route.ts
C:/Users/myeon/il-it-da/app/api/store-manuals/batch-create/route.ts
C:/Users/myeon/il-it-da/app/api/store-manuals/batch-update/route.ts
C:/Users/myeon/il-it-da/app/api/store-manuals/preview/confirm/route.ts
C:/Users/myeon/il-it-da/app/api/store-manuals/route.ts
C:/Users/myeon/il-it-da/app/api/store-manuals/search-readiness/reindex/route.ts
C:/Users/myeon/il-it-da/app/api/webhooks/index-manual/route.ts
C:/Users/myeon/il-it-da/app/boss/questions/[id]/BossQuestionDetailView.tsx
C:/Users/myeon/il-it-da/app/boss/questions/repeated/RepeatedQuestionView.tsx
C:/Users/myeon/il-it-da/app/boss/store-manuals/page.tsx
C:/Users/myeon/il-it-da/app/hq/manuals/common/page.tsx
C:/Users/myeon/il-it-da/app/hq/manuals/onboarding/page.tsx
C:/Users/myeon/il-it-da/components/manuals/ManualSearchReadinessPanel.tsx
C:/Users/myeon/il-it-da/components/owner/QuestionManualFollowup.tsx
C:/Users/myeon/il-it-da/docs/owner-escalation-manual-followup.md
C:/Users/myeon/il-it-da/supabase/migrations/037_owner_manual_safe_edit.sql
C:/Users/myeon/il-it-da/lib/manuals/index-saved-manuals.ts
C:/Users/myeon/il-it-da/lib/manuals/manual-save-result.ts
C:/Users/myeon/il-it-da/lib/manuals/manual-write-contract.ts
C:/Users/myeon/il-it-da/lib/manuals/save-manuals-with-batch.ts
C:/Users/myeon/il-it-da/lib/manuals/save-store-manual-edit.ts
C:/Users/myeon/il-it-da/lib/manuals/validate-manual-edit.ts
C:/Users/myeon/il-it-da/lib/owner/question-manual-context.ts
C:/Users/myeon/il-it-da/lib/rag/index-approved-manual.ts
C:/Users/myeon/il-it-da/lib/rag/index-manual.ts
C:/Users/myeon/il-it-da/lib/rag/manual-indexing/persist-chunks.ts
C:/Users/myeon/il-it-da/lib/rag/manual-indexing/pipeline.ts
C:/Users/myeon/il-it-da/lib/rag/manual-indexing/reembed-approved-manuals.ts
C:/Users/myeon/il-it-da/lib/rag/manual-indexing/supabase-deps.ts
C:/Users/myeon/il-it-da/lib/rag/save-manual-sections.ts
C:/Users/myeon/il-it-da/lib/types/manual.ts
C:/Users/myeon/il-it-da/package.json
C:/Users/myeon/il-it-da/scripts/verify-manual-postgres.mjs
C:/Users/myeon/il-it-da/tests/manuals/atomic-manual-index.test.ts
C:/Users/myeon/il-it-da/tests/manuals/manual-confirm-flow.test.ts
C:/Users/myeon/il-it-da/tests/manuals/manual-preview-api.test.ts
C:/Users/myeon/il-it-da/tests/manuals/manual-readiness-api.test.ts
C:/Users/myeon/il-it-da/tests/manuals/manual-save-entrypoint.test.ts
C:/Users/myeon/il-it-da/tests/manuals/manual-upload-idempotency-api.test.ts
C:/Users/myeon/il-it-da/tests/manuals/manual-write-contract.test.ts
C:/Users/myeon/il-it-da/tests/manuals/save-store-manual-edit.test.ts
C:/Users/myeon/il-it-da/tests/manuals/store-manual-extract.test.ts
C:/Users/myeon/il-it-da/tests/manuals/validate-manual-edit.test.ts
C:/Users/myeon/il-it-da/tests/owner/question-manual-context.test.ts
C:/Users/myeon/il-it-da/tests/rag/manual-indexing/persist-chunks.test.ts
C:/Users/myeon/il-it-da/tests/rag/save-manual-sections.test.ts
C:/Users/myeon/il-it-da/tsconfig.test.json
```

## 최초 구현 기록 (버전1, 아래 내용은 변경 이력)

## 작업 상태와 보호 범위

- 시작 상태: 깨끗한 `develop`, HEAD `83c6610ad384100a9a18a62dc99592aa50a3ac42`, stash 없음.
- 작업 브랜치: `fix/owner-escalation-manual-followup`. HEAD는 유지했다.
- `git add/commit/push`, DB 접속을 통한 SQL 적용, 실제 매뉴얼/청크/임베딩 갱신, 외부 AI/유료 API 호출을 실행하지 않았다.
- 파싱 규칙, RAG 임계점, 검색 점수 계산, 모델/임베딩 모델/차원, 평가 데이터셋은 변경하지 않았다.
- 반영민 팀원의 공유 DB 최신 매뉴얼과 50문항 QA 기준은 이 작업에서 변경하지 않았다. 실제 QA 결과를 다시 검증했다는 뜻은 아니다.

## 확인된 입력 계약

| 경로 | 실제 코드 조건 |
| --- | --- |
| 파일 수신 | 점주 preview의 `POST`: 로그인과 `requireStoreOwner` 이후 파일 검사. 0바이트 거부, 최대 10MB. `.txt/.md/.docx/.csv/.xlsx/.xls` 지원, PDF 미지원, 엑셀 MIME 검사. |
| 엑셀 읽기 | `extractSpreadsheetSheets`: xlsx 라이브러리로 문자열 행렬 생성. 최대 20시트, 시트당 5,000행. 점주 `extractStoreManualGroups`는 비어 있지 않은 시트가 2개 이상이면 거부한다. |
| 점주 헤더 정규화 | `normalizeStoreManualRows`: 첫 행에서 카테고리/category, 타이틀/제목/title, 매뉴얼/내용/본문/세부매뉴얼/content를 모두 찾으면 3열로 재배열. 넘버 등 다른 열은 사용하지 않는다. 빈 카테고리와 타이틀은 직전 값으로 채운다. 세 헤더가 모두 없으면 원본 행렬을 사용한다. |
| 공용 표 파서 | `parseExcelTableGroups`: 첫 행은 항상 제외. 이후 앞 3열을 카테고리, 제목, 본문으로 사용한다. 빈 카테고리는 직전 값 또는 미분류. 제목 또는 본문 없는 행은 건너뛴다. 완전히 같은 행은 중복 제거한다. 파일 안의 헤더 탐색/전치 보조 함수는 현재 이 export에서 호출하지 않는다. |
| 본문 항목 분할 | `splitTextIntoManualItems`: 번호 줄, 하위 번호 및 들여쓰기 섹션 규칙으로 항목 분할. 인식 경계가 없으면 빈 줄 문단 또는 전체 셀을 항목으로 사용한다. 같은 카테고리와 제목의 여러 행은 한 그룹에 항목을 이어 붙인다. |
| 파서 fallback | 표 파싱 결과가 없으면 헤더를 제외한 행을 평탄화해 `parseManualText`로 처리한다. 파일명이 analyze-manual-with-ai여도 이 함수는 규칙 기반이며 외부 AI 호출을 하지 않는다. |
| 미리보기 확정 | `parseConfirmedManualGroups`: 제목/카테고리/항목 배열 필수. 제목 200자, 카테고리 100자, 본문 항목 20,000자, 그룹 1,000개, 총 항목 5,000개 이하. 빈 항목은 제외하지만 저장 가능한 항목이 없는 그룹은 거부한다. key로 중복 저장 방지. |
| 기존 단건 수정 | 엑셀 파싱을 다시 거치지 않는다. 제목/카테고리/본문의 부분 JSON 수정. 이번 검증은 입력된 필드의 비문자열/빈 값과 빈 수정 객체를 거부하고, 본문은 기존 `chunkManualText`로 저장 전에 검사한다. 업로드 확정의 길이 상한을 단건 수정에 새로 강제하지 않는다. |
| 검색 청크 조건 | `chunkManualText`: 공백 정리 후 본문 최대 50,000자, target 800/max 1,200/overlap 120 유지. `indexApprovedManual`: 승인된 매뉴얼만, 청크 최대 100개. 임베딩 입력의 브랜드/제목/카테고리/본문 형식과 1536차원을 유지한다. |

근거 파일과 함수: [점주 추출기](../lib/manuals/extract-store-manual-groups.ts), [파일 읽기](../lib/manuals/extract-manual-file-text.ts), [실제 표 파서](../lib/manuals/parse-excel-table.ts#L363), [항목 분할](../lib/manuals/detect-manual-item.ts), [확정 검증](../lib/manuals/parse-confirmed-manual-groups.ts), [편집 검증](../lib/manuals/validate-manual-edit.ts), [청크 분할](../lib/rag/chunk-manual.ts).

## 저장, 수정, 승인, 검색 반영

### 기존 업로드

1. 점주 화면의 파일 선택 -> `/api/store-manuals/preview` -> `extractStoreManualGroups` -> `buildManualPreview`. 이 단계는 매뉴얼을 쓰지 않는다.
2. 미리보기 확인 -> `/api/store-manuals/preview/confirm` -> `parseConfirmedManualGroups` -> `saveManualGroupsWithBatchGuard`.
3. fingerprint와 upload batch claim으로 중복 방지 후 `saveManualGroupsWithChunks`가 부모 카드 1개와 항목별 자식 N개를 저장한다. 여러 행 본문을 부모 본문 하나로 덮어쓰지 않는다.
4. 부모는 항목 수 설명을 갖고, 자식은 원문 항목을 갖는다. 부모/자식은 `approved`로 생성된다. 카테고리 placeholder만 `draft`다.
5. 자식만 null 임베딩 청크를 만든 뒤 `reembedApprovedManuals` -> `indexManualById`. 개별 임베딩 실패는 저장 자체를 실패로 바꾸지 않는다.

저장 진입점 근거: [배치 저장 가드](../lib/manuals/save-manuals-with-batch.ts), [부모/자식 저장](../lib/rag/save-manual-sections.ts), [점주 확정 라우트](../app/api/store-manuals/preview/confirm/route.ts).

### 이번 단건 수정 경로

1. 질문 상세에서 기존 답변과 근거 후보를 확인하고 기존 처리 상태를 `in_progress`로 변경할 수 있다.
2. 근거 후보를 자동 선택하지 않는다. 점주가 매장 매뉴얼 항목을 직접 선택하면 검증된 매장과 항목 ID를 기존 편집 화면으로 전달한다. 페이지도 승인된 소유 매장과 조회된 항목을 다시 대조한다.
3. 기존 본문 폼에서 부족한 내용만 수정한다. 줄바꿈/항목 구조와 다른 자식 행은 유지한다. 저장 중 입력을 잠그며, 실패 시 입력을 보존한다.
4. PATCH -> `validateManualEdit` -> `requireStoreOwner` -> `edit_store_manual_if_current`. 서버 세션 사용자와 매장의 실제 franchise를 사용한다.
5. SQL 초안은 매뉴얼 행을 잠근 뒤 동일 store/franchise와 `updated_at`을 비교한다. 충돌은 409. 수정과 기존 청크 무효화는 같은 트랜잭션이다. 저장 실패는 롤백한다. 승인 상태를 임의로 바꾸지 않는다.
6. 부모 카드는 검색 대상에서 제외하고, 미승인 상태는 인덱싱하지 않는다. 승인된 세부 매뉴얼만 저장된 버전을 인덱싱한다.
7. `indexApprovedManual`은 기존 방식으로 청크/임베딩을 준비한다. 저장 버전이 이미 바뀌었으면 임베딩 전에 거부한다. `replace_manual_chunks_if_current`는 행 잠금과 snapshot 검사를 다시 하고, 전체 삭제/삽입을 하나의 트랜잭션으로 게시한다. 실패 시 부분 게시하지 않는다.
8. 수정 응답은 본문 저장과 `searchStatus`를 분리한다. `ready`, `failed`, `not_searchable`, `parent_only`를 구분하고, 기존 검색 준비 패널을 새로 조회한다. 저장 시 이미 무효화된 이전 버전은 임베딩 실패 후 검색에 남지 않으며 재처리가 필요하다.
9. 질문 상세로 돌아와 원문을 복사하고 명시적으로 '같은 질문 확인'을 선택할 수 있다. 직원 전용 RAG 권한을 우회하지 않고 승인 직원의 기존 챗봇 수동 확인을 안내한다.
10. 실제 답변/근거 또는 직원 안내/개별 대응 결과를 확인한 후 기존 완료 동작을 사용한다. 확인창은 있으나 매뉴얼 수정을 강제하지 않는다. 저장이나 인덱싱은 question_logs를 수정하지 않는다.

현재 저장/수정 코드에 별도의 점주 매뉴얼 승인 요청/승인 버튼 단계는 없다. 기존 승인된 행은 승인 상태를 유지하고 draft는 draft를 유지한다. 직원 가입 승인과 매뉴얼 승인을 혼동하지 않는다.

## 질문, 알림, 권한 계약

- `fetchPendingQuestionsForOwner`: 소유 매장 검증 후 insufficient 질문 조회. 최근 7일/최대 500건 집계로 반복 배지와 보류가 없는 answered/cautious 반복 대표 로그도 검토 목록에 포함한다. 정규화 규칙과 반복 임계값은 유지했다.
- `fetchRepeatedQuestionAlertForOwner`: 알림 당시 기간/횟수/분류 snapshot 조회. 이번 이동 링크는 해당 storeId를 유지하며 보류/반복 처리 목록으로 이동한다. 과거 알림이 최근 검토 목록의 특정 항목과 항상 일치한다고 보장하지 않는다.
- `updateQuestionResolutionStatusForOwner`: 원본 로그의 store_id로 소유권 확인. 처리 revision 기반 충돌/ABA 방지와 기존 031 미적용 호환 처리를 유지했다. 처리 상태는 RAG 답변 status와 별개다.
- `resolveNotificationHref`/`resolveNotificationClick`: 기존 질문 강조 및 반복 알림 이동 계약을 변경하지 않았다.
- `fetchOwnerQuestionManualContext`: 질문은 검증된 매장의 로그만 읽는다. 근거는 같은 franchise의 해당 매장 매뉴얼 또는 승인된 본사 공통 매뉴얼만 노출한다. 타 매장/타 브랜드/본사 draft/삭제된 근거는 노출하지 않는다.
- 근거 후보는 로그의 단일 source_manual_id가 가리키는 현재 본문이다. 당시 전체 검색 근거, 과거 본문 snapshot은 저장되지 않아 복원할 수 없다. 후보가 적절한지 점주가 확인한다.
- 본사 매뉴얼은 읽기 전용으로 안내한다. 점주 쓰기는 store/franchise 범위를 갖는 RPC만 사용한다. HQ PATCH의 `requireHqUser` 권한을 변경하지 않았다.
- 답이 이미 매뉴얼에 있는 경우 본문을 바꾸지 말고 검색 문제로 확인하라는 안내를 추가했다. 임계값/점수/모델을 변경하는 우회 해결은 하지 않았다.

근거: [질문 조회/상태 변경](../lib/owner/pending-questions.ts), [반복 알림 조회](../lib/owner/repeated-question-alerts.ts), [알림 이동](../lib/notifications/notification-href.ts), [점주 매장 권한](../lib/manuals/store-manual-auth.ts), [RAG 직원 권한](../lib/rag/authorize-rag-store-access.ts), [상세 근거 조회](../lib/owner/question-manual-context.ts).

## 확인된 결함과 수정

| 기존 결함 | 조치 |
| --- | --- |
| 단건 PATCH가 명시적인 빈 필드를 무시해 일부 입력만 저장할 수 있음 | 필드별 타입/빈 내용 사전 검증, 구체적인 오류, 기존 청크 분할 조건 재사용 |
| 수정에 버전 검사가 없어 동시 변경을 덮어쓸 수 있음 | updated_at 필수, SQL 행 잠금/CAS, 409 및 명시적 최신 본문 재조회 |
| 본문 저장 후 별도 청크 삭제/삽입, 반환된 DB error 미검사, 인덱싱 오류를 숨김 | 단건 수정의 비원자적 청크 쓰기 제거, 원자 무효화 RPC, 저장/검색 상태 분리 |
| 기존 인덱싱 upsert와 tail 삭제 사이에 이전/새 청크 혼합 가능 | 버전 검사 후 전체 청크 원자 교체 RPC. 게시 실패/충돌은 성공으로 반환하지 않음 |
| 검색 준비 패널이 빈 목록/미승인만 있는 경우에도 모두 준비 완료로 표시할 수 있음 | 검색 대상이 있고 미승인/미준비가 없는 경우에만 표시, 조회 실패 시 이전 report 제거 |
| 질문 상세에 답변/근거/관련 편집/확인 경로 없음 | 읽기 전용 상세 조회, 직접 선택, 기존 편집 딥링크/질문 복귀, 수동 확인 |
| 반복 화면의 기존 보류 링크가 storeId를 잃음 | 반복 여부와 관계없이 해당 storeId의 처리 목록으로 이동 |

## DB 초안과 미적용 사항

최초 초안의 현재 위치: [정식 037](../supabase/migrations/037_owner_manual_safe_edit.sql). 최초에는 migration 밖에서 제안했으나 현재는 정식 번호를 부여했다. 공유 DB에는 적용하지 않았다. 아래는 버전1 당시 기록이며 현재 함수/트리거 계약과 배포 절차는 최상단 절을 따른다.

- 애플리케이션의 여러 HTTP 요청만으로 본문 수정과 청크 삭제/게시의 원자성 및 동시 수정 잠금을 보장할 수 없어 DB 함수가 필요하다.
- SQL 미적용 상태에서 이번 단건 수정은 `503 SAFE_MANUAL_EDIT_UNAVAILABLE`로 저장하지 않는다. 이전의 위험한 방식으로 fallback하지 않는다.
- 공유 `indexManualById`도 게시 RPC를 필요로 한다. 따라서 이 브랜치를 그대로 배포하면 SQL 미적용 환경의 새 저장/재처리는 임베딩 게시에 실패할 수 있다. 기존 저장된 자료를 조회하는 검색 로직은 변경하지 않았다. QA가 진행 중인 공유 환경에 코드/SQL을 배포하지 말고 독립 검증 환경에서 함께 검토해야 한다.
- 처리 메모/선택 매뉴얼 연결 전용 컬럼은 현재 없다. source_manual_id는 챗봇 답변의 근거이므로 점주가 고른 매뉴얼로 덮어쓰지 않는다. 이번 UI 선택은 저장되지 않는다. 해당 기록을 영속화하려면 별도 관계/메모 스키마와 상태 revision 기반 저장 설계가 필요하며 이번 최소 기능에는 넣지 않았다.
- 과거 청크의 본문 버전을 저장한 컬럼이 없다. 초안은 과거 데이터를 자동 수정하거나 재임베딩하지 않는다. 기존 검색 준비 상태는 승인/청크/임베딩 존재 확인이지 과거 데이터의 버전 일치를 소급 입증하는 상태가 아니다.
- 오래된 bulk 수정/HQ 수정 경로에는 이번 단건 편집처럼 클라이언트 CAS를 강제하지 않았다. 초안 트리거와 공용 게시 함수의 버전 검사 범위와, 미연결 manual-indexing/persist-chunks 어댑터의 비원자적 쓰기 방식은 독립 환경에서 별도 회귀 검토가 필요하다. 모든 쓰기 경로의 안전성을 입증했다고 보고하지 않는다.

## 검증과 남은 확인

- `npm run test:owner-escalation`: 테스트 타입 검사와 관련 428개 테스트. 가짜 client/임베딩, 파서 fixture, 함수 실행 및 일부 화면/SQL 소스 계약 검사.
- `npm run test:rag`: 기존 전체 회귀 1,330개. 첫 실행의 소스 검사 실패 1건은 검증 함수 이동에 맞춰 검사 위치를 갱신했다.
- `npm run typecheck`: 통과.
- `npm run check:integration`: 9 checks, errors 0, warnings 0. 기존 마이그레이션 014/015 누락 안내 2건.
- `npm run check:frontend`: lint -> typecheck -> build -> diff 공백 -> frontend 검사. lint 오류 0, 기존 경고 68. 프런트엔드 구조 검사 100개. 설치된 Next 16.3.4의 build 정리 코드가 cache/dev/lock/trace를 보존하고 현재 dev는 .next/dev를 사용함을 확인했다. 기존 서버를 중단하거나 next.config를 바꾸지 않았다.
- `git diff --check`와 새 미추적 파일의 공백 검사도 별도로 수행한다.
- PostgreSQL에서 SQL 초안을 실행하지 않았다. 실제 트랜잭션 잠금/롤백, pgvector 타입·권한·시간 정밀도 호환성은 아직 검증되지 않았다. 가짜 client의 혼합 방지/충돌 시뮬레이션과 SQL 소스 검사를 실제 DB 검증으로 해석하면 안 된다.
- 실환경에서 남은 항목: 독립 DB에 초안 검토 적용, 동시 저장/인덱싱·실패 롤백·승인 변경·타 범위 접근 재현, 기존 업로드/수정/재처리 회귀, 인증된 점주 화면의 모바일/데스크톱 확인, 승인 직원의 원문 재질문/답변/근거 확인.
- 외부 검색/AI 호출 없이 실제 검색 품질 또는 질문 해결을 입증하지 않았다. 50문항 QA는 변경되지 않은 기준으로 팀원이 계속 수행해야 한다.

## 변경 파일 전체 경로

```text
C:/Users/myeon/il-it-da/app/api/boss/question-logs/[id]/context/route.ts
C:/Users/myeon/il-it-da/app/api/store-manuals/[id]/route.ts
C:/Users/myeon/il-it-da/app/boss/questions/[id]/BossQuestionDetailView.tsx
C:/Users/myeon/il-it-da/app/boss/questions/repeated/RepeatedQuestionView.tsx
C:/Users/myeon/il-it-da/app/boss/store-manuals/page.tsx
C:/Users/myeon/il-it-da/components/manuals/ManualSearchReadinessPanel.tsx
C:/Users/myeon/il-it-da/components/owner/QuestionManualFollowup.tsx
C:/Users/myeon/il-it-da/docs/owner-escalation-manual-followup.md
C:/Users/myeon/il-it-da/supabase/migrations/037_owner_manual_safe_edit.sql
C:/Users/myeon/il-it-da/lib/manuals/save-store-manual-edit.ts
C:/Users/myeon/il-it-da/lib/manuals/validate-manual-edit.ts
C:/Users/myeon/il-it-da/lib/owner/question-manual-context.ts
C:/Users/myeon/il-it-da/lib/rag/index-approved-manual.ts
C:/Users/myeon/il-it-da/lib/rag/index-manual.ts
C:/Users/myeon/il-it-da/package.json
C:/Users/myeon/il-it-da/tests/manuals/atomic-manual-index.test.ts
C:/Users/myeon/il-it-da/tests/manuals/manual-readiness-api.test.ts
C:/Users/myeon/il-it-da/tests/manuals/manual-save-entrypoint.test.ts
C:/Users/myeon/il-it-da/tests/manuals/save-store-manual-edit.test.ts
C:/Users/myeon/il-it-da/tests/manuals/validate-manual-edit.test.ts
C:/Users/myeon/il-it-da/tests/owner/question-manual-context.test.ts
C:/Users/myeon/il-it-da/tsconfig.test.json
```