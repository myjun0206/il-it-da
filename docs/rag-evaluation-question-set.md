# RAG 평가 질문셋(QA Question Set) 스키마

RAG QA 질문셋은 **JSON 배열**을 최상위 구조로 사용합니다. 각 배열 항목은 하나의 평가 케이스입니다.

## 필수 필드

| 필드 | 타입 | 허용값 |
|---|---|---|
| `question_id` | string (비어 있지 않음) | 자유 형식, 배열 내 고유값 |
| `question_type` | string | `normal`, `paraphrase`, `insufficient`, `out_of_scope`, `store_isolation` |
| `target_store` | string | `all`, `이수점`, `숭실대점` |
| `question` | string (trim 후 비어 있지 않음, 최대 2000자) | 자유 형식 |
| `expected_status` | string | `answered`, `cautious`, `insufficient` |

## 선택 필드

| 필드 | 타입 | 허용값 |
|---|---|---|
| `manual_scope` | string | `hq`, `store`, `none` |
| `category` | string | 자유 형식 |
| `expected_result` | string | 자유 형식 (의미 비교는 이번 단계 미채점) |
| `expected_keywords` | `string[]` | 빈 문자열 원소 금지 |
| `forbidden_content` | `string[]` | 빈 문자열 원소 금지 |
| `priority` | string | `high`, `medium`, `low` |
| `note` | string | 자유 형식 |

## 검증 명령

```
node scripts/validate-rag-dataset.mjs --input <json-path>
```

- 로더와 스키마 검증만 수행하며 외부 API·DB·환경변수를 사용하지 않습니다.
- 기본 출력은 총 항목 수와 오류 수, `index/questionId/field/code`만 표시합니다.
- 종료 코드: `0` = 정상, `2` = 인자 오류·JSON 문법 오류·스키마 오류.

## 최소 예시

```json
[
  {
    "question_id": "sample-001",
    "question_type": "normal",
    "target_store": "이수점",
    "question": "영업시간이 어떻게 되나요?",
    "expected_status": "answered",
    "expected_keywords": ["영업시간"],
    "forbidden_content": ["모르겠습니다"],
    "priority": "medium"
  }
]
```

위 예시는 가상의 값이며 실제 API 키나 매장 UUID를 포함하지 않습니다.
