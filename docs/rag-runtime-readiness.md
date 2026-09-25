# RAG 런타임 준비 상태 점검 (018 scoped RPC)

이 문서는 `supabase/migrations/018_scoped_hybrid_manual_search.sql`이 실제 Supabase 프로젝트에
적용됐는지, RAG 검색이 실행될 준비가 됐는지를 **DB를 변경하지 않고** 확인하는 절차를 담는다.

## 1. 계약 분석 요약

- **018 RPC**: `public.match_manual_chunks_hybrid_scoped(query_embedding vector(1536), query_text text, query_keywords text[], target_store_id uuid, target_franchise_id uuid, match_count integer default 5)` → `(chunk_id, manual_id, title, category, content, raw_similarity_score, keyword_boost, similarity_score)`.
- **TypeScript 호출부**(`lib/rag/search-manual-chunks.ts`)는 동일한 6개 파라미터 이름(`query_embedding`, `query_text`, `query_keywords`, `target_store_id`, `target_franchise_id`, `match_count`)으로 `supabase.rpc(...)`를 호출한다 — 이름/개수 정확히 일치(`scripts/integration-check/check-repository.mjs`의 `checkScopedRpcMigrationContract`로 회귀 검사 자동화됨).
- **migration 미적용 시 예상 실패**: 실제 DB에 함수가 없으면 `supabase.rpc("match_manual_chunks_hybrid_scoped", ...)`가 Postgres `42883 (undefined function)` 오류를 반환하고, `search-manual-chunks.ts`가 이를 고정 메시지로만 로그(`"RAG store-scoped hybrid search failed."`)한 뒤 던지며, `app/api/rag/query/route.ts`의 catch 블록이 `500 { error: "Unable to answer the question." }`로 응답한다(기존 계약, 신규 오류 코드 없음).
- **`stores.franchise_id`가 null**이면 `resolveRagStoreFranchiseForRequest`가 `UNRESOLVED`를 반환하고 `route.ts`가 검색 자체를 실행하지 않고 동일한 500 응답으로 fail-closed된다.
- **`manuals.scope_type`이 소문자 `hq`/`store`가 아니면**(null, `HQ`, `STORE`, `common`, `shared` 등 — 004/010 CHECK 제약은 이 값들도 허용) 018 RPC의 WHERE절(`scope_type = 'hq'` / `= 'store'` 정확히 소문자 비교)에 걸리지 않아 **그 매뉴얼은 조용히 검색에서 빠진다**(오류는 아니지만 실질적으로 검색 불가 상태).
- **approved 매뉴얼에 chunk가 없으면** 그 매뉴얼은 RPC 결과에 전혀 나타나지 않는다(오류 없이 조용히 제외).
- **chunk의 embedding이 null이면** 018 RPC의 `mc.embedding is not null` 조건에 걸려 제외된다(005/010과 동일한 기존 계약).
- **HQ 공통 매뉴얼 필수 조건**: `status='approved'`, `scope_type='hq'`, `store_id is null`, `franchise_id`가 실제 존재하는 franchise를 가리킴, 최소 1개의 `embedding not null` chunk.
- **store 전용 매뉴얼 필수 조건**: `status='approved'`, `scope_type='store'`, `store_id`가 실제 존재하는 store를 가리킴, 최소 1개의 `embedding not null` chunk.
- **최소 점검 항목**(2절 SQL이 그대로 다룸): RPC 존재 여부, franchise_id 누락 store 수, 잘못된/누락된 scope_type 매뉴얼 수, approved 매뉴얼 수, chunk 없는 approved 매뉴얼 수, embedding null chunk 수, franchise별/store별 검색 준비 매뉴얼 수, parent/child별 준비 chunk 수.

정적 코드 계약(파라미터 이름 일치 등)은 `npm run check:integration`이 자동 확인한다. 아래 SQL은
**실제 DB 상태**(함수가 배포됐는지, 데이터가 준비됐는지)를 확인하는 별도 단계다.

## 2. 비파괴 점검 SQL (Supabase SQL Editor에서 실행)

