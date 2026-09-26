// 세부 매뉴얼(Items) 항목을 판별/분할하는 공용 규칙. 텍스트 파서(analyze-manual-with-ai.ts)와
// 엑셀/CSV 테이블 파서(parse-excel-table.ts)가 함께 쓴다 - 외부 API 호출 없이 순수 정규식/문자열 로직.
//
// 조건부 분할 규칙:
// 1) 기본 동작: 줄 맨 앞의 단독 숫자("1.", "2." 등)는 각각 독립된 세부 매뉴얼 항목 경계로 분할한다.
// 2) 섬션별 독립 그룹핑: 줄이 탭/공백 들여쓰기로 시작하거나, "숫자-숫자."(예: "4-1.") 패턴으로
//    시작하는 줄(=그룹 트리거)을 만나면, 그 줄부터 다음 그룹 트리거(또는 텍스트 끝)까지는
//    더 이상 숫자로 쪼개지 않고 그 트리거 하나의 섹션(예: "4-1")으로 통째로 묶인다.
//    다음 그룹 트리거(예: "4-2")를 만나면 그 열렩은 끝나고 새 섹션이 독립적으로 다시 시작된다
//    (전역적으로 영구히 잠기는 것이 아니라, 트리거를 만날 때마다 새로 리셋되는 섹션 단위 묶음).

// 줄 맨 앞의 "숫자-숫자." 패턴(trim된 문자열 기준) - 그룹 트리거 조건 중 하나.
const SUB_NUMBERED_LINE_PATTERN = /^\d{1,3}-\d{1,3}[.)]/;
// 줄 맨 앞의 "숫자." 패턴(trim된 문자열 기준) - 기본 분할 경계 조건.
const LEADING_NUMBER_LINE_PATTERN = /^\d{1,3}[.)]/;
// 줄이 탭 또는 공백(들여쓰기, 전각 공백 포함)으로 시작하는지 - 그룹 트리거 조건 중 하나(trim 전 원본 기준).
const LEADING_INDENT_PATTERN = /^[\t \u3000]/;

// 이 줄이 "분할 차단(그룹핑)"을 시작시키는 트리거인지 판별한다.
function isGroupTriggerLine(rawLine: string): boolean {
  if (LEADING_INDENT_PATTERN.test(rawLine)) {
    return true;
  }
  return SUB_NUMBERED_LINE_PATTERN.test(rawLine.trim());
}

// 이 줄이 그룹 트리거가 아니면서 맨 앞 단독 숫자로 시작하는 "기본 분할 경계"인지 판별한다.
function isPlainNumberBoundaryLine(rawLine: string): boolean {
  if (isGroupTriggerLine(rawLine)) {
    return false;
  }
  return LEADING_NUMBER_LINE_PATTERN.test(rawLine.trim());
}

/**
 * 한 줄이 세부 매뉴얼 항목 경계(맨 앞 단독 숫자, 그룹 트리거 아님)로 볼 수 있는지 판별한다.
 */
export function isManualItemLine(rawLine: string): boolean {
  return isPlainNumberBoundaryLine(rawLine);
}

/**
 * 텍스트(셀 내용 또는 타이틀 본문)를 세부 매뉴얼 항목 배열로 나눈다.
 * - 맨 앞 단독 숫자("1.", "2." 등) 줄을 만날 때마다 기본적으로 새 항목을 시작한다.
 * - 탭/들여쓰기로 시작하거나 "숫자-숫자."(예: "4-1.")로 시작하는 줄(그룹 트리거)을 만나면,
 *   그 줄부터 다음 그룹 트리거(또는 텍스트 끝)까지는 더 이상 숫자로 쪼개지 않고 그 트리거 하나의
 *   섹션으로 통째로 묶는다. 다음 그룹 트리거가 나오면 그 이전 섹션은 종료되고 새 섹션이 독립적으로
 *   시작된다(전역 영구 잠금이 아니라 섹션별 독립 묶음).
 * 인식 가능한 경계가 전혀 없으면 빈 줄 문단 단위로, 그마저 없으면 전체를 항목 하나로 취급한다(에러 없음).
 */
export function splitTextIntoManualItems(text: string): string[] {
  if (!text.trim()) {
    return [];
  }

  const lines = text.split(/\r?\n/);
  const items: string[] = [];
  let currentLines: string[] = [];
  let inSection = false;
  let foundBoundary = false;

  const flush = () => {
    const content = currentLines.join("\n").trim();
    if (content) {
      items.push(content);
    }
    currentLines = [];
  };

  for (const line of lines) {
    if (isGroupTriggerLine(line)) {
      // 새 섹션 시작: 쌓인 내용(이전 섹션이든 일반 항목이든)을 항목 하나로 마무리하고,
      // 이 트리거 줄부터 다음 트리거가 나올 때까지만 이어붙일 새 섹션을 연다.
      foundBoundary = true;
      flush();
      inSection = true;
      currentLines.push(line);
      continue;
    }

    if (inSection) {
      // 섹션 안에서는 어떤 줄이 와도(숫자로 시작해도) 다음 그룹 트리거를 만나기 전까지 그대로 이어붙인다.
      currentLines.push(line);
      continue;
    }

    if (isPlainNumberBoundaryLine(line)) {
      // 새 "숫자." 경계를 만나면 지금까지 쌓인 내용을 항목 하나로 마무리하고 새로 시작한다.
      foundBoundary = true;
      if (currentLines.length > 0) {
        flush();
      }
    }

    currentLines.push(line);
  }

  flush();

  // 실제로 인식된 경계(그룹 트리거 또는 숫자 경계)가 하나라도 있었을 때만 위 분할 결과를 쓴다.
  // 경계가 전혀 없었다면 문단 단위 fallback으로 넘어간다(그렇지 않으면 항상 통째로 한 덩어리가 된다).
  if (foundBoundary && items.length > 0) {
    return items;
  }

  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length > 0) {
    return paragraphs;
  }

  return text.trim() ? [text.trim()] : [];
}
