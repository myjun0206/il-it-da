import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  // Normalize CRLF to LF so multi-line regex assertions below are unaffected by the
  // checkout's line-ending style (this repo's files may be checked out with CRLF on Windows).
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

// Real Postgres isn't available in this test suite, so the cascade-delete contract of
// 019_manuals_parent_cascade_delete.sql (and the app-level delete routes that rely on it)
// is verified statically, the same pattern as tests/rag/manual-search-scope.test.ts uses
// for the 018 migration. Actual end-to-end deletion must still be checked against a real
// database separately (see final report blockers).
describe("supabase/migrations/019_manuals_parent_cascade_delete.sql (static contract)", () => {
  const sql = readSource("supabase/migrations/019_manuals_parent_cascade_delete.sql");

  test("drops the old manuals_parent_manual_id_fkey before recreating it", () => {
    assert.match(sql, /alter table public\.manuals drop constraint manuals_parent_manual_id_fkey/);
  });

  test("recreates parent_manual_id -> manuals(id) with ON DELETE CASCADE (not SET NULL)", () => {
    assert.match(
      sql,
      /add constraint manuals_parent_manual_id_fkey\s*\n\s*foreign key \(parent_manual_id\) references public\.manuals\(id\) on delete cascade/,
    );
  });

  test("is idempotent / guarded (checks pg_constraint and manuals table existence before altering)", () => {
    assert.match(sql, /to_regclass\('public\.manuals'\) is null/);
    assert.match(sql, /where conname = 'manuals_parent_manual_id_fkey'/);
  });

  test("does not touch manual_chunks_manual_id_fkey (already ON DELETE CASCADE since 010)", () => {
    assert.equal(sql.includes("manual_chunks"), false);

    const hqManuals010 = readSource("supabase/migrations/010_franchises_and_hq_manuals.sql");
    assert.match(
      hqManuals010,
      /alter table public\.manual_chunks\s*\n\s*add constraint manual_chunks_manual_id_fkey\s*\n\s*foreign key \(manual_id\) references public\.manuals\(id\) on delete cascade/,
    );
  });
});

// With 019 in place, deleting a parent manual cascades to its children (manuals rows), and
// deleting a child manual cascades to its own manual_chunks rows (010) - so no FK orphan can
// exist at the DB level regardless of delete order. The app-level routes below additionally
// delete children explicitly before the parent (belt-and-suspenders, not required by 019
// alone) - this locks that existing explicit ordering so a future edit can't silently drop it.
describe("manual delete routes explicitly delete children before the parent", () => {
  test("app/api/manuals/[id]/route.ts DELETE deletes parent_manual_id=id rows before deleting id itself", () => {
    const source = readSource("app/api/manuals/[id]/route.ts");
    const childrenDeleteIndex = source.indexOf('.delete().eq("parent_manual_id", id)');
    const parentDeleteIndex = source.indexOf('.delete().eq("id", id)');
    assert.ok(childrenDeleteIndex >= 0 && parentDeleteIndex >= 0);
    assert.ok(childrenDeleteIndex < parentDeleteIndex);
  });

  test("app/api/store-manuals/[id]/route.ts DELETE deletes parent_manual_id=id rows before deleting id itself", () => {
    const source = readSource("app/api/store-manuals/[id]/route.ts");
    const deleteHandler = source.slice(source.indexOf("export async function DELETE"));
    const childrenDeleteIndex = deleteHandler.indexOf('.eq("parent_manual_id", id)');
    const parentDeleteIndex = deleteHandler.indexOf('.eq("id", id)');
    assert.ok(childrenDeleteIndex >= 0 && parentDeleteIndex >= 0);
    assert.ok(childrenDeleteIndex < parentDeleteIndex);
  });

  test("app/api/manuals/route.ts PATCH delete-category deletes children (in parent_manual_id) before the category's own rows", () => {
    const source = readSource("app/api/manuals/route.ts");
    const childrenDeleteIndex = source.indexOf('.delete().in("parent_manual_id", ids)');
    const parentDeleteIndex = source.indexOf('.delete().in("id", ids)');
    assert.ok(childrenDeleteIndex >= 0 && parentDeleteIndex >= 0);
    assert.ok(childrenDeleteIndex < parentDeleteIndex);
  });

  test("batch-delete routes rely on the 019 cascade for any parent ids submitted without their children ids", () => {
    // These routes intentionally delete `ids` in one shot (no explicit children-first step);
    // 019's ON DELETE CASCADE is what prevents orphaned children if a caller only submits a
    // parent id. This test locks that comment/assumption so it isn't silently removed.
    for (const routePath of ["app/api/manuals/batch-delete/route.ts", "app/api/store-manuals/batch-delete/route.ts"]) {
      const source = readSource(routePath);
      assert.match(source, /on delete cascade/);
    }
  });
});
