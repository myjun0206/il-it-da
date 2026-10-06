import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface DeleteAllNotificationsResponse {
  success: boolean;
  deletedCount?: number;
  error?: string;
}

export async function DELETE(
  _request: NextRequest
): Promise<NextResponse<DeleteAllNotificationsResponse>> {
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

    // Get count of notifications first
    const { count: totalCount } = await adminClient
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("recipient_user_id", user.id);

    // Delete all notifications for current user only
    const { error: deleteError } = await adminClient
      .from("notifications")
      .delete()
      .eq("recipient_user_id", user.id);

    if (deleteError) {
      console.error("Failed to delete all notifications:", deleteError);
      return NextResponse.json(
        { success: false, error: "알림을 삭제할 수 없습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      deletedCount: totalCount || 0,
    });
  } catch (e) {
    console.error("Error deleting all notifications:", e);
    return NextResponse.json(
      { success: false, error: "알림을 삭제할 수 없습니다." },
      { status: 500 }
    );
  }
}
