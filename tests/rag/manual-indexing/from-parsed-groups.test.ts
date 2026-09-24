import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { fromParsedManualGroup } from "../../../lib/rag/manual-indexing/from-parsed-groups.ts";
import { validateManualBatch } from "../../../lib/rag/manual-indexing/validate.ts";

describe("fromParsedManualGroup (parser output -> NormalizedManualInput adapter)", () => {
  test("converts a parsed topic+items group into a valid parent + child batch", () => {
    const items = fromParsedManualGroup(
      { topic: "오픈 체크리스트", items: [{ title: "", content: "문 열기" }, { title: "환기", content: "창문 열기" }] },
      { scopeType: "hq" },
      "upload-1",
    );

    assert.equal(items.length, 3);
    const [parent, child1, child2] = items;
    assert.equal(parent.parentExternalId, undefined);
    assert.equal(child1.parentExternalId, parent.externalId);
    assert.equal(child2.parentExternalId, parent.externalId);
    assert.equal(child1.title, "오픈 체크리스트"); // falls back to topic when item has no title
    assert.equal(child2.title, "환기");

    const { items: validated, issues } = validateManualBatch(items);
    assert.deepEqual(issues, []);
    assert.equal(validated.length, 3);
  });

  test("preserves category (topic) exactly, never re-classifying it", () => {
    const [parent, child] = fromParsedManualGroup(
      { topic: "본사 공지 > 긴급", items: [{ title: "", content: "내용" }] },
      { scopeType: "hq" },
      "upload-2",
    );
    assert.equal(parent.category, "본사 공지 > 긴급");
    assert.equal(child.category, "본사 공지 > 긴급");
  });

  test("hq scope: storeId is always normalized to null, even if context carries a stale one", () => {
    const [parent] = fromParsedManualGroup(
      { topic: "공통 매뉴얼", items: [] },
      { scopeType: "hq", storeId: "leftover-store-id" },
      "upload-3",
    );
    assert.equal(parent.storeId, null);
  });

  test("store scope: storeId from the authenticated context is carried through to every item", () => {
    const items = fromParsedManualGroup(
      { topic: "매장 매뉴얼", items: [{ title: "", content: "내용" }] },
      { scopeType: "store", storeId: "store-42" },
      "upload-4",
    );
    assert.ok(items.every((item) => item.storeId === "store-42"));
  });

  test("uses only the authenticated franchise/brand context, ignoring any would-be request-body values", () => {
    const authenticatedContext = { scopeType: "hq" as const, franchiseId: "franchise-real", brandName: "진짜 브랜드" };
    // This adapter's signature has no body/user-supplied franchiseId parameter at all,
    // so there is no way for a spoofed body value to reach the output.
    const [parent] = fromParsedManualGroup({ topic: "t", items: [] }, authenticatedContext, "upload-5");

    assert.equal(parent.franchiseId, "franchise-real");
    assert.equal(parent.brandName, "진짜 브랜드");
  });

  test("defaults to approved status unless the caller explicitly requests draft", () => {
    const [approvedParent] = fromParsedManualGroup({ topic: "t", items: [] }, { scopeType: "hq" }, "upload-6");
    assert.equal(approvedParent.status, "approved");

    const [draftParent] = fromParsedManualGroup(
      { topic: "t", items: [] },
      { scopeType: "hq", status: "draft" },
      "upload-7",
    );
    assert.equal(draftParent.status, "draft");
  });
});
