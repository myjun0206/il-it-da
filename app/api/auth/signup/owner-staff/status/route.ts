import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAuthEmailSettings } from "@/lib/auth/auth-email-settings";
import { checkEmailSignupConfirmation, parseOwnerStaffRole } from "@/lib/auth/owner-staff-signup";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    const role = parseOwnerStaffRole(user?.user_metadata?.role);
    if (error || !user || !role || user.app_metadata?.provider !== "email" || user.identities?.some((identity) => identity.provider !== "email")) {
      return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const { data: profile, error: profileError } = await createAdminClient().from("profiles")
      .select("role").eq("id", user.id).maybeSingle<{ role: string }>();
    if (profileError || (profile && profile.role !== role)) {
      return NextResponse.json({ ok: false }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const confirmation = await checkEmailSignupConfirmation(user, { hasProfile: Boolean(profile), getSettings: fetchAuthEmailSettings });
    if (!confirmation.ok) {
      return NextResponse.json(confirmation, { status: confirmation.status, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ ok: true, role, email: user.email, name: user.user_metadata?.name ?? "", phone: user.user_metadata?.phone ?? "" },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "인증 상태를 확인할 수 없습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}