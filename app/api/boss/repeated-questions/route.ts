import { NextResponse } from "next/server";

import {
  type RepeatedQuestionAlertResult,
  fetchRepeatedQuestionAlertForOwner,
  unauthenticatedRepeatedQuestionAlertResult,
} from "@/lib/owner/repeated-question-alerts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** 반복 질문 알림 1건 조회. 세션 사용자가 그 매장의 승인 점주일 때만 내용을 돌려준다. */
export async function GET(request: Request): Promise<NextResponse<RepeatedQuestionAlertResult["body"]>> {
  const serverClient = await createClient();
  const { data: userData, error: userError } = await serverClient.auth.getUser();

  if (userError || !userData.user) {
    const unauthenticated = unauthenticatedRepeatedQuestionAlertResult();
    return NextResponse.json(unauthenticated.body, { status: unauthenticated.status });
  }

  const { searchParams } = new URL(request.url);
  const result = await fetchRepeatedQuestionAlertForOwner(createAdminClient(), {
    userId: userData.user.id,
    storeId: searchParams.get("storeId"),
    alertId: searchParams.get("alertId"),
  });

  return NextResponse.json(result.body, { status: result.status });
}
