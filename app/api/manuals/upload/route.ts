import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { saveManualGroupsWithChunks, type ManualGroupInput } from "@/lib/rag/save-manual-sections";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type UploadManualsResponse = {
  manuals?: ManualRecord[];
  error?: string;
};

const TITLE_KEYS = ["title", "제목", "주제", "소주제"];
const CONTENT_KEYS = ["content", "내용", "본문"];

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function pickColumnIndex(headerRow: string[], candidates: string[]): number {
  return headerRow.findIndex((cell) => candidates.includes(cell.trim().toLowerCase()));
}

// "0. 프랜차이즈 매뉴얼 적용 원칙", "1. 오픈 체크리스트", "11. 매장 개방..." 처럼
// 최상위 정수 번호("숫자. ")로 시작하는 줄만 주제(부모 카드) 경계로 인식한다.
const NUMBERED_ITEM_START = /(?:^|\n)\s*(\d{1,3}\.\s.*)/g;

// "0-1. 본사 공통 매뉴얼", "1-2. 매장 개방..." 처럼 "숫자-숫자. " 패턴은
// 주제 안의 세부 내용(자식 항목) 경계로 인식한다.
const SUB_ITEM_START = /(?:^|\n)\s*(\d{1,3}-\d{1,3}\.\s.*)/g;

function splitByPattern(text: string, pattern: RegExp): string[] {
  const starts: number[] = [];
  const regex = new RegExp(pattern);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const matchedLine = match[1];
    const lineStart = match.index + match[0].indexOf(matchedLine);
    starts.push(lineStart);
  }

  if (starts.length < 2) {
    return [];
  }

  const chunks: string[] = [];

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : text.length;
    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

// 빈 줄(\n\n) 기준 문단 분할. 번호 매김 패턴이 전혀 없을 때의 차선책으로 사용한다.
function splitByParagraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

// 주제(부모) 1개의 본문을 세부 내용(자식) 목록으로 나눈다:
// "숫자-숫자." 패턴 -> 없으면 평범한 "숫자." 나열 -> 없으면 빈 줄 문단 -> 그마저 없으면 전체 본문을 하나의 항목으로 사용한다.
// 이 함수는 이미 주제가 결정된 뒤 호출되므로, "1. ", "2. " 같은 평범한 번호도 새 주제가 아닌 세부 항목으로 처리된다.
function splitDetailItems(text: string): string[] {
  const subItems = splitByPattern(text, SUB_ITEM_START);
  if (subItems.length >= 2) {
    return subItems;
  }

  const numberedItems = splitByPattern(text, NUMBERED_ITEM_START);
  if (numberedItems.length >= 2) {
    return numberedItems;
  }

  const paragraphs = splitByParagraphs(text);
  if (paragraphs.length >= 2) {
    return paragraphs;
  }

  return text.trim() ? [text.trim()] : [];
}

// 한 셀/항목 안에 여러 대주제(정수 번호)가 통촬로 들어있는 경우를 감지해 주제별 그룹으로 분할한다.
function splitTopLevelGroups(text: string): ManualGroupInput[] {
  const chunks = splitByPattern(text, NUMBERED_ITEM_START);

  if (chunks.length < 2) {
    return [];
  }

  return chunks.map((chunk) => {
    const [firstLine, ...rest] = chunk.split("\n");
    return {
      topic: (firstLine ?? "").trim(),
      items: splitDetailItems(rest.join("\n").trim()),
    };
  });
}

function rowsToGroups(rows: string[][], fallbackTopic: string): ManualGroupInput[] {
  if (rows.length === 0) {
    return [];
  }

  let titleIdx = 0;
  let contentIdx = 1;
  let sourceRows = rows;
  let hasRecognizedHeader = false;

  // 행이 2개 이상일 때만 첫 행을 헤더 후보로 검사한다. 데이터가 1행뿐이면 헤더로 오인해 버리지 않는다.
  if (rows.length > 1) {
    const normalizedHeader = rows[0].map((cell) => cell.trim().toLowerCase());
    const detectedTitleIdx = pickColumnIndex(normalizedHeader, TITLE_KEYS);
    const detectedContentIdx = pickColumnIndex(normalizedHeader, CONTENT_KEYS);
    hasRecognizedHeader = detectedTitleIdx !== -1 || detectedContentIdx !== -1;

    if (hasRecognizedHeader) {
      titleIdx = detectedTitleIdx;
      contentIdx = detectedContentIdx;
      sourceRows = rows.slice(1);
    }
  }

  const groups: ManualGroupInput[] = [];

  for (const row of sourceRows) {
    const title = titleIdx >= 0 ? (row[titleIdx] ?? "").trim() : "";
    const content = contentIdx >= 0 ? (row[contentIdx] ?? "").trim() : "";

    if (!title && !content) {
      continue;
    }

    // title 열이 명확히 인식되었으면 그 값을 주제로 뿐로 사용하고, content 안의 "1. ", "2. " 같은 번호는
    // 절대 새 주제로 분할하지 않고 세부 항목(items)으로만 매핑한다.
    if (hasRecognizedHeader) {
      groups.push({
        topic: title || fallbackTopic,
        items: splitDetailItems(content || title),
      });
      continue;
    }

    // 헤더를 인식하지 못해 title/content 구분이 불확실한 경우에만, 한 셀 안에 여러 대주제가 통촬로
    // 들어있을 가능성을 검사한다.
    const source = content || title;
    const topLevelGroups = splitTopLevelGroups(source);

    if (topLevelGroups.length >= 2) {
      groups.push(...topLevelGroups);
      continue;
    }

    groups.push({
      topic: title || fallbackTopic,
      items: splitDetailItems(content || title),
    });
  }

  return groups;
}

