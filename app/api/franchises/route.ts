import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type FranchiseRow = {
  id: string;
  name: string;
  domain: string;
  logo_url: string | null;
};

type FranchiseListResponse = {
  franchises?: FranchiseRow[];
  error?: string;
};

// 가입 승인 화면의 브랜드 드롭다운에서 사용: 계정 생성 전(회원가입 도중)에도 조회할 수 있어야
// 하므로 인증 없이 franchises 디렉터리 전체를 공개 조회한다.
export async function GET(): Promise<NextResponse<FranchiseListResponse>> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("franchises")
    .select("id, name, domain, logo_url")
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "프랜차이즈 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ franchises: (data ?? []) as FranchiseRow[] });
}
