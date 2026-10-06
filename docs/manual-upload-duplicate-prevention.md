# 매뉴얼 업로드 중복 저장 방지

업로드·미리보기·저장 흐름 전반은 [manual-upload-preview-handover.md](manual-upload-preview-handover.md)를
따른다. 이 문서는 같은 매뉴얼이 여러 번 저장되는 문제를 막는 부분만 다룬다.

## 1. 왜 중복이 생겼나

확정 저장은 호출될 때마다 새 부모·자식 행을 만든다. 화면의 중복 클릭 방지(`isSaving`,
`isSubmittingRef`)는 같은 탭에서 연달아 누르는 경우만 막을 뿐, 다음은 막지 못했다.

- 응답을 받기 전에 새로고침하고 다시 저장
- 네트워크 계층의 요청 재전송
- 같은 파일로 미리보기를 다시 만들어 저장

그래서 "오로라 환불 처리 규칙"처럼 동일한 부모·자식 쌍이 여러 벌 쌓였다.

## 2. 두 가지를 구분해서 막는다

| 상황 | 판단 기준 | 결과 |
| --- | --- | --- |
| 같은 저장 요청의 재전송 | 미리보기가 발급한 `idempotencyKey` | 새 행을 만들지 않음. 이미 성공했으면 그때 저장한 행을 그대로 반환(200) |
| 같은 내용을 새로 업로드 | 서버가 계산한 content fingerprint | 409 + "이미 같은 내용의 매뉴얼이 등록되어 있어요..." |
| 아직 처리 중 | batch 상태 `processing` | 409 + "매뉴얼을 저장하고 있어요..." |

제목만으로는 절대 판단하지 않는다. 같은 제목이라도 범위가 다르거나 내용이 바뀌면 정상 저장된다.

## 3. fingerprint 정규화 규칙

`lib/manuals/manual-content-fingerprint.ts`에서 **서버가** 계산한다. 요청 본문의
hash/franchiseId/brandName/scopeType/userId는 읽지 않는다.

- 입력: 서버가 정한 scope(hq/store) + franchise/store 범위 + 최종 category/title/content +
  부모·자식 구조와 순서
- `\r\n`/`\r` → `\n`, 줄마다 앞뒤 공백 제거, 연속 공백·탭은 한 칸, 빈 줄 3줄 이상은 2줄로, 전체 trim
- 객체 대신 배열로 직렬화해 key 순서의 영향을 없앤다
- 제외한 항목, 클라이언트 임시 ID(`tempId`), `scopeType` 같은 표시용 필드는 확정 파싱 단계에서
  이미 빠지므로 fingerprint에 들어가지 않는다. UUID·created_at도 입력에 없다
- SHA-256 16진수 64자

**순서는 보존한다.** 저장 함수가 받은 순서대로 insert하고 목록 화면이 `category` → `created_at`
순으로 보여주기 때문에, 순서가 바뀌면 사용자가 보는 결과도 달라진다. 따라서 정렬하지 않고
재배열된 업로드는 다른 내용으로 취급한다.

## 4. 범위별 unique 계약

`manual_upload_batches`에 partial unique index 두 개를 둔다(020).

- HQ: `(coalesce(franchise_id, 고정 UUID), content_hash) where scope_type = 'hq'`
- 점주: `(store_id, content_hash) where scope_type = 'store'`

하나로 합치지 않는 이유는 PostgreSQL이 NULL을 서로 다른 값으로 취급해 `store_id`가 NULL인
HQ 행끼리는 중복이 걸러지지 않기 때문이다. 결과적으로 같은 내용이어도 **HQ와 지점**,
**서로 다른 지점**, **서로 다른 프랜차이즈**는 각각 저장된다.

## 5. 실패·부분 저장 정책

임베딩은 외부 호출이라 DB 트랜잭션에 넣을 수 없다. 그래서 "저장 성공"과 "검색 준비 완료"는
계속 분리된 상태로 둔다. 저장이 실패하면 그 batch가 실제로 만든 행 수를 함께 기록한다.

