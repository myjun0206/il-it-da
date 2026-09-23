import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { validateManualBatch } from "../../../lib/rag/manual-indexing/validate.ts";
import type { NormalizedManualInput } from "../../../lib/rag/manual-indexing/types.ts";

function baseInput(overrides: Partial<NormalizedManualInput> = {}): NormalizedManualInput {
  return {
    externalId: "ext-1",
    title: "오픈 체크리스트",
    category: "오픈/마감",
    content: "매장 오픈 전 점검 항목을 확인합니다.",
    scopeType: "hq",
    status: "approved",
    ...overrides,
  };
}

describe("validateManualBatch", () => {
  test("accepts a normal HQ manual", () => {
    const { items, issues } = validateManualBatch([baseInput()]);
    assert.deepEqual(issues, []);
    assert.equal(items.length, 1);
    assert.equal(items[0].storeId, null);
  });

  test("accepts a normal store manual with a storeId", () => {
    const { items, issues } = validateManualBatch([
      baseInput({ externalId: "ext-2", scopeType: "store", storeId: "store-1" }),
    ]);
    assert.deepEqual(issues, []);
    assert.equal(items[0].storeId, "store-1");
  });

  test("rejects a store manual with no storeId", () => {
    const { items, issues } = validateManualBatch([baseInput({ scopeType: "store", storeId: undefined })]);
    assert.equal(items.length, 0);
    assert.deepEqual(issues, [{ stage: "validate", externalId: "ext-1", code: "STORE_ID_REQUIRED_FOR_STORE_SCOPE" }]);
  });

  test("normalizes storeId to null for hq scope even if upstream sent one", () => {
    const { items } = validateManualBatch([baseInput({ scopeType: "hq", storeId: "leftover-store-id" })]);
    assert.equal(items[0].storeId, null);
  });

  test("rejects an invalid scopeType", () => {
    const { issues } = validateManualBatch([baseInput({ scopeType: "region" as never })]);
    assert.equal(issues[0].code, "INVALID_SCOPE_TYPE");
  });

  test("rejects an invalid status", () => {
    const { issues } = validateManualBatch([baseInput({ status: "published" as never })]);
    assert.equal(issues[0].code, "INVALID_STATUS");
  });

  test("rejects an empty title", () => {
    const { issues } = validateManualBatch([baseInput({ title: "   " })]);
    assert.equal(issues[0].code, "TITLE_REQUIRED");
  });

  test("rejects empty content", () => {
    const { issues } = validateManualBatch([baseInput({ content: "" })]);
    assert.equal(issues[0].code, "CONTENT_REQUIRED");
  });

  test("rejects every occurrence of a duplicate externalId within the same batch", () => {
    const { items, issues } = validateManualBatch([
      baseInput({ externalId: "dup" }),
      baseInput({ externalId: "dup", title: "다른 제목" }),
    ]);
    assert.equal(items.length, 0);
    assert.equal(issues.length, 2);
    assert.ok(issues.every((issue) => issue.code === "DUPLICATE_EXTERNAL_ID"));
  });

  test("preserves category exactly as received", () => {
    const { items } = validateManualBatch([baseInput({ category: "본사 공지 > 긴급" })]);
    assert.equal(items[0].category, "본사 공지 > 긴급");
  });

  test("resolves a valid parent/child relationship and keeps both items", () => {
    const { items, issues } = validateManualBatch([
      baseInput({ externalId: "parent-1" }),
      baseInput({ externalId: "child-1", parentExternalId: "parent-1" }),
    ]);
    assert.deepEqual(issues, []);
    assert.equal(items.length, 2);
  });

  test("rejects a self-referencing parentExternalId", () => {
    const { issues } = validateManualBatch([baseInput({ externalId: "a", parentExternalId: "a" })]);
    assert.equal(issues[0].code, "PARENT_REFERENCE_SELF");
  });

  test("rejects a parentExternalId that does not exist in the batch", () => {
    const { issues } = validateManualBatch([baseInput({ parentExternalId: "missing-parent" })]);
    assert.equal(issues[0].code, "PARENT_REFERENCE_NOT_FOUND");
  });

  test("rejects more than one level of parent/child nesting", () => {
    const { issues } = validateManualBatch([
      baseInput({ externalId: "grandparent" }),
      baseInput({ externalId: "parent", parentExternalId: "grandparent" }),
      baseInput({ externalId: "child", parentExternalId: "parent" }),
    ]);
    assert.ok(issues.some((issue) => issue.code === "PARENT_MUST_BE_ROOT"));
  });

  test("rejects a malformed existingManualId", () => {
    const { issues } = validateManualBatch([baseInput({ existingManualId: "not-a-uuid" })]);
    assert.equal(issues[0].code, "INVALID_EXISTING_MANUAL_ID");
  });

  test("accepts a well-formed existingManualId", () => {
    const { items, issues } = validateManualBatch([
      baseInput({ existingManualId: "11111111-1111-1111-8111-111111111111" }),
    ]);
    assert.deepEqual(issues, []);
    assert.equal(items[0].existingManualId, "11111111-1111-1111-8111-111111111111");
  });

  test("requires a non-empty externalId", () => {
    const { issues } = validateManualBatch([baseInput({ externalId: "" })]);
    assert.equal(issues[0].code, "EXTERNAL_ID_REQUIRED");
  });
});
