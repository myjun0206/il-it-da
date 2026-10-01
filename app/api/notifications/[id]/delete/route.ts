import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface DeleteNotificationResponse {
  success: boolean;
  error?: string;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<DeleteNotificationResponse>> {
  try {
    const { id: notificationId } = await params;

    // Get current authenticated user
    const serverClient = await createClient();
    const { data: { user }, error: userError } = await serverClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // Verify the notification belongs to current user
    const adminClient = createAdminClient();
    const { data: notification, error: queryError } = await adminClient
      .from("notifications")
      .select("recipient_user_id")
      .eq("id", notificationId)
      .maybeSingle();

    if (queryError || !notification) {
      return NextResponse.json(
        { success: false, error: "알림을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (notification.recipient_user_id !== user.id) {
      return NextResponse.json(
        { success: false, error: "접근 권한이 없습니다." },
        { status: 403 }
      );
    }

    // Delete notification with defensive double-check on ownership
    const { error: deleteError } = await adminClient
      .from("notifications")
      .delete()
      .eq("id", notificationId)
      .eq("recipient_user_id", user.id);

    if (deleteError) {
      console.error("Failed to delete notification:", deleteError);
      return NextResponse.json(
        { success: false, error: "알림을 삭제할 수 없습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Error deleting notification:", e);
    return NextResponse.json(
      { success: false, error: "알림을 삭제할 수 없습니다." },
      { status: 500 }
    );
  }
}
