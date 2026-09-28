import { NextResponse, type NextRequest } from "next/server";

import { isMissingConversationTable, type ConversationMessageDto } from "@/lib/staff/conversations";
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
 * 본인 대화 1건 + 메시지. 다른 사용자의 대화 ID는 존재 여부와 관계없이 404.
 * canContinue: 대화 매장에 지금도 approved staff membership이 있는지 (없으면 기록 열람만 가능)
 */
export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const adminClient = createAdminClient();
  const { data: conversation, error } = await adminClient
    .from("conversations")
    .select("id, title, store_id, updated_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle<{ id: string; title: string; store_id: string; updated_at: string }>();

  if (error && !isMissingConversationTable(error)) {
    return NextResponse.json({ error: "대화를 불러오지 못했습니다." }, { status: 500 });
  }
  if (!conversation) {
    return NextResponse.json({ error: "대화를 찾을 수 없습니다." }, { status: 404 });
  }

  const [{ data: messages, error: messageError }, { data: store }, { data: membership }] = await Promise.all([
    adminClient
      .from("conversation_messages")
      .select("id, role, content, status, source_title, source_category, similarity, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true }),
    adminClient.from("stores").select("store_name").eq("id", conversation.store_id).maybeSingle<{ store_name: string }>(),
    adminClient
      .from("store_memberships")
      .select("id")
      .eq("user_id", userId)
      .eq("store_id", conversation.store_id)
      .eq("role", "staff")
      .eq("status", "approved")
      .maybeSingle(),
  ]);

  if (messageError) {
    return NextResponse.json({ error: "대화를 불러오지 못했습니다." }, { status: 500 });
  }

  const result: ConversationMessageDto[] = (messages ?? []).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    status: row.status,
    sourceTitle: row.source_title,
    sourceCategory: row.source_category,
    similarity: row.similarity,
    createdAt: row.created_at,
  }));

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      storeId: conversation.store_id,
      storeName: store?.store_name ?? "",
      updatedAt: conversation.updated_at,
      canContinue: Boolean(membership),
    },
    messages: result,
  });
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
    return NextResponse.json({ error: "대화를 삭제하지 못했습니다." }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "대화를 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
