import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { saveManualGroupsWithChunks } from "@/lib/rag/save-manual-sections";
import { parseManualText, type AnalyzedManualGroup } from "@/lib/manuals/analyze-manual-with-ai";
import { parseExcelTableGroups } from "@/lib/manuals/parse-excel-table";
import {
  extractCsvRows,
  extractDocxManualText,
  extractSpreadsheetRows,
  rowsToFlatText,
} from "@/lib/manuals/extract-manual-file-text";
import { isFileSizeWithinLimit, isPlausibleXlsxMimeType } from "@/lib/manuals/upload-limits";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type UploadManualsResponse = {
  manuals?: ManualRecord[];
  error?: string;
};

const TEXT_EXTENSIONS = new Set([".txt", ".md"]);
const XLSX_EXTENSIONS = new Set([".xlsx", ".xls"]);

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

// 엑셀/CSV는 먼저 행·열 구조 그대로 parseExcelTableGroups로 분석하고,
// 표 구조를 인식하지 못하면(null) 셀을 평탄화한 텍스트를 parseManualText로 분석한다.
async function extractManualGroups(file: File, extension: string): Promise<AnalyzedManualGroup[]> {
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

// 파일 하나 안에 여러 카테고리/타이틀/세부 매뉴얼이 섞여 있을 수 있으므로,
// 파일명을 카테고리로 강제하지 않고 extractManualGroups(표 구조 또는 텍스트 패턴 인식, 100% 로컬 규칙 기반)로 분석한다.
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

  if (!isFileSizeWithinLimit(file.size)) {
    return NextResponse.json({ error: "업로드 가능한 최대 파일 크기를 초과했습니다." }, { status: 413 });
  }

  const extension = getExtension(file.name);

  if (extension === ".pdf") {
    return NextResponse.json(
      { error: "PDF 파일 파싱은 아직 지원하지 않습니다. .txt, .docx, .xlsx, .csv 파일로 변환 후 다시 업로드해주세요." },
      { status: 400 },
    );
  }

  if (!TEXT_EXTENSIONS.has(extension) && extension !== ".docx" && extension !== ".csv" && !XLSX_EXTENSIONS.has(extension)) {
    return NextResponse.json(
      { error: "지원하지 않는 파일 형식입니다. (.txt, .md, .docx, .xlsx, .xls, .csv 만 지원)" },
      { status: 400 },
    );
  }

  if (XLSX_EXTENSIONS.has(extension) && !isPlausibleXlsxMimeType(file.type)) {
    return NextResponse.json({ error: "지원하지 않는 파일 형식입니다." }, { status: 400 });
  }

  let groups: AnalyzedManualGroup[];

  try {
    groups = await extractManualGroups(file, extension);
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