전부 `SELECT`뿐이며 `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`ALTER`/`DROP`/`CREATE`는 없다.
결과는 개수(count)와 boolean만 나오며, UUID·이메일·매뉴얼 본문·질문/답변 원문은 어디에도 없다.

```sql
-- 2-1. scoped RPC가 실제로 배포됐는지 (pg_proc/pg_namespace만 읽음, 실행하지 않음)
select exists (
  select 1
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'match_manual_chunks_hybrid_scoped'
) as scoped_rpc_exists;

-- 2-2. franchise_id가 비어있는 store 개수 (011/012 백필이 다 됐는지)
select count(*) as stores_missing_franchise_id
from public.stores
where franchise_id is null;

-- 2-3. scope_type이 없거나 'hq'/'store'가 아닌 manual 개수 (018 RPC에서 조용히 제외되는 대상)
select count(*) as manuals_with_unexpected_scope_type
from public.manuals
where scope_type is null
   or scope_type not in ('hq', 'store');

-- 2-4. approved manual 총 개수
select count(*) as approved_manual_count
from public.manuals
where status = 'approved';

-- 2-5. approved인데 chunk가 하나도 없는 manual 개수
select count(*) as approved_manuals_without_chunks
from public.manuals m
where m.status = 'approved'
  and not exists (
    select 1 from public.manual_chunks mc where mc.manual_id = m.id
  );

-- 2-6. approved manual의 chunk 중 embedding이 null인 개수
select count(*) as approved_manual_chunks_with_null_embedding
from public.manual_chunks mc
join public.manuals m on m.id = mc.manual_id
where m.status = 'approved'
  and mc.embedding is null;

-- 2-7. franchise별 "검색 가능한" HQ 공통 매뉴얼 준비 현황 (건수만 집계, franchise_id 원문 미노출)
select
  count(*) filter (
    where m.status = 'approved'
      and m.scope_type = 'hq'
      and m.store_id is null
      and exists (
        select 1 from public.manual_chunks mc
        where mc.manual_id = m.id and mc.embedding is not null
      )
  ) as hq_common_manuals_search_ready,
  count(distinct m.franchise_id) filter (
    where m.status = 'approved'
      and m.scope_type = 'hq'
      and m.store_id is null
      and exists (
        select 1 from public.manual_chunks mc
        where mc.manual_id = m.id and mc.embedding is not null
      )
  ) as franchises_with_search_ready_hq_manual
from public.manuals m;

-- 2-8. store별 "검색 가능한" 지점 전용 매뉴얼 준비 현황 (건수만 집계, store_id 원문 미노출)
select
  count(*) filter (
    where m.status = 'approved'
      and m.scope_type = 'store'
      and m.store_id is not null
      and exists (
        select 1 from public.manual_chunks mc
        where mc.manual_id = m.id and mc.embedding is not null
      )
  ) as store_manuals_search_ready,
  count(distinct m.store_id) filter (
    where m.status = 'approved'
      and m.scope_type = 'store'
      and m.store_id is not null
      and exists (
        select 1 from public.manual_chunks mc
        where mc.manual_id = m.id and mc.embedding is not null
      )
  ) as stores_with_search_ready_manual
from public.manuals m;

-- 2-9. parent(주제 카드)/child(세부 항목)별 chunk 준비 현황
select
  count(*) filter (where m.parent_manual_id is null) as root_or_parent_manual_count,
  count(*) filter (
    where m.parent_manual_id is null
      and exists (select 1 from public.manual_chunks mc where mc.manual_id = m.id and mc.embedding is not null)
  ) as root_or_parent_manuals_with_ready_chunks,
  count(*) filter (where m.parent_manual_id is not null) as child_manual_count,
  count(*) filter (
    where m.parent_manual_id is not null
      and exists (select 1 from public.manual_chunks mc where mc.manual_id = m.id and mc.embedding is not null)
  ) as child_manuals_with_ready_chunks
