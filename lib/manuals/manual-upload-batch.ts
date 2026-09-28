import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 확정 저장 요청 1건을 manual_upload_batches 한 행으로 수렴시킨다.
 * HQ/점주 confirm 라우트가 같은 함수를 쓰고, 인증 경계(requireHqUser/requireStoreOwner)만
 * 각 라우트에 남는다. 여기에 들어오는 scope는 이미 서버에서 검증된 값이어야 한다.
 */

export const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BatchStatus = "processing" | "completed" | "failed";

export interface BatchScope {
  scopeType: "hq" | "store";
  franchiseId: string | null;
  storeId: string | null;
  requestedBy: string;
}

export interface ManualUploadBatchRow {
  id: string;
  idempotency_key: string;
  content_hash: string;
  scope_type: string;
  franchise_id: string | null;
  store_id: string | null;
  requested_by: string | null;
  status: BatchStatus;
  manual_count: number;
}

export type ClaimBatchResult =
  /** 새로(또는 깨끗한 재시도로) 저장을 시작해도 되는 상태. */
  | { kind: "claimed"; batchId: string }
  /** 같은 key의 요청이 이미 성공했다. 기존 결과를 그대로 돌려주면 된다. */
  | { kind: "already_completed"; batchId: string }
  /** 같은 key의 요청이 아직 처리 중이다. */
  | { kind: "processing" }
  /** 같은 범위에 같은 내용이 이미 등록(또는 등록 중)이다. */
  | { kind: "duplicate_content" }
  /** 이전 시도가 일부만 저장하고 실패했다. 자동 삭제/재삽입하지 않고 사람이 확인해야 한다. */
  | { kind: "needs_recovery" }
  /** key가 다른 사용자/범위의 것이거나, 같은 key로 다른 내용을 보냈다. */
  | { kind: "rejected" };

const HQ_HASH_INDEX = "manual_upload_batches_hq_active_hash_idx";
const STORE_HASH_INDEX = "manual_upload_batches_store_active_hash_idx";
const KEY_INDEX = "manual_upload_batches_idempotency_key_idx";

const BATCH_COLUMNS =
  "id, idempotency_key, content_hash, scope_type, franchise_id, store_id, requested_by, status, manual_count";

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

function violatedIndex(error: { message?: string; details?: string } | null): string {
  return `${error?.message ?? ""} ${error?.details ?? ""}`;
}

function scopeMatches(row: ManualUploadBatchRow, scope: BatchScope): boolean {
  if (row.scope_type !== scope.scopeType) return false;
  if (row.requested_by !== scope.requestedBy) return false;
  if (scope.scopeType === "store") return row.store_id === scope.storeId;
  return row.franchise_id === scope.franchiseId;
}

/** 같은 key로 이미 만들어진 batch가 어떤 상태인지 해석한다. */
function resolveExisting(
  row: ManualUploadBatchRow,
  scope: BatchScope,
  contentHash: string,
): ClaimBatchResult {
  // 브라우저가 임의 key를 보낼 수 있으므로, 인증 범위가 다르면 절대 재사용하지 않는다.
  if (!scopeMatches(row, scope)) {
    return { kind: "rejected" };
  }
  if (row.status === "processing") {
    return { kind: "processing" };
  }
  if (row.status === "completed") {
    // 이미 저장된 요청이다. 같은 내용일 때만 그 결과를 돌려주고, 내용이 달라졌다면
    // 새 저장으로 봐야 하므로 기존 batch를 덮어쓰지 않는다.
    return row.content_hash === contentHash
      ? { kind: "already_completed", batchId: row.id }
      : { kind: "rejected" };
  }
  // failed: 저장된 행이 없을 때만 같은 batch를 다시 쓴다. 이때는 사용자가 미리보기에서
  // 제목·분류를 고친 뒤 재시도했을 수 있으므로 달라진 내용(hash)도 허용한다.
  return row.manual_count > 0 ? { kind: "needs_recovery" } : { kind: "claimed", batchId: row.id };
}

