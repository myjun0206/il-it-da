import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildManualReadinessReport,
  MANUAL_READINESS_LABELS,
  resolveManualReadinessStatus,
  type ReadinessChunkInput,
  type ReadinessManualInput,
} from "../../lib/manuals/manual-search-readiness.ts";
import {
  checkManualReindexAllowed,
  REINDEX_REJECTION_MESSAGES,
  type ReindexManualRow,
} from "../../lib/manuals/manual-reindex-guard.ts";

function parent(id: string, title = "오픈 운영"): ReadinessManualInput {
  return { id, title, category: "오픈 및 마감", parent_manual_id: null, status: "approved" };
}

function child(id: string, parentId: string, status = "approved"): ReadinessManualInput {
  return { id, title: `${id} 항목`, category: "오픈 및 마감", parent_manual_id: parentId, status };
}

function standalone(id: string, status = "approved"): ReadinessManualInput {
  return { id, title: `${id} 단독 매뉴얼`, category: "기타", parent_manual_id: null, status };
}

function chunk(manualId: string, hasEmbedding: boolean): ReadinessChunkInput {
  return { manual_id: manualId, has_embedding: hasEmbedding };
}

describe("resolveManualReadinessStatus (실제 함수 실행)", () => {
  test("승인된 자식 + 모든 chunk에 embedding 있음 -> ready", () => {
    const status = resolveManualReadinessStatus(child("c1", "p1"), [chunk("c1", true), chunk("c1", true)], false);
    assert.equal(status, "ready");
    assert.equal(MANUAL_READINESS_LABELS[status], "검색 준비 완료");
  });

  test("승인된 자식 + chunk 없음 -> needs_reindex", () => {
    const status = resolveManualReadinessStatus(child("c1", "p1"), [], false);
    assert.equal(status, "needs_reindex");
    assert.equal(MANUAL_READINESS_LABELS[status], "검색 준비 필요");
  });

  test("embedding이 null인 chunk가 하나라도 있으면 -> needs_reindex", () => {
    const status = resolveManualReadinessStatus(child("c1", "p1"), [chunk("c1", true), chunk("c1", false)], false);
    assert.equal(status, "needs_reindex");
  });

  test("draft 자식은 chunk/embedding과 무관하게 -> not_searchable", () => {
    const status = resolveManualReadinessStatus(child("c1", "p1", "draft"), [chunk("c1", true)], false);
    assert.equal(status, "not_searchable");
    assert.equal(MANUAL_READINESS_LABELS[status], "검색 대상 아님");
  });

  test("실제 자식을 거느린 주제 카드는 -> parent_only", () => {
    const status = resolveManualReadinessStatus(parent("p1"), [], true);
    assert.equal(status, "parent_only");
    assert.equal(MANUAL_READINESS_LABELS[status], "상위 항목");
  });

  test("parent_manual_id가 null이어도 자식이 없으면 단독 검색 매뉴얼로 판정한다", () => {
    assert.equal(resolveManualReadinessStatus(standalone("s1"), [chunk("s1", true)], false), "ready");
    assert.equal(resolveManualReadinessStatus(standalone("s1"), [], false), "needs_reindex");
    assert.equal(resolveManualReadinessStatus(standalone("s1"), [chunk("s1", false)], false), "needs_reindex");
    assert.equal(resolveManualReadinessStatus(standalone("s1", "draft"), [chunk("s1", true)], false), "not_searchable");
  });
});

describe("buildManualReadinessReport (실제 함수 실행)", () => {
  const manuals = [
    parent("p1", "오픈 운영"),
    child("ready-1", "p1"),
    child("no-chunk", "p1"),
    child("null-embedding", "p1"),
    child("draft-1", "p1", "draft"),
  ];
  const chunks = [chunk("ready-1", true), chunk("null-embedding", true), chunk("null-embedding", false)];

  test("집계는 세부 매뉴얼만 세고 부모 카드는 어떤 수치에도 포함하지 않는다", () => {
    const report = buildManualReadinessReport(manuals, chunks);
    assert.deepEqual(report.summary, {
      totalDetailManualCount: 4,
      readyCount: 1,
      needsReindexCount: 2,
      notSearchableCount: 1,
    });
  });

  test("실제 자식을 거느린 부모 카드는 그룹 헤더가 되고 오류(재처리 필요) 수에 잡히지 않는다", () => {
    const report = buildManualReadinessReport(
      [parent("p1"), child("c1", "p1"), child("c2", "p1")],
      [chunk("c1", true), chunk("c2", true)],
    );
    assert.equal(report.groups.length, 1);
    assert.equal(report.summary.totalDetailManualCount, 2);
    assert.equal(report.summary.needsReindexCount, 0);
    assert.equal(report.groups[0].manuals.some((m) => m.manualId === "p1"), false);
  });

  test("parent_manual_id가 null이고 자식도 없으면 집계에 포함되는 검색 매뉴얼로 잡힌다", () => {
    const report = buildManualReadinessReport(
      [standalone("s-ready"), standalone("s-empty"), standalone("s-null"), standalone("s-draft", "draft")],
      [chunk("s-ready", true), chunk("s-null", false)],
    );
    assert.deepEqual(report.summary, {
      totalDetailManualCount: 4,
      readyCount: 1,
      needsReindexCount: 2,
      notSearchableCount: 1,
    });
    const byId = new Map(report.groups.flatMap((g) => g.manuals).map((m) => [m.manualId, m]));
    assert.equal(byId.get("s-ready")?.status, "ready");
    assert.equal(byId.get("s-empty")?.canReindex, true);
    assert.equal(byId.get("s-null")?.canReindex, true);
    assert.equal(byId.get("s-draft")?.canReindex, false);
  });

  test("재처리 버튼은 needs_reindex 항목에만 허용된다", () => {
    const report = buildManualReadinessReport(manuals, chunks);
    const byId = new Map(report.groups[0].manuals.map((m) => [m.manualId, m]));
    assert.equal(byId.get("ready-1")?.canReindex, false);
    assert.equal(byId.get("no-chunk")?.canReindex, true);
    assert.equal(byId.get("null-embedding")?.canReindex, true);
    assert.equal(byId.get("draft-1")?.canReindex, false);
  });

  test("그룹별 집계가 전체 집계와 일치한다", () => {
    const report = buildManualReadinessReport(manuals, chunks);
    assert.deepEqual(report.groups[0].summary, report.summary);
  });

  test("응답 항목에는 본문과 embedding 값이 들어가지 않는다", () => {
    const report = buildManualReadinessReport(manuals, chunks);
    const keys = Object.keys(report.groups[0].manuals[0]).sort();
    assert.deepEqual(keys, ["canReindex", "manualId", "status", "statusLabel", "title"]);
  });

  test("다른 매뉴얼의 chunk가 상태 판정에 섞이지 않는다", () => {
    const report = buildManualReadinessReport([parent("p1"), child("c1", "p1")], [chunk("other", true)]);
    assert.equal(report.groups[0].manuals[0].status, "needs_reindex");
  });
});

