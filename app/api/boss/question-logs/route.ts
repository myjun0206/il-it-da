import { NextResponse } from "next/server";

import {
  type PendingQuestionsResult,
  fetchPendingQuestionsForOwner,
  unauthenticatedPendingQuestionsResult,
} from "@/lib/owner/pending-questions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * 점주가 자기 매장에서 매뉴얼 근거 부족으로 보류된(status='insufficient') 직원 질문만 읽는다.
 *
 * storeId는 쿼리로 받지만 fetchPendingQuestionsForOwner 안에서 requireStoreOwner
 * (승인된 owner 멤버십 + stores.franchise_id 확인)로 다시 검증하므로, 다른 매장 점주·
 * 미승인 점주·비로그인 사용자는 질문 내용을 볼 수 없다.
 */
export async function GET(request: Request): Promise<NextResponse<PendingQuestionsResult["body"]>> {
  const serverClient = await createClient();
  const { data: userData, error: userError } = await serverClient.auth.getUser();

  if (userError || !userData.user) {
    const unauthenticated = unauthenticatedPendingQuestionsResult();
    return NextResponse.json(unauthenticated.body, { status: unauthenticated.status });
  }

  const { searchParams } = new URL(request.url);

  const result = await fetchPendingQuestionsForOwner(createAdminClient(), {
    userId: userData.user.id,
    storeId: searchParams.get("storeId"),
    limit: searchParams.get("limit"),
  });

  return NextResponse.json(result.body, { status: result.status });
}