from public.manuals m
where m.status = 'approved';
```

**판정 기준**: `scoped_rpc_exists = true` 이고 `hq_common_manuals_search_ready > 0`(또는 검증하려는
franchise 최소 1건) 이고 `store_manuals_search_ready > 0`(검증하려는 store 최소 1건)이면 RAG 검색을
실행할 준비가 된 것으로 본다. `stores_missing_franchise_id`, `manuals_with_unexpected_scope_type`,
`approved_manuals_without_chunks`, `approved_manual_chunks_with_null_embedding`이 0보다 크면 해당
건수만큼 검색에서 조용히 빠지는 데이터가 있다는 뜻이다(오류는 아님).

## 3. Migration 적용 절차 (실행하지 않음 — 문서만)

### A. Supabase CLI로 적용하는 팀 절차가 있을 때

1. `supabase projects list` 또는 `supabase status`로 **현재 연결된 프로젝트**가 맞는지 확인한다.
2. `supabase db diff` 또는 `supabase migration list`로 **적용 예정 migration 목록**에 `018_scoped_hybrid_manual_search.sql`이 포함돼 있는지 확인한다(이미 적용된 항목과 구분).
3. 팀의 기존 배포 절차대로 `018`을 적용한다(예: `supabase db push`) — 이 문서는 실행 여부만 안내하며 실제로 실행하지 않는다.
4. 적용 후 위 2-1 SQL(`scoped_rpc_exists`)을 다시 실행해 `true`가 나오는지 확인한다.

### B. Supabase Dashboard SQL Editor를 사용할 때

1. `supabase/migrations/018_scoped_hybrid_manual_search.sql` 파일 내용을 저장소에서 그대로 열어 검토한다(수정하지 않음).
2. Dashboard의 SQL Editor에 파일 내용을 그대로 붙여넣고 실행한다(파일 내용 자체가 이미 `create or replace function`이라 재실행해도 안전하다 — 새 함수를 drop/recreate하는 별도 문장을 추가하지 않는다).
3. 실행 후 Database → Functions(또는 2-1 SQL)로 `match_manual_chunks_hybrid_scoped` 함수와 6개 인자가 보이는지 확인한다.
4. 2절의 점검 SQL 전체를 다시 실행해 개수/boolean이 기대와 맞는지 확인한다.

**주의**: 이미 운영 DB에 존재하는 함수를 임의로 `drop`하거나 `db reset`을 실행하라고 제안하지
않는다. `018` 파일은 이미 `create or replace function`이라 기존 배포본이 있어도 안전하게
재적용 가능하다. Service role key는 어떤 절차에도 커맨드라인 인자로 노출하지 않는다(환경변수/
Supabase 로그인 세션으로만 인증).

## 4. 실제 브라우저 수동 검증 체크리스트 (migration 적용 후)

| # | 시나리오 | 예상 결과 |
|---|---|---|
| 1 | approved staff가 자기 지점 매뉴얼 관련 질문 | 답변 가능(`status: "answered"` 또는 `"cautious"`) |
| 2 | 같은 franchise의 HQ 공통 매뉴얼 관련 질문 | 답변 가능 |
| 3 | 같은 franchise의 **다른 지점** 전용 매뉴얼에만 있는 내용 질문 | 검색 결과에서 제외 → `insufficient` |
| 4 | **다른 franchise**의 HQ 공통 매뉴얼에만 있는 내용 질문 | 검색 결과에서 제외 → `insufficient` |
| 5 | 어떤 매뉴얼에도 없는 질문 | `insufficient`, `NO_MANUAL_ANSWER` 문구 |
| 6 | pending/rejected 계정으로 직접 API 호출 | `401`(미인증) 또는 `403`(미승인) |
| 7 | `stores.franchise_id`가 없는 레거시 매장 소속 staff | 검색 미실행, 500(fail-closed), 응답/로그에 store/franchise 값 없음 |
| 8 | embedding이 null인 매뉴얼만 관련된 질문 | 검색 결과에서 제외 → `insufficient` |
| 9 | 위 1·2번 응답의 `status`/`similarity`/`source`/`matches` 필드 존재 확인 | 기존 shape 그대로 |
| 10 | 질문 성공/실패 각각 `question_logs`에 저장됐는지(내용 열람 없이 행 존재만 확인) | 저장됨 |
