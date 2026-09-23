import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface MarkAllReadResponse {
  success: boolean;
  markedCount?: number;
  error?: string;
}

export async function PUT(request: NextRequest): Promise<NextResponse<MarkAllReadResponse>> {
  try {
    // Get current authenticated user
    const serverClient = await createClient();
    const { data: { user }, error: userError } = await serverClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const adminClient = createAdminClient();

    // Get count of unread notifications first
    const { count: unreadCount } = await adminClient
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("recipient_user_id", user.id)
      .eq("is_read", false);

    // Mark all unread notifications as read
    const { error: updateError } = await adminClient
      .from("notifications")
      .update({ is_read: true, updated_at: new Date().toISOString() })
      .eq("recipient_user_id", user.id)
      .eq("is_read", false);

    if (updateError) {
      console.error("Failed to mark all notifications as read:", updateError);
      return NextResponse.json(
        { success: false, error: "알림을 업데이트할 수 없습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      markedCount: unreadCount || 0,
    });
  } catch (e) {
    console.error("Error marking all notifications as read:", e);
    return NextResponse.json(
      { success: false, error: "알림을 업데이트할 수 없습니다." },
      { status: 500 }
    );
  }
}
