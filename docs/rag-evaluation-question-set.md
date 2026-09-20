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

## Excel 원본 작성부터 평가 실행까지

QA 질문 내용은 반영민 팀원이 **Excel(.xlsx)** 로 작성하는 것이 원본입니다. `.xlsx` 파일을 애플리케이션이
직접 읽지는 않으며, Excel에서 **"CSV UTF-8(쉼표로 분리)"** 로 내보낸 파일을 `convert:rag-dataset`
CLI로 기존 JSON 스키마로 변환한 뒤 사용합니다. 약 100건 규모에서는 수작업 JSON 변환의 오류 위험이 커서
사용하지 않습니다.

흐름:

```
Excel 원본 작성
→ 모든 컬럼을 텍스트 서식으로 관리
→ "CSV UTF-8(쉼표로 분리)"로 저장
→ convert:rag-dataset 실행
→ validate:rag-dataset 실행
→ 로컬 서버 실행 후 eval:rag-dataset 실행
```

> ⚠️ Excel에서 내보낼 때 반드시 **"CSV UTF-8(쉼표로 분리)"** 를 선택해야 합니다. 일반 "CSV(쉼표로
> 분리)"를 선택하면 한글이 다른 인코딩(예: CP949)으로 저장되어 깨질 수 있습니다.
> 또한 모든 컬럼을 Excel에서 **텍스트 서식**으로 지정해 두어야 `question_id`나 날짜처럼 보이는 값이
> 숫자·날짜로 자동 변환되어 손상되는 것을 막을 수 있습니다.

### Excel/CSV 컬럼

`question_id`, `question_type`, `manual_scope`, `target_store`, `category`, `question`,
`expected_status`, `expected_result`, `expected_keywords`, `forbidden_content`, `priority`, `note`

### Excel 작성 규칙

- `expected_keywords`가 여러 개면 `|` 문자로 구분합니다. 예: `9시|영업시간`
- `forbidden_content`가 여러 개면 `|` 문자로 구분합니다.
- `target_store`에는 `all`, `이수점`, `숭실대점`만 사용합니다.
- 실제 매장 `storeId`(UUID)를 입력하지 않습니다. UUID는 별도의 매장 매핑 JSON 파일에서만 관리합니다.
- API 키, 토큰, 이메일, 비밀번호 등 민감정보를 어떤 컬럼에도 입력하지 않습니다.

### CSV → JSON 변환 규칙

- 컬럼명(필드명)은 CSV와 JSON이 동일합니다. 헤더 앞뒤 공백은 자동으로 제거되며, 필수 헤더 누락·중복
  헤더·정의되지 않은 헤더는 오류로 처리됩니다(조용히 무시하지 않음).
- `question_id`는 셀 타입과 무관하게 항상 문자열로 취급합니다.
- 일반 문자열 셀은 바깥쪽 공백만 제거하고, `question`/`expected_result`의 줄바꿈은 그대로 보존합니다.
- `expected_keywords`, `forbidden_content`는 `|` 기준으로 분리하고 각 항목의 앞뒤 공백을 제거하며
  빈 항목은 제거합니다. 분리 결과가 없으면 해당 필드는 JSON 객체에서 생략됩니다.
- 쉼표가 포함된 값은 따옴표(`".."`)로, 셀 내부 줄바꿈과 큰따옴표(`""` 이스케이프)도 지원합니다.
- 변환과 스키마 검증이 모두 성공한 경우에만 JSON 파일이 저장됩니다(부분 저장 없음).

```
npm run convert:rag-dataset -- --input <question-set.csv> --output <question-set.json>
```

변환 후에는 `node scripts/validate-rag-dataset.mjs --input <json-path>`로 스키마를 다시 확인한
뒤, `node scripts/evaluate-rag-dataset.mjs --input <json-path> --stores <store-map.json>` 로 실제
평가를 실행합니다.

## 매장 매핑 JSON

질문셋에는 UUID를 넣지 않으므로, `target_store`(`이수점`, `숭실대점` 등)를 실제 `storeId`로 연결하는
별도의 매장 매핑 파일이 필요합니다.

