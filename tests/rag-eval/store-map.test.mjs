import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  createStoreMap,
  loadStoreMap,
  resolveTargetStores,
  validateStoreMap,
} from "../../scripts/rag-eval/store-map.mjs";

const ISU_ID = "57181130-4449-4299-a864-25a2098147e4";
const SOONGSIL_ID = "f9bc865b-5722-40b3-8548-1c181f5ad7fb";

const VALID_STORE_MAP = [
  { name: "이수점", id: ISU_ID },
  { name: "숭실대점", id: SOONGSIL_ID },
];

describe("validateStoreMap", () => {
  test("accepts a valid store map", () => {
    const result = validateStoreMap(VALID_STORE_MAP);

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.equal(result.data.length, 2);
  });

  test("rejects a non-array top-level value", () => {
    const result = validateStoreMap({ not: "an array" });

    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, [
      { index: null, name: null, field: "root", code: "TOP_LEVEL_NOT_ARRAY" },
    ]);
  });

  test("rejects an empty name", () => {
    const result = validateStoreMap([{ name: "   ", id: ISU_ID }]);

    assert.ok(
      result.errors.some((error) => error.field === "name" && error.code === "REQUIRED_FIELD_MISSING"),
    );
  });

  test("rejects an invalid UUID", () => {
    const result = validateStoreMap([{ name: "이수점", id: "not-a-uuid" }]);

    assert.ok(result.errors.some((error) => error.field === "id" && error.code === "INVALID_UUID"));
  });

  test("rejects a duplicate name", () => {
    const result = validateStoreMap([
      { name: "이수점", id: ISU_ID },
      { name: "이수점", id: SOONGSIL_ID },
    ]);

    assert.ok(
      result.errors.some((error) => error.index === 1 && error.field === "name" && error.code === "DUPLICATE_NAME"),
    );
  });

  test("rejects a duplicate id", () => {
    const result = validateStoreMap([
      { name: "이수점", id: ISU_ID },
      { name: "숭실대점", id: ISU_ID },
    ]);

    assert.ok(
      result.errors.some((error) => error.index === 1 && error.field === "id" && error.code === "DUPLICATE_ID"),
    );
  });

  test("does not include the actual UUID value in error objects", () => {
    const result = validateStoreMap([{ name: "이수점", id: "not-a-uuid" }]);

    for (const error of result.errors) {
      assert.deepEqual(Object.keys(error).sort(), ["code", "field", "index", "name"]);
      assert.equal(JSON.stringify(error).includes(ISU_ID), false);
    }
  });
});

describe("resolveTargetStores", () => {
  const storeMap = createStoreMap(VALID_STORE_MAP);

  test("returns every registered store for 'all'", () => {
    const resolved = resolveTargetStores("all", storeMap);

    assert.deepEqual(
      resolved.sort((a, b) => a.name.localeCompare(b.name)),
      [
        { name: "숭실대점", id: SOONGSIL_ID },
        { name: "이수점", id: ISU_ID },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );
  });

  test("resolves a specific store name to exactly that store", () => {
    const resolved = resolveTargetStores("이수점", storeMap);

    assert.deepEqual(resolved, [{ name: "이수점", id: ISU_ID }]);
  });

  test("throws for an unregistered store name", () => {
    assert.throws(() => resolveTargetStores("부산점", storeMap), (error) => {
      assert.equal(error.code, "UNKNOWN_TARGET_STORE");
      return true;
    });
  });
});

describe("loadStoreMap", () => {
  let tempDir;

  before(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "rag-eval-store-map-"));
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("loads and validates a plain UTF-8 JSON file", () => {
    const filePath = path.join(tempDir, "valid.json");
    writeFileSync(filePath, JSON.stringify(VALID_STORE_MAP), "utf8");

    const result = loadStoreMap(filePath);

    assert.equal(result.valid, true);
    assert.equal(result.data.length, 2);
  });

  test("strips a UTF-8 BOM before parsing", () => {
    const filePath = path.join(tempDir, "bom.json");
    writeFileSync(filePath, `\uFEFF${JSON.stringify(VALID_STORE_MAP)}`, "utf8");

    const result = loadStoreMap(filePath);

    assert.equal(result.valid, true);
  });

  test("throws a distinct error for invalid JSON syntax", () => {
    const filePath = path.join(tempDir, "invalid.json");
    writeFileSync(filePath, "{ not valid json", "utf8");

    assert.throws(() => loadStoreMap(filePath), (error) => {
      assert.equal(error.code, "STORE_MAP_JSON_SYNTAX_ERROR");
      return true;
    });
  });
});
