import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireHqUser } from "@/lib/supabase/hq-auth";

export const runtime = "nodejs";

const NAME_MAX_LENGTH = 50;

/**
 * HQ 본인의 표시 이름만 변경한다. 이메일/역할/프랜차이즈는 이 API로 바꿀 수 없다.
 * profiles.full_name과 auth user_metadata.name(헤더 표시용)을 함께 맞춘다.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const hqUser = await requireHqUser();
    if (!hqUser) {
      return NextResponse.json({ error: "본사 관리자만 변경할 수 있습니다." }, { status: 403 });
    }

    // franchise_id가 없는 레거시 계정은 user_metadata.name의 첫 단어로 브랜드를 추정하므로
    // 이름을 바꾸면 데이터 접근 범위가 달라질 수 있다. 이 경우 변경을 막는다.
    if (!hqUser.franchiseId) {
      return NextResponse.json(
        { error: "소속 프랜차이즈 정보가 연결되지 않은 계정은 이름을 변경할 수 없습니다. 관리자에게 문의해주세요." },
        { status: 403 },
      );
    }

    let body: { name?: unknown };
    try {
      body = (await request.json()) as { name?: unknown };
    } catch {
      return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "이름을 입력해주세요." }, { status: 400 });
    }
    if (name.length > NAME_MAX_LENGTH) {
      return NextResponse.json({ error: `이름은 ${NAME_MAX_LENGTH}자 이하로 입력해주세요.` }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { error: profileError } = await adminClient
      .from("profiles")
      .update({ full_name: name })
      .eq("id", hqUser.userId);

    if (profileError) {
      console.error("PATCH /api/hq/profile profile update error:", profileError);
      return NextResponse.json({ error: "이름을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 500 });
    }

    const { data: authUser } = await adminClient.auth.admin.getUserById(hqUser.userId);
    const { error: metadataError } = await adminClient.auth.admin.updateUserById(hqUser.userId, {
      user_metadata: { ...(authUser.user?.user_metadata ?? {}), name },
    });

    if (metadataError) {
      console.error("PATCH /api/hq/profile metadata update error:", metadataError);
    }

    return NextResponse.json({ name });
  } catch (error) {
    console.error("PATCH /api/hq/profile error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
