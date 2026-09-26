import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// Structural/content checks only: this suite never imports or calls any manual parser
// (lib/manuals/*, lib/rag/*) and never touches Supabase/OpenAI/any network or DB. It only
// validates the taxonomy fixture and doc themselves (see docs/manual-category-taxonomy.md).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(repoRoot, "tests/fixtures/manual-categories/m-coffee-common-taxonomy.json");
const docPath = path.join(repoRoot, "docs/manual-category-taxonomy.md");

type TaxonomyCategory = { key: string; label: string; manualTitles: string[] };
type TaxonomyFixture = {
  brandName: string;
  sourceScopeType: string;
  scopeType: string;
  categories: TaxonomyCategory[];
};

// The only two scope_type values the final DB/RAG contract (018 scoped RPC) ever searches;
// see docs/manual-category-taxonomy.md section 2.
const ALLOWED_FINAL_SCOPE_TYPES = ["hq", "store"];

function readTaxonomy(): TaxonomyFixture {
  const parsed = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
  assert.ok(parsed && typeof parsed === "object", "fixture must parse to a JSON object");
  return parsed as TaxonomyFixture;
}

// Standard RFC 4122 UUID (v1-v5); the fixture must never contain a real persisted id.
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const SENSITIVE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "UUID", pattern: UUID_PATTERN },
  { label: "OpenAI-style API key", pattern: /sk-[A-Za-z0-9]{16,}/ },
  { label: "Bearer token", pattern: /Bearer\s+[A-Za-z0-9._-]{10,}/i },
  { label: "email address", pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { label: "JWT-shaped token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

function assertNoSensitiveContent(label: string, text: string): void {
  for (const { label: patternLabel, pattern } of SENSITIVE_PATTERNS) {
    assert.equal(pattern.test(text), false, `${label} must not contain a ${patternLabel}`);
  }
}

const EXPECTED_TITLES = [
  "프랜차이즈 매뉴얼 적용 원칙",
  "오픈 운영",
  "재고 관리",
  "음료 제조 및 레시피 관리",
  "고객 응대 및 주문 처리",
  "위생 및 청소 관리",
  "마감 운영",
  "긴급 상황 대응",
  "신규 직원 업무 안내",
  "POS 및 결제 관리",
  "환불·취소·보상 처리 기준",
  "재고 발주 기준",
  "장비 세척 및 관리",
  "식품 안전 및 이물질 대응",
  "교대 및 인수인계",
  "교대 인수인계 체크리스트",
  "주문·포장·픽업 처리",
  "쿠폰·포인트·프로모션 관리",
  "분실물 및 고객 물품 대응",
];

const EXPECTED_COUNTS_BY_KEY: Record<string, number> = {
  store_operations_staff: 4,
  opening_closing: 2,
  ordering_payment_customer_service: 6,
  menu_recipe: 1,
  inventory_ordering_equipment: 3,
  hygiene_safety_emergency: 3,
};

// The existing (pre-taxonomy) Excel category buckets from docs/manual-category-taxonomy.md
// section 5, which the doc claims every one of maps onto one of the 6 new top categories.
const EXISTING_EXCEL_CATEGORIES = [
  "매장운영",
  "주문·결제",
  "고객응대",
  "음료제조",
  "메뉴제조",
  "재고·발주",
  "장비관리",
  "위생·안전",
];

describe("tests/fixtures/manual-categories/m-coffee-common-taxonomy.json (structural validity)", () => {
  test("fixture file exists and parses as a JSON object with brandName/sourceScopeType/scopeType/categories", () => {
    const taxonomy = readTaxonomy();
    assert.equal(taxonomy.brandName, "M Coffee");
    assert.equal(typeof taxonomy.sourceScopeType, "string");
    assert.equal(typeof taxonomy.scopeType, "string");
    assert.ok(Array.isArray(taxonomy.categories));
  });

  // The 018 scoped RPC only ever searches final scope_type 'hq'/'store'. The original Excel
  // value is 'common' for M Coffee's HQ-common manuals, but that must never be the value
  // stored/searched as the final DB scope_type - see docs/manual-category-taxonomy.md section 2.
  test("sourceScopeType (original Excel value) is exactly \"common\"", () => {
    const taxonomy = readTaxonomy();
    assert.equal(taxonomy.sourceScopeType, "common");
  });

  test("final scopeType is exactly \"hq\" (the normalized value, not the raw Excel value)", () => {
    const taxonomy = readTaxonomy();
    assert.equal(taxonomy.scopeType, "hq");
  });

  test("final scopeType is never \"common\" (storing common as the final scope_type would drop these manuals from the 018 scoped RPC)", () => {
    const taxonomy = readTaxonomy();
    assert.notEqual(taxonomy.scopeType, "common");
  });

  test("the fixture's final scopeType is one of the only two values the 018 scoped RPC ever searches (hq/store)", () => {
    const taxonomy = readTaxonomy();
    assert.ok(
      ALLOWED_FINAL_SCOPE_TYPES.includes(taxonomy.scopeType),
      `final scopeType "${taxonomy.scopeType}" must be one of ${ALLOWED_FINAL_SCOPE_TYPES.join("/")}`,
    );
  });

  test("has exactly 6 categories", () => {
    const taxonomy = readTaxonomy();
    assert.equal(taxonomy.categories.length, 6);
  });

  test("manual titles total exactly 19 across all categories", () => {
    const taxonomy = readTaxonomy();
    const total = taxonomy.categories.reduce((sum, category) => sum + category.manualTitles.length, 0);
    assert.equal(total, 19);
  });

  test("each of the 19 expected titles appears exactly once across all categories", () => {
    const taxonomy = readTaxonomy();
    const allTitles = taxonomy.categories.flatMap((category) => category.manualTitles);
    const counts = new Map<string, number>();
    for (const title of allTitles) {
      counts.set(title, (counts.get(title) ?? 0) + 1);
    }
    for (const title of EXPECTED_TITLES) {
      assert.equal(counts.get(title), 1, `"${title}" must appear exactly once`);
    }
    assert.equal(counts.size, EXPECTED_TITLES.length, "no unexpected extra titles");
  });

  test("the actual title list matches the expected title list exactly (no missing, no extra)", () => {
    const taxonomy = readTaxonomy();
    const allTitles = taxonomy.categories.flatMap((category) => category.manualTitles);
    assert.deepEqual([...allTitles].sort(), [...EXPECTED_TITLES].sort());
  });

  test("category keys are English snake_case and unique", () => {
    const taxonomy = readTaxonomy();
    const keys = taxonomy.categories.map((category) => category.key);
    for (const key of keys) {
      assert.match(key, /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, `"${key}" must be snake_case`);
    }
    assert.equal(new Set(keys).size, keys.length, "category keys must be unique");
  });

  test("category labels are unique", () => {
    const taxonomy = readTaxonomy();
    const labels = taxonomy.categories.map((category) => category.label);
    assert.equal(new Set(labels).size, labels.length, "category labels must be unique");
  });

  test("no category has an empty key/label, and no manual title is empty", () => {
    const taxonomy = readTaxonomy();
    for (const category of taxonomy.categories) {
      assert.ok(category.key.trim().length > 0, "key must not be empty");
      assert.ok(category.label.trim().length > 0, "label must not be empty");
      assert.ok(category.manualTitles.length > 0, `category "${category.key}" must have at least one title`);
      for (const title of category.manualTitles) {
        assert.equal(typeof title, "string");
        assert.ok(title.trim().length > 0, "manual title must not be blank");
      }
    }
  });

  test("fixture contains no UUID, DB id, email, API key, or JWT", () => {
    assertNoSensitiveContent("m-coffee-common-taxonomy.json", readFileSync(fixturePath, "utf8"));
  });

  test("each category's manual count matches the expected 4/2/6/1/3/3 breakdown", () => {
    const taxonomy = readTaxonomy();
    for (const category of taxonomy.categories) {
      const expectedCount = EXPECTED_COUNTS_BY_KEY[category.key];
      assert.ok(expectedCount !== undefined, `unexpected category key "${category.key}"`);
      assert.equal(
        category.manualTitles.length,
        expectedCount,
        `category "${category.key}" should have ${expectedCount} titles`,
      );
    }
    assert.equal(Object.keys(EXPECTED_COUNTS_BY_KEY).length, 6);
  });

  test("this fixture never imports a manual parser or a Supabase/OpenAI client (pure JSON data)", () => {
    const source = readFileSync(fixturePath, "utf8");
    assert.equal(/import\s/.test(source), false, "fixture must be pure JSON, no import statements");
    assert.equal(/supabase|openai/i.test(source), false);
  });
});

describe("docs/manual-category-taxonomy.md (contract doc contents)", () => {
  const doc = readFileSync(docPath, "utf8");

  test("doc contains no UUID, DB id, email, API key, or JWT", () => {
    assertNoSensitiveContent("manual-category-taxonomy.md", doc);
  });

  test("doc explicitly states the 19 detail manuals are kept as-is and only grouped in the UI", () => {
    assert.match(doc, /19개/);
    assert.match(doc, /그대로 유지/);
  });

  test("doc explicitly states RAG still searches the 19 detail manuals/chunks, not the top categories", () => {
    assert.match(doc, /RAG/);
    assert.match(doc, /세부 매뉴얼과 그 청크를 그대로 검색/);
  });

  test("doc explicitly distinguishes parent_manual_id from the top-level category concept", () => {
    assert.match(doc, /parent_manual_id/);
    assert.match(doc, /다른 개념/);
  });

  // docs/manual-category-taxonomy.md section 2: Excel's scope_type=common must be normalized
  // to the final DB scope_type=hq at upload time, since the 018 scoped RPC only ever searches
  // hq/store. This must be documented as a contract even though the real conversion code is
  // explicitly out of scope for this task.
  test("doc explicitly documents the common -> hq normalization contract", () => {
    assert.match(doc, /`common`/);
    assert.match(doc, /`hq`/);
    assert.match(doc, /변환/);
    assert.match(doc, /018/);
  });

  test("doc states the real conversion code is not implemented in this task", () => {
    assert.match(doc, /구현하지 않는다/);
  });

  test("doc states it is a proposal/contract until the DB storage approach is finalized", () => {
    assert.match(doc, /분류 계약/);
    assert.match(doc, /확정/);
  });

  test("doc proposes a fail-closed UNCLASSIFIED rule for titles that do not match exactly", () => {
    assert.match(doc, /UNCLASSIFIED/);
    assert.match(doc, /추측하지 않는다/);
  });

  test("doc describes future expansion principles for other brands and store-only manuals", () => {
    assert.match(doc, /B Burger/);
    assert.match(doc, /store/i);
  });

  test("every existing Excel category bucket is explained as mapping to one of the 6 top categories", () => {
    for (const existingCategory of EXISTING_EXCEL_CATEGORIES) {
      assert.ok(doc.includes(existingCategory), `doc must mention existing category "${existingCategory}"`);
    }
    // Each of the 6 new category labels must also appear, so the mapping direction is documented.
    const taxonomy = readTaxonomy();
    for (const category of taxonomy.categories) {
      assert.ok(doc.includes(category.label), `doc must mention top category label "${category.label}"`);
    }
  });

  test("this test file never imports a manual parser or a Supabase/OpenAI client", () => {
    const selfSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
    assert.equal(/^import .*from ["'].*lib\/manuals/m.test(selfSource), false);
    assert.equal(/^import .*from ["'].*lib\/rag/m.test(selfSource), false);
    assert.equal(/^import .*from ["']@supabase/m.test(selfSource), false);
    assert.equal(/^import .*from ["']openai/m.test(selfSource), false);
  });
});
