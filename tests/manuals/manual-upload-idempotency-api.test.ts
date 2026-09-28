import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  CLAIM_BLOCKED_RESPONSES,
  DUPLICATE_CONTENT_MESSAGE,
  PROCESSING_MESSAGE,
} from "../../lib/manuals/manual-upload-batch-messages.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const MIGRATION = "supabase/migrations/020_manual_upload_batches.sql";

describe("020 마이그레이션 설계 계약", () => {
  const sql = readSource(MIGRATION);

  test("기존 마이그레이션 번호와 충돌하지 않는 새 번호를 쓴다", () => {
    for (const taken of ["019_manuals_parent_cascade_delete.sql", "018_scoped_hybrid_manual_search.sql"]) {
      assert.ok(readSource(`supabase/migrations/${taken}`).length > 0);
    }
    assert.match(sql, /create table if not exists public\.manual_upload_batches/);
  });

  test("재실행해도 안전하다 (if not exists / pg_constraint 확인)", () => {
    assert.equal(sql.includes("create table public.manual_upload_batches"), false);
    assert.match(sql, /create unique index if not exists/);
    assert.match(sql, /add column if not exists upload_batch_id uuid/);
    assert.match(sql, /from pg_constraint/);
  });

  test("HQ와 store에 각각 partial unique index를 둔다", () => {
    assert.match(sql, /manual_upload_batches_hq_active_hash_idx[\s\S]*?where scope_type = 'hq'/);
    assert.match(sql, /manual_upload_batches_store_active_hash_idx[\s\S]*?where scope_type = 'store'/);
  });

  test("processing/completed와 '부분 저장이 남은 failed'를 중복으로 막는다", () => {
    const predicate = /status in \('processing', 'completed'\) or \(status = 'failed' and manual_count > 0\)/g;
    assert.equal(sql.match(predicate)?.length, 2);
  });

  test("franchise_id가 NULL인 HQ 계정도 걸러지도록 coalesce를 쓴다", () => {
    assert.match(sql, /coalesce\(franchise_id, '00000000-0000-0000-0000-000000000000'::uuid\)/);
  });

  test("manuals.title에 unique 제약을 만들지 않는다", () => {
    assert.equal(/unique[^\n]*\btitle\b/i.test(sql), false);
  });

  test("기존 manuals 행과 호환되도록 upload_batch_id는 nullable이고 백필하지 않는다", () => {
    assert.equal(/upload_batch_id uuid not null/i.test(sql), false);
    assert.equal(/update public\.manuals/i.test(sql), false);
    assert.equal(/insert into public\.manuals/i.test(sql), false);
  });

  test("기존 데이터를 자동으로 지우지 않는다", () => {
    assert.equal(/delete from/i.test(sql), false);
    assert.equal(/truncate/i.test(sql), false);
    assert.equal(/drop table/i.test(sql), false);
  });

  test("매뉴얼 손실을 막기 위해 모든 FK가 on delete set null이다", () => {
    const statements = sql.replace(/--[^\n]*/g, "");
    assert.equal(statements.match(/on delete set null/g)?.length, 4);
    assert.equal(/manual_upload_batches\(id\) on delete cascade/.test(statements), false);
  });

  test("manuals/manual_chunks와 같은 방식으로 RLS만 켜고 정책은 두지 않는다", () => {
    assert.match(sql, /alter table public\.manual_upload_batches enable row level security/);
    assert.equal(/create policy/i.test(sql), false);
  });

  test("018 검색 RPC와 019 cascade 계약을 건드리지 않는다", () => {
    assert.equal(sql.includes("match_manual_chunks"), false);
    assert.equal(sql.includes("manuals_parent_manual_id_fkey"), false);
  });
});

