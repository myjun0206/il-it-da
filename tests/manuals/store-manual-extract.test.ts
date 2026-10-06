import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type * as XlsxModule from "xlsx";

import { buildConfirmedManualsPayload, buildManualPreview } from "../../lib/manuals/build-manual-preview.ts";
import { extractManualGroups } from "../../lib/manuals/extract-manual-groups.ts";
import {
  STORE_MULTI_SHEET_ERROR,
  extractStoreManualGroups,
  normalizeStoreManualRows,
} from "../../lib/manuals/extract-store-manual-groups.ts";
import { parseConfirmedManualGroups } from "../../lib/manuals/parse-confirmed-manual-groups.ts";
import { saveManualGroupsWithBatchGuard } from "../../lib/manuals/save-manuals-with-batch.ts";

const XLSX = createRequire(import.meta.url)("xlsx") as typeof XlsxModule;

// 양재헌 팀원 지점 시트와 같은 형식(넘버/카테고리/타이틀/매뉴얼, 이어지는 행, 헤더 안 공백)의 합성 데이터.
const HEADER = ["넘버", "카테 고리", "타이틀", "매뉴얼"];
const STORE_SHEET: string[][] = [
  HEADER,
  ["1", "매장운영", "매장 기본 운영 정보", "1-1. 매장 기본 정보\n- 영업시간 10:00~22:00"],
  ["", "", "", "1-2. 주요 혼잡 시간\n- 평일 점심 12:00~13:00"],
  ["", "", "", "1-3. 시간대별 운영\n- 오픈 전 점검"],
  ["2", "재고·발주", "재고 및 비품 위치", "- 번: 냉동고 2번 칸"],
  ["3", "재고·발주", "발주 마감", "2-1. 발주 마감 시각\n- 매일 15:00"],
  ["", "", "", "2-2. 긴급 발주\n- 점장 승인 후 진행"],
  ["4", "장비관리", "튀김기 관리", "- 오일 교체는 주 2회"],
];
const EXPECTED = { categories: 3, titles: 4, items: 7 };

function workbookFile(sheets: Record<string, string[][]>): File {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([bytes], "store.xlsx");
}

function summarize(groups: { category?: string; topic: string; items: unknown[] }[]) {
  return {
    categories: new Set(groups.map((group) => group.category)).size,
    titles: groups.length,
    items: groups.reduce((count, group) => count + group.items.length, 0),
  };
}

/** 파일 → 미리보기 → 화면이 보내는 확정 payload → 서버 확정 파싱까지 실제 함수로 진행한다. */
async function confirmedGroupsFromFile(file: File, storeId: string) {
  const preview = buildManualPreview(await extractStoreManualGroups(file, ".xlsx"), { storeId });
  const labels = Object.fromEntries(preview.categories.map((category) => [category.tempId, category.label]));
  const groups = parseConfirmedManualGroups(buildConfirmedManualsPayload(preview, labels, {}));
  assert.ok(groups, "confirm payload must parse");
  return groups;
}

type Row = Record<string, unknown>;

