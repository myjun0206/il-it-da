# 매뉴얼 상위 카테고리 분류 계약 (Manual Category Taxonomy Proposal)

> **이 문서는 분류 계약(제안서)입니다.** 실제 분류 파서 구현이나 Supabase 스키마/마이그레이션,
> UI 구현을 확정하거나 변경하지 않습니다. `tests/fixtures/manual-categories/`의 fixture는
> 공태현 팀원이 DB 저장 방식을 확정하기 전까지 참고할 수 있는 계약이며, 저장 방식이
> 확정되면 이 문서와 fixture도 함께 갱신해야 합니다.

## 1. 목표와 범위

- M Coffee 본사 공통 매뉴얼 19개는 **그대로 유지**한다. 개수, 제목, `manuals`/`manual_chunks`
  행, 임베딩은 전혀 바꾸지 않는다. 이 19개의 **원본(Excel) `scope_type`은 `common`**이지만,
  최종 DB/RAG 계약에서의 `scope_type`은 `common`이 아니다 — 자세한 내용은 2절 참고.
- **사용자 화면(탐색/관리 UI)에서만** 이 19개를 아래 6개 상위 카테고리로 묶어서 보여준다.
- **RAG 검색은 기존과 동일하게 19개 세부 매뉴얼과 그 청크를 그대로 검색한다.** 상위
  카테고리는 검색 스코프나 임베딩 단위가 아니다 — 청크를 상위 카테고리 단위로 합치거나
  다시 나누지 않는다.
- 상위 카테고리는 오직 **탐색·관리 UI를 위한 분류값**이다. DB에 실제로 어떻게 저장할지
  (예: `manuals.category`를 그대로 쓸지, 별도 컬럼/테이블을 새로 만들지)는 이 문서의 범위가
  아니며, 공태현 팀원이 결정한다.

## 2. scope_type 정규화 계약: Excel `common` → 최종 DB `hq`

원본 Excel은 M Coffee 본사 공통 매뉴얼을 `scope_type = "common"`으로 표시한다. 하지만 현재
운영 중인 RAG 검색 RPC(`018_scoped_hybrid_manual_search.sql`의
`match_manual_chunks_hybrid_scoped`)는 최종 DB 값으로 `scope_type = 'hq'` 또는
`'store'`만 검색 대상으로 인정한다(`docs/manual-file-format-contract.md`,
`tests/rag/manual-search-scope.test.ts` 참고). 이 계약을 명시적으로 분리한다.

- **원본(Excel) 값**: 본사 공통 매뉴얼은 `common`, 지점 전용 매뉴얼은 `store`로 표시되어
  들어온다.
- **업로드 정규화 단계**에서 원본 `common`은 최종 DB 저장 전에 **`hq`로 변환**한다.
  원본 `store`는 그대로 `store`로 유지한다(변환하지 않는다).
- **최종 DB/RAG 계약은 `hq`/`store` 두 값만 사용**한다. `common`을 최종 DB의 `scope_type`
  컬럼에 그대로 저장하는 것은 **금지**한다 — 그렇게 저장하면 018 scoped RPC의 검색
  조건(`m.scope_type = 'hq' ...` 또는 `m.scope_type = 'store' ...`)에 걸리지 않아 해당
  매뉴얼이 RAG 검색 결과에서 통째로 빠지게 된다.
- 이 표기 계약은 `tests/fixtures/manual-categories/m-coffee-common-taxonomy.json`에도
  그대로 반영되어 있다: 원본 값은 `sourceScopeType: "common"`, 최종(정규화된) 값은
  `scopeType: "hq"`로 분리해서 기록한다.
- **실제 변환 코드(업로드 정규화 로직)는 이번 작업에서 구현하지 않는다.** 이 절은 계약만
  정의하며, 공태현 팀원이 실제 정규화 코드를 구현할 때 참고한다.

## 3. `parent_manual_id`와 상위 카테고리는 다른 개념이다

`manuals.parent_manual_id`는 기존 코드에서 "주제 카드(부모) - 세부 항목(자식)" 계층을
표현하는 데 쓰인다(부모는 청크되지 않고, 자식만 `manual_chunks`를 갖는다 — 자세한 내용은
`docs/manual-indexing-pipeline.md` 참고). 이 문서가 제안하는 **상위 카테고리 6개는
`parent_manual_id` 계층과 절대 같은 개념으로 취급하지 않는다.**

- 19개 공통 매뉴얼은 이미 각자 독립된 `manuals` 행(및 청크)이다. 상위 카테고리로 묶는다고
  해서 이 중 하나가 다른 것의 `parent_manual_id`가 되거나, 6개의 새로운 "가짜 부모" 매뉴얼
  행이 생기는 것이 아니다.
- 상위 카테고리를 실제로 어떻게 저장할지(새 컬럼, 매핑 테이블, 프론트엔드 상수 등)는
  이후 별도로 결정한다. 이 문서와 fixture는 그 저장 방식을 어떤 식으로든 미리 확정하지
  않는다.

## 4. 상위 카테고리 6개와 세부 매뉴얼 매핑

`tests/fixtures/manual-categories/m-coffee-common-taxonomy.json`이 아래 표의 유일한
정본(source of truth)이다. 이 문서는 표로 요약만 한다.

