import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MAX_UPLOAD_FILE_SIZE_BYTES,
  MAX_XLSX_ROWS_PER_SHEET,
  MAX_XLSX_SHEET_COUNT,
  isFileSizeWithinLimit,
  isPlausibleXlsxMimeType,
  isRowCountWithinLimit,
  isSheetCountWithinLimit,
} from "../../lib/manuals/upload-limits.ts";

describe("isFileSizeWithinLimit", () => {
  test("allows a normal PoC-sized manual file", () => {
    assert.equal(isFileSizeWithinLimit(50 * 1024), true);
  });

  test("allows exactly the maximum size", () => {
    assert.equal(isFileSizeWithinLimit(MAX_UPLOAD_FILE_SIZE_BYTES), true);
  });

  test("rejects a file larger than the maximum size", () => {
    assert.equal(isFileSizeWithinLimit(MAX_UPLOAD_FILE_SIZE_BYTES + 1), false);
  });

  test("rejects non-finite or negative sizes", () => {
    assert.equal(isFileSizeWithinLimit(Number.NaN), false);
    assert.equal(isFileSizeWithinLimit(-1), false);
  });
});

describe("isPlausibleXlsxMimeType", () => {
  test("accepts known xlsx/xls MIME types and common generic browser values", () => {
    assert.equal(
      isPlausibleXlsxMimeType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      true,
    );
    assert.equal(isPlausibleXlsxMimeType("application/vnd.ms-excel"), true);
    assert.equal(isPlausibleXlsxMimeType("application/octet-stream"), true);
    assert.equal(isPlausibleXlsxMimeType(""), true);
  });

  test("rejects an obviously mismatched MIME type (extension renamed from another file type)", () => {
    assert.equal(isPlausibleXlsxMimeType("image/png"), false);
    assert.equal(isPlausibleXlsxMimeType("text/html"), false);
  });
});

describe("isSheetCountWithinLimit", () => {
  test("allows a normal sheet count and the exact limit", () => {
    assert.equal(isSheetCountWithinLimit(1), true);
    assert.equal(isSheetCountWithinLimit(MAX_XLSX_SHEET_COUNT), true);
  });

  test("rejects a sheet count over the limit", () => {
    assert.equal(isSheetCountWithinLimit(MAX_XLSX_SHEET_COUNT + 1), false);
  });
});

describe("isRowCountWithinLimit", () => {
  test("allows a normal row count and the exact limit", () => {
    assert.equal(isRowCountWithinLimit(10), true);
    assert.equal(isRowCountWithinLimit(MAX_XLSX_ROWS_PER_SHEET), true);
  });

  test("rejects a row count over the limit", () => {
    assert.equal(isRowCountWithinLimit(MAX_XLSX_ROWS_PER_SHEET + 1), false);
  });
});
