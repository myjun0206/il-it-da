# 매뉴얼 업로드 미리보기/확정 저장 인수인계

HQ·점주 매뉴얼 파일 업로드 → 미리보기 → 확정 저장 흐름의 요약이다. 파싱 규칙 자체는
[manual-file-format-contract.md](manual-file-format-contract.md), 상위 카테고리 기준은
[manual-category-taxonomy.md](manual-category-taxonomy.md)를 따른다.

## 1. 지원 형식

- 지원: `.txt`, `.md`, `.docx`, `.csv`, `.xlsx`, `.xls` (최대 10MB, 시트 20개, 시트당 5,000행)
- 미지원: PDF, 이미지, OCR — 업로드 시 거부된다.
- 파싱은 100% 규칙 기반이다(AI/OpenAI/OCR 미사용). 표 형식은 `parseExcelTableGroups`로 먼저
  분석하고, 표 구조를 인식하지 못하면 평탄화한 텍스트를 `parseManualText`로 분석한다.

## 2. API

| 주체 | 미리보기 (DB 쓰기 없음) | 확정 저장 | 인증 |
| --- | --- | --- | --- |
| HQ | `POST /api/manuals/preview` (file) | `POST /api/manuals/preview/confirm` (`{ manuals }`) | `requireHqUser()` |
| 점주 | `POST /api/store-manuals/preview` (file, storeId) | `POST /api/store-manuals/preview/confirm` (`{ storeId, manuals }`) | `requireStoreOwner()` |

- 화면: HQ `app/hq/manuals/onboarding/page.tsx`, 점주 `app/boss/store-manuals/upload/page.tsx`
  (진입: `app/boss/store-manuals/page.tsx`의 "미리보기로 올리기"). 편집 UI는 둘 다
  `components/manuals/ManualPreviewEditor.tsx`를 쓴다.
- confirm은 미리보기 결과를 신뢰하지 않고 매번 인증·권한을 다시 확인하고
  `parseConfirmedManualGroups`로 제목/카테고리/본문/개수·길이 제한을 다시 검증한다.
  `tempId`, `scopeType`, `franchiseId`, `brandName`은 요청에서 읽지 않는다.

## 3. 저장 구조와 범위

- `manuals.category` = 상위 카테고리 라벨. 부모(주제 카드)와 자식(세부 항목) 모두 같은 값을 저장한다.
- 부모: `parent_manual_id = null`, `title = 세부 매뉴얼 제목`. 자식: `parent_manual_id = 부모 id`.
- 범위는 서버가 강제한다: HQ(common) → `scope_type = 'hq'`, `store_id = null`,
  점주 → `scope_type = 'store'`, `store_id = 검증된 storeId`.
- 점주의 `franchise_id`/`brand_name`은 `stores.franchise_id` → `franchises`로 서버가 조회한다.
  매장에 `franchise_id`가 없거나 franchise를 찾지 못하면 403으로 거부된다.
- 자식만 청크·임베딩한다(부모는 청크화하지 않음). 개별 임베딩 실패는 로그만 남기고 저장은 성공으로 응답한다.
- 분류하지 못한 항목은 내부 키(`unclassified`)가 아니라 "분류 확인 필요" 라벨로 저장된다.

## 4. 파서 규칙 추가 위치

- 표(CSV/XLSX): `lib/manuals/parse-excel-table.ts`
- 텍스트(TXT/MD/DOCX 본문): `lib/manuals/analyze-manual-with-ai.ts`의 `parseManualText`
  (이름과 달리 규칙 기반), 항목 판별은 `lib/manuals/detect-manual-item.ts`
- 형식 분기: `lib/manuals/extract-manual-groups.ts` (업로드·미리보기 라우트가 공유)
- 상위 카테고리 분류: `lib/manuals/manual-category-rules.ts`

## 5. fixture 추가

1. `tests/fixtures/manual-formats/`에 입력 파일(`*.csv`/`*.txt`/`*.md`)과 기대 결과 `expected-*.json`
   (`[{ category, topic, items }]`)을 추가한다.
2. `tests/manuals/fixture-parser-integration.test.ts`에 실제 파서 호출 → `assert.deepEqual` 테스트를 추가한다.
3. 새 테스트 파일은 `package.json`의 `test:rag`와 `tsconfig.test.json`의 `include`에 모두 등록한다.

## 6. 브라우저 수동 검증

- [ ] HQ: CSV/XLSX/TXT/MD/DOCX 각각 업로드 → 미리보기 요약(세부 매뉴얼 수, 항목 수) 표시
- [ ] 카테고리 이름 변경, 다른 카테고리로 이동, 저장 제외/복원 후 저장 → 목록에 반영
- [ ] 모든 항목 제외 시 저장 불가 안내, 저장 버튼 연타 시 1회만 저장
- [ ] PDF/이미지 업로드 시 거부 안내
- [ ] 점주: 승인된 지점에서 업로드·저장 → 지점 매뉴얼 목록에 표시, 다른 지점/미승인 계정은 거부
- [ ] 저장 후 직원 채팅에서 해당 매뉴얼이 검색되고 카테고리가 이해 가능한 이름으로 표시
- [ ] 부모 삭제 시 자식·청크가 함께 삭제
- [ ] 키보드만으로 파일 선택·편집·저장 가능

## 7. 주의

실제 DB 데이터 변경(마이그레이션 적용, `stores.franchise_id` 백필, 기존 매뉴얼 재분류 등)은
별도 승인 후에만 진행한다.