/** manuals/manual_chunks/manual_upload_batches만 흉내낸 최소 가짜 DB. 실제 Supabase/OpenAI 없음. */
function fakeDb() {
  const tables: Record<string, Row[]> = { manuals: [], manual_chunks: [], manual_upload_batches: [] };
  let sequence = 0;
  const client = {
    rpc: async (name: string) => {
      assert.equal(name, "check_manual_write_contract"); return { data: 2, error: null };
    },
    from(table: string) {
      const filters: [string, unknown][] = [];
      let mode: "select" | "insert" | "update" = "select";
      let payload: Row | Row[] = {};
      let head = false;
      const run = () => {
        if (mode === "insert") {
          const rows = ([] as Row[]).concat(payload).map((row) => ({ id: `${table}-${++sequence}`, ...row }));
          tables[table].push(...rows);
          return { data: rows, error: null };
        }
        const matched = tables[table].filter((row) => filters.every(([column, value]) => row[column] === value));
        if (mode === "update") {
          matched.forEach((row) => Object.assign(row, payload));
          return { data: matched, error: null };
        }
        return head ? { data: null, count: matched.length, error: null } : { data: matched, error: null };
      };
      const builder = {
        select: (_columns?: string, options?: { head?: boolean }) => {
          head = Boolean(options?.head);
          return builder;
        },
        insert: (value: Row | Row[]) => {
          mode = "insert";
          payload = value;
          return builder;
        },
        update: (value: Row) => {
          mode = "update";
          payload = value;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        order: () => builder,
        single: () => Promise.resolve(run()).then((result) => ({ data: (result.data as Row[] | null)?.[0] ?? null, error: null })),
        maybeSingle: () => Promise.resolve(run()).then((result) => ({ data: (result.data as Row[] | null)?.[0] ?? null, error: null })),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(run()).then(resolve),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, tables };
}

/** /boss/store-manuals가 쓰는 것과 같은 규칙: 최상위 행 = 타이틀 카드, 자식 = 세부 항목, 카테고리별로 묶는다. */
function toOwnerList(rows: Row[]) {
  const parents = rows.filter((row) => !row.parent_manual_id);
  const byCategory = new Map<string, { title: unknown; items: number }[]>();
  for (const parent of parents) {
    const items = rows.filter((row) => row.parent_manual_id === parent.id).length;
    const list = byCategory.get(String(parent.category)) ?? [];
    list.push({ title: parent.title, items });
    byCategory.set(String(parent.category), list);
  }
  return byCategory;
}

describe("지점 매뉴얼 추출 (파서 입력 정규화)", () => {
  test("수정 전 공용 추출기는 넘버를 카테고리로 읽고 본문 열과 이어지는 행을 잃는다 (재현)", async () => {
    const groups = await extractManualGroups(workbookFile({ store: STORE_SHEET }), ".xlsx");
    assert.deepEqual(new Set(groups.map((group) => group.category)), new Set(["1", "2", "3", "4"]));
    assert.equal(summarize(groups).items, 4);
    assert.equal(groups.flatMap((group) => group.items).some((item) => item.includes("영업시간")), false);
  });

  test("지점 추출기는 헤더 이름으로 열을 찾고 이어지는 행을 앞 타이틀에 붙인다", async () => {
    const groups = await extractStoreManualGroups(workbookFile({ store: STORE_SHEET }), ".xlsx");
    assert.deepEqual(summarize(groups), EXPECTED);
    const first = groups.find((group) => group.topic === "매장 기본 운영 정보");
    assert.equal(first?.category, "매장운영");
    assert.equal(first?.items.length, 3);
    assert.match(first?.items[2] ?? "", /오픈 전 점검/);
  });

  test("여러 시트 파일은 한 매장에 합치지 않고 거부한다", async () => {
    await assert.rejects(
      extractStoreManualGroups(workbookFile({ a: STORE_SHEET, b: STORE_SHEET }), ".xlsx"),
      new Error(STORE_MULTI_SHEET_ERROR),
    );
  });

  test("본사와 같은 3열(카테고리/타이틀/매뉴얼) 파일은 공용 추출기와 결과가 같다", async () => {
    const threeColumn = [["카테고리", "타이틀", "매뉴얼"], ["매장운영", "오픈", "1. 불 켜기"], ["매장운영", "마감", "1. 정산"]];
    const file = workbookFile({ s: threeColumn });
    assert.deepEqual(await extractStoreManualGroups(file, ".xlsx"), await extractManualGroups(file, ".xlsx"));
  });

  test("카테고리·타이틀·매뉴얼 헤더를 모두 찾지 못하면 행을 바꾸지 않는다", () => {
    const rows = [["주제", "내용"], ["오픈", "1. 불 켜기"]];
    assert.strictEqual(normalizeStoreManualRows(rows), rows);
  });
});

describe("지점 매뉴얼 파일 → 미리보기 → 확정 payload → 저장 → 점주 목록", () => {
  const STORE_A = { userId: "owner-a", storeId: "store-a", franchiseId: "franchise-m", brandName: "M Coffee" };
  const STORE_B = { userId: "owner-b", storeId: "store-b", franchiseId: "franchise-b", brandName: "B Burger" };
  const embedOk = async () => undefined;

  async function saveFor(db: ReturnType<typeof fakeDb>, auth: typeof STORE_A, key: string) {
    const groups = await confirmedGroupsFromFile(workbookFile({ store: STORE_SHEET }), auth.storeId);
    assert.deepEqual(summarize(groups), EXPECTED);
    return saveManualGroupsWithBatchGuard(db.client, {
      auth,
      groups,
      storeId: auth.storeId,
      scope: { scopeType: "store", franchiseId: auth.franchiseId, storeId: auth.storeId },
      idempotencyKey: key,
      indexManual: embedOk,
    });
  }

  test("저장 행은 부모(타이틀)·자식(세부 항목) 구조이고 검증된 store_id·franchise_id·scope_type=store를 갖는다", async () => {
    const db = fakeDb();
    const result = await saveFor(db, STORE_A, "11111111-1111-4111-8111-111111111111");
    assert.equal(result.kind, "saved");

    const parents = db.tables.manuals.filter((row) => !row.parent_manual_id);
    const children = db.tables.manuals.filter((row) => row.parent_manual_id);
    assert.equal(parents.length, EXPECTED.titles);
    assert.equal(children.length, EXPECTED.items);
    for (const row of db.tables.manuals) {
      assert.equal(row.store_id, "store-a");
      assert.equal(row.franchise_id, "franchise-m");
      assert.equal(row.scope_type, "store");
      assert.equal(row.status, "approved");
    }
    assert.equal(db.tables.manual_chunks.length, 0);
    assert.equal(children.every((row) => row.search_status === "ready"), true);
  });

  test("점주 목록 변환은 카테고리 3 · 타이틀 4 · 항목 7이고 다른 지점 행은 섞이지 않는다", async () => {
    const db = fakeDb();
    await saveFor(db, STORE_A, "11111111-1111-4111-8111-111111111111");
    await saveFor(db, STORE_B, "22222222-2222-4222-8222-222222222222");

    // GET /api/store-manuals는 requireStoreOwner로 검증한 storeId로만 .eq("store_id") 조회한다.
    const storeARows = db.tables.manuals.filter((row) => row.store_id === "store-a");
    const list = toOwnerList(storeARows);

    assert.equal(list.size, EXPECTED.categories);
    assert.equal([...list.values()].flat().length, EXPECTED.titles);
    assert.equal([...list.values()].flat().reduce((count, card) => count + card.items, 0), EXPECTED.items);
    assert.equal(storeARows.some((row) => row.franchise_id === "franchise-b"), false);
    assert.equal(list.get("매장운영")?.find((card) => card.title === "매장 기본 운영 정보")?.items, 3);
  });
});