- **0건**: `failed`로 기록하고 fingerprint를 놓아준다 → 사용자가 그대로 다시 시도할 수 있다
- **1건 이상**: `failed`이지만 unique index가 계속 중복을 막는다 → 같은 내용이 두 벌 생기지 않는다.
  이때는 자동으로 지우거나 다시 넣지 않고, "이전 저장이 끝나지 않았어요" 안내로 사람이 확인하게 한다

자동 삭제·자동 복구를 하지 않는 이유는, 실패 시점에 어떤 행이 정상인지 서버가 단정할 수 없고
잘못 지우면 되돌릴 수 없기 때문이다.

## 6. 기존 중복 데이터 진단 (SELECT 전용)

이미 쌓인 중복 행은 마이그레이션이나 앱이 자동으로 지우지 않는다. 아래 쿼리로 규모만 확인하고,
정리는 관리 화면에서 수동으로 하거나 별도 승인을 받아 진행한다.
모두 집계 쿼리이며 실제 ID·본문·embedding 값을 출력하지 않는다.

```sql
-- 1) 같은 범위·같은 제목·같은 본문으로 중복된 후보 묶음과 개수
select
  m.scope_type,
  m.franchise_id is not null as has_franchise,
  m.store_id is not null as has_store,
  m.category,
  m.title,
  count(*) as duplicate_rows
from public.manuals as m
where m.parent_manual_id is null
group by m.scope_type, has_franchise, has_store, m.franchise_id, m.store_id, m.category, m.title, m.content
having count(*) > 1
order by duplicate_rows desc;

-- 2) 중복 부모마다 자식이 몇 개씩 달려 있는지(부모·자식 쌍 확인)
with duplicated_parents as (
  select m.id, m.title, m.scope_type
  from public.manuals as m
  join (
    select scope_type, franchise_id, store_id, category, title, content
    from public.manuals
    where parent_manual_id is null
    group by scope_type, franchise_id, store_id, category, title, content
    having count(*) > 1
  ) as dup
    on dup.title = m.title
   and dup.content = m.content
   and dup.category = m.category
   and dup.scope_type = m.scope_type
   and dup.franchise_id is not distinct from m.franchise_id
   and dup.store_id is not distinct from m.store_id
  where m.parent_manual_id is null
)
select
  p.scope_type,
  p.title,
  count(c.id) as child_count
from duplicated_parents as p
left join public.manuals as c on c.parent_manual_id = p.id
group by p.scope_type, p.title, p.id
order by p.title;

-- 3) 중복 묶음에 딸린 chunk 총 개수(정리 시 함께 사라질 양)
select
  m.scope_type,
  m.title,
  count(ch.id) as chunk_count
from public.manuals as m
join public.manual_chunks as ch on ch.manual_id = m.id
where m.title in (
  select title
  from public.manuals
  where parent_manual_id is null
  group by scope_type, franchise_id, store_id, category, title, content
  having count(*) > 1
)
group by m.scope_type, m.title
order by chunk_count desc;

-- 4) 새 업로드 batch 현황(처리 중이거나 부분 저장으로 막혀 있는 요청 확인)
select status, scope_type, count(*) as batches, sum(manual_count) as manuals_created
from public.manual_upload_batches
group by status, scope_type
order by status;
```

## 7. 한계

- 020 마이그레이션은 **아직 실제 Supabase에 적용하지 않았다.** 적용 전까지는 중복 방지가
  동작하지 않는다(`upload_batch_id` 컬럼과 batch 테이블이 없으면 저장 요청이 실패한다).
- 기존 매뉴얼의 `upload_batch_id`는 NULL이다. 백필하지 않으므로, 이미 저장된 내용과 동일한
  파일을 새로 올리는 경우는 막히지 않는다(같은 내용의 첫 batch가 만들어진 이후부터 막힌다).
- 저장은 성공했지만 임베딩이 실패한 경우는 여전히 별도 상태다. 중복 방지와는 별개 문제다.
