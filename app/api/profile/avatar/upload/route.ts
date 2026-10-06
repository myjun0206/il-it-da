import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROFILE_AVATAR_BUCKET, validateAvatarFile } from "@/lib/supabase/storage-profile-avatar";

export const runtime = "nodejs";

const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export interface UploadResponse {
  success?: boolean;
  avatarUrl?: string;
  avatarUpdatedAt?: string; // 캐시 busting용 timestamp
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
    let serverClient;
    try {
      serverClient = await createClient();
    } catch (e) {
      console.error("[AVATAR_UPLOAD] Failed to create server client:", e);
      return NextResponse.json(
        { error: "서버 설정 오류가 발생했습니다. (auth client)" },
        { status: 500 }
      );
    }

    const { data: userData, error: userError } = await serverClient.auth.getUser();

    if (userError || !userData.user) {
      console.warn("[AVATAR_UPLOAD] User not authenticated:", userError);
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const user = userData.user;

    // 2. FormData 파싱
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (e) {
      console.error("[AVATAR_UPLOAD] Failed to parse FormData:", e);
      return NextResponse.json(
        { error: "요청 데이터를 읽을 수 없습니다." },
        { status: 400 }
      );
    }

    const fileData = formData.get("file");
    const mimeType = formData.get("mimeType") as string | null;

    // FormData에서 가져온 file이 실제로 File인지 확인
    if (!fileData || typeof fileData === "string" || !(fileData instanceof File)) {
      console.warn("[AVATAR_UPLOAD] Invalid file type:", typeof fileData);
      return NextResponse.json({ error: "유효한 파일을 업로드해주세요." }, { status: 400 });
    }

    const file: File = fileData;

    if (!mimeType) {
      console.warn("[AVATAR_UPLOAD] Missing MIME type");
      return NextResponse.json({ error: "파일의 MIME type이 필요합니다." }, { status: 400 });
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
    let adminClient;
    try {
      adminClient = createAdminClient();
    } catch (e) {
      console.error("[AVATAR_UPLOAD] Failed to create admin client:", e);
      return NextResponse.json(
        { error: "서버 설정 오류가 발생했습니다. (admin client)" },
        { status: 500 }
      );
    }

    const { data: currentProfile } = await adminClient
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle<{ avatar_url: string | null }>();

    const oldAvatarUrl = currentProfile?.avatar_url || null;

    // 8. 파일 확장자 결정 및 versioned filename 생성
    const now = new Date();
    const timestamp = now.getTime();
    const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp";
    const filename = `avatar-${timestamp}.${ext}`;
    const filePath = `${user.id}/${filename}`;

    // 9. Storage에 파일 업로드
    const { error: uploadError } = await adminClient.storage
      .from(PROFILE_AVATAR_BUCKET)
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: false, // versioned filename이므로 upsert 불필요
      });

    if (uploadError) {
      console.error("[AVATAR_UPLOAD] Storage upload failed:", {
        filePath,
        mimeType,
        error: uploadError.message || uploadError,
      });
      return NextResponse.json(
        { error: "프로필 사진을 Storage에 업로드하지 못했습니다." },
        { status: 500 }
      );
    }

    // 10. 공개 URL 생성
    const {
      data: { publicUrl },
    } = adminClient.storage.from(PROFILE_AVATAR_BUCKET).getPublicUrl(filePath);

    // 10-1. Storage에서 파일이 실제로 존재하는지 검증
    const { data: fileList, error: listError } = await adminClient.storage
      .from(PROFILE_AVATAR_BUCKET)
      .list(`${user.id}`);

    const fileExists = !listError && fileList && fileList.some((f) => f.name === filename);

    if (!fileExists) {
      console.error("[AVATAR_UPLOAD] File not found after upload");

      return NextResponse.json(
        { error: "프로필 사진 저장에 실패했습니다. (verification)" },
        { status: 500 }
      );
    }

    console.log("[AVATAR_UPLOAD] File verified in Storage");

    // publicUrl 검증
    if (!publicUrl || typeof publicUrl !== "string" || !publicUrl.includes("http")) {
      console.error("[AVATAR_UPLOAD] Invalid publicUrl generated");

      // URL 생성 실패 시 업로드된 파일 삭제
      await adminClient.storage
        .from(PROFILE_AVATAR_BUCKET)
        .remove([filePath])
        .catch(() => {});

      return NextResponse.json(
        { error: "프로필 사진 URL 생성에 실패했습니다." },
        { status: 500 }
      );
    }

    console.log("[AVATAR_UPLOAD] Public URL valid");

    // 11. DB 업데이트: avatar_url (원본 publicUrl) 저장
    // ⚠️ avatar_updated_at은 DB에서 timestamp로 관리하지만,
    //    cache busting은 이미 filename에 포함됨 (avatar-{timestamp}.ext)
    const isoTimestamp = new Date(timestamp).toISOString();
    const { error: updateError, data: updatedData } = await adminClient
      .from("profiles")
      .update({
        avatar_url: publicUrl, // 원본 URL만 (query string 없음)
        avatar_updated_at: isoTimestamp,
      })
      .eq("id", user.id)
      .select("avatar_url, avatar_updated_at");

    if (updateError) {
      console.error("[AVATAR_UPLOAD] DB update failed");

      await adminClient.storage
        .from(PROFILE_AVATAR_BUCKET)
        .remove([filePath])
        .catch(() => {});

      return NextResponse.json(
        { error: "프로필 정보 저장에 실패했습니다. (DB)" },
        { status: 500 }
      );
    }

    console.log("[AVATAR_UPLOAD] DB update successful");

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
      {
        success: true,
        avatarUrl: publicUrl,
        avatarUpdatedAt: now.toISOString(),
        oldAvatarUrl,
      },
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