describe("confirm 라우트의 중복 방지 계약", () => {
  const hq = readSource("app/api/manuals/preview/confirm/route.ts");
  const store = readSource("app/api/store-manuals/preview/confirm/route.ts");
  // claim/fingerprint/저장은 모든 저장 경로가 공유하는 진입점으로 옵겨졌다.
  const guard = readSource("lib/manuals/save-manuals-with-batch.ts");

  test("hash는 서버가 계산하고 body의 hash를 읽지 않는다", () => {
    assert.match(guard, /buildManualContentFingerprint\(scope, groups\)/);
    for (const source of [hq, store]) {
      const code = stripComments(source);
      assert.equal(code.includes("body.contentHash"), false);
      assert.equal(code.includes("body.hash"), false);
      assert.equal(code.includes("body.fingerprint"), false);
    }
  });

  test("body의 franchiseId/brandName/scopeType/userId를 신뢰하지 않는다", () => {
    for (const source of [hq, store]) {
      const code = stripComments(source);
      for (const forbidden of ["body.franchiseId", "body.brandName", "body.scopeType", "body.userId"]) {
        assert.equal(code.includes(forbidden), false, `reads ${forbidden}`);
      }
    }
  });

  test("HQ는 인증된 franchise, 점주는 검증된 storeId로만 지문 범위를 잡는다", () => {
    assert.match(hq, /\{ scopeType: "hq", franchiseId: hqUser\.franchiseId, storeId: null \}/);
    assert.match(store, /\{ scopeType: "store", franchiseId: storeAuth\.franchiseId, storeId: storeAuth\.storeId \}/);
  });

  test("인증 경계는 기존대로 분리되어 있고 confirm에서 다시 검증한다", () => {
    assert.match(hq, /const hqUser = await requireHqUser\(\)/);
    assert.match(store, /requireStoreOwner\(adminClient, userData\.user\.id, storeId\)/);
  });

  test("HQ와 점주가 같은 중복 방지 로직을 재사용한다", () => {
    for (const source of [hq, store]) {
      assert.match(source, /from "@\/lib\/manuals\/save-manuals-with-batch"/);
      assert.match(source, /await saveManualGroupsWithBatchGuard\(/);
    }
    assert.match(guard, /await claimManualUploadBatch\(/);
  });

  test("claim이 통과했을 때만 저장하고, batch id를 저장 행에 연결한다", () => {
    const claimIndex = guard.indexOf("claimManualUploadBatch(");
    const saveIndex = guard.indexOf("saveManualGroupsWithChunks(");
    assert.ok(claimIndex >= 0 && saveIndex > claimIndex, "claim must run before save");
    assert.match(guard, /claim\.kind !== "claimed"/);
    assert.match(guard, /claim\.batchId/);
  });

  test("완료된 동일 요청은 기존 행을 그대로 돌려주고 새로 저장하지 않는다", () => {
    assert.match(guard, /claim\.kind === "already_completed"/);
    assert.match(guard, /\.eq\("upload_batch_id", claim\.batchId\)/);
    const completedIndex = guard.indexOf('claim.kind === "already_completed"');
    const saveIndex = guard.indexOf("saveManualGroupsWithChunks(");
    assert.ok(completedIndex < saveIndex, "idempotent replay must short-circuit before saving");
  });

  test("저장 성공/실패 시 batch 상태를 기록한다", () => {
    assert.match(guard, /await completeManualUploadBatch\(/);
    assert.match(guard, /await failManualUploadBatch\(/);
  });

  test("idempotency key는 UUID 형식만 받는다", () => {
    for (const source of [hq, store]) {
      assert.match(source, /IDEMPOTENCY_KEY_PATTERN\.test\(body\.idempotencyKey\.trim\(\)\)/);
    }
  });

  test("성공 응답 shape({ manuals })는 그대로 유지된다", () => {
    for (const source of [hq, store]) {
      assert.match(source, /NextResponse\.json\(\{ manuals: result\.manuals \}, \{ status: result\.kind === "saved" \? 201 : 200 \}\)/);
    }
  });

  test("중복/처리 중 응답은 409이고 내부 hash·batch id·UUID를 노출하지 않는다", () => {
    assert.equal(CLAIM_BLOCKED_RESPONSES.duplicate_content.status, 409);
    assert.equal(CLAIM_BLOCKED_RESPONSES.processing.status, 409);
    assert.equal(CLAIM_BLOCKED_RESPONSES.needs_recovery.status, 409);
    for (const blocked of Object.values(CLAIM_BLOCKED_RESPONSES)) {
      for (const term of ["hash", "batch", "idempotency", "uuid", "sql", "supabase"]) {
        assert.equal(blocked.error.toLowerCase().includes(term), false, `${blocked.error} leaks ${term}`);
      }
      assert.match(blocked.error, /[가-힣]/);
    }
  });

  test("사용자 문구가 요구된 그대로다", () => {
    assert.equal(
      DUPLICATE_CONTENT_MESSAGE,
      "이미 같은 내용의 매뉴얼이 등록되어 있어요. 기존 매뉴얼을 확인하거나 내용을 수정한 뒤 다시 시도해 주세요.",
    );
    assert.equal(PROCESSING_MESSAGE, "매뉴얼을 저장하고 있어요. 잠시 후 목록에서 확인해 주세요.");
  });

  test("claim 실패 로그에 원본 오류 객체나 본문을 남기지 않는다", () => {
    assert.match(guard, /claim failed:", \{ name: e instanceof Error \? e\.name : "UnknownError" \}/);
    for (const source of [hq, store, guard]) {
      assert.equal(/console\.error\([^)]*body/i.test(source), false);
    }
  });
});

describe("preview -> confirm key 연결", () => {
  const hqPreview = readSource("app/api/manuals/preview/route.ts");
  const storePreview = readSource("app/api/store-manuals/preview/route.ts");
  const hqPage = readSource("app/hq/manuals/onboarding/page.tsx");
  const storePage = readSource("app/boss/store-manuals/upload/page.tsx");

  test("미리보기 성공 시 서버가 key를 발급한다", () => {
    for (const source of [hqPreview, storePreview]) {
      assert.match(source, /idempotencyKey: randomUUID\(\)/);
      assert.match(source, /from "node:crypto"/);
    }
  });

  test("미리보기 라우트는 여전히 DB에 쓰지 않는다", () => {
    for (const source of [hqPreview, storePreview]) {
      for (const write of [".insert(", ".update(", ".delete(", ".upsert("]) {
        assert.equal(source.includes(write), false, `preview writes via ${write}`);
      }
    }
  });

  test("같은 미리보기 세션은 같은 key를 저장 요청에 함께 보낸다", () => {
    assert.match(hqPage, /body: JSON\.stringify\(\{ manuals: payloadManuals, idempotencyKey \}\)/);
    assert.match(storePage, /body: JSON\.stringify\(\{ storeId, manuals: payloadManuals, idempotencyKey \}\)/);
  });

  test("새 파일을 올리면 key가 초기화돼 새 key를 받는다", () => {
    for (const source of [hqPage, storePage]) {
      assert.match(source, /setIdempotencyKey\(""\)/);
      assert.match(source, /setIdempotencyKey\(data\.idempotencyKey\)/);
    }
  });

  test("key가 없으면 저장을 시작하지 않는다 (중복 클릭 가드는 그대로 유지)", () => {
    assert.match(hqPage, /if \(!preview \|\| !idempotencyKey \|\| isSubmittingRef\.current\) return;/);
    assert.match(storePage, /if \(!preview \|\| !storeId \|\| !idempotencyKey \|\| isSubmittingRef\.current\) return;/);
  });

  test("저장 중 버튼 비활성화와 접근성 안내가 유지된다", () => {
    for (const source of [hqPage, storePage]) {
      assert.match(source, /disabled=\{isSaving\}/);
      assert.match(source, /isLoading=\{isSaving\}/);
      assert.match(source, /role="alert"/);
    }
  });

  test("서버가 돌려준 안내 문구를 그대로 보여주고 기술 용어를 쓰지 않는다", () => {
    for (const source of [hqPage, storePage]) {
      assert.match(source, /setError\(e instanceof Error \? e\.message/);
      // 사용자에게 보이는 문구는 한글이 들어있는 문자열 리터럴뿐이다.
      const koreanLiterals = (source.match(/["'`][^"'`\n]*[가-힣][^"'`\n]*["'`]/g) ?? []).join(" ");
      for (const term of ["hash", "idempotency", "batch"]) {
        assert.equal(koreanLiterals.toLowerCase().includes(term), false, `shows ${term}`);
      }
    }
  });

  test("중복이라고 기존 데이터를 자동으로 덮어쓰거나 지우지 않는다", () => {
    for (const source of [hqPage, storePage]) {
      assert.equal(/method: "DELETE"/.test(source), false);
      assert.equal(/method: "PATCH"/.test(source), false);
    }
  });
});

describe("기존 계약 회귀 없음", () => {
  test("저장 함수의 batch 연결은 선택적이라 기존 호출부가 그대로 동작한다", () => {
    const source = readSource("lib/rag/save-manual-sections.ts");
    assert.match(source, /uploadBatchId\?: string \| null,/);
    assert.match(source, /upload_batch_id: uploadBatchId \?\? null,/);
    assert.equal(source.match(/upload_batch_id: uploadBatchId \?\? null,/g)?.length, 2);
  });

  test("기존 analyze/batch-create 경로도 같은 중복 방지를 거친다", () => {
    const source = readSource("app/api/store-manuals/batch-create/route.ts");
    assert.match(source, /saveManualGroupsWithBatchGuard\(adminClient, \{/);
    assert.match(source, /storeId: storeAuth\.storeId,/);
  });

  test("미리보기 편집 UI는 HQ/점주가 계속 공유한다", () => {
    for (const relative of ["app/hq/manuals/onboarding/page.tsx", "app/boss/store-manuals/upload/page.tsx"]) {
      assert.match(readSource(relative), /<ManualPreviewEditor/);
    }
  });
});
