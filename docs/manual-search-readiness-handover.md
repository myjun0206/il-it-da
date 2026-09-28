# 검색 준비 상태와 재처리 인수인계

매뉴얼 업로드·미리보기·저장 흐름은 [manual-upload-preview-handover.md](manual-upload-preview-handover.md)를
따른다. 이 문서는 그 다음 단계인 "저장된 매뉴얼이 실제로 챗봇 검색에 쓰이는가"만 다룬다.

## 1. 저장 성공 ≠ 검색 준비 완료

`saveManualGroupsWithChunks`는 저장 후 자식 매뉴얼을 청크·임베딩하지만, 개별 임베딩 실패는
로그만 남기고 API는 그대로 201을 반환한다. 018 scoped RPC는
`status = 'approved'`이고 `manual_chunks.embedding is not null`인 청크만 검색하므로,
청크가 없거나 embedding이 비어 있는 자식 매뉴얼은 **저장돼 있어도 답변에 쓰이지 않는다.**
그래서 저장 완료 안내와 검색 준비 상태를 화면에서 분리했다.

## 2. 상태 판정 기준

새 컬럼이나 마이그레이션 없이 기존 `manuals` + `manual_chunks` 행만으로 계산한다
(`lib/manuals/manual-search-readiness.ts`).

| 내부 키 | 화면 문구 | 조건 |
| --- | --- | --- |
| `ready` | 검색 준비 완료 | 자식 + `approved` + 청크 1개 이상 + 모든 청크에 embedding 있음 |
| `needs_reindex` | 검색 준비 필요 | 자식 + `approved` + 청크 없음, 또는 embedding이 비어 있는 청크가 1개 이상 |
| `not_searchable` | 검색 대상 아님 | 자식이지만 `approved`가 아님(draft 등) |
| `parent_only` | 상위 항목 | `parent_manual_id`가 없는 주제 카드 |

- 집계(전체 세부 매뉴얼 수 / 준비 완료 / 재처리 필요 / 검색 대상 아님)는 자식만 센다.
- **부모는 재처리하지 않는다.** 저장 시에도 부모는 청크하지 않으며, 부모 본문은
  `"N개 항목"` 같은 요약이라 검색 대상이 아니다. 따라서 오류나 재처리 대상으로 세지 않는다.

## 3. API

| 주체 | 상태 조회 | 재처리 |
| --- | --- | --- |
| HQ | `GET /api/manuals/search-readiness` | `POST /api/manuals/search-readiness/reindex` (`{ manualId }`) |
| 점주 | `GET /api/store-manuals/search-readiness?storeId=` | `POST /api/store-manuals/search-readiness/reindex` (`{ storeId, manualId }`) |

- 범위: HQ는 `requireHqUser()`의 franchise + `store_id is null`, 점주는 `requireStoreOwner()`로
  재검증한 `storeAuth.storeId`. 요청의 `franchiseId`/`brandName`/`scopeType`은 읽지 않는다.
- 응답에는 본문, embedding 값, 이메일, 사용자 ID, franchiseId, storeId를 넣지 않는다.
- 화면: `components/manuals/ManualSearchReadinessPanel.tsx`를 HQ·점주 매뉴얼 화면이 공유한다.

## 4. 재처리 방식

재처리는 **자식 매뉴얼 1건 단위**로만 동작한다(무제한 일괄 재처리 API는 두지 않는다).
서버는 색인 전에 순서대로 다시 확인한다.

1. 로그인 사용자
2. HQ 또는 승인된 owner 권한
3. DB에서 읽은 매뉴얼 행이 인증된 franchise/store 범위에 속하는지
4. `parent_manual_id`가 있는 실제 자식인지
5. `status = 'approved'`인지

(3~5는 `lib/manuals/manual-reindex-guard.ts`의 `checkManualReindexAllowed`가 담당한다.)

통과하면 기존 `indexManualById`를 호출한다. 이 경로는 001의
`unique (manual_id, chunk_index)`에 대한 upsert와 뒤쪽 stale 청크 삭제를 그대로 쓰므로,
여러 번 눌러도 청크가 중복되지 않는다. 실패 시 OpenAI/DB 원본 오류 대신 고정 문구를 반환한다.

## 5. 공태현 팀원이 실제 파일 테스트 후 확인할 항목

- [ ] 업로드·저장 직후 목록 화면의 "검색 준비 상태" 요약에서 준비 완료 수가 저장한 세부 매뉴얼 수와 같은지
- [ ] 다르다면 "자세히 보기"에서 어떤 항목이 "검색 준비 필요"인지, 파싱 결과 본문이 비어 있지는 않은지
- [ ] 파서 규칙을 바꾼 뒤 같은 파일을 다시 올렸을 때 항목 수와 준비 완료 수가 함께 변하는지
- [ ] "검색 준비 다시 하기"를 여러 번 눌러도 중복 청크가 생기지 않는지(아래 SQL로 확인)
- [ ] 준비 완료로 바뀐 매뉴얼이 직원 챗봇 답변의 근거로 실제 검색되는지

## 6. 브라우저 수동 검증

- [ ] HQ 공통 매뉴얼 화면에 요약 카드(준비 완료 / 준비 필요 / 검색 대상 아님)가 보인다
- [ ] "자세히 보기"를 열면 세부 매뉴얼마다 상태 배지가 보인다
- [ ] "검색 준비 필요" 항목에만 "검색 준비 다시 하기" 버튼이 보인다
- [ ] 버튼을 누르면 비활성화되고, 끝난 뒤 상태가 자동으로 다시 조회된다
- [ ] 실패 시 쉬운 한국어 안내가 뜨고 기술 용어나 원본 오류가 보이지 않는다
- [ ] 점주 화면에서 자기 지점 상태만 보인다
- [ ] 키보드 Tab/Enter만으로 펼치기와 재처리를 할 수 있다
- [ ] 모바일 폭에서 카드와 목록이 깨지지 않는다

## 7. 실제 Supabase 확인용 SQL (조회 전용)

아래는 모두 `SELECT`다. 이 문서에는 실제 데이터를 바꾸는 `UPDATE`/`DELETE`를 넣지 않는다.
데이터 변경이 필요하면 별도 승인을 받는다.

```sql
-- 1) embedding이 비어 있는 청크 수
select count(*) as null_embedding_chunks
from public.manual_chunks
where embedding is null;

-- 2) 승인된 자식 매뉴얼인데 청크가 아예 없는 건수
select count(*) as children_without_chunks
from public.manuals as m
where m.parent_manual_id is not null
  and m.status = 'approved'
  and not exists (select 1 from public.manual_chunks as c where c.manual_id = m.id);

-- 3) 범위별 검색 준비 필요 건수
select
  m.scope_type,
  count(*) as needs_reindex
from public.manuals as m
where m.parent_manual_id is not null
  and m.status = 'approved'
  and (
    not exists (select 1 from public.manual_chunks as c where c.manual_id = m.id)
    or exists (select 1 from public.manual_chunks as c where c.manual_id = m.id and c.embedding is null)
  )
group by m.scope_type;

-- 4) 청크 중복 점검 (unique 제약이 살아 있으면 항상 0행)
select manual_id, chunk_index, count(*)
from public.manual_chunks
group by manual_id, chunk_index
having count(*) > 1;
```
