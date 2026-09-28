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

    // 4. 이 매장이 속한 프랜차이즈의 본사 공지 중 "전체 지점" 또는 "이 매장" 대상만 조회한다.
    const { data: store } = await adminClient
      .from("stores")
      .select("franchise_id")
      .eq("id", storeId)
      .maybeSingle<{ franchise_id: string | null }>();

    if (!store?.franchise_id) {
      return NextResponse.json({ success: true, data: { notices: [], summary: { total: 0, important: 0 } } });
    }

    const [{ data: noticeRows, error: noticeError }, { data: franchise }] = await Promise.all([
      adminClient
        .from("notices")
        .select("id, title, content, created_at, updated_at")
        .eq("franchise_id", store.franchise_id)
        .or(`target_type.eq.all,target_store_id.eq.${storeId}`)
        .order("created_at", { ascending: false }),
      adminClient.from("franchises").select("name").eq("id", store.franchise_id).maybeSingle<{ name: string }>(),
    ]);

    if (noticeError) {
      // migration 021(notices 테이블)이 아직 적용되지 않은 환경에서는 공지가 없는 것으로 본다.
      if (noticeError.code === "42P01" || noticeError.code === "PGRST205") {
        return NextResponse.json({ success: true, data: { notices: [], summary: { total: 0, important: 0 } } });
      }
      throw noticeError;
    }

    // notices 테이블에는 분류/중요 표시 컬럼이 없어 "기타"·일반 공지로 표시한다.
    const notices: NoticeItem[] = (noticeRows ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      category: "기타",
      isImportant: false,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
      franchiseName: franchise?.name ?? "",
    }));

    return NextResponse.json({
      success: true,
      data: {
        notices,
        summary: {
          total: notices.length,
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
