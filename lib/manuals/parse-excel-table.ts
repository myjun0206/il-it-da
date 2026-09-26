import type { AnalyzedManualGroup } from "@/lib/manuals/analyze-manual-with-ai";
import { splitTextIntoManualItems } from "@/lib/manuals/detect-manual-item";

// 엑셀/CSV의 행·열 구조를 그대로 분석해 카테고리 > 타이틀 > 세부 매뉴얼 계층을 추출한다.
// 표가 "세로형"(카테고리가 열 방향으로 반복)이든 "가로형"(카테고리가 행 방향으로 반복)이든 모두
// 인식하기 위해, 원본 행렬과 전치(transpose)한 행렬 양쪽에 같은 분석을 돌려 더 확신도 높은 쪽을 쓴다.
// 각 방향 안에서는: 고정된 컬럼 인덱스에 의존하지 않고 "연속된 레코드에서 값이 반복되는 축"을
// 카테고리(그룹)로, 그 다음으로 원래 순서상 먼저 나오는 축을 타이틀로, 나머지를 세부 매뉴얼(items)로 본다.
// 예)
//   1 | ㅎㅎ | 엉엉엉 | 아아아   -> ㅎㅎ가 2행 연속 반복 -> 카테고리=열1, 타이틀=열0(1,2,3), items=열2,3
//   2 | ㅎㅎ | 앙앙앙 |
//   3 | ㅅㅅ | 으으응 |
//   1 | ㅇㅇ | 아아아(어어어)    -> 열0(1,1,2)이 반복 -> 카테고리=열0, 타이틀=열1(ㅇㅇ,ㅅㅅ,ㄹㄹ), items=열2
//   1 | ㅅㅅ | 흐흐흐
//   2 | ㄹㄹ | 스스스
// 표 구조를 인식하지 못하면(반복되는 축이 전혀 없으면) null을 반환해 호출자가 일반 텍스트 파서로
// 대체할 수 있게 한다 - 예외를 던지지 않는다.
// 전처리 단계에서 "모든 행/열이 공통으로 갖는 고정 값"(회사명 열, 반복된 헤더 행, 빈 열 등)은
// 실제 카테고리/타이틀 데이터가 아니므로 먼저 걸러내고 시작한다.

const MAX_TABLE_GROUPS = 300;
// 값이 1종류뿐인 열(또는 전치 후 행)에서, 그 값이 채워진 칸의 비율이 이 값 이상이면
// "공통 고정값"(노이즈)로 간주한다.
const NOISE_COLUMN_COVERAGE_THRESHOLD = 0.9;
// 헤더 행을 찾기 위해 파일 상단부터 몇 행까지 훑을지 탐색할지(그 이전은 노이즈로 간주).
const HEADER_SEARCH_ROW_LIMIT = 15;
// 헤더 행에서 이 키워드와 정확히 일치하면 해당 역할(카테고리/타이틀/내용)을 맡는다.
const CATEGORY_HEADER_KEYWORDS = new Set(["category", "카테고리"]);
const TITLE_HEADER_KEYWORDS = new Set(["title", "타이틀", "제목", "주제", "소주제"]);
const CONTENT_HEADER_KEYWORDS = new Set(["content", "내용", "본문", "세부매뉴얼", "item", "items"]);
// manuals 테이블을 그대로 내보낸 것처럼 시스템/메타데이터 열은 카테고리/타이틀/세부매뉴얼
// 어느 역할에도 쓰이지 않도록 완전히 제외한다.
const SYSTEM_HEADER_KEYWORDS = new Set([
  "id",
  "brand_name",
  "franchise_id",
  "store_id",
  "parent_manual_id",
  "scope_type",
  "status",
  "created_at",
  "updated_at",
]);

function normalizeCell(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function isRowBlank(row: string[]): boolean {
  return row.every((cell) => !cell.trim());
}

// 모든 셀이 비어있거나, 값이 있는 셀들이 전부 똑같은 한 가지 값(예: 구분선 "-", 반복 라벨)인 행은
// 실제 데이터가 아닌 노이즈 행으로 보고 제외한다.
function isRowUniformNoise(row: string[]): boolean {
  const nonEmpty = row.filter((cell) => cell.trim());
  if (nonEmpty.length === 0) return true;
  return new Set(nonEmpty).size === 1 && nonEmpty.length === row.length;
}

// 모든 셀 값이 완전히 동일한 행(주로 시트를 이어붙일 때 반복되는 헤더 행)은 처음 한 번만 데이터로 남긴다.
function dedupeExactDuplicateRows(rows: string[][]): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];

  for (const row of rows) {
    const signature = row.join("\u0001");
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(row);
  }

  return result;
}

