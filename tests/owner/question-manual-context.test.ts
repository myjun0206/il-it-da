import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildQuestionManualEditUrl, fetchOwnerQuestionManualContext } from "../../lib/owner/question-manual-context.ts";
import { buildManualSelectionGroups } from "../../lib/manuals/manual-selection.ts";
import type { ManualRecord } from "../../lib/types/manual.ts";

function fake(options: { denied?: boolean; otherLog?: boolean; storeId?: string | null; franchiseId?: string; status?: string; deleted?: boolean; sourceError?: boolean; logError?: boolean; noSource?: boolean } = {}) {
  const calls: { table: string; filters: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      calls.push({ table, filters });
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => { filters[field] = value; return query; },
        maybeSingle: async () => {
          if (table === "store_memberships") return { data: options.denied ? null : { id: "membership" }, error: null };
          if (table === "stores") return { data: { franchise_id: "brand" }, error: null };
          if (table === "franchises") return { data: { id: "brand", name: "브랜드" }, error: null };
          if (table === "question_logs") return { data: { id: "question", store_id: options.otherLog ? "other" : "store", answer: "당시 답변", source_manual_id: options.noSource ? null : "source" }, error: options.logError ? {} : null };
          if (table === "manuals") return { data: options.deleted ? null : { id: "source", title: "제목", content: "현재 본문", category: "운영", store_id: options.storeId === undefined ? "store" : options.storeId, franchise_id: options.franchiseId ?? "brand", status: options.status ?? "approved" }, error: options.sourceError ? {} : null };
          assert.fail(`unexpected table ${table}`);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}
const input = { userId: "owner", storeId: "store", questionId: "question" };

test("owner context returns existing answer and source only after store validation", async () => {
  const db = fake();
  const result = await fetchOwnerQuestionManualContext(db.client, input);
  assert.equal(result.status, 200);
  assert.equal(result.body.context?.answer, "당시 답변");
  assert.equal(result.body.context?.source?.editable, true);
  assert.deepEqual(db.calls.find((call) => call.table === "question_logs")?.filters, { id: "question", store_id: "store" });
  assert.deepEqual(db.calls.find((call) => call.table === "manuals")?.filters, { id: "source", franchise_id: "brand" });
});

test("HQ source is read-only; other stores, brands, drafts and deleted sources do not leak", async () => {
  const hq = await fetchOwnerQuestionManualContext(fake({ storeId: null }).client, input);
  assert.equal(hq.body.context?.source?.editable, false);
  for (const options of [{ storeId: "other" }, { franchiseId: "other" }, { storeId: null, status: "draft" }, { deleted: true }, { sourceError: true }]) {
    const result = await fetchOwnerQuestionManualContext(fake(options).client, input);
    assert.equal(result.body.context?.source, null);
    assert.equal(result.body.context?.sourceState, "unavailable");
    assert.equal(JSON.stringify(result.body).includes("현재 본문"), false);
  }
});

test("denied membership and cross-store logs cannot expose answers; read failures are not success", async () => {
  for (const [options, status] of [[{ denied: true }, 403], [{ otherLog: true }, 404], [{ logError: true }, 500]] as const) {
    const result = await fetchOwnerQuestionManualContext(fake(options).client, input);
    assert.equal(result.status, status);
    assert.equal(result.body.context, undefined);
  }
  const result = await fetchOwnerQuestionManualContext(fake({ noSource: true }).client, input);
  assert.equal(result.body.context?.sourceState, "none");
});

test("manual edit URL carries store and question without selecting a source automatically", () => {
  const url = new URL(buildQuestionManualEditUrl("store", "q&1", "manual"), "http://localhost");
  assert.equal(url.searchParams.get("questionId"), "q&1");
  assert.equal(url.searchParams.get("storeId"), "store");
  assert.equal(url.searchParams.get("manualId"), "manual");
  assert.equal(buildQuestionManualEditUrl("store", "question").includes("manualId"), false);
});

test("manual choices use original child headings, group parents and keep exact edit IDs", () => {
  const parent = { id: "parent", title: "청소 및 마감 운영", category: "운영", content: "2 items", store_id: "store", parent_manual_id: null } as ManualRecord;
  const first = { ...parent, id: "child-1", parent_manual_id: parent.id, content: "7-3. 튀김기 관리\n전원을 끄고 청소합니다." };
  const second = { ...first, id: "child-2", content: "7-4. 튀김기 관리\n온도를 확인합니다." };
  const rows = [parent, first, second, { ...first, id: "foreign", store_id: "other" }];
  const original = JSON.stringify(rows);
  const groups = buildManualSelectionGroups(rows, "store");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "운영 · 청소 및 마감 운영");
  assert.deepEqual(groups[0].options.map((option) => option.label), ["7-3. 튀김기 관리 · 청소 및 마감 운영", "7-4. 튀김기 관리 · 청소 및 마감 운영"]);
  for (const option of groups[0].options) {
    const url = new URL(buildQuestionManualEditUrl("store", "question", option.manual.id), "http://localhost");
    assert.equal(url.searchParams.get("manualId"), option.manual.id);
    assert.notEqual(option.manual.id, "parent");
  }
  assert.equal(JSON.stringify(rows), original);
});

test("unnumbered manuals retain titles and exact duplicate choices are distinguishable without invented numbers", () => {
  const manual = { id: "plain", title: "매장 안내", category: "운영", content: "본문 설명입니다.", store_id: "store", parent_manual_id: null } as ManualRecord;
  assert.equal(buildManualSelectionGroups([manual], "store")[0].options[0].title, "매장 안내");
  const duplicate = { ...manual, id: "second" };
  const choices = buildManualSelectionGroups([manual, duplicate], "store")[0].options;
  assert.equal(new Set(choices.map((option) => option.label)).size, 2);
  assert.deepEqual(choices.map((option) => option.title), ["매장 안내 · ID plain", "매장 안내 · ID second"]);
  const placeholder = { ...manual, id: "placeholder", content: "__STORE_MANUAL_CATEGORY_PLACEHOLDER__", status: "draft" as const };
  assert.deepEqual(buildManualSelectionGroups([placeholder], "store"), []);
  const missingParent = { ...manual, parent_manual_id: "missing" };
  assert.equal(buildManualSelectionGroups([missingParent], "store")[0].options[0].manual.id, "plain");
});

test("followup is explicit, uses the existing editor and never reruns RAG or resolves questions", () => {
  const ui = readFileSync(new URL("../../components/owner/QuestionManualFollowup.tsx", import.meta.url), "utf8");
  assert.match(ui, /useState\(""\)/);
  assert.match(ui, /수정할 매장 매뉴얼을 선택하세요/);
  assert.match(ui, /직원 재질문 안내/);
  assert.match(ui, /이 버튼은 재질문을 실행하지 않습니다/);
  assert.match(ui, /aria-expanded=\{showVerification\}/);
  assert.match(ui, /aria-expanded=\{showContext\}/);
  assert.match(ui, /이 근거 매뉴얼 선택/);
  assert.match(ui, /selectedManual\.id/);
  assert.match(ui, /본사 확인이 필요/);
  assert.match(ui, /답이 이미 매뉴얼에 있다면/);
  for (const forbidden of ["/api/rag/query", 'nextStatus: "resolved"', "preview/confirm", 'method: "POST"', 'method: "PATCH"']) assert.equal(ui.includes(forbidden), false);
  const editor = readFileSync(new URL("../../app/boss/store-manuals/page.tsx", import.meta.url), "utf8");
  assert.match(editor, /expectedUpdatedAt: item.updated_at/);
  assert.match(editor, /pickQuestionsStore/);
  assert.match(editor, /질문은 자동 완료되지 않습니다/);
  assert.match(editor, /buildBossQuestionDetailUrl/);
  assert.match(editor, /승인 상태:/);
  const detail = readFileSync(new URL("../../app/boss/questions/[id]/BossQuestionDetailView.tsx", import.meta.url), "utf8");
  assert.match(detail, /nextStatus === "resolved" && !window.confirm/);
  assert.match(detail, /직원 안내·개별 대응 결과/);
});