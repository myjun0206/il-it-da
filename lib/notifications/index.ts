import { createAdminClient } from "@/lib/supabase/admin";

export interface CreateNotificationParams {
  recipientUserId: string;
  type:
    | "staff_pending_approval"
    | "owner_pending_approval"
    | "approval_decision"
    | "staff_approval_decision"
    | "new_notice"
    | "manual_update";
  title: string;
  message: string;
  targetUrl?: string;
  relatedId?: string;
}

export async function createNotification(
  params: CreateNotificationParams
): Promise<{ success: boolean; error?: string; notificationId?: string }> {
  try {
    const adminClient = createAdminClient();

    const { data, error } = await adminClient
      .from("notifications")
      .insert({
        recipient_user_id: params.recipientUserId,
        type: params.type,
        title: params.title,
        message: params.message,
        target_url: params.targetUrl || null,
        related_id: params.relatedId || null,
        is_read: false,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error("Failed to create notification:", error);
      return { success: false, error: error.message };
    }

    return { success: true, notificationId: data?.id };
  } catch (e) {
    console.error("Error creating notification:", e);
    return { success: false, error: "알림 생성에 실패했습니다." };
  }
}

/**
 * Format a relative time string (e.g., "5분 전", "1시간 전", "어제", "2026.09.20")
 */
export function formatNotificationTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return "방금 전";
    if (diffMins < 60) return `${diffMins}분 전`;
    if (diffHours < 24) return `${diffHours}시간 전`;
    if (diffDays === 1) return "어제";
    if (diffDays < 7) return `${diffDays}일 전`;

    // Format as YYYY.MM.DD for older dates
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}.${month}.${day}`;
  } catch {
    return "";
  }
}
