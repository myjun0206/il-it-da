import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildManualContentFingerprint, type FingerprintScope } from "@/lib/manuals/manual-content-fingerprint";
import {
  claimManualUploadBatch,
  completeManualUploadBatch,
  failManualUploadBatch,
  releaseEmptyCompletedBatch,
} from "@/lib/manuals/manual-upload-batch";
import { CLAIM_BLOCKED_RESPONSES } from "@/lib/manuals/manual-upload-batch-messages";
import { saveManualGroupsWithChunks, type ManualGroupInput } from "@/lib/rag/save-manual-sections";
import type { HqAuthResult } from "@/lib/supabase/hq-auth";
import type { ManualRecord } from "@/lib/types/manual";
import { requireManualWriteContract, MANUAL_FEATURE_PENDING } from "@/lib/manuals/manual-write-contract";

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
  /** 테스트에서만 주입한다. 생략하면 실제 임베딩(indexManualById)을 쓴다. */
  indexManual?: (manualId: string) => Promise<unknown>;
}

export const HQ_BRAND_REQUIRED_MESSAGE =
  "소속 브랜드가 연결되지 않은 본사 계정은 매뉴얼을 저장할 수 없어요. 관리자에게 문의해 주세요.";

export async function saveManualGroupsWithBatchGuard(
  client: SupabaseClient,
  input: SaveWithBatchGuardInput,
): Promise<SaveWithBatchGuardResult> {
  const { auth, groups, scope, storeId } = input;

  // 018 RPC는 franchise_id가 일치하는 HQ 매뉴얼만 검색한다. NULL로 저장하면 직원 챗봇이 영원히 찾지 못한다.
  if (scope.scopeType === "hq" && !scope.franchiseId) {
    return { kind: "blocked", status: 403, error: HQ_BRAND_REQUIRED_MESSAGE };
  }
  let context;
  try { context = await requireManualWriteContract(client); }
  catch { return { kind: "blocked", status: 503, error: MANUAL_FEATURE_PENDING }; }

  const contentHash = buildManualContentFingerprint(scope, groups);
  // 미리보기가 없는 경로는 요청마다 새 key를 쓴다. 같은 내용을 다시 보내면 key가 달라도
  // content_hash unique index가 걸러내므로 중복 행은 생기지 않는다.
  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  let claim;

  try {
    const claimInput = {
      idempotencyKey,
      contentHash,
      scope: {
        scopeType: scope.scopeType,
        franchiseId: scope.franchiseId,
        storeId: scope.storeId,
        requestedBy: auth.userId,
      },
    };

    claim = await claimManualUploadBatch(client, claimInput);

    if (claim.kind === "already_completed") {
      const { data: replayed, error: replayError } = await client
        .from("manuals")
        .select(MANUAL_SELECT_COLUMNS)
        .eq("upload_batch_id", claim.batchId)
        .order("created_at", { ascending: true });

      if (replayError) {
        throw new Error("MANUAL_UPLOAD_BATCH_REPLAY_LOOKUP_FAILED");
      }

      if ((replayed ?? []).length > 0) {
        return { kind: "replayed", manuals: replayed as ManualRecord[] };
      }

      // 완료 기록만 남고 매뉴얼은 모두 삭제된 경우: 빈 결과를 성공으로 돌려주지 않고 새로 저장한다.
      await releaseEmptyCompletedBatch(client, claim.batchId);
      claim = await claimManualUploadBatch(client, claimInput);

      if (claim.kind === "already_completed") {
        const concurrent = CLAIM_BLOCKED_RESPONSES.processing;
        return { kind: "blocked", status: concurrent.status, error: concurrent.error };
      }
    }
  } catch (e) {
    console.error("[MANUAL_SAVE_GUARD] claim failed:", { name: e instanceof Error ? e.name : "UnknownError" });
    return { kind: "save_failed", error: "매뉴얼 저장 중 오류가 발생했습니다." };
  }

  if (claim.kind !== "claimed") {
    const blocked = CLAIM_BLOCKED_RESPONSES[claim.kind];
    return { kind: "blocked", status: blocked.status, error: blocked.error };
  }

  try {
    const manuals = await saveManualGroupsWithChunks(client, auth, groups, storeId, input.indexManual, claim.batchId, context);
    await completeManualUploadBatch(client, claim.batchId, manuals.length);
    return { kind: "saved", manuals };
  } catch (e) {
    console.error("[MANUAL_SAVE_GUARD] save failed:", { name: e instanceof Error ? e.name : "UnknownError" });
    await failManualUploadBatch(client, claim.batchId);
    // 예상치 못한 오류의 message는 DB 제약명/쿼리/네트워크 상세를 담을 수 있어 응답에 넣지 않는다.
    return { kind: "save_failed", error: "매뉴얼 저장 중 오류가 발생했습니다." };
  }
}
