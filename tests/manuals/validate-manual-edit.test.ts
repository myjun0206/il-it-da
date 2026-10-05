import assert from "node:assert/strict";
import { test } from "node:test";
import { validateManualEdit } from "../../lib/manuals/validate-manual-edit.ts";

test("manual edit preserves multiline text and partial updates", () => {
  assert.deepEqual(validateManualEdit({ content: "  첫 행\n둘째 행  " }), {
    valid: true, update: { content: "첫 행\n둘째 행" },
  });
  assert.deepEqual(validateManualEdit({ title: "제목", category: "운영", content: "본문" }), {
    valid: true, update: { title: "제목", category: "운영", content: "본문" },
  });
});

test("manual edit rejects empty, malformed and absent input with a field reason", () => {
  for (const field of ["title", "category", "content"] as const) {
    for (const value of ["", " \n ", null, 42, [], {}]) {
      const result = validateManualEdit({ [field]: value });
      assert.equal(result.valid, false);
      if (!result.valid) assert.match(result.error, /제목|카테고리|본문/);
    }
  }
  assert.equal(validateManualEdit({}).valid, false);
});

test("manual edit preserves the edit contract and rejects content that the existing chunker cannot split", () => {
  assert.equal(validateManualEdit({ title: "가".repeat(201), category: "가".repeat(101) }).valid, true);
  assert.equal(validateManualEdit({ content: "가".repeat(20_001) }).valid, true);
  assert.equal(validateManualEdit({ content: "가".repeat(50_000) }).valid, true);
  const result = validateManualEdit({ content: "가".repeat(50_001) });
  assert.equal(result.valid, false);
  if (!result.valid) assert.match(result.error, /50,000/);
  for (const value of [null, [], "text"]) assert.equal(validateManualEdit(value as never).valid, false);
});