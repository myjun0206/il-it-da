import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ChangePasswordResponse = {
  success: boolean;
  message?: string;
};

function jsonResponse(body: ChangePasswordResponse, status: number): NextResponse<ChangePasswordResponse> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<NextResponse<ChangePasswordResponse>> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, message: "비밀번호 변경에 실패했습니다. 다시 시도해주세요." }, 400);
  }

  const password =
    body && typeof body === "object" && "password" in body ? body.password : undefined;

  if (typeof password !== "string" || password.length < 8) {
    return jsonResponse({ success: false, message: "비밀번호 변경에 실패했습니다. 다시 시도해주세요." }, 400);
  }

  try {
    const sessionClient = await createClient();
    const { data: userData, error: userError } = await sessionClient.auth.getUser();

    if (userError || !userData.user) {
      return jsonResponse({ success: false, message: "로그인이 필요합니다." }, 401);
    }

    const adminClient = createAdminClient();
    const { data: authData, error: authError } = await adminClient.auth.admin.getUserById(userData.user.id);

    if (authError || !authData.user) {
      return jsonResponse({ success: false, message: "비밀번호 변경에 실패했습니다. 다시 시도해주세요." }, 500);
    }

    if (authData.user.app_metadata?.must_change_password !== true) {
      return jsonResponse({ success: false, message: "비밀번호 변경 요청이 유효하지 않습니다." }, 409);
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(userData.user.id, {
      password,
      app_metadata: {
        ...authData.user.app_metadata,
        must_change_password: false,
      },
    });

    if (updateError) {
      return jsonResponse({ success: false, message: "비밀번호 변경에 실패했습니다. 다시 시도해주세요." }, 500);
    }

    return jsonResponse({ success: true }, 200);
  } catch {
    return jsonResponse({ success: false, message: "비밀번호 변경에 실패했습니다. 다시 시도해주세요." }, 500);
  }
}