import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// 공지 라우트는 next/server, cookies(), Supabase 클라이언트에 묶여 Next 런타임 밖에서 실행되지
// 않는다(다른 route 테스트와 동일 관행). 여기서는 021 마이그레이션과 라우트가 같은 테이블·컬럼·
// 범위 계약을 쓰는지, franchise/store 격리가 코드에 남아 있는지를 고정한다.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

const migration = readSource("supabase/migrations/021_hq_notices.sql");
const hqRoute = readSource("app/api/hq/notices/route.ts");
const bossRoute = readSource("app/api/boss/notices/route.ts");

describe("021_hq_notices.sql (DB 계약)", () => {
  test("021 번호를 쓰고 020(매뉴얼 업로드 batch)과 겹치지 않는다", () => {
    assert.match(migration, /^-- 021: HQ notices/);
  });

  test("public.notices 테이블과 라우트가 읽고 쓰는 컬럼을 모두 정의한다", () => {
    assert.match(migration, /create table if not exists public\.notices/);
    for (const column of [
      "franchise_id",
      "author_id",
      "target_type",
      "target_store_id",
      "title",
      "content",
      "created_at",
      "updated_at",
    ]) {
      assert.match(migration, new RegExp(`\\n\\s+${column}\\s`), `missing column: ${column}`);
    }
  });

  test("target_type은 all/store로만 제한된다", () => {
    assert.match(migration, /check \(target_type in \('all', 'store'\)\)/);
  });

  test("전체 공지는 target_store_id가 없고 지점 공지는 반드시 있어야 한다", () => {
    assert.match(migration, /\(target_type = 'all' and target_store_id is null\)/);
    assert.match(migration, /\(target_type = 'store' and target_store_id is not null\)/);
  });

  test("franchise 삭제 시 공지도 함께 정리되도록 cascade를 건다", () => {
    assert.match(migration, /franchise_id uuid not null references public\.franchises\(id\) on delete cascade/);
  });

  test("RLS만 켜고 anon/authenticated 직접 접근 정책은 만들지 않는다", () => {
    assert.match(migration, /alter table public\.notices enable row level security/);
    assert.equal(/create policy/i.test(migration), false);
  });
});

describe("app/api/hq/notices/route.ts (본사만 작성)", () => {
  test("조회/작성 모두 requireHqUser를 통과해야 한다", () => {
    assert.equal(hqRoute.match(/const hqUser = await requireHqUser\(\)/g)?.length, 2);
  });

  test("franchise 범위는 세션에서만 오고 요청 body에서 오지 않는다", () => {
    assert.match(hqRoute, /franchise_id: hqUser\.franchiseId/);
    assert.equal(/franchiseId\s*[:=]\s*body\./.test(hqRoute), false);
  });

  test("franchise_id가 없는 레거시 HQ 계정은 fail closed 한다", () => {
    assert.match(hqRoute, /if \(!hqUser\.franchiseId\) \{\s*return NextResponse\.json\(\{ notices: \[\] \}\)/);
    assert.match(hqRoute, /소속 프랜차이즈 정보가 없어 공지를 작성할 수 없습니다\./);
  });

  test("목록은 자기 franchise 공지만 조회한다", () => {
    assert.match(hqRoute, /\.from\("notices"\)[\s\S]*?\.eq\("franchise_id", hqUser\.franchiseId\)/);
  });

  test("지점 공지는 그 지점이 같은 franchise 소속일 때만 허용한다", () => {
    assert.match(
      hqRoute,
      /\.from\("stores"\)[\s\S]*?\.eq\("id", targetStoreId\)[\s\S]*?\.eq\("franchise_id", hqUser\.franchiseId\)/,
    );
  });

  test("migration 미적용 환경에서는 raw DB 오류 대신 안내 문구를 돌려준다", () => {
    assert.match(hqRoute, /error\?\.code === "42P01" \|\| error\?\.code === "PGRST205"/);
    assert.match(hqRoute, /DB 설정\(021_hq_notices\)을 요청해주세요/);
  });

  test("응답에 raw Supabase 오류 메시지를 담지 않는다", () => {
    assert.equal(/error: \w+(Error)?\.message/.test(hqRoute), false);
  });
});

describe("app/api/boss/notices/route.ts (점주 조회 범위)", () => {
  test("요청한 storeId에 대한 승인된 owner 멤버십을 서버에서 다시 확인한다", () => {
    assert.match(
      bossRoute,
      /\.from\("store_memberships"\)[\s\S]*?\.eq\("user_id", user\.id\)[\s\S]*?\.eq\("store_id", storeId\)[\s\S]*?\.eq\("role", "owner"\)[\s\S]*?\.eq\("status", "approved"\)/,
    );
    assert.match(bossRoute, /이 매장에 대한 접근 권한이 없습니다\./);
  });

  test("franchise는 요청값이 아니라 그 매장의 stores.franchise_id로 결정한다", () => {
    assert.match(bossRoute, /\.from\("stores"\)[\s\S]*?\.select\("franchise_id"\)[\s\S]*?\.eq\("id", storeId\)/);
  });

  test("같은 franchise의 전체 공지 또는 이 매장 대상 공지만 조회한다", () => {
    assert.match(bossRoute, /\.eq\("franchise_id", store\.franchise_id\)/);
    assert.match(bossRoute, /\.or\(`target_type\.eq\.all,target_store_id\.eq\.\$\{storeId\}`\)/);
  });

  test("franchise가 없는 매장은 공지를 하나도 노출하지 않는다", () => {
    assert.match(bossRoute, /if \(!store\?\.franchise_id\) \{\s*return NextResponse\.json\(\{ success: true, data: \{ notices: \[\], summary/);
  });

  test("migration 미적용 환경에서는 빈 목록으로 응답한다", () => {
    assert.match(bossRoute, /noticeError\.code === "42P01" \|\| noticeError\.code === "PGRST205"/);
  });

  test("응답에 author_id 같은 내부 식별자를 내보내지 않는다", () => {
    assert.match(bossRoute, /\.select\("id, title, content, created_at, updated_at"\)/);
    assert.equal(/author_id/.test(bossRoute), false);
  });
});
