# 매뉴얼 인덱싱 파이프라인 코어 (공태현 팀원 연결 문서)

이 문서는 `lib/rag/manual-indexing/**`에 구현된 인덱싱 파이프라인 코어와, 파일 파싱·카테고리 분류를
담당하는 공태현 팀원의 결과물이 만나는 경계(정규화 입력 계약)를 설명한다.

## 담당 경계

- **공태현 팀원 책임**: Excel/CSV/TXT/MD/PDF 파싱, 매뉴얼 내용 분리, 상위 카테고리/세부 항목 분류.
  카테고리 이름·개수·상위/하위 관계를 결정하는 모든 로직이 여기에 속한다.
- **이 파이프라인 책임**: 공태현 팀원이 넘긴 정규화된 결과를 입력으로 받아 검증 → `manuals` 저장 →
  청크 생성 → embedding 생성 → `manual_chunks` 저장 → 결과 집계까지만 담당한다. **카테고리를 다시
  분류하거나 상위/하위 관계를 재해석하지 않는다.**
- 파일 파서, 확장자별 처리, 업로드 UI(`app/api/manuals/upload/**` 등)는 이번 작업에서 수정하지
  않았다.

## 정규화 입력 계약 (`NormalizedManualInput`, `lib/rag/manual-indexing/types.ts`)

| 필드 | 타입 | 설명 |
|---|---|---|
| `externalId` | `string` (필수) | 이번 호출(배치) 안에서만 쓰이는 상관관계 키. **DB에 저장되지 않는다** (`manuals` 테이블에 해당 컬럼이 없음). |
| `existingManualId` | `string \| null` (선택) | 이미 존재하는 실제 `public.manuals.id`. 있으면 insert 대신 update — 매뉴얼 단위 재실행 안전성의 유일한 경로. |
| `title` | `string` (필수) | 그대로 저장. |
| `category` | `string` (필수) | **upstream 값 그대로 보존**. 이 파이프라인은 분류하거나 검증하지 않는다. |
| `content` | `string` (필수) | 그대로 저장 + 청크/embedding 입력으로 사용. |
| `scopeType` | `"hq" \| "store"` (필수) | `manuals.scope_type`에 매핑. |
| `storeId` | `string \| null` (선택) | `scopeType === "store"`일 때 필수. `scopeType === "hq"`이면 무시하고 `null`로 정규화한다(불필요한 값이 와도 오류 아님). |
| `parentExternalId` | `string \| null` (선택) | **같은 배치 안의** 다른 항목의 `externalId`를 참조. 1단계 깊이만 지원(부모의 부모 참조는 거부). |
| `status` | `"draft" \| "approved"` (필수) | 기존 `manuals.status` 정책 그대로. |
| `franchiseId`, `brandName` | 선택 | 있으면 그대로 저장, 없으면 `null`. |

### HQ 예시
```json
{ "externalId": "hq-open-checklist", "title": "오픈 체크리스트", "category": "오픈/마감",
  "content": "...", "scopeType": "hq", "status": "approved" }
```

### Store 예시
```json
{ "externalId": "store-42-open-checklist", "title": "강남점 오픈 체크리스트", "category": "오픈/마감",
  "content": "...", "scopeType": "store", "storeId": "11111111-1111-1111-8111-111111111111",
  "status": "approved" }
```

### Parent/child 예시 (주제 카드 + 세부 항목, `lib/rag/save-manual-sections.ts`와 동일한 계약)
```json
[
  { "externalId": "topic-1", "title": "청소 매뉴얼", "category": "청소", "content": "3개 항목",
    "scopeType": "hq", "status": "approved" },
  { "externalId": "topic-1-item-1", "parentExternalId": "topic-1", "title": "청소 매뉴얼",
    "category": "청소", "content": "바닥 청소 절차...", "scopeType": "hq", "status": "approved" }
]
```
`topic-1`처럼 **다른 항목의 부모로만 쓰이는 항목은 청크화하지 않는다** (주제 카드).
`topic-1-item-1`처럼 부모를 가진 항목(child) 또는 부모/자식 관계가 전혀 없는 단독 항목은 청크화된다.

## 파이프라인이 담당하는 단계

1. **validate** (`lib/rag/manual-indexing/validate.ts`): 제목/본문 비어있음, status/scopeType 허용값,
   store 범위 storeId 필수, 배치 내 externalId 중복, parent 참조 일관성(자기참조/미존재/2단계 이상 금지)만
   확인한다. 카테고리 값은 검증하지 않는다.
2. **persist manual**: `existingManualId`가 있으면 `update`, 없으면 `insert`. root(부모 없음) 항목을
   먼저 저장해 실제 DB id를 얻은 뒤, child 항목의 `parent_manual_id`에 그 실제 id를 채운다.
3. **chunk**: 부모 전용 항목(다른 항목의 parentExternalId로만 참조됨)과 draft 상태는 건너뛴다. 나머지는
   기존 `lib/rag/chunk-manual.ts`의 `chunkManualText`를 그대로 재사용한다(길이 제한도 그 함수가 그대로
   적용).
4. **generate embeddings**: 기존 `lib/rag/openai-embeddings.ts`의 `createEmbeddings`를 그대로 재사용.
   `indexApprovedManual`과 동일한 입력 형식(`브랜드: ...\n제목: ...\n카테고리: ...\n내용: ...`)을 사용한다.
5. **persist chunks** (`lib/rag/manual-indexing/persist-chunks.ts`): `lib/rag/index-approved-manual.ts`가
   이미 쓰던 것과 동일한 계약 — `upsert({ onConflict: "manual_id,chunk_index" })` 후 남는 chunk는
   `chunk_index >= 새 청크 수` 조건으로 삭제. 이 unique 제약은 `001_initial_rag_schema.sql`에 이미 있다.
