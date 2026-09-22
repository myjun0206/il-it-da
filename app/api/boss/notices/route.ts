import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface NoticeItem {
  id: string;
  title: string;
  content: string;
  category: "운영 안내" | "매뉴얼" | "교육" | "시스템" | "기타";
  isImportant: boolean;
  createdAt: string;
  updatedAt: string;
  franchiseName: string;
}

interface NoticesResponse {
  success: boolean;
  data?: {
    notices: NoticeItem[];
    summary: {
      total: number;
      important: number;
    };
  };
  error?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse<NoticesResponse>> {
  try {
    // 1. Get current authenticated owner
    const serverClient = await createClient();
    const { data: { user }, error: userError } = await serverClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    // 2. Extract storeId from query params
    const storeId = request.nextUrl.searchParams.get("storeId");
    if (!storeId) {
      return NextResponse.json(
        { success: false, error: "매장을 선택해주세요." },
        { status: 400 }
      );
    }

    // 3. Validate owner has approved membership to this store
    const adminClient = createAdminClient();
    const { data: ownerMembership, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("*")
      .eq("user_id", user.id)
      .eq("store_id", storeId)
      .eq("role", "owner")
      .eq("status", "approved")
      .maybeSingle();

    if (membershipError || !ownerMembership) {
      return NextResponse.json(
        { success: false, error: "이 매장에 대한 접근 권한이 없습니다." },
        { status: 403 }
      );
    }

    // 4. Return empty notices (notices table does not exist yet)
    // In production: Query from notices table filtered by store/franchise
    return NextResponse.json({
      success: true,
      data: {
        notices: [],
        summary: {
          total: 0,
          important: 0,
        },
      },
    });
  } catch (error) {
    console.error("Failed to fetch notices:", error);
    return NextResponse.json(
      { success: false, error: "공지사항을 불러오지 못했습니다." },
      { status: 500 }
    );
  }
}
