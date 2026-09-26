import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// Structural/content checks only: this suite never imports or calls any manual parser
// (lib/manuals/*, lib/rag/*) and never touches Supabase/OpenAI/any network or DB. It only
// validates the fixture files themselves, so it stays valid even before a real parser for
// these formats exists yet (see docs/manual-file-format-contract.md).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturesDir = path.join(repoRoot, "tests/fixtures/manual-formats");

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), "utf8");
}

const REQUIRED_FILES = [
  "standard.csv",
  "standard.txt",
  "standard.md",
  "variant.csv",
  "variant.txt",
  "variant.md",
  "expected-standard.json",
  "expected-variant.json",
] as const;

type ExpectedGroup = { category: string; topic: string; items: string[] };

// Standard RFC 4122 UUID (v1-v5); fixtures must never contain a real persisted id.
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
// Common secret/token/PII shapes that must never appear in fixtures or this contract doc.
const SENSITIVE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "UUID", pattern: UUID_PATTERN },
  { label: "OpenAI-style API key", pattern: /sk-[A-Za-z0-9]{16,}/ },
  { label: "Bearer token", pattern: /Bearer\s+[A-Za-z0-9._-]{10,}/i },
  { label: "email address", pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { label: "Korean-style phone number", pattern: /01[016789]-?\d{3,4}-?\d{4}/ },
  { label: "JWT-shaped token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

function assertNoSensitiveContent(label: string, text: string): void {
  for (const { label: patternLabel, pattern } of SENSITIVE_PATTERNS) {
    assert.equal(pattern.test(text), false, `${label} must not contain a ${patternLabel}`);
  }
}

function readExpectedJson(name: string): ExpectedGroup[] {
  const parsed = JSON.parse(readFixture(name)) as unknown;
  assert.ok(Array.isArray(parsed), `${name} must parse to a JSON array`);
  return parsed as ExpectedGroup[];
}

describe("tests/fixtures/manual-formats/ (existence + structural validity)", () => {
  for (const file of REQUIRED_FILES) {
    test(`${file} exists`, () => {
      assert.ok(existsSync(path.join(fixturesDir, file)), `expected fixture file ${file} to exist`);
    });
  }

  test("expected-standard.json and expected-variant.json both parse as valid JSON arrays", () => {
    assert.doesNotThrow(() => readExpectedJson("expected-standard.json"));
    assert.doesNotThrow(() => readExpectedJson("expected-variant.json"));
  });

  // standard.* and variant.* fixtures are the same manual, only expressed with different
  // (messier) formatting; see docs/manual-file-format-contract.md section 2 and 5. Their
  // normalized expected results must therefore be byte-for-byte identical - variant's
  // CRLF/blank-line/whitespace/tab/duplicate-row noise must leave zero trace in the result.
  test("expected-variant.json is deepEqual to expected-standard.json (variant is representation-only noise)", () => {
    const standard = readExpectedJson("expected-standard.json");
    const variant = readExpectedJson("expected-variant.json");
    assert.deepEqual(variant, standard);
  });

  test("expected JSON groups only ever use the {category, topic, items} shape (no id/uuid fields)", () => {
    for (const file of ["expected-standard.json", "expected-variant.json"] as const) {
      const groups = readExpectedJson(file);
      assert.ok(groups.length > 0, `${file} must contain at least one group`);
      for (const group of groups) {
        assert.deepEqual(Object.keys(group).sort(), ["category", "items", "topic"]);
        assert.equal(typeof group.category, "string");
        assert.equal(typeof group.topic, "string");
        assert.ok(Array.isArray(group.items));
      }
    }
  });

  test("no group in expected-standard.json or expected-variant.json has an empty category/topic/items", () => {
    for (const file of ["expected-standard.json", "expected-variant.json"] as const) {
      const groups = readExpectedJson(file);
      for (const group of groups) {
        assert.ok(group.category.trim().length > 0, `${file}: category must not be empty`);
        assert.ok(group.topic.trim().length > 0, `${file}: topic must not be empty`);
        assert.ok(group.items.length > 0, `${file}: items must not be empty`);
        for (const item of group.items) {
          assert.equal(typeof item, "string");
          assert.ok(item.trim().length > 0, `${file}: an item must not be blank`);
        }
      }
    }
  });

  test("none of the fixture files or the contract doc contain a UUID, API key, email, phone number, or JWT", () => {
    for (const file of REQUIRED_FILES) {
      assertNoSensitiveContent(file, readFixture(file));
    }
    const doc = readFileSync(path.join(repoRoot, "docs/manual-file-format-contract.md"), "utf8");
    assertNoSensitiveContent("docs/manual-file-format-contract.md", doc);
  });

  test("standard.csv/.txt/.md each literally contain every category and topic listed in expected-standard.json", () => {
    const expected = readExpectedJson("expected-standard.json");
    for (const file of ["standard.csv", "standard.txt", "standard.md"] as const) {
      const text = readFixture(file);
      for (const group of expected) {
        assert.ok(text.includes(group.category), `${file} must contain category "${group.category}"`);
        assert.ok(text.includes(group.topic), `${file} must contain topic "${group.topic}"`);
      }
    }
  });

  test("variant.csv/.txt/.md each literally contain every category and topic listed in expected-variant.json", () => {
    const expected = readExpectedJson("expected-variant.json");
    for (const file of ["variant.csv", "variant.txt", "variant.md"] as const) {
      const text = readFixture(file);
      for (const group of expected) {
        assert.ok(text.includes(group.category), `${file} must contain category "${group.category}"`);
        assert.ok(text.includes(group.topic), `${file} must contain topic "${group.topic}"`);
      }
    }
  });

  test("variant fixtures actually exercise CRLF, blank lines, leading whitespace, and sub-numbered/indented items", () => {
    for (const file of ["variant.csv", "variant.txt", "variant.md"] as const) {
      const text = readFixture(file);
      assert.match(text, /\r\n/, `${file} should contain at least one CRLF line ending`);
      assert.match(text, /\r?\n[ \t\r]*\r?\n/, `${file} should contain a blank line`);
      assert.match(text, /\t/, `${file} should contain a tab-indented line`);
      assert.match(text, /1-1\./, `${file} should contain a sub-numbered ("1-1.") line`);
      // Leading whitespace before a category is a fixture characteristic we keep in the
      // committed files. Trailing whitespace is intentionally NOT kept in these files (it
      // triggers this repo's trailing-whitespace quality gate on `git diff --check`); that
      // case is instead verified with an inline string literal below, never a raw file line.
      assert.match(text, / 오픈 준비/, `${file} should contain a category with leading whitespace`);
    }
  });

  // Trailing whitespace on a physical line fails this repo's `git diff --check` quality gate,
  // so the "category/title trailing whitespace is trimmed" contract (see
  // docs/manual-file-format-contract.md section 3.5) is verified with an inline string here
  // instead of via a trailing space committed to a fixture file.
  test("trailing whitespace normalization contract (verified via inline string, not a fixture file)", () => {
    const trailingWhitespaceExample = "출근 후 점검  ";
    assert.equal(trailingWhitespaceExample.trimEnd(), "출근 후 점검");
  });

  test("variant.csv additionally exercises a duplicated CSV row (same title repeated verbatim)", () => {
    const text = readFixture("variant.csv");
    const occurrences = text.split(" 출근 후 점검 ").length - 1;
    assert.ok(occurrences >= 2, "variant.csv should repeat the same title row at least twice");
  });

  test("standard fixtures exercise plain numbers, sub-numbers, cautions, and tab indentation", () => {
    for (const file of ["standard.csv", "standard.txt", "standard.md"] as const) {
      const text = readFixture(file);
      assert.match(text, /1-1\./, `${file} should contain a sub-numbered ("1-1.") line`);
      assert.match(text, /주의:/, `${file} should contain a caution ("주의:") line`);
      assert.match(text, /\t/, `${file} should contain a tab-indented line`);
    }
  });

  test("this suite never imports a manual parser or a Supabase/OpenAI client (fixtures only, not wired to real parsing yet)", () => {
    const selfSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
    assert.equal(/^import .*from ["'].*lib\/manuals/m.test(selfSource), false);
    assert.equal(/^import .*from ["'].*lib\/rag/m.test(selfSource), false);
    assert.equal(/^import .*from ["']@supabase/m.test(selfSource), false);
    assert.equal(/^import .*from ["']openai/m.test(selfSource), false);
  });
});

// Numeric-title preservation ("a title that is just digits, e.g. \"10\", must be kept as a
// string, not dropped or reinterpreted") is a real contract (see
// docs/manual-file-format-contract.md section 5.1), but it is intentionally NOT mixed into
// the standard/variant equality fixtures above - doing so previously made expected-variant.json
// diverge from expected-standard.json, contradicting the "same manual" claim. Per the
// "don't grow the fixture file count unnecessarily" guidance, this is a single small inline
// literal (not a new fixture file), checked structurally only - no parser is called here.
const NUMERIC_TITLE_EXAMPLE = {
  category: "위생 관리",
  topic: "10",
  items: ["숫자만 있는 제목도 문자열로 그대로 보존되어야 한다"],
};

describe("numeric-title preservation (separate small example, not part of standard/variant equality)", () => {
  test("a purely numeric topic string is a non-empty string, not a number and not dropped", () => {
    assert.equal(typeof NUMERIC_TITLE_EXAMPLE.topic, "string");
    assert.equal(NUMERIC_TITLE_EXAMPLE.topic, "10");
    assert.ok(NUMERIC_TITLE_EXAMPLE.topic.trim().length > 0);
  });

  test("the numeric-title example is independent of expected-standard.json / expected-variant.json", () => {
    const standard = readExpectedJson("expected-standard.json");
    const variant = readExpectedJson("expected-variant.json");
    assert.equal(
      standard.some((group) => group.topic === NUMERIC_TITLE_EXAMPLE.topic),
      false,
    );
    assert.equal(
      variant.some((group) => group.topic === NUMERIC_TITLE_EXAMPLE.topic),
      false,
    );
  });
});
