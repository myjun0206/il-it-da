import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";

import { claimManualUploadBatch, type ManualUploadBatchRow } from "../../lib/manuals/manual-upload-batch.ts";
import { buildConfirmedManualsPayload, buildManualPreview } from "../../lib/manuals/build-manual-preview.ts";
import { parseConfirmedManualGroups } from "../../lib/manuals/parse-confirmed-manual-groups.ts";
import { buildManualContentFingerprint } from "../../lib/manuals/manual-content-fingerprint.ts";
import { MAX_UPLOAD_FILE_SIZE_BYTES, isFileSizeWithinLimit } from "../../lib/manuals/upload-limits.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

const KEY = "11111111-1111-4111-8111-111111111111";
const HQ_SCOPE = { scopeType: "hq" as const, franchiseId: "franchise-1", storeId: null, requestedBy: "hq-user" };

test("shared HQ upload executes preview, leave cancellation and one idempotent save", async () => {
  type Element = { type: string; props: {
    children?: unknown; role?: string; onFileSelected?: (file: File) => void;
    onClose?: () => void; onSave?: () => void; onClick?: () => void;
    [key: string]: unknown;
  } };
  const states: unknown[] = [];
  let cursor = 0;
  let closed = 0;
  const saved: unknown[] = [];
  const requests: { url: string; options: RequestInit; resolve: (response: unknown) => void }[] = [];
  const jsx = (type: string, props: Element["props"]) => ({ type, props });
  const hooks = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in states)) states[index] = { current: initial };
      return states[index];
    },
    useEffect() {},
  };
  const exports: Record<string, unknown> = {};
  const modules: Record<string, unknown> = {
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { X: "icon" },
    "@/components/common/Button": { Button: "button" },
    "@/components/manuals/ManualFileDropzone": { __esModule: true, default: "dropzone" },
    "@/components/manuals/ManualUploadReviewModal": { __esModule: true, default: "review" },
    "@/lib/manuals/build-manual-preview": { buildConfirmedManualsPayload },
    "@/lib/manuals/upload-limits": { MAX_UPLOAD_FILE_SIZE_BYTES, isFileSizeWithinLimit },
  };
  const code = ts.transpileModule(readSource("components/manuals/HQManualUpload.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Script(code).runInNewContext({ exports, module: { exports }, FormData,
    require: (name: string) => {
      assert.ok(name in modules, name);
      return modules[name];
    },
    fetch: (url: string, options: RequestInit) => new Promise(resolve => requests.push({ url, options, resolve })),
  });
  const render = (): Element => {
    cursor = 0;
    const component = exports.default as (props: { onClose: () => void; onSaved: (data: unknown) => void }) => Element;
    return component({ onClose: () => { closed++; }, onSaved: (data: unknown) => { saved.push(data); } });
  };
  const find = (tree: Element, predicate: (element: Element) => boolean): Element | undefined => {
    if (predicate(tree)) return tree;
    const children = [tree.props.children].flat(Infinity).filter(child => child && typeof child === "object");
    for (const child of children) {
      const result = find(child as Element, predicate);
      if (result) return result;
    }
  };
  const file = new File(["category,title,content"], "manual.csv", { type: "text/csv" });
  const dropzone = find(render(), element => element.type === "dropzone")!;
  dropzone.props.onFileSelected!(file);
  dropzone.props.onFileSelected!(file);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/manuals/preview");
  const preview = buildManualPreview([{ category: "오픈/마감", topic: "오픈 준비", items: ["불 켜기"] }]);
  requests[0].resolve({ ok: true, json: async () => ({ preview, idempotencyKey: KEY }) });
  await new Promise(setImmediate);
  render().props.onClose!();
  const dialog = find(render(), element => element.props.role === "alertdialog")!;
  assert.ok(dialog);
  assert.equal(closed, 0);
  find(dialog, element => element.type === "button" && element.props.children === "계속 작성하기")!.props.onClick!();
  const review = render();
  assert.equal(review.type, "review");
  review.props.onSave!();
  review.props.onSave!();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "/api/manuals/preview/confirm");
  const body = JSON.parse(requests[1].options.body as string);
  assert.deepEqual(Object.keys(body).sort(), ["idempotencyKey", "manuals"]);
  assert.equal(body.idempotencyKey, KEY);
  assert.equal(body.manuals.length, 1);
  requests[1].resolve({ ok: true, json: async () => ({ manuals: [{ id: "synthetic-manual" }] }) });
  await new Promise(setImmediate);
  assert.equal(saved.length, 1);
  assert.equal(closed, 0);
});

