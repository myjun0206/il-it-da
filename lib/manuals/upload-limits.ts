// 순수 함수/상수만 포함한다(Next.js 런타임 의존성 없음) - node:test로 직접 단위 테스트하기 위함.
// PoC 규모의 매뉴얼 업로드에 충분한 여유를 두되, 과도한 파일로 인한 자원 고갈을 막기 위한 상한.
export const MAX_UPLOAD_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_XLSX_SHEET_COUNT = 20;
export const MAX_XLSX_ROWS_PER_SHEET = 5_000;

// 브라우저가 .xlsx/.xls에 대해 흔히 보내는 MIME 타입 + 빈 값/octet-stream(제네릭)까지만 허용한다.
// 확장자만 바꾼 명백히 다른 타입(예: image/*, text/html)은 이 목록에 없으므로 거부된다.
const ALLOWED_XLSX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
  "",
]);

export function isFileSizeWithinLimit(
  sizeInBytes: number,
  maxBytes: number = MAX_UPLOAD_FILE_SIZE_BYTES,
): boolean {
  return Number.isFinite(sizeInBytes) && sizeInBytes >= 0 && sizeInBytes <= maxBytes;
}

export function isPlausibleXlsxMimeType(mimeType: string): boolean {
  return ALLOWED_XLSX_MIME_TYPES.has(mimeType);
}

export function isSheetCountWithinLimit(
  sheetCount: number,
  maxSheets: number = MAX_XLSX_SHEET_COUNT,
): boolean {
  return Number.isFinite(sheetCount) && sheetCount >= 0 && sheetCount <= maxSheets;
}

export function isRowCountWithinLimit(
  rowCount: number,
  maxRows: number = MAX_XLSX_ROWS_PER_SHEET,
): boolean {
  return Number.isFinite(rowCount) && rowCount >= 0 && rowCount <= maxRows;
}
