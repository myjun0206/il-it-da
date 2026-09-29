import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROFILE_AVATAR_BUCKET, validateAvatarFile } from "@/lib/supabase/storage-profile-avatar";

export const runtime = "nodejs";

const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

interface UploadResponse {
  avatarUrl?: string;
  oldAvatarUrl?: string | null;
  error?: string;
}

/**
 * POST /api/profile/avatar/upload
 *
 * 인증된 사용자의 프로필 사진 업로드
 *
 * 요청 본문: FormData
 * - file: File
 * - mimeType: string (image/jpeg, image/png, image/webp)
 * - userId: string (검증용, 실제로는 auth.user.id 기준으로 처리)
 *
 * 응답: { avatarUrl, oldAvatarUrl?, error? }
 */
export async function POST(request: NextRequest): Promise<NextResponse<UploadResponse>> {
  try {
    // 1. 인증 확인 (서버 클라이언트로 쿠키 기반 세션 읽기)
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const user = userData.user;

    // 2. FormData 파싱
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const mimeType = formData.get("mimeType") as string | null;

    if (!file || !mimeType) {
      return NextResponse.json({ error: "파일과 MIME type이 필요합니다." }, { status: 400 });
    }

    // 4. 파일 유효성 검증
    const validation = validateAvatarFile(file, mimeType);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // 5. 파일 크기 최종 검증
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `파일 크기가 너무 큽니다. 최대 ${MAX_FILE_SIZE_MB}MB까지 가능합니다.` },
        { status: 400 }
      );
    }

    // 6. Buffer로 변환
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 7. 기존 avatar_url 조회 (삭제용)
    const adminClient = createAdminClient();
    const { data: currentProfile } = await adminClient
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle<{ avatar_url: string | null }>();

    const oldAvatarUrl = currentProfile?.avatar_url || null;

    // 8. 파일 확장자 결정
    const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp";
    const filename = `avatar.${ext}`;
    const filePath = `${user.id}/${filename}`;

    // 9. Storage에 파일 업로드 (기존 파일이 있으면 덮어씀)
    const { error: uploadError } = await adminClient.storage
      .from(PROFILE_AVATAR_BUCKET)
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: true, // 기존 파일이 있으면 덮어쓰기
      });

    if (uploadError) {
      console.error("[AVATAR_UPLOAD] Storage upload failed:", {
        bucket: PROFILE_AVATAR_BUCKET,
        path: filePath,
        error: uploadError,
      });
      return NextResponse.json(
        { error: "프로필 사진 업로드에 실패했습니다. (Storage)" },
        { status: 500 }
      );
    }

    // 10. 공개 URL 생성
    const {
      data: { publicUrl },
    } = adminClient.storage.from(PROFILE_AVATAR_BUCKET).getPublicUrl(filePath);

    console.log("[AVATAR_UPLOAD] Public URL generated:", {
      filePath,
      publicUrl,
      length: publicUrl.length,
    });

    // 11. DB 업데이트: avatar_url과 avatar_updated_at 저장
    const { error: updateError } = await adminClient
      .from("profiles")
      .update({
        avatar_url: publicUrl,
        avatar_updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      // DB 업데이트 실패 시 업로드된 파일 삭제
      console.error("[AVATAR_UPLOAD] DB update failed:", {
        userId: user.id,
        avatarUrl: publicUrl,
        error: updateError,
      });

      await adminClient.storage
        .from(PROFILE_AVATAR_BUCKET)
        .remove([filePath])
        .catch(() => {
          // 삭제 실패는 무시 (나중에 정리됨)
        });

      return NextResponse.json(
        { error: "프로필 정보 저장에 실패했습니다. (DB)" },
        { status: 500 }
      );
    }

    // 12. 이전 파일 삭제 (비동기, 오류는 로깅만 함)
    if (oldAvatarUrl) {
      const oldFilePath = oldAvatarUrl.split("/").pop(); // URL에서 파일명 추출
      if (oldFilePath) {
        void adminClient.storage
          .from(PROFILE_AVATAR_BUCKET)
          .remove([`${user.id}/${oldFilePath}`])
          .catch((err) => {
            console.warn("[AVATAR_UPLOAD] Failed to delete old avatar:", err);
          });
      }
    }

    return NextResponse.json(
      { avatarUrl: publicUrl, oldAvatarUrl },
      { status: 200 }
    );
  } catch (e) {
    console.error("[AVATAR_UPLOAD] Unexpected error:", e);
    return NextResponse.json(
      { error: "프로필 사진 업로드 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
