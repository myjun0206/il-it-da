import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";

export const runtime = "nodejs";

type StoresResponse = {
  stores?: Array<{ id: string; name: string }>;
  error?: string;
};

export async function GET(): Promise<NextResponse<StoresResponse>> {
  try {
    const hqUser = await requireHqUser();
    if (!hqUser) {
      return NextResponse.json({ error: "본사 관리자만 접근할 수 있습니다." }, { status: 403 });
    }

    if (!hqUser.franchiseId) {
      return NextResponse.json({ stores: [] }, { status: 200 });
    }

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("stores")
      .select("id, store_name")
      .eq("franchise_id", hqUser.franchiseId)
      .order("store_name", { ascending: true });

    if (error) {
      return NextResponse.json({ error: "지점 목록을 불러오지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json({
      stores: (data ?? []).map((store) => ({ id: store.id, name: store.store_name })),
    });
  } catch (error) {
    console.error("GET /api/stores error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
