import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role, approval_status")
    .eq("id", user.id)
    .maybeSingle<{ role: string; approval_status: string | null }>();

  if (profileError || !profile?.role) {
    return NextResponse.json({ authenticated: true, userId: user.id, role: null }, { status: 200 });
  }

  return NextResponse.json(
    {
      authenticated: true,
      userId: user.id,
      role: profile.role,
      approvalStatus: profile.approval_status === "approved" || profile.approval_status === "rejected"
        ? profile.approval_status
        : "pending",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}