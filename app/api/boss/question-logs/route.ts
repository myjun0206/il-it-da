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
    resolutionStatus: searchParams.get("resolutionStatus"),
    highlightQuestionId: searchParams.get("highlightId") || searchParams.get("questionId"),
  });

  return NextResponse.json(result.body, { status: result.status });
}

interface PatchResolutionBody {
  questionLogId?: unknown;
  nextStatus?: unknown;
  currentStatus?: unknown;
  currentRevision?: unknown;
}

/**
 * 점주가 insufficient 질문의 처리 상태(open, in_progress, resolved)를 갱신한다.
 * 세션 사용자가 question_logs.store_id의 승인된 점주인지 서버에서 다시 검증한다.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const serverClient = await createClient();
  const { data: userData, error: userError } = await serverClient.auth.getUser();

  if (userError || !userData.user) {
    const unauthenticated = unauthenticatedPendingQuestionsResult();
    return NextResponse.json(unauthenticated.body, { status: unauthenticated.status });
  }

  let body: PatchResolutionBody;
  try {
    body = (await request.json()) as PatchResolutionBody;
  } catch {
    return NextResponse.json({ success: false, error: "요청 본문 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const questionLogId = typeof body.questionLogId === "string" ? body.questionLogId : "";
  const nextStatus = typeof body.nextStatus === "string" ? body.nextStatus : "";
  const currentStatus = typeof body.currentStatus === "string" ? body.currentStatus : undefined;
  const currentRevision = typeof body.currentRevision === "number" ? body.currentRevision : undefined;

  const { updateQuestionResolutionStatusForOwner, isQuestionResolutionStatus } = await import("@/lib/owner/pending-questions");

  if (!isQuestionResolutionStatus(nextStatus)) {
    return NextResponse.json({ success: false, error: "올바른 처리 상태를 지정해 주세요." }, { status: 400 });
  }

  const result = await updateQuestionResolutionStatusForOwner(createAdminClient(), {
    userId: userData.user.id,
    questionLogId,
    nextStatus,
    currentStatus: isQuestionResolutionStatus(currentStatus) ? currentStatus : undefined,
    currentRevision,
  });

  return NextResponse.json(result.body, { status: result.status });
}
