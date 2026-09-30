import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canCreateNotice,
  canReadNotice,
  type NoticeMembership,
  type NoticeScope,
} from "../../lib/notices/notice-authorization.ts";
import { buildHqNoticeTarget } from "../../lib/notices/build-hq-notice-target.ts";

// 공지 라우트는 next/server, cookies(), Supabase 클라이언트에 묶여 Next 런타임 밖에서 실행되지
// 않는다(다른 route 테스트와 동일 관행). 여기서는 021 마이그레이션과 라우트가 같은 테이블·컬럼·
// 범위 계약을 쓰는지, franchise/store 격리가 코드에 남아 있는지를 고정한다.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

const migration = readSource("supabase/migrations/021_hq_notices.sql");
const audienceMigration = readSource("supabase/migrations/029_notice_audience.sql");
const hqRoute = readSource("app/api/hq/notices/route.ts");
const bossRoute = readSource("app/api/boss/notices/route.ts");
const staffRoute = readSource("app/api/staff/notices/route.ts");
const hqCreatePage = readSource("app/hq/communication/new/page.tsx");

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

  test("029는 기존 공지를 all_members로 보존하고 기본 audience를 설정한다", () => {
    assert.match(audienceMigration, /add column if not exists audience text/);
    assert.match(audienceMigration, /set audience = 'all_members'[\s\S]*?where audience is null/);
    assert.match(audienceMigration, /alter column audience set default 'all_members'/);
    assert.match(audienceMigration, /alter column audience set not null/);
  });

  test("audience는 owner/all_members/staff만 허용한다", () => {
    assert.match(audienceMigration, /check \(audience in \('owner', 'all_members', 'staff'\)\)/);
  });

  test("franchise 타입을 추가하면서 legacy all/store의 target_store_id 규칙을 유지한다", () => {
    assert.match(audienceMigration, /target_type in \('all', 'franchise'\) and target_store_id is null/);
    assert.match(audienceMigration, /target_type = 'store' and target_store_id is not null/);
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
    assert.match(bossRoute, /\.or\(`target_type\.eq\.all,target_type\.eq\.franchise,target_store_id\.eq\.\$\{storeId\}`\)/);
    assert.match(bossRoute, /\.in\("audience", \["owner", "all_members"\]\)/);
    assert.match(bossRoute, /canReadNotice\("owner"/);
  });

  test("franchise가 없는 매장은 공지를 하나도 노출하지 않는다", () => {
    assert.match(bossRoute, /if \(!store\?\.franchise_id\) \{\s*return NextResponse\.json\(\{ success: true, data: \{ notices: \[\], summary/);
  });

  test("migration 미적용 환경에서는 빈 목록으로 응답한다", () => {
    assert.match(bossRoute, /noticeError\.code === "42P01" \|\| noticeError\.code === "PGRST205"/);
  });

  test("응답에 author_id 같은 내부 식별자를 내보내지 않는다", () => {
    assert.match(
      bossRoute,
      /\.select\("id, target_type, target_store_id, audience, title, content, created_at, updated_at"\)/,
    );
    assert.equal(/\.select\([^)]*author_id/.test(bossRoute), false);
  });
});

const FRANCHISE_A = "franchise-a";
const FRANCHISE_B = "franchise-b";
const STORE_A = "store-a";
const STORE_B = "store-b";

function scope(overrides: Partial<NoticeScope> = {}): NoticeScope {
  return {
    franchiseId: FRANCHISE_A,
    targetType: "franchise",
    targetStoreId: null,
    audience: "all_members",
    ...overrides,
  };
}

function membership(
  overrides: Partial<NoticeMembership> = {},
): NoticeMembership {
  return {
    storeId: STORE_A,
    franchiseId: FRANCHISE_A,
    role: "owner",
    status: "approved",
    ...overrides,
  };
}

function hqCanCreate(noticeScope: NoticeScope, targetStoreFranchiseId: string | null = null) {
  return canCreateNotice({
    role: "hq",
    franchiseId: FRANCHISE_A,
    memberships: [],
    scope: noticeScope,
    targetStoreFranchiseId,
  });
}

describe("notice authorization policy", () => {
  test("HQ can target franchise owners only", () => {
    assert.equal(hqCanCreate(scope({ audience: "owner" })), true);
  });

  test("HQ can target all franchise members", () => {
    assert.equal(hqCanCreate(scope({ audience: "all_members" })), true);
  });

  test("HQ can target a store's owners", () => {
    assert.equal(hqCanCreate(scope({ targetType: "store", targetStoreId: STORE_A, audience: "owner" }), FRANCHISE_A), true);
  });

  test("HQ can target all members of one store", () => {
    assert.equal(hqCanCreate(scope({ targetType: "store", targetStoreId: STORE_A, audience: "all_members" }), FRANCHISE_A), true);
  });

  test("OWNER can target STAFF at an approved own store", () => {
    assert.equal(canCreateNotice({
      role: "owner",
      franchiseId: FRANCHISE_A,
      memberships: [membership()],
      scope: scope({ targetType: "store", targetStoreId: STORE_A, audience: "staff" }),
      targetStoreFranchiseId: FRANCHISE_A,
    }), true);
  });

  test("OWNER cannot target another store", () => {
    assert.equal(canCreateNotice({
      role: "owner",
      franchiseId: FRANCHISE_A,
      memberships: [membership()],
      scope: scope({ targetType: "store", targetStoreId: STORE_B, audience: "staff" }),
      targetStoreFranchiseId: FRANCHISE_A,
    }), false);
  });

  test("STAFF cannot create notices", () => {
    assert.equal(canCreateNotice({
      role: "staff",
      franchiseId: FRANCHISE_A,
      memberships: [membership({ role: "staff" })],
      scope: scope({ targetType: "store", targetStoreId: STORE_A, audience: "staff" }),
      targetStoreFranchiseId: FRANCHISE_A,
    }), false);
  });

  test("HQ cannot write to another franchise", () => {
    assert.equal(hqCanCreate(scope({ franchiseId: FRANCHISE_B })), false);
  });

  test("members cannot read another franchise's notice", () => {
    assert.equal(canReadNotice("staff", [membership({ role: "staff" })], scope({ franchiseId: FRANCHISE_B })), false);
  });

  test("unapproved memberships cannot create or read notices", () => {
    const pendingMembership = membership({ status: "pending" });
    const storeScope = scope({ targetType: "store", targetStoreId: STORE_A, audience: "staff" });
    assert.equal(canCreateNotice({
      role: "owner",
      franchiseId: FRANCHISE_A,
      memberships: [pendingMembership],
      scope: storeScope,
      targetStoreFranchiseId: FRANCHISE_A,
    }), false);
    assert.equal(canReadNotice("owner", [pendingMembership], scope({ audience: "owner" })), false);
  });
});

describe("notice routes enforce the shared policy", () => {
  test("HQ create accepts audience but limits HQ audiences and target franchise", () => {
    assert.match(hqRoute, /canCreateNotice\(/);
    assert.match(hqRoute, /audience !== "owner" && audience !== "all_members"/);
    assert.match(hqRoute, /\.eq\("franchise_id", hqUser\.franchiseId\)/);
  });

  test("OWNER has a server-side POST and STAFF has no write handler", () => {
    assert.match(bossRoute, /export async function POST\(/);
    assert.match(bossRoute, /\.eq\("role", "owner"\)[\s\S]*?\.eq\("status", "approved"\)/);
    assert.match(bossRoute, /audience: "staff"/);
    assert.match(staffRoute, /export async function GET\(/);
    assert.equal(/export async function (POST|PATCH|DELETE)\(/.test(staffRoute), false);
  });

  test("STAFF reads only approved staff memberships and server-filtered audiences", () => {
    assert.match(staffRoute, /\.eq\("role", "staff"\)[\s\S]*?\.eq\("status", "approved"\)/);
    assert.match(staffRoute, /\.select\("role"\)/);
    assert.equal(/select\("role, franchise_id"\)/.test(staffRoute), false);
    assert.match(staffRoute, /canReadNotice\("staff"/);
  });
});

describe("HQ notice creation form audience payload", () => {
  test("whole franchise + owners only keeps the existing all target", () => {
    assert.deepEqual(buildHqNoticeTarget("all", "store-ignored", "owner"), {
      targetType: "all",
      audience: "owner",
    });
  });

  test("whole franchise + owners and staff", () => {
    assert.deepEqual(buildHqNoticeTarget("all", "store-ignored", "all_members"), {
      targetType: "all",
      audience: "all_members",
    });
  });

  test("one store + owners only", () => {
    assert.deepEqual(buildHqNoticeTarget("store", STORE_A, "owner"), {
      targetType: "store",
      targetStoreId: STORE_A,
      audience: "owner",
    });
  });

  test("one store + owners and staff", () => {
    assert.deepEqual(buildHqNoticeTarget("store", STORE_A, "all_members"), {
      targetType: "store",
      targetStoreId: STORE_A,
      audience: "all_members",
    });
  });

  test("form defaults to all_members and only renders the two HQ audiences", () => {
    assert.match(hqCreatePage, /useState<HqNoticeAudience>\("all_members"\)/);
    assert.match(hqCreatePage, /label: "점주만"/);
    assert.match(hqCreatePage, /label: "점주 \+ 직원"/);
    assert.equal(/value: "staff"/.test(hqCreatePage), false);
    assert.match(hqCreatePage, /buildHqNoticeTarget\(targetType, targetStoreId, audience\)/);
  });

  test("API continues to reject staff audience and verify HQ franchise/store scope", () => {
    assert.match(hqRoute, /audience !== "owner" && audience !== "all_members"/);
    assert.match(hqRoute, /canCreateNotice\(/);
    assert.match(hqRoute, /\.eq\("franchise_id", hqUser\.franchiseId\)/);
  });
});
