import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export interface Notification {
  id: string;
  recipientUserId: string;
  type: string;
  title: string;
  message: string;
  targetUrl?: string;
  relatedId?: string;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  success: boolean;
  data?: {
    notifications: Notification[];
    unreadCount: number;
    totalCount: number;
    filteredCount: number;
    returnedCount: number;
    hasMore: boolean;
  };
  error?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse<NotificationsResponse>> {
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

    // Get limit from query params (default 10)
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || "10");
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 1000) {
      return NextResponse.json({ success: false, error: "잘못된 조회 개수입니다." }, { status: 400 });
    }
    const limit = requestedLimit;
    const includeRead = request.nextUrl.searchParams.get("includeRead") === "true";

    // Query notifications
    const adminClient = createAdminClient();
    let query = adminClient
      .from("notifications")
      .select("*")
      .eq("recipient_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    // Filter out read notifications unless explicitly requested
    if (!includeRead) {
      query = query.eq("is_read", false);
    }

    const { data: notifications, error: queryError } = await query;

    if (queryError) {
      console.error("Failed to fetch notifications: NOTIFICATION_QUERY_FAILED");
      return NextResponse.json(
        { success: false, error: "알림을 불러올 수 없습니다." },
        { status: 500 }
      );
    }

    // Count total unread
    const { count: unreadCount, error: countError } = await adminClient
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("recipient_user_id", user.id)
      .eq("is_read", false);

    if (countError) {
      console.error("Failed to count unread notifications: NOTIFICATION_COUNT_FAILED");
      return NextResponse.json({ success: false, error: "알림 개수를 확인할 수 없습니다." }, { status: 500 });
    }
    const { count: totalCount, error: totalError } = await adminClient.from("notifications")
      .select("id", { count: "exact", head: true }).eq("recipient_user_id", user.id);
    if (totalError) return NextResponse.json({ success: false, error: "알림 개수를 확인할 수 없습니다." }, { status: 500 });
    const filteredCount = includeRead ? totalCount ?? 0 : unreadCount ?? 0;

    // Transform camelCase response
    const transformedNotifications: Notification[] = (notifications || []).map((n) => ({
      id: n.id,
      recipientUserId: n.recipient_user_id,
      type: n.type,
      title: n.title,
      message: n.message,
      targetUrl: n.target_url,
      relatedId: n.related_id,
      isRead: n.is_read,
      createdAt: n.created_at,
    }));

    return NextResponse.json({
      success: true,
      data: {
        notifications: transformedNotifications,
        unreadCount: unreadCount || 0,
        totalCount: totalCount ?? 0,
        filteredCount,
        returnedCount: transformedNotifications.length,
        hasMore: transformedNotifications.length < filteredCount,
      },
    });
  } catch (e) {
    console.error("Error fetching notifications: NOTIFICATION_READ_FAILED", { kind: e instanceof Error ? "Error" : "UnknownError" });
    return NextResponse.json(
      { success: false, error: "알림을 불러올 수 없습니다." },
      { status: 500 }
    );
  }
}
