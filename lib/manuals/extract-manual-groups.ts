import { parseManualText, type AnalyzedManualGroup } from "@/lib/manuals/analyze-manual-with-ai";
import { parseExcelTableGroups } from "@/lib/manuals/parse-excel-table";
import {
  extractCsvRows,
  extractDocxManualText,
  extractSpreadsheetRows,
  rowsToFlatText,
} from "@/lib/manuals/extract-manual-file-text";

export const TEXT_EXTENSIONS = new Set([".txt", ".md"]);
export const XLSX_EXTENSIONS = new Set([".xlsx", ".xls"]);
export const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ".docx", ".csv", ...XLSX_EXTENSIONS]);

export function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

/**
 * Shared by the upload route and the preview route so both call the exact same 100%
 * rule-based parsing path (no AI/OpenAI/image-classification/OCR): 엑셀/CSV는 먼저 행·열
 * 구조 그대로 parseExcelTableGroups로 분석하고, 표 구조를 인식하지 못하면(null) 셀을
 * 평탄화한 텍스트를 parseManualText로 분석한다.
 */
export async function extractManualGroups(file: File, extension: string): Promise<AnalyzedManualGroup[]> {
  if (TEXT_EXTENSIONS.has(extension)) {
    return parseManualText(await file.text());
  }
  if (extension === ".docx") {
    return parseManualText(await extractDocxManualText(file));
  }
  if (extension === ".csv") {
    const rows = await extractCsvRows(file);
    return parseExcelTableGroups(rows) ?? parseManualText(rowsToFlatText(rows));
  }
  if (XLSX_EXTENSIONS.has(extension)) {
    const rows = await extractSpreadsheetRows(file);
    return parseExcelTableGroups(rows) ?? parseManualText(rowsToFlatText(rows));
  }
  throw new Error("지원하지 않는 파일 형식입니다.");
}