| key | label | 개수 | 세부 매뉴얼 제목 |
|---|---|---|---|
| `store_operations_staff` | 매장 운영 및 직원 업무 | 4 | 프랜차이즈 매뉴얼 적용 원칙, 신규 직원 업무 안내, 교대 및 인수인계, 교대 인수인계 체크리스트 |
| `opening_closing` | 오픈 및 마감 | 2 | 오픈 운영, 마감 운영 |
| `ordering_payment_customer_service` | 주문·결제 및 고객 응대 | 6 | 고객 응대 및 주문 처리, POS 및 결제 관리, 환불·취소·보상 처리 기준, 주문·포장·픽업 처리, 쿠폰·포인트·프로모션 관리, 분실물 및 고객 물품 대응 |
| `menu_recipe` | 메뉴 제조 및 레시피 | 1 | 음료 제조 및 레시피 관리 |
| `inventory_ordering_equipment` | 재고·발주 및 장비 | 3 | 재고 관리, 재고 발주 기준, 장비 세척 및 관리 |
| `hygiene_safety_emergency` | 위생·안전 및 비상 대응 | 3 | 위생 및 청소 관리, 긴급 상황 대응, 식품 안전 및 이물질 대응 |

합계 4+2+6+1+3+3 = **19개**, 누락·중복 없이 정확히 한 번씩만 등장한다(검증은
`tests/manuals/manual-category-taxonomy.test.ts` 참고).

## 5. 분류 규칙 — fail-closed(자동 추측 금지) 원칙

세부 매뉴얼 제목을 상위 카테고리에 배정할 때는 **4절 표의 제목 문자열과 정확히 일치**하는
경우에만 해당 상위 카테고리로 분류한다.

- 제목에 오타가 있거나, 공백/특수문자가 다르거나, 표에 아예 없는 새 제목이면 **자동으로
  비슷한 카테고리를 추측하지 않는다.** 이런 경우 `UNCLASSIFIED`(미분류)로 남기고, 사람이
  검토해서 4절 표(또는 새 상위 카테고리)를 갱신하도록 한다.
- `UNCLASSIFIED`는 매뉴얼을 숨기거나 삭제하는 것이 아니다 — 세부 매뉴얼은 그대로 조회·검색
  가능해야 하고, 다만 상위 카테고리 그룹 UI에서는 "미분류" 묶음에 놓인다.
- 이 fail-closed 원칙은 잘못된 자동 분류로 인해 실제 매뉴얼이 엉뚱한 상위 카테고리에
  숨어버리는 것을 방지하기 위함이다.

## 6. 기존(Excel) category → 상위 카테고리 정규화 제안

M Coffee 매뉴얼 업로드 Excel/CSV의 기존 `category` 값은 19개보다 더 거친(coarse) 단위로
되어 있을 수 있다. 아래는 그 기존 category 값들을 6개 상위 카테고리로 정규화하는 제안이다
— 마찬가지로 **제안일 뿐 확정이 아니며**, 실제 파서에는 아직 구현하지 않는다.

| 기존 category | 상위 카테고리로 정규화 |
|---|---|
| `매장운영` | 제목이 정확히 "오픈 운영" 또는 "마감 운영"이면 → `opening_closing`(오픈 및 마감). 그 외 본사 공통 운영 제목이면 → `store_operations_staff`(매장 운영 및 직원 업무) |
| `주문·결제`, `고객응대` | → `ordering_payment_customer_service`(주문·결제 및 고객 응대) |
| `음료제조`, `메뉴제조` | → `menu_recipe`(메뉴 제조 및 레시피) |
| `재고·발주`, `장비관리` | → `inventory_ordering_equipment`(재고·발주 및 장비) |
| `위생·안전` | → `hygiene_safety_emergency`(위생·안전 및 비상 대응) |

위 표의 모든 기존 category 값은 6개 상위 카테고리 중 하나로 연결될 수 있다. `매장운영`만
제목 기반의 추가 분기(tie-break)가 필요하고, 나머지는 1:1 또는 N:1로 상위 카테고리에
직접 연결된다. 이 표에 없는 기존 category 값을 새로 만나면 5절의 fail-closed 원칙에 따라
`UNCLASSIFIED`로 남긴다.

## 7. 향후 확장 원칙 (B Burger, store 전용 매뉴얼)

- **다른 브랜드(B Burger 등)**: 이 문서의 taxonomy는 `brandName: "M Coffee"` /
  원본(Excel) `sourceScopeType: "common"`(최종 DB `scopeType: "hq"`)에만 적용된다.
  브랜드마다 업무 구조와 세부 매뉴얼 제목이 다를 수 있으므로, 브랜드별로 **별도의 taxonomy
  fixture/문서**를 만든다(이 파일을 억지로 재사용해 다른 브랜드의 제목을 끼워 맞추지 않는다).
- **store 전용(원본·최종 모두 `scope_type = store`) 매뉴얼**: 지점이 자체적으로 추가한
  매뉴얼은 본사 공통 taxonomy에 강제로 편입시키지 않는다. store 전용 매뉴얼은 기본적으로
  `UNCLASSIFIED`(또는 지점 자체 카테고리)로 두고, 필요하면 별도의 store-scope taxonomy를
  정의한다. `store`는 원본과 최종 DB 값이 같으므로(2절) 별도 변환이 필요 없다.
- 브랜드/스코프가 늘어나도 4절 표처럼 "제목 → 상위 카테고리" 매핑이 정본이며, 어떤 자동
  추측 로직도 5절의 fail-closed 원칙을 벗어나지 않는다.

## 8. 참고

- 세부 매뉴얼 자체의 저장/청크/임베딩 계약은 이 문서가 아니라
  `docs/manual-indexing-pipeline.md`, `docs/manual-file-format-contract.md`를 따른다.
- 이 문서와 fixture는 100% 규칙 기반이며, AI/OpenAI/Vision/OCR을 전혀 사용하지 않는다.
