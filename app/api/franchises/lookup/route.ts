import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type FranchiseRow = {
  id: string;
  name: string;
  domain: string;
  logo_url: string | null;
};

type FranchiseLookupResponse = {
  franchise?: FranchiseRow;
  error?: string;
};

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

// 회원가입 전(계정 없음) 단계에서도 조회할 수 있어야 하므로 인증 없이 도메인만으로 공개 조회한다.
export async function GET(request: Request): Promise<NextResponse<FranchiseLookupResponse>> {
  const { searchParams } = new URL(request.url);
  const rawDomain = searchParams.get("domain");

  if (!rawDomain) {
    return NextResponse.json({ error: "domain query parameter is required." }, { status: 400 });
  }

  const domain = normalizeDomain(rawDomain);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("franchises")
    .select("id, name, domain, logo_url")
    .eq("domain", domain)
    .maybeSingle<FranchiseRow>();

  if (error) {
    return NextResponse.json({ error: "프랜차이즈 조회 중 오류가 발생했습니다." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "등록된 프랜차이즈 정보를 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ franchise: data });
}