// 행렬을 전치한다(행<->열 교환). 행 길이가 들쭉날쭉해도 안전하도록 최대 길이만큼 빈 칸으로 채운 뒤 뒤집는다.
function transposeMatrix(matrix: string[][]): string[][] {
  if (matrix.length === 0) return [];

  const columnCount = Math.max(...matrix.map((row) => row.length));
  return Array.from({ length: columnCount }, (_, c) => matrix.map((row) => row[c] ?? ""));
}

// 병합 셀/빈 칸을 바로 앞 값으로 채운다(Forward-fill). 카테고리 축 인식과 최종 카테고리 값 모두에 사용한다.
function forwardFillColumn(column: string[]): string[] {
  const filled: string[] = [];
  let last = "";

  for (const cell of column) {
    if (cell) {
      last = cell;
      filled.push(cell);
    } else {
      filled.push(last);
    }
  }

  return filled;
}

// 연속된 두 값이 얼마나 자주 같은지(0~1)를 계산한다. 값이 클수록 "반복되는 그룹 축"일 가능성이 높다.
function computeConsecutiveRepeatRatio(column: string[]): number {
  let transitions = 0;
  let repeats = 0;

  for (let i = 1; i < column.length; i += 1) {
    const prev = column[i - 1];
    const curr = column[i];
    if (!prev || !curr) continue;
    transitions += 1;
    if (prev === curr) repeats += 1;
  }

  return transitions === 0 ? 0 : repeats / transitions;
}

// 열 전체가 비어있거나, 값이 한 종류뿐이면서 거의 모든 행을 채우고 있는 열(예: 회사명, 고정 라벨)은
// 어느 행에서도 서로 구분되지 않으므로 카테고리/타이틀/세부매뉴얼 어디에도 쓰지 않고 완전히 제외한다.
function detectNoiseColumnIndexes(rawColumns: string[][]): Set<number> {
  const noise = new Set<number>();

  rawColumns.forEach((column, index) => {
    const nonEmpty = column.filter(Boolean);

    if (nonEmpty.length === 0) {
      noise.add(index);
      return;
    }

    const distinctValues = new Set(nonEmpty);
    const coverage = nonEmpty.length / column.length;

    if (distinctValues.size === 1 && coverage >= NOISE_COLUMN_COVERAGE_THRESHOLD) {
      noise.add(index);
    }
  });

  return noise;
}

function pickCategoryColumnIndex(
  rawColumns: string[][],
  noiseColumnIndexes: Set<number>,
): { index: number; ratio: number } | null {
  let bestIndex: number | null = null;
  let bestRatio = 0;

  rawColumns.forEach((column, index) => {
    if (noiseColumnIndexes.has(index)) {
      return;
    }

    // 서로 다른 값이 2종류 미만이면(값이 한 종류뿐이거나 전부 비어있으면) 여러 그룹을 구분하는
    // 카테고리 열일 수 없으므로 제외한다 - 이 검사가 없으면 "값 하나 + 나머지 빈 칸"인 items 열이
    // forward-fill 후 100% 반복처럼 보여 카테고리 열로 잘못 뽑힐 수 있다.
    const distinctValues = new Set(column.filter(Boolean));
    if (distinctValues.size < 2) {
      return;
    }

    // 병합 셀(중간 행이 비어 카테고리 값이 이어지는 경우)을 반복으로 인식하도록 forward-fill 후 비율을 계산한다.
    const ratio = computeConsecutiveRepeatRatio(forwardFillColumn(column));
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestIndex = index;
    }
  });

  // 반복이 전혀 없으면(모든 열이 매 행마다 값이 바뀌면) 그룹 구조가 없다고 판단한다.
  return bestIndex !== null && bestRatio > 0 ? { index: bestIndex, ratio: bestRatio } : null;
}

function pickTitleColumnIndex(columnCount: number, categoryIndex: number, noiseColumnIndexes: Set<number>): number | null {
  for (let index = 0; index < columnCount; index += 1) {
    if (index !== categoryIndex && !noiseColumnIndexes.has(index)) {
      return index;
    }
  }
  return null;
}

function matchesKeyword(cell: string, keywords: Set<string>): boolean {
  return keywords.has(cell.trim().toLowerCase());
}

