import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
import {
  extractManualGroups,
  getFileExtension,
  TEXT_EXTENSIONS,
  XLSX_EXTENSIONS,
} from "@/lib/manuals/extract-manual-groups";
import { isFileSizeWithinLimit, isPlausibleXlsxMimeType } from "@/lib/manuals/upload-limits";
import { buildManualPreview, type ManualUploadPreview } from "@/lib/manuals/build-manual-preview";

export const runtime = "nodejs";

type PreviewManualsResponse = {
  preview?: ManualUploadPreview;
  idempotencyKey?: string;
  error?: string;
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Store-owner counterpart of /api/manuals/preview: same parsing (extractManualGroups) and same
 * classification/preview builder (buildManualPreview) as the HQ route, but scoped to a single
 * store. Never touches Supabase manuals/manual_chunks - only requireStoreOwner's own auth reads
 * happen here. storeId is never trusted from the client as-is: requireStoreOwner re-checks it
 * against the caller's own approved owner membership (store_memberships) and fails closed
 * (returns null -> 403) for a pending/rejected/other-owner's store.
 */
export async function POST(request: Request): Promise<NextResponse<PreviewManualsResponse>> {
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

  const storeId = getString(formData.get("storeId"));

  if (!storeId) {
    return NextResponse.json({ error: "지점 ID가 필요합니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const storeAuth = await requireStoreOwner(adminClient, userData.user.id, storeId);

  if (!storeAuth) {
    return NextResponse.json({ error: "이 지점에 대한 접근 권한이 없습니다." }, { status: 403 });
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

  let groups;

  try {
    groups = await extractManualGroups(file, extension);
  } catch (parseError) {
    console.error("[STORE_MANUALS_PREVIEW] parse failed:", parseError);
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

  // storeAuth.storeId (server-verified), never the raw request value, decides scopeType "store".
  const preview = buildManualPreview(groups, { storeId: storeAuth.storeId });

  // 이 미리보기 세션 1회당 1개. 같은 저장 요청이 재전송돼도 같은 key로 묶여 한 번만 저장된다.
  return NextResponse.json({ preview, idempotencyKey: randomUUID() }, { status: 200 });
}
