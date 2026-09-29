import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type FindIdResponse = {
  success: boolean;
  email?: string;
  message?: string;
};

type ProfilePhoneRow = {
  user_id: string;
  phone: string | null;
};

function jsonResponse(body: FindIdResponse, status: number): NextResponse<FindIdResponse> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function maskEmail(email: string): string | null {
  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === email.length - 1) return null;

  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  const visibleLength = localPart.length >= 9 ? 3 : localPart.length >= 3 ? 1 : 0;
  const hiddenLength = localPart.length >= 9 ? 6 : 4;

  return `${localPart.slice(0, visibleLength)}${"•".repeat(hiddenLength)}@${domain}`;
}

export async function POST(request: Request): Promise<NextResponse<FindIdResponse>> {
  let body: { fullName?: unknown; phone?: unknown };

  try {
    body = (await request.json()) as { fullName?: unknown; phone?: unknown };
  } catch {
    return jsonResponse({ success: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : "";

  if (!fullName || !/^\d{10,11}$/.test(phone)) {
    return jsonResponse({ success: false, message: "이름과 휴대폰 번호를 확인해주세요." }, 400);
  }

  try {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("profiles")
      .select("user_id, phone")
      .eq("full_name", fullName);

    if (error) {
      return jsonResponse({ success: false, message: "계정을 확인하지 못했습니다." }, 500);
    }

    const profiles = (data ?? []) as ProfilePhoneRow[];
    const userIds = [...new Set(
      profiles
        .filter((profile) => typeof profile.user_id === "string" && normalizePhone(profile.phone ?? "") === phone)
        .map((profile) => profile.user_id),
    )];

    if (userIds.length === 0) {
      return jsonResponse({ success: false, message: "일치하는 계정을 찾을 수 없습니다." }, 404);
    }

    if (userIds.length > 1) {
      return jsonResponse({ success: false, message: "일치하는 계정을 확인할 수 없습니다." }, 409);
    }

    const { data: authUser, error: authError } = await adminClient.auth.admin.getUserById(userIds[0]);

    if (authError) {
      return jsonResponse({ success: false, message: "계정을 확인하지 못했습니다." }, 500);
    }

    const maskedEmail = authUser.user.email ? maskEmail(authUser.user.email.trim()) : null;

    if (!maskedEmail) {
      return jsonResponse({ success: false, message: "일치하는 계정을 찾을 수 없습니다." }, 404);
    }

    return jsonResponse({ success: true, email: maskedEmail }, 200);
  } catch {
    return jsonResponse({ success: false, message: "계정을 확인하지 못했습니다." }, 500);
  }
}