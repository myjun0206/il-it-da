import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
import { parseManualText, type AnalyzedManualGroup } from "@/lib/manuals/analyze-manual-with-ai";
import { parseExcelTableGroups } from "@/lib/manuals/parse-excel-table";
import {
  extractCsvRows,
  extractDocxManualText,
  extractSpreadsheetRows,
  rowsToFlatText,
} from "@/lib/manuals/extract-manual-file-text";
import { isFileSizeWithinLimit } from "@/lib/manuals/upload-limits";

export const runtime = "nodejs";

type AnalyzeResponse = {
  groups?: AnalyzedManualGroup[];
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

/**
 * 지점 매뉴얼 파일을 업로드하면 AI가 텍스트를 분석해 카테고리/타이틀/세부 매뉴얼 구조(미리보기)를 반환한다.
 * DB에는 아무것도 저장하지 않으며, 사용자가 검토 후 /api/store-manuals/batch-create로 최종 등록한다.
 */
export async function POST(request: Request): Promise<NextResponse<AnalyzeResponse>> {
  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    }

    const storeId = typeof formData.get("storeId") === "string" ? (formData.get("storeId") as string).trim() : "";

    if (!storeId) {
      return NextResponse.json({ error: "지점 ID가 필요합니다." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const storeAuth = await requireStoreOwner(adminClient, userData.user.id, storeId);

    if (!storeAuth) {
      return NextResponse.json({ error: "이 지점에 대한 접근 권한이 없습니다." }, { status: 403 });
    }

    const fileValue = formData.get("file");
    const file = fileValue instanceof File ? fileValue : null;

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
    }

    if (!isFileSizeWithinLimit(file.size)) {
      return NextResponse.json({ error: "업로드 가능한 최대 파일 크기를 초과했습니다." }, { status: 413 });
    }

    const extension = getExtension(file.name);

    if (extension === ".pdf") {
      return NextResponse.json(
        { error: "PDF는 아직 지원하지 않습니다. Word(.docx)나 텍스트(.txt)로 저장해서 올려주세요." },
        { status: 400 },
      );
    }

    if (!TEXT_EXTENSIONS.has(extension) && extension !== ".docx" && extension !== ".csv" && !XLSX_EXTENSIONS.has(extension)) {
      return NextResponse.json(
        { error: "지원하지 않는 형식입니다. .txt, .md, .docx, .csv, .xlsx, .xls 파일을 올려주세요." },
        { status: 400 },
      );
    }

    let groups: AnalyzedManualGroup[];
    try {
      groups = await extractManualGroups(file, extension);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "파일을 읽지 못했습니다." },
        { status: 400 },
      );
    }

    if (groups.length === 0) {
      return NextResponse.json({ error: "문서 내용을 분석하지 못했습니다." }, { status: 422 });
    }

    return NextResponse.json({ groups });
  } catch (e) {
    console.error("POST /api/store-manuals/analyze error:", e);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