export async function claimManualUploadBatch(
  client: SupabaseClient,
  input: { idempotencyKey: string; contentHash: string; scope: BatchScope },
): Promise<ClaimBatchResult> {
  const { idempotencyKey, contentHash, scope } = input;

  const { data: existing, error: lookupError } = await client
    .from("manual_upload_batches")
    .select(BATCH_COLUMNS)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle<ManualUploadBatchRow>();

  if (lookupError) {
    throw new Error("MANUAL_UPLOAD_BATCH_LOOKUP_FAILED");
  }

  if (existing) {
    const resolved = resolveExisting(existing, scope, contentHash);
    if (resolved.kind !== "claimed") {
      return resolved;
    }
    // failed -> processing 전환은 조건부 update로 한 번만 성공해야 한다.
    // 두 요청이 같은 failed 행을 동시에 읽으면 진 쪽은 갱신 대상이 없어 빈 결과를 받는다.
    const { data: resumed, error: resumeError } = await client
      .from("manual_upload_batches")
      .update({ status: "processing", content_hash: contentHash, manual_count: 0, completed_at: null })
      .eq("id", resolved.batchId)
      .eq("status", "failed")
      .select("id");

    if (resumeError) {
      // 고친 내용이 같은 범위의 다른 살아있는 요청과 겹치면 unique index가 막는다.
      if (isUniqueViolation(resumeError)) {
        return { kind: "duplicate_content" };
      }
      throw new Error("MANUAL_UPLOAD_BATCH_RESUME_FAILED");
    }

    if (!resumed || resumed.length === 0) {
      return { kind: "processing" };
    }

    return resolved;
  }

  const { data: inserted, error: insertError } = await client
    .from("manual_upload_batches")
    .insert({
      idempotency_key: idempotencyKey,
      content_hash: contentHash,
      scope_type: scope.scopeType,
      franchise_id: scope.franchiseId,
      store_id: scope.scopeType === "store" ? scope.storeId : null,
      requested_by: scope.requestedBy,
      status: "processing",
      manual_count: 0,
    })
    .select("id")
    .single<{ id: string }>();

  if (!insertError && inserted) {
    return { kind: "claimed", batchId: inserted.id };
  }

  if (!isUniqueViolation(insertError)) {
    throw new Error("MANUAL_UPLOAD_BATCH_CLAIM_FAILED");
  }

  const conflict = violatedIndex(insertError);

  if (conflict.includes(HQ_HASH_INDEX) || conflict.includes(STORE_HASH_INDEX)) {
    return { kind: "duplicate_content" };
  }

  if (conflict.includes(KEY_INDEX)) {
    // 같은 key의 요청이 바로 직전에 먼저 들어와 행을 만든 경우(동시 요청 경쟁).
    const { data: raced } = await client
      .from("manual_upload_batches")
      .select(BATCH_COLUMNS)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle<ManualUploadBatchRow>();

    if (raced) {
      const resolved = resolveExisting(raced, scope, contentHash);
      // 경쟁에서 진 쪽은 저장을 시작하지 않는다.
      return resolved.kind === "claimed" ? { kind: "processing" } : resolved;
    }
  }

  // 우리가 아는 세 인덱스가 아닌 unique 충돌은 원인을 단정할 수 없다.
  // "이미 등록된 내용"이라고 잘못 안내하지 말고 저장 오류로 처리한다.
  throw new Error("MANUAL_UPLOAD_BATCH_CLAIM_FAILED");
}

export async function completeManualUploadBatch(
  client: SupabaseClient,
  batchId: string,
  manualCount: number,
): Promise<void> {
  await client
    .from("manual_upload_batches")
    .update({ status: "completed", manual_count: manualCount, completed_at: new Date().toISOString() })
    .eq("id", batchId);
}

/**
 * 저장이 실패했을 때, 이 batch가 실제로 남긴 manuals 행 수를 함께 기록한다.
 * 0건이면 content_hash가 풀려 사용자가 그대로 다시 시도할 수 있고,
 * 1건 이상이면 partial unique index가 계속 중복을 막아 같은 내용이 두 번 저장되지 않는다.
 */
export async function failManualUploadBatch(
  client: SupabaseClient,
  batchId: string,
): Promise<void> {
  const { count } = await client
    .from("manuals")
    .select("id", { count: "exact", head: true })
    .eq("upload_batch_id", batchId);

  await client
    .from("manual_upload_batches")
    .update({ status: "failed", manual_count: count ?? 0, completed_at: new Date().toISOString() })
    .eq("id", batchId);
}
