import { NextResponse } from "next/server";

import { requireHqUser } from "@/lib/supabase/hq-auth";
import { extractDocxTextFromXml } from "@/lib/manuals/extract-docx-text";
import { isFileSizeWithinLimit } from "@/lib/manuals/upload-limits";

export const runtime = "nodejs";

type ExtractTextResponse = {
  text?: string;
  error?: string;
};

// 온보딩 화면에서 Word(.docx) 파일의 본문만 추출해 돌려준다. 저장은 하지 않으며, 사용자가 확인 후 승인할 때 /api/manuals로 저장된다.
export async function POST(request: Request): Promise<NextResponse<ExtractTextResponse>> {
  const hqUser = await requireHqUser();

  if (!hqUser) {
    return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
  }

  let file: File | null = null;

  try {
    const formData = await request.formData();
    const value = formData.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
  }

  if (!isFileSizeWithinLimit(file.size)) {
    return NextResponse.json({ error: "업로드 가능한 최대 파일 크기를 초과했습니다." }, { status: 413 });
  }

  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();

  if (extension !== ".docx") {
    return NextResponse.json({ error: "Word(.docx) 파일만 변환할 수 있습니다." }, { status: 400 });
  }

  try {
    const mod = await import("xlsx");
    const XLSX = mod.default ?? mod;
    const archive = XLSX.CFB.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
    const entry = XLSX.CFB.find(archive, "/word/document.xml");

    if (!entry?.content) {
      return NextResponse.json({ error: "Word 문서 내용을 찾지 못했습니다. 파일을 확인해주세요." }, { status: 400 });
    }

    const xml = Buffer.from(entry.content as Uint8Array).toString("utf8");
    const text = extractDocxTextFromXml(xml);

    if (!text.trim()) {
      return NextResponse.json({ error: "문서에 읽을 수 있는 글자가 없습니다." }, { status: 400 });
    }

    return NextResponse.json({ text });
  } catch (e) {
    console.error("[MANUALS_EXTRACT_TEXT] docx parse failed:", e instanceof Error ? e.name : "UnknownError");
    return NextResponse.json({ error: "Word 파일을 읽지 못했습니다. 파일 상태를 확인해주세요." }, { status: 400 });
  }
}