6. **finalize**: `manualCount / chunkCount / indexedCount / skippedCount / failedCount / errorCodes`를
   집계해 반환한다.

## approved/draft, parent/child 정책 (기존 계약 확인 결과)

- 검색 RPC(`match_manual_chunks*`, 001/002/003/005/010)는 항상 `manuals.status = 'approved'`로 조인해
  걸러낸다. 이 파이프라인은 이를 신뢰해 **draft는 애초에 청크/embedding 단계를 건너뛴다** (검색 가능하게
  만들지 않음 + 불필요한 OpenAI 호출 절약).
- `lib/rag/save-manual-sections.ts`의 기존 구현은 "부모 = 주제 카드(청크 안 함) / 자식 = 세부 내용
  (청크함)" 계약을 이미 쓰고 있다. 이 파이프라인은 그 계약을 그대로 따른다.
- ⚠️ **확인 필요(blocker 아님, 주의사항)**: `010_franchises_and_hq_manuals.sql`의 주석은
  `parent_manual_id`를 "지점이 본사 매뉴얼을 상속/커스텀할 때 원본 본사 매뉴얼을 참조"하는 용도로
  설명하고 있어, 실제 구현(`save-manual-sections.ts`)의 "주제/세부 항목" 용법과 다르다. 이번 파이프라인은
  **실제 구현(코드)** 을 기준으로 삼았다. 공태현 팀원의 `parentExternalId`가 어느 의미로 쓰이는지
  실제 연결 전에 반드시 맞춰봐야 한다.

## 재실행 중복 방지 (idempotency)

- **청크/임베딩 레벨**: `manual_id, chunk_index` unique 제약(기존 migration, 신규 migration 없음) 덕분에
  같은 `manualId`로 다시 실행하면 upsert + stale 삭제로 완전히 idempotent하다.
- **매뉴얼(행) 레벨**: `manuals` 테이블에는 `externalId`를 저장할 컬럼이 없다(스키마에 임의로 추가하지
  않음). 따라서 **같은 정규화 배치를 `existingManualId` 없이 다시 제출하면 새 매뉴얼 행이 중복 생성된다.**
  이것이 이번 작업에서 새 migration 없이는 해결할 수 없는 **blocker**다. 우회책: 첫 실행 결과의
  `items[].manualId`를 호출자가 보관했다가, 재실행 시 같은 `externalId` 항목에 `existingManualId`로
  채워 넣으면 해당 매뉴얼은 insert 대신 update된다.

## 오류 코드

검증 단계(`ValidationErrorCode`): `TITLE_REQUIRED`, `CONTENT_REQUIRED`, `INVALID_STATUS`,
`INVALID_SCOPE_TYPE`, `STORE_ID_REQUIRED_FOR_STORE_SCOPE`, `EXTERNAL_ID_REQUIRED`,
`DUPLICATE_EXTERNAL_ID`, `INVALID_EXISTING_MANUAL_ID`, `PARENT_REFERENCE_SELF`,
`PARENT_REFERENCE_NOT_FOUND`, `PARENT_MUST_BE_ROOT`.

파이프라인 단계(`PipelineErrorCode`): `MANUAL_PERSIST_FAILED`, `EXISTING_MANUAL_NOT_FOUND`,
`CHUNKING_FAILED`, `EMBEDDING_FAILED`, `EMBEDDING_COUNT_MISMATCH`, `CHUNK_PERSIST_FAILED`.

모든 코드는 고정 문자열이며, 실패 로그에는 코드 + `error.name`만 남고 매뉴얼 본문/UUID/이메일/raw
Supabase·OpenAI 에러는 남기지 않는다.

## 아직 연결되지 않은 부분 (실제 route 연결 전 blocker)

1. **실제 API 라우트 없음**: 이번 작업은 `lib/rag/manual-indexing/**` 코어만 구현했다. 공태현 팀원의
   업로드 route(수정 금지 대상)가 파싱 결과를 `NormalizedManualInput[]`로 변환해 이 파이프라인을 호출하는
   연결 코드가 아직 없다.
2. **매뉴얼 행 재실행 중복**: 위 idempotency 절에서 설명한 대로, `existingManualId` 없이 재실행하면
   중복 행이 생긴다. 새 unique 컬럼(예: `manuals.external_id`) 없이는 완전히 해결할 수 없다.
3. **franchiseId/brandName 출처**: 실제 route에서는 인증된 HQ 사용자(`requireHqUser()` 등, 이번 작업
   범위 밖)로부터 이 값을 가져와야 한다. 이 파이프라인은 입력으로 그대로 받기만 한다.
4. **parent_manual_id 의미 확인**: 위에서 언급한 migration 주석과 실제 구현 간 불일치를 공태현 팀원과
   확인해야 한다.
5. **트랜잭션 부재**: Supabase JS 클라이언트에는 여러 테이블에 걸친 클라이언트 트랜잭션이 없다. 한
   매뉴얼의 "persist manual" 성공 후 "chunk/embedding/persist chunks" 중 어느 단계가 실패해도 매뉴얼
   행 자체는 이미 저장된 채로 남는다(그 매뉴얼의 `status`가 draft가 아니라 approved라면, 검색에는
   나타나지만 청크가 없거나 일부만 있는 상태가 될 수 있다). 배치 안의 다른 매뉴얼에는 영향을 주지 않는다
   (매뉴얼 단위로 격리됨).
