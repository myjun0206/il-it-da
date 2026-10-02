import { NextResponse } from "next/server";

import { listStaffConversations } from "@/lib/staff/conversations";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** 로그인한 직원 본인의 대화 목록 (최신순). 현재 승인된 근무 매장의 대화만 포함한다. */
export async function GET(): Promise<NextResponse> {
  const serverClient = await createClient();
  const { data: userData, error: userError } = await serverClient.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await listStaffConversations(createAdminClient(), userData.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ conversations: result.conversations, historyAvailable: result.historyAvailable });
}
