import { parseManualText, type AnalyzedManualGroup } from "@/lib/manuals/analyze-manual-with-ai";
import { extractManualGroups, XLSX_EXTENSIONS } from "@/lib/manuals/extract-manual-groups";
import { extractCsvRows, extractSpreadsheetSheets, rowsToFlatText } from "@/lib/manuals/extract-manual-file-text";
import { parseExcelTableGroups } from "@/lib/manuals/parse-excel-table";

/**
 * 지점 매뉴얼 업로드 전용 추출기. 본사 경로(extractManualGroups)는 그대로 두고, 지점 파일에서
 * 확인된 형식(넘버/카테고리/타이틀/매뉴얼, 타이틀이 첫 행에만 있는 이어지는 행)을 공용 파서가
 * 기대하는 "카테고리/타이틀/내용" 3열로 맞춘 뒤 같은 parseExcelTableGroups에 넘긴다.
 */

export const STORE_MULTI_SHEET_ERROR =
  "지점 매뉴얼은 시트가 1개인 파일로 올려 주세요. 여러 매장·본사 시트가 한 매장에 합쳐지는 것을 막기 위해 나눠서 올려야 해요.";

const CATEGORY_HEADERS = new Set(["카테고리", "category"]);
const TITLE_HEADERS = new Set(["타이틀", "제목", "title"]);
const CONTENT_HEADERS = new Set(["매뉴얼", "내용", "본문", "세부매뉴얼", "content"]);

// "카테고 리", " 카테고리"처럼 셀 안 공백이 섞인 헤더도 같은 열로 본다.
function normalizeHeader(cell: string): string {
  return cell.replace(/\s+/g, "").toLowerCase();
}

function findColumn(header: string[], names: Set<string>): number {
  return header.findIndex((cell) => names.has(normalizeHeader(cell ?? "")));
}

/**
 * 첫 행에서 카테고리·타이틀·매뉴얼 열을 모두 찾으면 그 순서로 재배열하고, 비어 있는 카테고리·타이틀은
 * 같은 시트의 직전 값으로 채운다. 세 열을 모두 찾지 못하면 기존 동작을 위해 원본을 그대로 돌려준다.
 */
export function normalizeStoreManualRows(rows: string[][]): string[][] {
  const header = rows[0] ?? [];
  const categoryColumn = findColumn(header, CATEGORY_HEADERS);
  const titleColumn = findColumn(header, TITLE_HEADERS);
  const contentColumn = findColumn(header, CONTENT_HEADERS);

  if (categoryColumn < 0 || titleColumn < 0 || contentColumn < 0) {
    return rows;
  }

  let lastCategory = "";
  let lastTitle = "";
  const normalized: string[][] = [["카테고리", "타이틀", "매뉴얼"]];

  for (const row of rows.slice(1)) {
    const category = (row[categoryColumn] ?? "").trim();
    const title = (row[titleColumn] ?? "").trim();
    const content = (row[contentColumn] ?? "").trim();

    if (category) lastCategory = category;
    if (title) lastTitle = title;
    if (!content) continue;

    normalized.push([lastCategory, lastTitle, content]);
  }

  return normalized;
}

function groupsFromRows(rows: string[][]): AnalyzedManualGroup[] {
  const normalized = normalizeStoreManualRows(rows);
  return parseExcelTableGroups(normalized) ?? parseManualText(rowsToFlatText(normalized.slice(1)));
}

export async function extractStoreManualGroups(file: File, extension: string): Promise<AnalyzedManualGroup[]> {
  if (XLSX_EXTENSIONS.has(extension)) {
    const sheets = (await extractSpreadsheetSheets(file)).filter((sheet) => sheet.rows.length > 0);
    if (sheets.length > 1) {
      throw new Error(STORE_MULTI_SHEET_ERROR);
    }
    return sheets.length === 0 ? [] : groupsFromRows(sheets[0].rows);
  }

  if (extension === ".csv") {
    return groupsFromRows(await extractCsvRows(file));
  }

  return extractManualGroups(file, extension);
}
