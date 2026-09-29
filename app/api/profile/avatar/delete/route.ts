import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROFILE_AVATAR_BUCKET } from "@/lib/supabase/storage-profile-avatar";

export const runtime = "nodejs";

interface DeleteResponse {
  success?: boolean;
  error?: string;
}

/**
 * POST /api/profile/avatar/delete
 *
 * 인증된 사용자의 프로필 사진 삭제
 *
 * 요청 본문은 비어있어도 됨 - 서버에서 auth.user.id 기준으로 처리
 *
 * 응답: { success: boolean, error?: string }
 */
export async function POST(request: NextRequest): Promise<NextResponse<DeleteResponse>> {
  try {
    // 1. 인증 확인 (서버 클라이언트로 쿠키 기반 세션 읽기)
    let serverClient;
    try {
      serverClient = await createClient();
    } catch (e) {
      console.error("[AVATAR_DELETE] Failed to create server client:", e);
      return NextResponse.json(
        { error: "서버 설정 오류가 발생했습니다. (auth client)" },
        { status: 500 }
      );
    }

    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      console.warn("[AVATAR_DELETE] User not authenticated:", userError);
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const user = userData.user;

    let adminClient;
    try {
      adminClient = createAdminClient();
    } catch (e) {
      console.error("[AVATAR_DELETE] Failed to create admin client:", e);
      return NextResponse.json(
        { error: "서버 설정 오류가 발생했습니다. (admin client)" },
        { status: 500 }
      );
    }

    // 4. 기존 avatar_url 조회
    const { data: currentProfile } = await adminClient
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle<{ avatar_url: string | null }>();

    const avatarUrl = currentProfile?.avatar_url;

    // 5. Storage에서 파일 삭제 (있을 경우만)
    if (avatarUrl) {
      // publicUrl에서 filename 추출: https://xxx/avatars/userId/avatar-{timestamp}.jpg → avatar-{timestamp}.jpg
      const filename = avatarUrl.split("/").pop();
      if (filename) {
        const filePath = `${user.id}/${filename}`;
        const { error: deleteError } = await adminClient.storage
          .from(PROFILE_AVATAR_BUCKET)
          .remove([filePath]);

        if (deleteError) {
          console.warn("[AVATAR_DELETE] Storage delete failed");
          // Storage 삭제 실패는 계속 진행 (DB 업데이트는 함)
        }
      }
    }

    // 6. DB 업데이트: avatar_url과 avatar_updated_at을 NULL로 설정
    const { error: updateError } = await adminClient
      .from("profiles")
      .update({
        avatar_url: null,
        avatar_updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("[AVATAR_DELETE] DB update failed:", updateError);
      return NextResponse.json(
        { error: "프로필 정보 업데이트에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (e) {
    console.error("[AVATAR_DELETE] Unexpected error:", e);
    return NextResponse.json(
      { error: "프로필 사진 삭제 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