```json
[
  { "name": "이수점", "id": "유효한 UUID" },
  { "name": "숭실대점", "id": "유효한 UUID" }
]
```

## 평가 실행 명령

```
node scripts/evaluate-rag-dataset.mjs --input <question-set.json> --stores <store-map.json> [--endpoint <url>] [--verbose]
```

- 기본 출력에는 case ID, expected/actual status, status·keyword·forbidden 판정, pass/fail, 전체
  요약만 표시됩니다. 질문 원문, 답변 전체, 매뉴얼 제목·본문, storeId(UUID)는 기본 출력에 없습니다.
- `--verbose`를 사용하면 시작 전에 "상세 모드에서는 질문과 답변 원문이 터미널 또는 CI 로그에 남을 수
  있습니다."라는 경고가 출력된 뒤에만 질문/답변 원문이 콘솔에 표시됩니다. 이 옵션은 로컬 확인 용도로만
  사용하고 CI 로그에 남기지 않아야 합니다.
- 종료 코드: `0` = 전체 통과, `1` = API 오류 또는 품질 실패 존재, `2` = 인자·로딩·스키마 오류.

## 예제 파일

- 질문셋 형식 JSON 예제: [`examples/rag-eval/question-set.example.json`](../examples/rag-eval/question-set.example.json)
- 질문셋 형식 CSV 예제(Excel "CSV UTF-8" 내보내기 결과물 형태): [`examples/rag-eval/question-set.example.csv`](../examples/rag-eval/question-set.example.csv)
- 매장 매핑 예제: [`examples/rag-eval/store-map.example.json`](../examples/rag-eval/store-map.example.json)

이 파일들은 스키마와 CLI 사용법을 보여주기 위한 최소 가상 예제이며, 반영민 팀원의 실제 질문 내용을
대신하지 않습니다. **`store-map.example.json`의 UUID는 실제 Supabase 매장 ID가 아닌 테스트 전용
가상 값입니다.** 실제 평가를 실행할 때는 반드시 운영 환경에 맞는 별도의 store map 파일로 교체해야
하며, 예제 store map을 그대로 실제 API 평가에 사용해서는 안 됩니다.

## 명령 요약

1. **CSV → JSON 변환** (외부 API/DB 호출 없음, 변환+검증 모두 성공해야 저장)
   ```
   npm run convert:rag-dataset -- --input examples/rag-eval/question-set.example.csv --output /tmp/question-set.example.json
   ```
2. **질문셋 형식 검증** (외부 API/DB 호출 없음)
   ```
   npm run validate:rag-dataset -- --input examples/rag-eval/question-set.example.json
   ```
3. **평가 도구 단위 테스트** (mock fetch만 사용, 외부 API/DB 호출 없음)
   ```
   npm run test:rag-eval
   ```
4. **실제 API 평가** (실제 질문셋·store map으로 교체해서 실행)
   ```
   npm run eval:rag-dataset -- --input <실제-question-set.json> --stores <실제-store-map.json>
   ```
   - 실행 전 로컬 서버(`npm run dev` 등)가 `http://localhost:3000`에서 실행 중이어야 합니다.
   - 이 명령은 실제 OpenAI/Supabase 호출을 유발하므로 사용량 또는 비용이 발생할 수 있습니다.

CI(GitHub Actions)에서는 1번(예제 CSV→JSON 변환), 2번(변환 결과 검증), 3번(단위 테스트)만 자동
실행되며, 4번(실제 API 평가)은 CI에서 실행되지 않습니다. CI에서 변환되는 JSON은 저장소
작업 디렉토리 밖의 러너 임시 경로(`RUNNER_TEMP`)에만 쓰여 Git 변경사항으로 남지 않습니다.
실제 평가는 로컬에서 필요할 때 수동으로 실행합니다.

## 실제 QA 데이터의 Git 관리

실제 Excel(.xlsx)/내보낸 CSV/변환된 JSON 파일은 **저장소에 커밋하지 않습니다.** 이 파일들은
팀 공유 저장소(공유 드라이브 등)에서 로컬 데이터로 관리하고, 저장소에는 `examples/rag-eval/`의
가상 예제 파일만 유지합니다.
