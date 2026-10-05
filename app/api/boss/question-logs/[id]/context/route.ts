import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchOwnerQuestionManualContext } from "@/lib/owner/question-manual-context";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const storeId = new URL(request.url).searchParams.get("storeId")?.trim();
  if (!storeId) return NextResponse.json({ error: "매장을 선택해 주세요." }, { status: 400 });
  const { id } = await params;
  const result = await fetchOwnerQuestionManualContext(createAdminClient(), {
    userId: data.user.id, storeId, questionId: id,
  });
  return NextResponse.json(result.body, { status: result.status });
}