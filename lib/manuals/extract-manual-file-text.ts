import { extractDocxTextFromXml } from "@/lib/manuals/extract-docx-text";
import { isRowCountWithinLimit, isSheetCountWithinLimit } from "@/lib/manuals/upload-limits";

// 매뉴얼 업로드 파일(.docx/.xlsx/.xls/.csv)에서 AI 분석용 원본 텍스트를 추출하는 공용 유틸.
// HQ(app/api/manuals/upload)와 지점(app/api/store-manuals/analyze) 업로드 라우트가 함께 쓴다.

export async function extractDocxManualText(file: File): Promise<string> {
  const mod = await import("xlsx");
  const XLSX = mod.default ?? mod;
  const archive = XLSX.CFB.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
  const entry = XLSX.CFB.find(archive, "/word/document.xml");

  if (!entry?.content) {
    throw new Error("Word 문서 내용을 찾지 못했습니다. 파일을 확인해주세요.");
  }

  const xml = Buffer.from(entry.content as Uint8Array).toString("utf8");
  return extractDocxTextFromXml(xml);
}

// 엑셀(.xlsx/.xls)을 시트별 원본 행렬(string[][])로 읽는다. 표 구조를 그대로 보존해야 하는
// parseExcelTableGroups(카테고리/타이틀 열 인식)에서 사용하고, 텍스트 평탄화도 이 위에서 만든다.
export async function extractSpreadsheetRows(file: File): Promise<string[][]> {
  const mod = await import("xlsx");
  const XLSX = mod.default ?? mod;
  const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });

  if (!isSheetCountWithinLimit(workbook.SheetNames.length)) {
    throw new Error("엑셀 파일의 시트 수가 허용 개수를 초과했습니다.");
  }

  const allRows: string[][] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });

    if (!isRowCountWithinLimit(rows.length)) {
      throw new Error("엑셀 시트의 행 수가 허용 개수를 초과했습니다.");
    }

    for (const row of rows) {
      allRows.push((row ?? []).map((cell) => String(cell ?? "").trim()));
    }
  }

  return allRows;
}

// 엑셀(.xlsx/.xls)의 각 행을 "셀1 - 셀2 - ..." 한 줄 텍스트로 펼쳐 텍스트 분석 입력으로 사용한다.
// (parseExcelTableGroups로 표 구조를 인식하지 못했을 때의 대체 경로)
export async function extractSpreadsheetManualText(file: File): Promise<string> {
  const rows = await extractSpreadsheetRows(file);
  return rowsToFlatText(rows);
}

// 따옴표로 감싼 쉼표를 지원하는 최소한의 CSV 파서 (한 줄에 개행이 포함된 필드는 지원하지 않음).
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

// CSV를 시트 없는 단일 표로 보고 원본 행렬(string[][])로 읽는다.
export async function extractCsvRows(file: File): Promise<string[][]> {
  const rows = (await file.text())
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => parseCsvLine(line).map((cell) => cell.trim()));

  if (!isRowCountWithinLimit(rows.length)) {
    throw new Error("CSV 파일의 행 수가 허용 개수를 초과했습니다.");
  }

  return rows;
}

// CSV의 각 행도 엑셀과 동일하게 "셀1 - 셀2 - ..." 한 줄 텍스트로 펼친다.
export async function extractCsvManualText(file: File): Promise<string> {
  const rows = await extractCsvRows(file);
  return rowsToFlatText(rows);
}

export function rowsToFlatText(rows: string[][]): string {
  const lines = rows
    .map((row) => row.map((cell) => cell.trim()).filter(Boolean).join(" - "))
    .filter(Boolean);

  return lines.join("\n\n");
}
