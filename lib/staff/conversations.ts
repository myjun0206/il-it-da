// 직원 AI 대화 기록 공통 유틸 (server 전용 API에서 사용)
import type { SupabaseClient } from "@supabase/supabase-js";

export const CONVERSATION_TITLE_MAX_LENGTH = 36;

/** 첫 질문으로 대화 제목을 만든다. (별도 AI 호출 없이 공백 정리 + 길이 제한) */
export function buildConversationTitle(question: string): string {
  const normalized = question.replace(/\s+/g, " ").trim();
  if (normalized.length <= CONVERSATION_TITLE_MAX_LENGTH) return normalized || "새 대화";
  return `${normalized.slice(0, CONVERSATION_TITLE_MAX_LENGTH).trimEnd()}…`;
}

/** migration 022(conversations 테이블)이 아직 적용되지 않은 환경 */
export function isMissingConversationTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export interface ConversationMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "answered" | "cautious" | "insufficient" | null;
  sourceTitle: string | null;
  sourceCategory: string | null;
  similarity: number | null;
  createdAt: string;
}

export interface ConversationSummaryDto {
  id: string;
  title: string;
  storeId: string;
  storeName: string;
  updatedAt: string;
}

const CONVERSATION_LIST_LIMIT = 100;

/** 현재 approved staff membership이 있는 매장 ID. 조회 실패 시 null (호출부는 fail-closed). */
async function fetchApprovedStaffStoreIds(adminClient: SupabaseClient, userId: string): Promise<string[] | null> {
  const { data, error } = await adminClient
    .from("store_memberships")
    .select("store_id")
    .eq("user_id", userId)
    .eq("role", "staff")
    .eq("status", "approved");

  if (error) {
    console.error("[STAFF_CONVERSATIONS] Failed to fetch approved memberships:", {
      userId,
      error: { code: error.code, message: error.message },
    });
    return null;
  }

  return [
    ...new Set(
      ((data ?? []) as { store_id: unknown }[])
        .map((row) => row.store_id)
        .filter((storeId): storeId is string => typeof storeId === "string" && storeId.length > 0),
    ),
  ];
}

export type StaffConversationListResult =
  | { ok: true; conversations: ConversationSummaryDto[]; historyAvailable: boolean }
  | { ok: false; status: 500; error: string };

/**
 * 본인 대화 중 지금도 approved staff membership이 있는 매장의 대화만 반환한다.
 * 탈퇴(멤버십 삭제)한 매장의 대화는 목록에서 제외된다.
 */
export async function listStaffConversations(
  adminClient: SupabaseClient,
  userId: string,
): Promise<StaffConversationListResult> {
  const failure = { ok: false, status: 500, error: "대화 기록을 불러오지 못했습니다." } as const;

  const approvedStoreIds = await fetchApprovedStaffStoreIds(adminClient, userId);
  if (!approvedStoreIds) return failure;
  if (approvedStoreIds.length === 0) return { ok: true, conversations: [], historyAvailable: true };

  const { data, error } = await adminClient
    .from("conversations")
    .select("id, title, store_id, updated_at")
    .eq("user_id", userId)
    .in("store_id", approvedStoreIds)
    .order("updated_at", { ascending: false })
    .limit(CONVERSATION_LIST_LIMIT);

  if (error) {
    if (isMissingConversationTable(error)) {
      return { ok: true, conversations: [], historyAvailable: false };
    }
    console.error("[STAFF_CONVERSATIONS] Failed to fetch conversations:", {
      userId,
      error: { code: error.code, message: error.message },
    });
    return failure;
  }

  const rows = (data ?? []) as { id: string; title: string; store_id: string; updated_at: string }[];
  const storeIds = [...new Set(rows.map((row) => row.store_id))];
  const { data: stores } = storeIds.length
    ? await adminClient.from("stores").select("id, store_name").in("id", storeIds)
    : { data: [] as { id: string; store_name: string }[] };
  const storeNames = new Map(((stores ?? []) as { id: string; store_name: string }[]).map((store) => [store.id, store.store_name]));

  return {
    ok: true,
    historyAvailable: true,
    conversations: rows.map((row) => ({
      id: row.id,
      title: row.title,
      storeId: row.store_id,
      storeName: storeNames.get(row.store_id) ?? "",
      updatedAt: row.updated_at,
    })),
  };
}

export type StaffConversationDetailResult =
  | {
      ok: true;
      conversation: ConversationSummaryDto & { canContinue: true };
      messages: ConversationMessageDto[];
    }
  | { ok: false; status: 404 | 500; error: string };

/**
 * 본인 대화 1건 + 메시지. 다른 사용자의 대화이거나, 대화 매장에 현재 approved staff membership이 없으면
 * (탈퇴한 매장) 존재 여부를 드러내지 않도록 404를 반환한다.
 */
export async function getStaffConversationDetail(
  adminClient: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<StaffConversationDetailResult> {
  const notFound = { ok: false, status: 404, error: "대화를 찾을 수 없습니다." } as const;
  const failure = { ok: false, status: 500, error: "대화를 불러오지 못했습니다." } as const;

  const { data: conversation, error } = await adminClient
    .from("conversations")
    .select("id, title, store_id, updated_at")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle<{ id: string; title: string; store_id: string; updated_at: string }>();

  if (error && !isMissingConversationTable(error)) {
    console.error("[STAFF_CONVERSATIONS] Failed to fetch conversation:", {
      userId,
      conversationId,
      error: { code: error.code, message: error.message },
    });
    return failure;
  }
  if (!conversation) return notFound;

  const { data: membership, error: membershipError } = await adminClient
    .from("store_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("store_id", conversation.store_id)
    .eq("role", "staff")
    .eq("status", "approved")
    .maybeSingle();

  if (membershipError) {
    console.error("[STAFF_CONVERSATIONS] Failed to verify membership:", {
      userId,
      conversationId,
      error: { code: membershipError.code, message: membershipError.message },
    });
    return failure;
  }
  if (!membership) return notFound;

  const [{ data: messages, error: messageError }, { data: store }] = await Promise.all([
    adminClient
      .from("conversation_messages")
      .select("id, role, content, status, source_title, source_category, similarity, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true }),
    adminClient.from("stores").select("store_name").eq("id", conversation.store_id).maybeSingle<{ store_name: string }>(),
  ]);

  if (messageError) {
    console.error("[STAFF_CONVERSATIONS] Failed to fetch messages:", {
      userId,
      conversationId,
      error: { code: messageError.code, message: messageError.message },
    });
    return failure;
  }

  type MessageRow = {
    id: string;
    role: ConversationMessageDto["role"];
    content: string;
    status: ConversationMessageDto["status"];
    source_title: string | null;
    source_category: string | null;
    similarity: number | null;
    created_at: string;
  };

  return {
    ok: true,
    conversation: {
      id: conversation.id,
      title: conversation.title,
      storeId: conversation.store_id,
      storeName: store?.store_name ?? "",
      updatedAt: conversation.updated_at,
      canContinue: true,
    },
    messages: ((messages ?? []) as MessageRow[]).map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      status: row.status,
      sourceTitle: row.source_title,
      sourceCategory: row.source_category,
      similarity: row.similarity,
      createdAt: row.created_at,
    })),
  };
}