function fakeBatchClient(seed: ManualUploadBatchRow[] = []) {
  const rows = seed.map((row) => ({ ...row }));

  const client = {
    from() {
      return {
        select(_columns: string) {
          let keyFilter: string | undefined;
          const query = {
            eq(_column: string, value: string) {
              keyFilter = value;
              return query;
            },
            maybeSingle: () =>
              Promise.resolve({
                data: rows.find((row) => row.idempotency_key === keyFilter) ?? null,
                error: null,
              }),
          };
          return query;
        },
        update(patch: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const query = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return query;
            },
            select() {
              const matched = rows.filter(
                (row) =>
                  (!filters.id || row.id === filters.id) && (!filters.status || row.status === filters.status),
              );
              for (const row of matched) Object.assign(row, patch);
              return Promise.resolve({ data: matched.map((row) => ({ id: row.id })), error: null });
            },
          };
          return query;
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, rows };
}

function batchRow(overrides: Partial<ManualUploadBatchRow> = {}): ManualUploadBatchRow {
  return {
    id: "batch-1",
    idempotency_key: KEY,
    content_hash: "hash-original",
    scope_type: "hq",
    franchise_id: "franchise-1",
    store_id: null,
    requested_by: "hq-user",
    status: "completed",
    manual_count: 3,
    ...overrides,
  };
}

describe("idempotency key 수명주기 (실제 함수 실행)", () => {
  test("hash는 미리보기 시점이 아니라 최종 편집 결과로 계산된다", () => {
    const preview = buildManualPreview([
      { category: "오픈/마감", topic: "오픈 준비", items: ["불 켜기"] },
    ]);
    const [manual] = preview.manuals;

    const asIs = parseConfirmedManualGroups(buildConfirmedManualsPayload(preview, {}, {}));
    const edited = parseConfirmedManualGroups(
      buildConfirmedManualsPayload(
        preview,
        { [manual.topCategoryTempId]: "새 분류" },
        { [manual.tempId]: { title: "새 제목" } },
      ),
    );

    assert.ok(asIs && edited);
    assert.equal(edited[0].category, "새 분류");
    assert.equal(edited[0].topic, "새 제목");

    const scope = { scopeType: "hq" as const, franchiseId: "franchise-1", storeId: null };
    assert.notEqual(buildManualContentFingerprint(scope, edited), buildManualContentFingerprint(scope, asIs));
  });

  test("제목·분류를 고쳐 재시도해도 아무것도 저장되지 않은 실패 batch는 같은 key로 이어진다", async () => {
    const { client, rows } = fakeBatchClient([batchRow({ status: "failed", manual_count: 0 })]);

    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY,
      contentHash: "hash-edited",
      scope: HQ_SCOPE,
    });

    assert.deepEqual(result, { kind: "claimed", batchId: "batch-1" });
    assert.equal(rows[0].content_hash, "hash-edited");
    assert.equal(rows[0].status, "processing");
  });

  test("이미 저장이 끝난 요청은 같은 key로 내용을 바꿔 보내도 덮어쓰지 않는다", async () => {
    const { client, rows } = fakeBatchClient([batchRow({ status: "completed" })]);

    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY,
      contentHash: "hash-edited",
      scope: HQ_SCOPE,
    });

    assert.deepEqual(result, { kind: "rejected" });
    assert.equal(rows[0].content_hash, "hash-original");
    assert.equal(rows[0].manual_count, 3);
  });

  test("응답을 놓쳐 같은 내용으로 다시 저장하면 완료된 결과를 재사용한다", async () => {
    const { client } = fakeBatchClient([batchRow({ status: "completed" })]);

    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY,
      contentHash: "hash-original",
      scope: HQ_SCOPE,
    });

    assert.deepEqual(result, { kind: "already_completed", batchId: "batch-1" });
  });

  test("처리 중인 요청은 내용이 달라도 새로 저장하지 않는다", async () => {
    const { client } = fakeBatchClient([batchRow({ status: "processing", manual_count: 0 })]);

    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY,
      contentHash: "hash-edited",
      scope: HQ_SCOPE,
    });

    assert.deepEqual(result, { kind: "processing" });
  });

  test("다른 사용자의 key는 내용이 같아도 재사용되지 않는다", async () => {
    const { client } = fakeBatchClient([batchRow({ requested_by: "other-user" })]);

    const result = await claimManualUploadBatch(client, {
      idempotencyKey: KEY,
      contentHash: "hash-original",
      scope: HQ_SCOPE,
    });

    assert.deepEqual(result, { kind: "rejected" });
  });
});

