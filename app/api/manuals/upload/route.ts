import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";
import { saveManualGroupsWithBatchGuard } from "@/lib/manuals/save-manuals-with-batch";
import type { AnalyzedManualGroup } from "@/lib/manuals/analyze-manual-with-ai";
import {
  extractManualGroups,
  getFileExtension,
  TEXT_EXTENSIONS,
  XLSX_EXTENSIONS,
} from "@/lib/manuals/extract-manual-groups";
import { isFileSizeWithinLimit, isPlausibleXlsxMimeType } from "@/lib/manuals/upload-limits";
import type { ManualRecord } from "@/lib/types/manual";

export const runtime = "nodejs";

type UploadManualsResponse = {
  manuals?: ManualRecord[];
  error?: string;
};

/**
 * Deprecated: HQ 공식 파일 업로드 경로는 /api/manuals/preview -> 사용자 검토 ->
 * /api/manuals/preview/confirm이다. 이 라우트는 저장 전 확인 단계 없이 바로 저장한다.
 *
 * 앱 화면에서는 더 이상 호출하지 않지만, 외부/기존 호출자를 위해 호환 목적으로 남겨둔다.
 * 중복 방지는 preview/confirm과 동일한 saveManualGroupsWithBatchGuard로 보호된다.
 *
 * 제거 조건: (1) 020 마이그레이션이 운영에 적용되고, (2) 한 번의 릴리스 주기 동안 이 경로로
 * 들어오는 요청이 없음을 확인하고, (3) 팀 합의로 외부 호출 계약이 없음을 확정한 뒤 삭제한다.
 *
 * 파일 하나 안에 여러 카테고리/타이틀/세부 매뉴얼이 섞여 있을 수 있으므로,
 * 파일명을 카테고리로 강제하지 않고 extractManualGroups(표 구조 또는 텍스트 패턴 인식,
 * 100% 로컬 규칙 기반)로 분석한다.
 */
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

  const extension = getFileExtension(file.name);

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
  const result = await saveManualGroupsWithBatchGuard(supabase, {
    auth: hqUser,
    groups,
    scope: { scopeType: "hq", franchiseId: hqUser.franchiseId, storeId: null },
  });

  if (result.kind === "blocked") {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (result.kind === "save_failed") {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ manuals: result.manuals }, { status: result.kind === "saved" ? 201 : 200 });
}
