import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildManualContentFingerprint, type FingerprintScope } from "@/lib/manuals/manual-content-fingerprint";
import {
  claimManualUploadBatch,
  completeManualUploadBatch,
  failManualUploadBatch,
} from "@/lib/manuals/manual-upload-batch";
import { CLAIM_BLOCKED_RESPONSES } from "@/lib/manuals/manual-upload-batch-messages";
import { saveManualGroupsWithChunks, type ManualGroupInput } from "@/lib/rag/save-manual-sections";
import type { HqAuthResult } from "@/lib/supabase/hq-auth";
import type { ManualRecord } from "@/lib/types/manual";

export const MANUAL_SELECT_COLUMNS =
  "id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at";

/**
 * manuals에 실제로 쓰는 모든 경로가 거쳐야 하는 단일 저장 진입점.
 * fingerprint 계산 -> batch claim -> 저장 -> 상태 기록을 한 곳에 묶어, 경로마다 중복 방지를
 * 다시 구현하거나 빠뜨리는 일이 없게 한다. scope는 반드시 서버 인증 결과에서 만들어 넘긴다.
 */
export type SaveWithBatchGuardResult =
  | { kind: "saved"; manuals: ManualRecord[] }
  /** 같은 요청이 이미 성공해 있었다. 그때 저장한 행을 그대로 돌려준다. */
  | { kind: "replayed"; manuals: ManualRecord[] }
  | { kind: "blocked"; status: number; error: string }
  /** 저장 자체가 실패했다(임베딩 실패는 여기에 해당하지 않는다). */
  | { kind: "save_failed"; error: string };

export interface SaveWithBatchGuardInput {
  auth: HqAuthResult;
  groups: ManualGroupInput[];
  scope: FingerprintScope;
  /** store 범위일 때만 지정한다. scope.storeId와 항상 같아야 한다. */
  storeId?: string;
  /** 미리보기가 발급한 key. 미리보기 단계가 없는 경로는 비워 두면 서버가 요청 단위로 만든다. */
  idempotencyKey?: string;
}

export async function saveManualGroupsWithBatchGuard(
  client: SupabaseClient,
  input: SaveWithBatchGuardInput,
): Promise<SaveWithBatchGuardResult> {
  const { auth, groups, scope, storeId } = input;

  const contentHash = buildManualContentFingerprint(scope, groups);
  // 미리보기가 없는 경로는 요청마다 새 key를 쓴다. 같은 내용을 다시 보내면 key가 달라도
  // content_hash unique index가 걸러내므로 중복 행은 생기지 않는다.
  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  let claim;

  try {
    claim = await claimManualUploadBatch(client, {
      idempotencyKey,
      contentHash,
      scope: {
        scopeType: scope.scopeType,
        franchiseId: scope.franchiseId,
        storeId: scope.storeId,
        requestedBy: auth.userId,
      },
    });
  } catch (e) {
    console.error("[MANUAL_SAVE_GUARD] claim failed:", { name: e instanceof Error ? e.name : "UnknownError" });
    return { kind: "save_failed", error: "매뉴얼 저장 중 오류가 발생했습니다." };
  }

  if (claim.kind === "already_completed") {
    const { data } = await client
      .from("manuals")
      .select(MANUAL_SELECT_COLUMNS)
      .eq("upload_batch_id", claim.batchId)
      .order("created_at", { ascending: true });

    return { kind: "replayed", manuals: (data ?? []) as ManualRecord[] };
  }

  if (claim.kind !== "claimed") {
    const blocked = CLAIM_BLOCKED_RESPONSES[claim.kind];
    return { kind: "blocked", status: blocked.status, error: blocked.error };
  }

  try {
    const manuals = await saveManualGroupsWithChunks(client, auth, groups, storeId, undefined, claim.batchId);
    await completeManualUploadBatch(client, claim.batchId, manuals.length);
    return { kind: "saved", manuals };
  } catch (e) {
    console.error("[MANUAL_SAVE_GUARD] save failed:", { name: e instanceof Error ? e.name : "UnknownError" });
    await failManualUploadBatch(client, claim.batchId);
    return {
      kind: "save_failed",
      error: e instanceof Error ? e.message : "매뉴얼 저장 중 오류가 발생했습니다.",
    };
  }
}