describe("checkManualReindexAllowed (실제 함수 실행)", () => {
  function row(overrides: Partial<ReindexManualRow> = {}): ReindexManualRow {
    return {
      id: "m1",
      status: "approved",
      franchise_id: "franchise-1",
      store_id: null,
      ...overrides,
    };
  }

  test("HQ: 같은 franchise의 승인된 공통 자식 매뉴얼은 허용된다", () => {
    const decision = checkManualReindexAllowed(row(), { kind: "hq", franchiseId: "franchise-1" }, false);
    assert.deepEqual(decision, { allowed: true });
  });

  test("HQ: 다른 franchise 매뉴얼은 거부된다", () => {
    const decision = checkManualReindexAllowed(
      row({ franchise_id: "franchise-2" }),
      { kind: "hq", franchiseId: "franchise-1" },
      false,
    );
    assert.deepEqual(decision, { allowed: false, reason: "out_of_scope" });
  });

  test("HQ: store 전용 매뉴얼은 공통 범위가 아니므로 거부된다", () => {
    const decision = checkManualReindexAllowed(
      row({ store_id: "store-1" }),
      { kind: "hq", franchiseId: "franchise-1" },
      false,
    );
    assert.deepEqual(decision, { allowed: false, reason: "out_of_scope" });
  });

  test("HQ: franchiseId를 알 수 없는 레거시 계정은 fail-closed 된다", () => {
    const decision = checkManualReindexAllowed(row({ franchise_id: null }), { kind: "hq", franchiseId: null }, false);
    assert.deepEqual(decision, { allowed: false, reason: "out_of_scope" });
  });

  test("점주: 자기 지점의 승인된 자식 매뉴얼만 허용된다", () => {
    const mine = checkManualReindexAllowed(row({ store_id: "store-1" }), { kind: "store", storeId: "store-1" }, false);
    const other = checkManualReindexAllowed(row({ store_id: "store-2" }), { kind: "store", storeId: "store-1" }, false);
    assert.deepEqual(mine, { allowed: true });
    assert.deepEqual(other, { allowed: false, reason: "out_of_scope" });
  });

  test("점주: 공통(HQ) 매뉴얼은 지점 범위가 아니므로 거부된다", () => {
    const decision = checkManualReindexAllowed(row({ store_id: null }), { kind: "store", storeId: "store-1" }, false);
    assert.deepEqual(decision, { allowed: false, reason: "out_of_scope" });
  });

  test("실제 자식을 거느린 부모 카드는 범위가 맞아도 거부된다", () => {
    const decision = checkManualReindexAllowed(row(), { kind: "hq", franchiseId: "franchise-1" }, true);
    assert.deepEqual(decision, { allowed: false, reason: "parent_card" });
  });

  test("자식이 없는 단독 승인 매뉴얼은 범위가 맞으면 HQ·점주 모두 재처리가 허용된다", () => {
    const hq = checkManualReindexAllowed(row(), { kind: "hq", franchiseId: "franchise-1" }, false);
    const store = checkManualReindexAllowed(
      row({ store_id: "store-1" }),
      { kind: "store", storeId: "store-1" },
      false,
    );
    assert.deepEqual(hq, { allowed: true });
    assert.deepEqual(store, { allowed: true });
  });

  test("draft 매뉴얼은 거부된다", () => {
    const decision = checkManualReindexAllowed(
      row({ status: "draft" }),
      { kind: "hq", franchiseId: "franchise-1" },
      false,
    );
    assert.deepEqual(decision, { allowed: false, reason: "not_approved" });
  });

  test("존재하지 않는 매뉴얼은 not_found로 거부된다", () => {
    assert.deepEqual(checkManualReindexAllowed(null, { kind: "hq", franchiseId: "f1" }, false), {
      allowed: false,
      reason: "not_found",
    });
  });

  test("거절 문구는 고정된 한국어이며 기술 용어/원본 오류를 담지 않는다", () => {
    const banned = ["embedding", "vector", "chunk", "index", "supabase", "openai", "sql"];
    for (const message of Object.values(REINDEX_REJECTION_MESSAGES)) {
      assert.match(message, /[가-힣]/);
      for (const term of banned) {
        assert.equal(message.toLowerCase().includes(term), false, `${message} contains ${term}`);
      }
    }
  });
});
