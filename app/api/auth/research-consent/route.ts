import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginRequest, readJsonBody } from "@/lib/auth/owner-staff-signup-server";
import { acceptsResearchInvitations, createResearchConsent, RESEARCH_CONSENT_KEY } from "@/lib/auth/signup-research-consent";

export const runtime = "nodejs";

export async function GET() {
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return NextResponse.json({ ok: false }, { status: 401 });
    return NextResponse.json({ ok: true, accepted: acceptsResearchInvitations(data.user.user_metadata?.[RESEARCH_CONSENT_KEY]) },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ ok: false }, { status: 403 });
  const body = await readJsonBody(request);
  if (!body || typeof body.accepted !== "boolean") return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return NextResponse.json({ ok: false }, { status: 401 });
    const consent = createResearchConsent(body.accepted);
    const result = await client.auth.updateUser({ data: { [RESEARCH_CONSENT_KEY]: consent } });
    if (result.error) return NextResponse.json({ ok: false, error: "선택 동의를 저장하지 못했습니다." }, { status: 503 });
    return NextResponse.json({ ok: true, accepted: consent.accepted }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}