// .txt 업로드: 최상위 정수 번호를 주제(부모) 경계로, 그 안의 하위 내용은 세부 항목(자식)으로 분할한다.
function parseTxtGroups(text: string, fallbackTopic: string): ManualGroupInput[] {
  const topLevelGroups = splitTopLevelGroups(text);

  if (topLevelGroups.length >= 2) {
    return topLevelGroups;
  }

  // 번호 매김이 전혀 없으면 빈 줄 문단마다 독립된 주제로 취급한다(각 주제당 세부 항목 1개).
  const paragraphs = splitByParagraphs(text).slice(0, 200);

  if (paragraphs.length === 0) {
    return [];
  }

  if (paragraphs.length === 1) {
    return [{ topic: fallbackTopic, items: [paragraphs[0]] }];
  }

  return paragraphs.map((paragraph, index) => {
    const [firstLine, ...rest] = paragraph.split(/\r?\n/);
    const content = rest.join("\n").trim() || paragraph;
    return {
      topic: (firstLine || `${fallbackTopic} ${index + 1}`).slice(0, 60),
      items: [content],
    };
  });
}

async function loadXlsxModule() {
  try {
    const mod = await import("xlsx");
    return mod.default ?? mod;
  } catch (importError) {
    console.error("[MANUALS_UPLOAD] xlsx module load failed:", importError);
    throw new Error("엑셀 파싱 모듈을 불러오지 못했습니다.");
  }
}

// xlsx(SheetJS)는 동기적으로 버퍼를 파싱하므로, ExcelJS의 비동기 zip/메타데이터 스트림 에러("reading 'company'")가 재현되지 않는다.
async function parseXlsxRows(buffer: ArrayBuffer): Promise<string[][]> {
  const XLSX = await loadXlsxModule();

  let workbook: ReturnType<typeof XLSX.read>;

  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (readError) {
    console.error("[MANUALS_UPLOAD] xlsx read failed:", readError);
    throw new Error("엑셀 파일 형식을 읽을 수 없습니다. 파일 상태를 확인해 주세요.");
  }

  const sheetName = workbook.SheetNames?.[0];

  if (!sheetName) {
    throw new Error("엑셀 파일에 시트가 없습니다.");
  }

  const sheet = workbook.Sheets[sheetName];

  let rawRows: unknown[][];

  try {
    rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
  } catch (sheetError) {
    console.error("[MANUALS_UPLOAD] xlsx sheet_to_json failed:", sheetError);
    throw new Error("엑셀 파일 형식을 읽을 수 없습니다. 파일 상태를 확인해 주세요.");
  }

  return rawRows.map((row) => (Array.isArray(row) ? row.map(normalizeCell) : []));
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

function parseCsvRows(text: string): string[][] {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
}

export async function POST(request: Request): Promise<NextResponse<UploadManualsResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "빈 파일은 업로드할 수 없습니다." }, { status: 400 });
  }

  const extension = getExtension(file.name);
  const fallbackTopic = file.name.slice(0, file.name.length - extension.length).trim() || "업로드 매뉴얼";

  let groups: ManualGroupInput[];

  try {
    if (extension === ".xlsx" || extension === ".xls") {
      const rows = await parseXlsxRows(await file.arrayBuffer());
      if (rows.length === 0) {
        return NextResponse.json({ error: "파일에 데이터가 없습니다." }, { status: 400 });
      }
      groups = rowsToGroups(rows, fallbackTopic);
    } else if (extension === ".csv") {
      const rows = parseCsvRows(await file.text());
      if (rows.length === 0) {
        return NextResponse.json({ error: "파일에 데이터가 없습니다." }, { status: 400 });
      }
      groups = rowsToGroups(rows, fallbackTopic);
    } else if (extension === ".txt" || extension === ".md") {
      groups = parseTxtGroups(await file.text(), fallbackTopic);
    } else if (extension === ".pdf") {
      return NextResponse.json(
        { error: "PDF 파일 파싱은 아직 지원하지 않습니다. .txt, .xlsx, .csv 파일로 변환 후 다시 업로드해주세요." },
        { status: 400 },
      );
    } else {
      return NextResponse.json(
        { error: "지원하지 않는 파일 형식입니다. (.xlsx, .csv, .txt 만 지원)" },
        { status: 400 },
      );
    }
  } catch (parseError) {
    console.error("[MANUALS_UPLOAD] parse failed:", parseError);
    const message =
      parseError instanceof Error && parseError.message
        ? parseError.message
        : "파일 형식을 읽을 수 없습니다. 파일 상태를 확인해 주세요.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (groups.length === 0) {
    return NextResponse.json(
      { error: "주제/내용을 인식하지 못했습니다. 파일 내용을 확인해주세요." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  try {
    const manuals = await saveManualGroupsWithChunks(supabase, hqUser, groups);
    return NextResponse.json({ manuals }, { status: 201 });
  } catch (e) {
    console.error("[MANUALS_UPLOAD] save failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "매뉴얼 저장 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
