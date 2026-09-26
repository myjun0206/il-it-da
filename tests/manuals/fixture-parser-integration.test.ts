import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { parse as parseCsv } from "csv-parse/sync";

import { parseExcelTableGroups } from "../../lib/manuals/parse-excel-table.ts";
import { parseManualText } from "../../lib/manuals/analyze-manual-with-ai.ts";

// This suite wires tests/fixtures/manual-formats/* to the REAL production parsers (not string
// comparisons, not a duplicated parser) - see docs/manual-file-format-contract.md sections 2/5.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturesDir = path.join(repoRoot, "tests/fixtures/manual-formats");

function readFixtureText(name: string): string {
  return readFileSync(path.join(fixturesDir, name), "utf8");
}

function readExpected(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), "utf8"));
}

function parseCsvGroups(name: string) {
  const rows = parseCsv(readFixtureText(name), { relax_column_count: true }) as string[][];
  return parseExcelTableGroups(rows);
}

describe("real parser <-> fixture wiring (standard.*)", () => {
  const expectedStandard = readExpected("expected-standard.json");

  test("standard.csv parses (via the real parseExcelTableGroups) to exactly expected-standard.json", () => {
    assert.deepEqual(parseCsvGroups("standard.csv"), expectedStandard);
  });

  test("standard.txt parses (via the real parseManualText) to exactly expected-standard.json", () => {
    assert.deepEqual(parseManualText(readFixtureText("standard.txt")), expectedStandard);
  });

  test("standard.md parses (via the real parseManualText) to exactly expected-standard.json", () => {
    assert.deepEqual(parseManualText(readFixtureText("standard.md")), expectedStandard);
  });
});

describe("real parser <-> fixture wiring (variant.*)", () => {
  const expectedVariant = readExpected("expected-variant.json");
  const expectedStandard = readExpected("expected-standard.json");

  test("expected-variant.json is exactly expected-standard.json (same manual, only representation differs)", () => {
    assert.deepEqual(expectedVariant, expectedStandard);
  });

  test("variant.csv parses (via the real parseExcelTableGroups) to exactly expected-variant.json", () => {
    assert.deepEqual(parseCsvGroups("variant.csv"), expectedVariant);
  });

  test("variant.txt parses (via the real parseManualText) to exactly expected-variant.json", () => {
    assert.deepEqual(parseManualText(readFixtureText("variant.txt")), expectedVariant);
  });

  test("variant.md parses (via the real parseManualText) to exactly expected-variant.json", () => {
    assert.deepEqual(parseManualText(readFixtureText("variant.md")), expectedVariant);
  });
});

describe("rule preservation (executed against the real parsers, not source text)", () => {
  test("blank rows are removed and an exact duplicate CSV row does not create a duplicate manual", () => {
    const rows = [
      ["category", "title", "content"],
      ["카테고리A", "제목1", "1. 내용1"],
      ["", "", ""],
      ["카테고리A", "제목1", "1. 내용1"],
    ];
    const groups = parseExcelTableGroups(rows);
    assert.equal(groups?.length, 1);
  });

  test("a category present only on the first row of a merged-cell block is forward-filled", () => {
    const rows = [
      ["category", "title", "content"],
      ["카테고리A", "제목1", "1. 내용1"],
      ["", "제목2", "1. 내용2"],
    ];
    const groups = parseExcelTableGroups(rows);
    assert.equal(groups?.[1]?.category, "카테고리A");
  });

  test("a numeric cell value (real JS number, as xlsx produces) is preserved as a string", () => {
    const rows = [
      ["category", "title", "content"],
      ["카테고리A", 10 as unknown as string, "1. 내용1"],
    ];
    const groups = parseExcelTableGroups(rows);
    assert.equal(groups?.[0]?.topic, "10");
  });

  test("CRLF and LF inputs normalize to the same items with no Korean content loss", () => {
    const build = (nl: string) =>
      ["[카테고리]", "1. 제목1", "1-1. 내용 한글 확인", "2. 제목2", "내용2"].join(nl);
    const crlf = parseManualText(build("\r\n"));
    const lf = parseManualText(build("\n"));
    assert.deepEqual(crlf, lf);
    assert.deepEqual(crlf[0].items, ["1-1. 내용 한글 확인"]);
  });

  test("leading/trailing whitespace around category/title is trimmed", () => {
    const groups = parseManualText(
      [
        "[  카테고리  ]",
        "1.  제목1  ",
        "내용1",
        "2. 제목2",
        "내용2",
        "[다른 카테고리]",
        "1. 다른 제목",
        "다른 내용",
      ].join("\n"),
    );
    assert.equal(groups[0].category, "카테고리");
    assert.equal(groups[0].topic, "제목1");
  });

  test("a blank-line-separated paragraph with no numbering splits into separate items", () => {
    const groups = parseManualText(
      ["[카테고리]", "1. 제목1", "첫 문단.", "", "둘째 문단.", "2. 제목2", "내용2"].join("\n"),
    );
    assert.deepEqual(groups[0].items, ["첫 문단.", "둘째 문단."]);
  });

  test("unparseable input (all whitespace) returns an empty result instead of guessing content", () => {
    assert.deepEqual(parseManualText("   \n\t\n   "), []);
    assert.equal(
      parseExcelTableGroups([
        ["category", "title", "content"],
        ["   ", "   ", "   "],
      ]),
      null,
    );
  });
});
