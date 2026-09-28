/**
 * Supabase Storage API for Profile Avatar
 *
 * - Upload: 프로필 사진 파일 업로드 (JPEG/PNG/WebP)
 * - Delete: 기존 프로필 사진 삭제
 * - Bucket: avatars/{userId}/avatar.{ext} 형태로 저장
 *
 * 권한:
 * - authenticated 사용자만 자신의 avatar 업로드/삭제 가능
 * - 클라이언트는 userId를 전달하지만 서버/API에서 auth.user.id 기준으로 검증
 */

const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const ALLOWED_MIMETYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

export const PROFILE_AVATAR_BUCKET = "avatars";

export interface UploadAvatarInput {
  /** Base64 또는 blob 형태의 이미지 데이터 */
  file: File | Blob;
  /** 파일의 MIME type */
  mimeType: string;
  /** 인증된 사용자 ID (서버에서 검증) */
  userId: string;
}

export interface UploadAvatarResult {
  success: boolean;
  avatarUrl?: string; // Storage 공개 URL 또는 경로
  oldAvatarUrl?: string; // 이전 avatar URL (삭제 필요시)
  error?: string;
}

export interface DeleteAvatarResult {
  success: boolean;
  error?: string;
}

/**
 * 파일 유효성 검증
 * - MIME type 확인
 * - 파일 크기 확인
 * - 확장자 확인
 */
export function validateAvatarFile(file: File | Blob, mimeType: string): { valid: boolean; error?: string } {
  // MIME type 검증
  if (!ALLOWED_MIMETYPES.has(mimeType)) {
    return {
      valid: false,
      error: "지원하지 않는 파일 형식입니다. JPEG, PNG, WebP만 업로드할 수 있습니다.",
    };
  }

  // 파일 크기 검증
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `파일 크기가 너무 큽니다. 최대 ${MAX_FILE_SIZE_MB}MB까지 가능합니다.`,
    };
  }

  // 확장자 검증 (MIME type과 일치성 확인)
  if (file instanceof File) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
      return {
        valid: false,
        error: "지원하지 않는 파일 형식입니다. JPEG, PNG, WebP만 업로드할 수 있습니다.",
      };
    }
  }

  return { valid: true };
}

/**
 * 파일 확장자 결정 (MIME type 기반)
 */
function getFileExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  return mimeToExt[mimeType] || "jpg";
}

/**
 * 클라이언트: 프로필 사진 업로드
 * 이 함수는 클라이언트에서 호출되고, API 경로 /api/profile/avatar/upload로 전달된다.
 * 서버에서 auth.user.id 기준으로 인증하므로 userId를 보낼 필요 없음.
 */
export async function uploadProfileAvatarClient(
  file: File,
  mimeType: string
): Promise<UploadAvatarResult> {
  // 클라이언트 측 유효성 검증
  const validation = validateAvatarFile(file, mimeType);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("mimeType", mimeType);

    const response = await fetch("/api/profile/avatar/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorData = (await response.json()) as { error?: string };
      return {
        success: false,
        error: errorData.error || "프로필 사진 업로드에 실패했습니다.",
      };
    }

    const result = (await response.json()) as UploadAvatarResult;
    return result;
  } catch (e) {
    console.error("Upload avatar error:", e);
    return {
      success: false,
      error: "프로필 사진 업로드 중 오류가 발생했습니다.",
    };
  }
}

/**
 * 클라이언트: 프로필 사진 삭제
 * 이 함수는 클라이언트에서 호출되고, API 경로 /api/profile/avatar/delete로 전달된다.
 * 서버에서 auth.user.id 기준으로 인증하므로 userId를 보낼 필요 없음.
 */
export async function deleteProfileAvatarClient(): Promise<DeleteAvatarResult> {
  try {
    const response = await fetch("/api/profile/avatar/delete", {
      method: "POST",
    });

    if (!response.ok) {
      const errorData = (await response.json()) as { error?: string };
      return {
        success: false,
        error: errorData.error || "프로필 사진 삭제에 실패했습니다.",
      };
    }

    const result = (await response.json()) as DeleteAvatarResult;
    return result;
  } catch (e) {
    console.error("Delete avatar error:", e);
    return {
      success: false,
      error: "프로필 사진 삭제 중 오류가 발생했습니다.",
    };
  }
}