// brand_name/status/created_at 등 시스템 컬럼명이 상단 어딘가에 보이면(헤더로 확정되지 않았더라도)
// 해당 열을 휴리스틱 분석(analyzeMatrixAsRecords)에서도 영구히 제외하기 위해 미리 발견해둔다.
function detectSystemColumnIndexes(matrix: string[][]): Set<number> {
  const system = new Set<number>();
  const limit = Math.min(matrix.length, HEADER_SEARCH_ROW_LIMIT);

  for (let r = 0; r < limit; r += 1) {
    matrix[r].forEach((cell, c) => {
      if (matchesKeyword(cell, SYSTEM_HEADER_KEYWORDS)) {
        system.add(c);
      }
    });
  }

  return system;
}

type HeaderRoles = {
  rowIndex: number;
  categoryColumn: number | null;
  titleColumn: number | null;
  contentColumn: number | null;
};

// 파일 상단부터 순차적으로 행을 훑어, "category/title/content"(또는 한글 동의어) 카테고리어가
// 2개 이상 등장하는 행을 실제 헤더 행으로 인정한다(우연히 하나만 일치하는 경우를 방지).
function findHeaderRow(matrix: string[][]): HeaderRoles | null {
  const limit = Math.min(matrix.length, HEADER_SEARCH_ROW_LIMIT);

  for (let r = 0; r < limit; r += 1) {
    const row = matrix[r];
    let categoryColumn: number | null = null;
    let titleColumn: number | null = null;
    let contentColumn: number | null = null;

    row.forEach((cell, c) => {
      if (categoryColumn === null && matchesKeyword(cell, CATEGORY_HEADER_KEYWORDS)) categoryColumn = c;
      if (titleColumn === null && matchesKeyword(cell, TITLE_HEADER_KEYWORDS)) titleColumn = c;
      if (contentColumn === null && matchesKeyword(cell, CONTENT_HEADER_KEYWORDS)) contentColumn = c;
    });

    const matchedRoleCount = [categoryColumn, titleColumn, contentColumn].filter((v) => v !== null).length;

    if (matchedRoleCount >= 2) {
      return { rowIndex: r, categoryColumn, titleColumn, contentColumn };
    }
  }

  return null;
}

// 명시적인 헤더(카테고리/타이틀/내용 컬럼명)를 찾았을 때, 그 매핑만 믿고 계층을 조립한다.
// 카테고리/타이틀/내용으로 명시되지 않은 나머지 컬럼(brand_name, status 등)은 자동으로 무시된다.
function buildGroupsFromHeader(matrix: string[][], header: HeaderRoles): AnalyzedManualGroup[] | null {
  if (header.titleColumn === null || header.contentColumn === null) {
    return null;
  }

  const titleColumn = header.titleColumn;
  const contentColumn = header.contentColumn;
  const categoryColumn = header.categoryColumn;

  const dataRows = dedupeExactDuplicateRows(
    matrix.slice(header.rowIndex + 1).filter((row) => !isRowBlank(row) && !isRowUniformNoise(row)),
  );

  if (dataRows.length === 0) {
    return null;
  }

  const filledCategoryColumn =
    categoryColumn !== null ? forwardFillColumn(dataRows.map((row) => row[categoryColumn] ?? "")) : null;

  const groupOrder: string[] = [];
  const groupsByKey = new Map<string, AnalyzedManualGroup>();

  dataRows.forEach((row, r) => {
    const category = (filledCategoryColumn ? filledCategoryColumn[r] : "") || "미분류";
    const topic = (row[titleColumn] ?? "").trim();
    const content = (row[contentColumn] ?? "").trim();

    if (!topic || !content) {
      return;
    }

    // 한 셀 안에 "1-1."/"1."/탭·들여쓰기로 구분된 여러 줄이 있으면 각각 독립된 items로 나누고,
    // 그런 구분이 없으면 셀 내용 전체를 하나의 item으로 그대로 쓴다.
    const items = splitTextIntoManualItems(content);

    if (items.length === 0) {
      return;
    }

    const key = `${category}\u0000${topic}`;
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.items.push(...items);
      return;
    }

    groupsByKey.set(key, { category, topic, items });
    groupOrder.push(key);
  });

  const groups = groupOrder.map((key) => groupsByKey.get(key)).filter((g): g is AnalyzedManualGroup => Boolean(g));

  return groups.length > 0 ? groups : null;
}

type OrientationResult = { groups: AnalyzedManualGroup[]; confidence: number };

