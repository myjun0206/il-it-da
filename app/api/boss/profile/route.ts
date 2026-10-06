import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const NAME_MAX_LENGTH = 50;

/**
 * 점주 본인의 표시 이름만 변경한다. 이메일/역할/프랜차이즈/매장은 이 API로 바꿀 수 없다.
 * profiles.full_name과 auth user_metadata.name(헤더 표시용)을 함께 맞춘다. (HQ: /api/hq/profile과 같은 규칙)
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const serverClient = await createClient();
    const { data: userData, error: userError } = await serverClient.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle<{ role: string }>();

    if (profileError || profile?.role !== "owner") {
      return NextResponse.json({ error: "점주만 변경할 수 있습니다." }, { status: 403 });
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

    // 023 이후 한 사용자가 마스터(brand_id NULL)와 브랜드별 profiles 행을 함께 가지므로,
    // 세션 사용자의 모든 행을 같은 이름으로 맞춘다. 역할·브랜드·승인 상태는 건드리지 않는다.
    const { error: updateError } = await adminClient
      .from("profiles")
      .update({ full_name: name })
      .eq("user_id", userData.user.id);

    if (updateError) {
      console.error("PATCH /api/boss/profile profile update error:", updateError);
      return NextResponse.json({ error: "이름을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 500 });
    }

    const { error: metadataError } = await adminClient.auth.admin.updateUserById(userData.user.id, {
      user_metadata: { ...(userData.user.user_metadata ?? {}), name },
    });

    if (metadataError) {
      console.error("PATCH /api/boss/profile metadata update error:", metadataError);
    }

    return NextResponse.json({ name });
  } catch (error) {
    console.error("PATCH /api/boss/profile error:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
