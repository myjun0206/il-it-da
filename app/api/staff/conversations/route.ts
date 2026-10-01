import { NextResponse } from "next/server";

import { isMissingConversationTable, type ConversationSummaryDto } from "@/lib/staff/conversations";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** 로그인한 직원 본인의 대화 목록 (최신순) */
export async function GET(): Promise<NextResponse> {
  const serverClient = await createClient();
  const { data: userData, error: userError } = await serverClient.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conversations")
    .select("id, title, store_id, updated_at")
    .eq("user_id", userData.user.id)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    if (isMissingConversationTable(error)) {
      return NextResponse.json({ conversations: [], historyAvailable: false });
    }
    console.error("[GET /api/staff/conversations] Failed to fetch conversations:", {
      userId: userData.user.id,
      error: { code: error.code, message: error.message },
    });
    return NextResponse.json({ error: "대화 기록을 불러오지 못했습니다." }, { status: 500 });
  }

  const storeIds = [...new Set((data ?? []).map((row) => row.store_id))];
  const { data: stores } = storeIds.length
    ? await adminClient.from("stores").select("id, store_name").in("id", storeIds)
    : { data: [] as { id: string; store_name: string }[] };
  const storeNames = new Map((stores ?? []).map((store) => [store.id, store.store_name]));

  const conversations: ConversationSummaryDto[] = (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    storeId: row.store_id,
    storeName: storeNames.get(row.store_id) ?? "",
    updatedAt: row.updated_at,
  }));

  return NextResponse.json({ conversations, historyAvailable: true });
}