// 행렬 하나를 "행 = 레코드, 열 = 필드(카테고리/타이틀/세부매뉴얼 후보)"로 보고 계층을 조립한다.
// 호출자가 원본 행렬과 전치된 행렬 양쪽에 이 함수를 돌려 세로형/가로형 표를 모두 인식한다.
// extraNoiseColumnIndexes로 brand_name/status 같은 시스템 컬럼을 카테고리/타이틀 후보에서 미리 제외할 수 있다.
function analyzeMatrixAsRecords(matrix: string[][], extraNoiseColumnIndexes: Set<number> = new Set()): OrientationResult | null {
  const dataRows = dedupeExactDuplicateRows(matrix.filter((row) => !isRowBlank(row) && !isRowUniformNoise(row)));

  if (dataRows.length < 2) {
    return null;
  }

  const columnCount = Math.max(...dataRows.map((row) => row.length));
  const rawColumns: string[][] = Array.from({ length: columnCount }, (_, c) => dataRows.map((row) => row[c] ?? ""));
  const noiseColumnIndexes = detectNoiseColumnIndexes(rawColumns);
  extraNoiseColumnIndexes.forEach((index) => noiseColumnIndexes.add(index));

  const category = pickCategoryColumnIndex(rawColumns, noiseColumnIndexes);

  if (category === null) {
    return null;
  }

  // 카테고리 열로 확정된 열만 forward-fill해 병합 셀/공백이 직전 카테고리 값을 이어받도록 한다.
  const filledCategoryColumn = forwardFillColumn(rawColumns[category.index]);

  const titleIndex = pickTitleColumnIndex(columnCount, category.index, noiseColumnIndexes);

  if (titleIndex === null) {
    return null;
  }

  const itemIndexes = Array.from({ length: columnCount }, (_, i) => i).filter(
    (i) => i !== category.index && i !== titleIndex && !noiseColumnIndexes.has(i),
  );

  // (카테고리, 타이틀)이 같은 연속 행은 한 그룹으로 묶어 items를 이어 붙인다.
  const groupOrder: string[] = [];
  const groupsByKey = new Map<string, AnalyzedManualGroup>();

  for (let r = 0; r < dataRows.length; r += 1) {
    const groupCategory = filledCategoryColumn[r] || "미분류";
    const topic = rawColumns[titleIndex][r];
    // 세부매뉴얼 후보 열의 셀 하나에 "1-1."/"1."/탭·들여쓰기로 구분된 여러 줄이 섞여 있으면
    // 그 줄들을 각각 독립된 item으로 나눈다.
    const items = itemIndexes.flatMap((i) => splitTextIntoManualItems(rawColumns[i][r]));

    if (!topic || items.length === 0) {
      continue;
    }

    const key = `${groupCategory}\u0000${topic}`;

    const existing = groupsByKey.get(key);
    if (existing) {
      existing.items.push(...items);
      continue;
    }

    groupsByKey.set(key, { category: groupCategory, topic, items: [...items] });
    groupOrder.push(key);

    if (groupOrder.length >= MAX_TABLE_GROUPS) {
      break;
    }
  }

  const groups = groupOrder.map((key) => groupsByKey.get(key)).filter((g): g is AnalyzedManualGroup => Boolean(g));

  return groups.length > 0 ? { groups, confidence: category.ratio } : null;
}

export function parseExcelTableGroups(rows: string[][]): AnalyzedManualGroup[] | null {
  const normalized = rows.map((row) => row.map(normalizeCell));
  const transposed = transposeMatrix(normalized);

  // 1) "category/title/content"(또는 한글 동의어) 헤더 행을 먼저 찾아본다 - manuals 테이블을 그대로
  //    내보낸 파일처럼 명시적 컬럼명이 있으면 이 매핑이 휴리스틱보다 훨씬 정확하다.
  for (const matrix of [normalized, transposed]) {
    const header = findHeaderRow(matrix);
    if (header) {
      const groups = buildGroupsFromHeader(matrix, header);
      if (groups) {
        return groups;
      }
    }
  }

  // 2) 명시적 헤더를 찾지 못했으면 반복 패턴 기반 휴리스틱으로 세로형/가로형을 모두 시도한다.
  //    brand_name/status/created_at 같은 시스템 컬럼명이 상단에 보이면(완전한 헤더로 인정되지 않았더라도)
  //    카테고리/타이틀 후보에서 미리 제외한다.
  const verticalSystemNoise = detectSystemColumnIndexes(normalized);
  const horizontalSystemNoise = detectSystemColumnIndexes(transposed);

  const vertical = analyzeMatrixAsRecords(normalized, verticalSystemNoise);
  const horizontal = analyzeMatrixAsRecords(transposed, horizontalSystemNoise);

  if (!vertical) {
    return horizontal?.groups ?? null;
  }
  if (!horizontal) {
    return vertical.groups;
  }

  return vertical.confidence >= horizontal.confidence ? vertical.groups : horizontal.groups;
}
