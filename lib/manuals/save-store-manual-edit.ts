import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStoreOwner } from "@/lib/manuals/store-manual-auth";
import { validateManualEdit, type ManualEditInput } from "@/lib/manuals/validate-manual-edit";
import type { ManualRecord } from "@/lib/types/manual";
import { requireManualWriteContract, MANUAL_FEATURE_PENDING, type ManualWriteContext } from "@/lib/manuals/manual-write-contract";

export type ManualEditSearchStatus = "ready" | "failed" | "not_searchable" | "parent_only";
export type StoreManualEditResult = {
  status: number;
  body: { manual?: ManualRecord; searchStatus?: ManualEditSearchStatus; error?: string; code?: string };
};

export async function saveStoreManualEdit(
  client: SupabaseClient,
  input: ManualEditInput & { userId: string; storeId: string; manualId: string; expectedUpdatedAt?: unknown },
  indexManual: (manualId: string, expectedUpdatedAt?: string, context?: ManualWriteContext) => Promise<unknown>,
): Promise<StoreManualEditResult> {
  const validation = validateManualEdit(input);
  if (!validation.valid) return { status: 400, body: { error: validation.error } };
  if (typeof input.expectedUpdatedAt !== "string" || !input.expectedUpdatedAt.trim()
    || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) {
    return { status: 409, body: { code: "MANUAL_REVISION_REQUIRED", error: "매뉴얼을 다시 불러온 뒤 수정해 주세요. 변경 버전을 확인할 수 없습니다." } };
  }
  const auth = await requireStoreOwner(client, input.userId, input.storeId);
  if (!auth) return { status: 403, body: { error: "이 지점에 대한 접근 권한이 없습니다." } };
  let context;
  try { context = await requireManualWriteContract(client); }
  catch { return { status: 503, body: { code: "SAFE_MANUAL_EDIT_UNAVAILABLE", error: MANUAL_FEATURE_PENDING } }; }

  const { data, error } = await client.rpc("edit_store_manual_if_current", {
    p_user_id: input.userId,
    p_store_id: auth.storeId,
    p_franchise_id: auth.franchiseId,
    p_manual_id: input.manualId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_update: validation.update,
  });
  if (error) {
    if (error.code === "40001") return { status: 409, body: { code: "MANUAL_EDIT_CONFLICT", error: "다른 수정이 먼저 저장되었습니다. 최신 내용을 다시 불러온 뒤 수정해 주세요." } };
    if (error.code === "P0002" || error.code === "42501") return { status: 404, body: { error: "수정 가능한 매장 매뉴얼을 찾을 수 없습니다. 본사 매뉴얼은 본사 확인이 필요합니다." } };
    if (error.code === "PGRST202" || error.code === "42883") return { status: 503, body: { code: "SAFE_MANUAL_EDIT_UNAVAILABLE", error: "안전한 매뉴얼 수정 기능이 아직 준비되지 않았습니다. 저장하지 않았습니다." } };
    return { status: 500, body: { error: "매뉴얼을 저장하지 못했습니다. 다시 불러와 상태를 확인해 주세요." } };
  }
  const saved = data as { manual: ManualRecord; hasChildren: boolean } | null;
  if (!saved?.manual) return { status: 500, body: { error: "저장 결과를 확인하지 못했습니다. 최신 내용을 다시 불러와 주세요." } };
  if (saved.hasChildren) return { status: 200, body: { manual: saved.manual, searchStatus: "parent_only" } };
  if (saved.manual.status !== "approved") return { status: 200, body: { manual: saved.manual, searchStatus: "not_searchable" } };
  try {
    await indexManual(saved.manual.id, saved.manual.updated_at, context);
    return { status: 200, body: { manual: saved.manual, searchStatus: "ready" } };
  } catch {
    return { status: 200, body: { manual: saved.manual, searchStatus: "failed" } };
  }
}