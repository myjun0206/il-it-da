import { NextResponse, type NextRequest } from "next/server";

import { getStaffConversationDetail } from "@/lib/staff/conversations";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

async function getUserId(): Promise<string | null> {
  const serverClient = await createClient();
  const { data, error } = await serverClient.auth.getUser();
  return error || !data.user ? null : data.user.id;
}

/**
 * 본인 대화 1건 + 메시지. 다른 사용자의 대화이거나 탈퇴한 매장(현재 approved staff membership 없음)의
 * 대화는 존재 여부와 관계없이 404. 응답이 성공이면 canContinue는 항상 true다.
 */
export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const result = await getStaffConversationDetail(createAdminClient(), userId, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ conversation: result.conversation, messages: result.messages });
}

/** 본인 대화만 삭제 (메시지는 FK cascade로 함께 삭제) */
export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    console.error("[DELETE /api/staff/conversations/:id] Failed to delete conversation:", {
      userId,
      conversationId: id,
      error: { code: error.code, message: error.message },
    });
    return NextResponse.json({ error: "대화를 삭제하지 못했습니다." }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "대화를 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
