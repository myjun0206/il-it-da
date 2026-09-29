import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type FindPasswordResponse = {
  success: boolean;
  temporaryPassword?: string;
  message?: string;
};

type ProfileUserRow = {
  user_id: string;
};

const PASSWORD_UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PASSWORD_LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const PASSWORD_DIGITS = "0123456789";
const PASSWORD_CHARACTERS = `${PASSWORD_UPPERCASE}${PASSWORD_LOWERCASE}${PASSWORD_DIGITS}`;

function jsonResponse(body: FindPasswordResponse, status: number): NextResponse<FindPasswordResponse> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function generateTemporaryPassword(): string {
  const password = [
    PASSWORD_UPPERCASE[randomInt(PASSWORD_UPPERCASE.length)],
    PASSWORD_LOWERCASE[randomInt(PASSWORD_LOWERCASE.length)],
    PASSWORD_DIGITS[randomInt(PASSWORD_DIGITS.length)],
  ];

  while (password.length < 16) {
    password.push(PASSWORD_CHARACTERS[randomInt(PASSWORD_CHARACTERS.length)]);
  }

  for (let index = password.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [password[index], password[swapIndex]] = [password[swapIndex], password[index]];
  }

  return password.join("");
}

function hasEmailIdentity(user: {
  identities?: Array<{ provider?: string }> | null;
  app_metadata?: Record<string, unknown>;
}): boolean {
  const providers = user.app_metadata?.providers;

  return Boolean(
    user.identities?.some((identity) => identity.provider === "email") ||
      (Array.isArray(providers) && providers.includes("email")) ||
      user.app_metadata?.provider === "email",
  );
}

export async function POST(request: Request): Promise<NextResponse<FindPasswordResponse>> {
  let body: { fullName?: unknown; email?: unknown };

  try {
    body = (await request.json()) as { fullName?: unknown; email?: unknown };
  } catch {
    return jsonResponse({ success: false, message: "이름과 이메일을 입력해주세요." }, 400);
  }

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!fullName || !email) {
    return jsonResponse({ success: false, message: "이름과 이메일을 입력해주세요." }, 400);
  }

  try {
    const supabase = createAdminClient();
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("full_name", fullName);

    if (profilesError) {
      return jsonResponse({ success: false, message: "비밀번호 재설정 중 오류가 발생했습니다." }, 500);
    }

    const userIds = [...new Set(
      ((profiles ?? []) as ProfileUserRow[])
        .map((profile) => profile.user_id)
        .filter((userId): userId is string => typeof userId === "string" && userId.length > 0),
    )];
    const matchingUsers = [];

    for (const userId of userIds) {
      const { data, error } = await supabase.auth.admin.getUserById(userId);

      if (error) {
        return jsonResponse({ success: false, message: "비밀번호 재설정 중 오류가 발생했습니다." }, 500);
      }

      const authUser = data.user;
      const authEmail = authUser.email?.trim().toLowerCase();

      if (authEmail === email && hasEmailIdentity(authUser)) {
        matchingUsers.push(authUser);
      }
    }

    if (matchingUsers.length === 0) {
      return jsonResponse({ success: false, message: "일치하는 계정을 찾을 수 없습니다." }, 404);
    }

    if (matchingUsers.length > 1) {
      return jsonResponse(
        { success: false, message: "일치하는 계정이 여러 개 존재합니다. 관리자에게 문의해주세요." },
        409,
      );
    }

    const user = matchingUsers[0];
    const temporaryPassword = generateTemporaryPassword();
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password: temporaryPassword,
      app_metadata: {
        ...user.app_metadata,
        must_change_password: true,
      },
    });

    if (updateError) {
      return jsonResponse({ success: false, message: "비밀번호 재설정 중 오류가 발생했습니다." }, 500);
    }

    return jsonResponse({ success: true, temporaryPassword }, 200);
  } catch {
    return jsonResponse({ success: false, message: "비밀번호 재설정 중 오류가 발생했습니다." }, 500);
  }
}