describe("HQ 공통 매뉴얼 화면의 공식 업로드 경로", () => {
  const commonPage = readSource("app/hq/manuals/common/page.tsx");
  const onboardingPage = readSource("app/hq/manuals/onboarding/page.tsx");
  const upload = readSource("components/manuals/HQManualUpload.tsx");

  test("파일 추가 버튼이 공통 미리보기 업로드를 연다", () => {
    assert.match(commonPage, /const goToManualUpload = \(\) => setShowUploadPanel\(true\)/);
    assert.match(commonPage, /onClick=\{goToManualUpload\}/);
    assert.match(commonPage, /<HQManualUpload/);
    assert.match(onboardingPage, /<HQManualUpload/);
  });

  test("공통 화면이 더 이상 구식 즉시 저장 API를 직접 호출하지 않는다", () => {
    assert.equal(commonPage.includes("/api/manuals/upload"), false);
    assert.equal(commonPage.includes("handleFileSelected"), false);
  });

  test("공통 화면에 업로드용 파일 입력과 상태가 남아 있지 않다", () => {
    assert.equal(/type="file"/.test(commonPage), false);
    assert.equal(commonPage.includes("setIsUploading"), false);
    assert.equal(commonPage.includes("setUploadError"), false);
  });

  test("HQ 매뉴얼 허브도 같은 미리보기 경로를 쓴다", () => {
    assert.match(readSource("app/hq/manuals/page.tsx"), /\/hq\/manuals\/onboarding\?from=manuals/);
  });

  test("공통 업로드는 파일 선택과 내용 확인 후 저장 성공을 호출부에 전달한다", () => {
    assert.match(upload, /<ManualFileDropzone/);
    assert.match(upload, /setPreview\(data\.preview\)/);
    assert.match(upload, /if \(preview\) return/);
    assert.match(upload, /<ManualUploadReviewModal/);
    assert.ok(upload.indexOf("onSaved(data)") > upload.indexOf("!Array.isArray(data?.manuals)"));
    assert.match(onboardingPage, /manualSaveMessage\(data\)/);
  });

  test("저장 진행 상태를 aria-live로 알리고 오류는 role=alert로 알린다", () => {
    const reviewModal = readSource("components/manuals/ManualUploadReviewModal.tsx");
    assert.match(upload, /<ManualUploadReviewModal/);
    assert.match(upload, /isSaving=\{isSaving\}/);
    assert.match(upload, /error=\{error\}/);
    assert.match(reviewModal, /role="status" aria-live="polite"/);
    assert.match(reviewModal, /role="alert"/);
  });

  test("확인이 필요한 이동은 window.confirm이 아니라 기존 확인 UI를 쓴다", () => {
    assert.equal(upload.includes("window.confirm"), false);
    assert.match(upload, /if \(preview\) setPendingLeave\(true\)/);
    assert.match(upload, /role="alertdialog"/);
    assert.match(upload, /if \(pending\.current\) return;/);
  });

  test("저장 요청 본문에 범위 값을 넣지 않는다", () => {
    assert.match(upload, /body: JSON\.stringify\(\{ manuals, idempotencyKey \}\)/);
    for (const forbidden of ["franchiseId:", "brandName:", "scopeType:", "storeId:"]) {
      assert.equal(upload.includes(forbidden), false, `sends ${forbidden}`);
    }
  });

  test("사용자 화면 문구에 기술 용어를 노출하지 않는다", () => {
    for (const source of [commonPage, onboardingPage, upload]) {
      const koreanLiterals = (source.match(/["'`][^"'`\n]*[가-힣][^"'`\n]*["'`]/g) ?? []).join(" ");
      for (const term of ["hash", "batch", "uuid", "embedding", "chunk", "idempotency"]) {
        assert.equal(koreanLiterals.toLowerCase().includes(term), false, `shows ${term}`);
      }
    }
  });
});

describe("legacy /api/manuals/upload 호환 유지", () => {
  const legacy = readSource("app/api/manuals/upload/route.ts");

  test("라우트는 삭제하지 않고 그대로 남아 있다", () => {
    assert.match(legacy, /export async function POST\(/);
  });

  test("중복 방지 guard가 그대로 유지된다", () => {
    assert.match(legacy, /saveManualGroupsWithBatchGuard\(supabase, \{/);
    assert.match(legacy, /result\.kind === "blocked"/);
  });

  test("HQ 인증과 공유 파서를 그대로 쓴다", () => {
    assert.match(legacy, /requireHqUser\(\)/);
    assert.match(legacy, /extractManualGroups\(file, extension\)/);
  });

  test("deprecated 상태와 제거 조건이 주석으로 남아 있다", () => {
    assert.match(legacy, /Deprecated/i);
    assert.match(legacy, /\/api\/manuals\/preview/);
  });

  test("앱 안에서 이 경로를 호출하는 화면이 없다", () => {
    for (const relative of [
      "app/hq/manuals/common/page.tsx",
      "app/hq/manuals/page.tsx",
      "app/hq/manuals/onboarding/page.tsx",
      "app/boss/store-manuals/page.tsx",
    ]) {
      assert.equal(readSource(relative).includes('"/api/manuals/upload"'), false, `${relative} still calls it`);
    }
  });
});
