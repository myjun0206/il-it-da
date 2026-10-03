import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { componentElements, createHookHarness, loadComponentModule } from "../support/component-harness.ts";
import {
  canCreateNotice,
  canReadNotice,
  canRecordNoticeRead,
  type NoticeMembership,
  type NoticeScope,
} from "../../lib/notices/notice-authorization.ts";
import { buildHqNoticeTarget } from "../../lib/notices/build-hq-notice-target.ts";
import { validateOwnerNoticeCreateRequest } from "../../lib/notices/validate-owner-notice-create-request.ts";
import { withNoticeReadStats, withNoticeReadStatus, withNoticeViewCounts } from "../../lib/notices/with-read-status.ts";
import { getNoticeViewCountIncrement } from "../../lib/notices/mark-notice-read.ts";
import { filterStaffNotices, toStaffNotice, type NoticeSourceFilter, type NoticeTargetFilter } from "../../lib/notices/notice-filters.ts";
import {
  validateNoticeContentUpdateRequest,
  validateNoticeDeleteRequest,
} from "../../lib/notices/validate-notice-mutation.ts";

// 공지 라우트는 next/server, cookies(), Supabase 클라이언트에 묶여 Next 런타임 밖에서 실행되지
// 않는다(다른 route 테스트와 동일 관행). 여기서는 021 마이그레이션과 라우트가 같은 테이블·컬럼·
// 범위 계약을 쓰는지, franchise/store 격리가 코드에 남아 있는지를 고정한다.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

const migration = readSource("supabase/migrations/021_hq_notices.sql");
const audienceMigration = readSource("supabase/migrations/033_notice_audience.sql");
const hqRoute = readSource("app/api/hq/notices/route.ts");
const bossRoute = readSource("app/api/boss/notices/route.ts");
const staffRoute = readSource("app/api/staff/notices/route.ts");
const noticeReadRoute = readSource("app/api/notices/[id]/read/route.ts");
const hqNoticesPage = readSource("app/hq/communication/page.tsx");
const hqCreatePage = readSource("app/hq/communication/new/page.tsx");
const ownerNoticesPage = readSource("app/boss/notices/page.tsx");
const ownerNoticeCreatePage = readSource("app/boss/notices/new/page.tsx");
const staffNoticesPage = readSource("app/staff/notices/page.tsx");
const noticeCard = readSource("components/notices/NoticeCard.tsx");
const noticeFilter = readSource("components/notices/NoticeFilter.tsx");
const noticeMeta = readSource("components/notices/NoticeMeta.tsx");
const markNoticeReadHelper = readSource("lib/notices/mark-notice-read.ts");

function noticePageScenario(role: "hq" | "owner" | "staff", multiple = false) {
  const notice = {
    id: "notice-a", title: "Kitchen Safety", content: "Check the equipment before opening.",
    createdAt: "2026-09-21T12:00:00.000Z", viewCount: 7, isRead: false,
    sourceLabel: "본사 공지", sourceType: "hq", targetType: "store", targetStoreId: "store-a",
    target: "Store A", isMine: false, category: "운영 안내", isImportant: false,
  };
  const rows = multiple ? [notice,
    { ...notice, id: "notice-b", title: "Store Schedule", content: "Kitchen opening shifts", sourceLabel: "점주 공지", sourceType: "owner", target: "Store B", isMine: true, category: "기타" },
    { ...notice, id: "notice-c", title: "Franchise Safety", targetType: "franchise", target: "전체 지점", targetStoreId: null },
  ] : [notice];
  const initialStates = role === "hq"
    ? ["Tester", "Cafe", true, rows, false, "", "", "all", "all", null, null, null, false]
    : role === "owner"
      ? [true, "Tester", "Store A", "store-a", { notices: rows, summary: { total: rows.length, important: 0 } }, false, "", "all", "", "전체", null, null, null, false]
      : [{ key: "store-a:0", status: "ready", notices: rows }, 0, "", "all", "all", null];
  const harness = createHookHarness(initialStates);
  const navigations: string[] = [];
  const reads: string[] = [];
  const emptyLayout = () => null;
  const overrides = {
    react: harness.react,
    "next/navigation": { useRouter: () => ({ push: (href: string) => navigations.push(href) }) },
    "next/link": { default: (props: { children: ReactNode; href: string }) => createElement("a", { href: props.href }, props.children), __esModule: true },
    "@/lib/supabase/client": { createClient: () => { throw new Error("Unexpected auth request"); } },
    "@/lib/owner/current-store": { resolveOwnerCurrentStore: () => { throw new Error("Unexpected store request"); } },
    "@/components/hq/HQSidebar": { default: emptyLayout, __esModule: true },
    "@/components/hq/HQHeader": { default: emptyLayout, __esModule: true },
    "@/components/owner/OwnerSidebar": { default: emptyLayout, __esModule: true },
    "@/components/owner/OwnerHeader": { default: emptyLayout, __esModule: true },
    "@/components/staff/StaffShellContext": { useStaffShell: () => ({ selectedStore: { id: "store-a" }, stores: [{ id: "store-a" }], isStoresLoading: false, storesError: "" }) },
    "@/lib/notices/mark-notice-read": {
      getNoticeViewCountIncrement,
      markNoticeAsRead: async (id: string) => { reads.push(id); return { succeeded: true, alreadyRead: false }; },
    },
  };
  const relativePath = role === "hq" ? "app/hq/communication/page.tsx" : role === "owner" ? "app/boss/notices/page.tsx" : "app/staff/notices/page.tsx";
  const componentModule = loadComponentModule<{ default: () => ReactNode }>(relativePath, overrides);
  return { notice, reads, navigations, render: () => harness.render(componentModule.default) };
}

async function assertNoticeDetail(role: "hq" | "owner" | "staff") {
  const scenario = noticePageScenario(role);
  const initial = scenario.render();
  const markup = renderToStaticMarkup(initial);
  assert.ok(markup.includes(scenario.notice.title), role);
  assert.match(markup, /조회 7/);
  const titleControl = componentElements(initial).find((element) =>
    element.props.title === scenario.notice.title && typeof element.props.onOpen === "function"
    || element.type === "button" && typeof element.props.onClick === "function" && renderToStaticMarkup(element).includes(scenario.notice.title),
  );
  assert.ok(titleControl, `${role}: title must be actionable`);
  ((titleControl.props.onOpen ?? titleControl.props.onClick) as () => void)();
  await Promise.resolve();
  const selected = componentElements(scenario.render()).find((element) => (element.props.notice as { title?: string } | undefined)?.title === scenario.notice.title);
  assert.ok(selected, `${role}: click must select a detail dialog`);
  const detail = renderToStaticMarkup(selected);
  assert.match(detail, /role="dialog"/);
  assert.match(detail, /aria-modal="true"/);
  assert.ok(detail.includes(scenario.notice.title));
  assert.ok(detail.includes(scenario.notice.content));
  assert.ok(detail.includes("2026.09.21"));
  assert.match(detail, new RegExp(`조회 ${role === "hq" ? 7 : 8}`));
  assert.deepEqual(scenario.navigations, []);
  assert.deepEqual(scenario.reads, role === "hq" ? [] : [scenario.notice.id]);
  (selected.props.onClose as () => void)();
  assert.equal(componentElements(scenario.render()).some((element) => element.props.notice), false);
}

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
  test("모든 HQ route handler는 requireHqUser를 통과해야 한다", () => {
    assert.equal(hqRoute.match(/const hqUser = await requireHqUser\(\)/g)?.length, 4);
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

  test("HQ GET excludes OWNER STAFF notices and keeps both HQ audiences", () => {
    assert.match(hqRoute, /\.eq\("franchise_id", hqUser\.franchiseId\)\s*\.in\("audience", \["owner", "all_members"\]\)/);

    const candidates = [
      { id: "hq-owner", franchise_id: FRANCHISE_A, author_id: "hq-user", target_type: "all", audience: "owner" },
      { id: "hq-all", franchise_id: FRANCHISE_A, author_id: "hq-user", target_type: "franchise", audience: "all_members" },
      { id: "owner-staff-current-store", franchise_id: FRANCHISE_A, author_id: "owner-user", target_type: "store", target_store_id: STORE_A, audience: "staff" },
      { id: "owner-staff-other-store", franchise_id: FRANCHISE_A, author_id: "owner-user", target_type: "store", target_store_id: STORE_B, audience: "staff" },
      { id: "other-franchise-owner", franchise_id: FRANCHISE_B, author_id: "other-hq", target_type: "all", audience: "owner" },
    ];
    const visible = candidates.filter((notice) =>
      notice.franchise_id === FRANCHISE_A
      && (notice.audience === "owner" || notice.audience === "all_members"),
    );

    assert.deepEqual(visible.map((notice) => notice.id), ["hq-owner", "hq-all"]);
    assert.ok(visible.some((notice) => notice.author_id === "hq-user" && notice.audience === "owner"));
    assert.ok(visible.some((notice) => notice.author_id === "hq-user" && notice.audience === "all_members"));
  });

  test("HQ GET response retains the content and created date needed for detail", () => {
    assert.match(hqRoute, /select\("id, author_id, target_type, target_store_id, audience, title, content, created_at"\)/);
    assert.match(hqRoute, /content: row\.content/);
    assert.match(hqRoute, /createdAt: row\.created_at/);
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

  test("HQ PATCH/DELETE are author- and franchise-scoped and only update content", () => {
    assert.match(hqRoute, /export async function PATCH\(/);
    assert.match(hqRoute, /export async function DELETE\(/);
    assert.match(hqRoute, /notice\.author_id !== hqUser\.userId/);
    assert.match(hqRoute, /\.eq\("author_id", hqUser\.userId\)/);
    assert.match(hqRoute, /\.update\(\{ title, content, updated_at:/);
    assert.match(hqRoute, /\.eq\("franchise_id", authorization\.context\.franchiseId\)/);
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

  test("OWNER also receives only their own STAFF notices for the verified current store", () => {
    assert.match(
      bossRoute,
      /\.eq\("franchise_id", store\.franchise_id\)[\s\S]*?\.eq\("target_type", "store"\)[\s\S]*?\.eq\("target_store_id", storeId\)[\s\S]*?\.eq\("audience", "staff"\)[\s\S]*?\.eq\("author_id", user\.id\)/,
    );
    assert.match(bossRoute, /\.\.\.\(ownStaffNoticeRows \?\? \[\]\)/);
    assert.match(bossRoute, /\.eq\("user_id", user\.id\)[\s\S]*?\.eq\("store_id", storeId\)[\s\S]*?\.eq\("role", "owner"\)[\s\S]*?\.eq\("status", "approved"\)/);
  });

  test("franchise가 없는 매장은 공지를 하나도 노출하지 않는다", () => {
    assert.match(bossRoute, /if \(!store\?\.franchise_id\) \{\s*return NextResponse\.json\(\{ success: true, data: \{ notices: \[\], summary/);
  });

  test("migration 미적용 환경에서는 빈 목록으로 응답한다", () => {
    assert.match(bossRoute, /isMissingTableError\(noticeError\) \|\| isMissingTableError\(ownStaffNoticeError\)/);
  });

  test("응답에 author_id 같은 내부 식별자를 내보내지 않는다", () => {
    assert.match(bossRoute, /isMine: row\.author_id === user\.id/);
    assert.equal(/author_id:\s*row\.author_id/.test(bossRoute), false);
  });

  test("OWNER PATCH/DELETE revalidate author, approved membership, store, franchise, type, and audience", () => {
    assert.match(bossRoute, /export async function PATCH\(/);
    assert.match(bossRoute, /export async function DELETE\(/);
    assert.match(bossRoute, /notice\.author_id !== actor\.userId/);
    assert.match(bossRoute, /notice\.target_type !== "store" \|\| notice\.audience !== "staff"/);
    assert.match(bossRoute, /\.eq\("user_id", actor\.userId\)[\s\S]*?\.eq\("store_id", notice\.target_store_id\)[\s\S]*?\.eq\("role", "owner"\)[\s\S]*?\.eq\("status", "approved"\)/);
    assert.match(bossRoute, /membership\.franchise_id !== store\.franchise_id \|\| notice\.franchise_id !== store\.franchise_id/);
    assert.match(bossRoute, /\.update\(\{ title, content, updated_at:/);
    assert.match(bossRoute, /\.eq\("author_id", actorResult\.actor\.userId\)[\s\S]*?\.eq\("target_store_id", authorization\.scope\.storeId\)[\s\S]*?\.eq\("audience", "staff"\)/);
    assert.match(bossRoute, /isMine: row\.author_id === user\.id[\s\S]*?row\.target_type === "store"[\s\S]*?row\.target_store_id === storeId[\s\S]*?row\.audience === "staff"/);
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

  test("OWNER cannot target another franchise or a mismatched membership franchise", () => {
    assert.equal(canCreateNotice({
      role: "owner",
      franchiseId: FRANCHISE_A,
      memberships: [membership()],
      scope: scope({ franchiseId: FRANCHISE_B, targetType: "store", targetStoreId: STORE_A, audience: "staff" }),
      targetStoreFranchiseId: FRANCHISE_B,
    }), false);
    assert.equal(canCreateNotice({
      role: "owner",
      franchiseId: FRANCHISE_A,
      memberships: [membership({ franchiseId: FRANCHISE_A })],
      scope: scope({ targetType: "store", targetStoreId: STORE_A, audience: "staff" }),
      targetStoreFranchiseId: FRANCHISE_B,
    }), false);
  });

  test("OWNER cannot target owner, all_members, or a broad scope", () => {
    for (const deniedScope of [
      scope({ targetType: "store", targetStoreId: STORE_A, audience: "owner" }),
      scope({ targetType: "store", targetStoreId: STORE_A, audience: "all_members" }),
      scope({ targetType: "all", targetStoreId: null, audience: "staff" }),
      scope({ targetType: "franchise", targetStoreId: null, audience: "staff" }),
    ]) {
      assert.equal(canCreateNotice({
        role: "owner",
        franchiseId: FRANCHISE_A,
        memberships: [membership()],
        scope: deniedScope,
        targetStoreFranchiseId: FRANCHISE_A,
      }), false);
    }
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

  test("OWNER read policy stays limited to HQ audiences, not staff", () => {
    const approvedOwner = [membership()];
    const storeScope = scope({ targetType: "store", targetStoreId: STORE_A });
    assert.equal(canReadNotice("owner", approvedOwner, { ...storeScope, audience: "staff" }), false);
    assert.equal(canReadNotice("owner", approvedOwner, { ...storeScope, audience: "owner" }), true);
    assert.equal(canReadNotice("owner", approvedOwner, { ...storeScope, audience: "all_members" }), true);
  });
});

describe("notice read authorization", () => {
  test("STAFF can record a read only for an approved membership's own store notice", () => {
    const staffMembership: NoticeMembership = { ...membership(), role: "staff" };
    const storeNotice = scope({ targetType: "store", targetStoreId: STORE_A, audience: "staff" });
    assert.equal(canRecordNoticeRead("staff-user", "staff", { ...storeNotice, authorId: "owner-user" }, [staffMembership]), true);
    assert.equal(canRecordNoticeRead("staff-user", "staff", {
      ...storeNotice,
      targetStoreId: STORE_B,
      authorId: "owner-user",
    }, [staffMembership]), false);
    assert.equal(canRecordNoticeRead("staff-user", "staff", {
      ...storeNotice,
      franchiseId: FRANCHISE_B,
      authorId: "owner-user",
    }, [staffMembership]), false);
    assert.equal(canRecordNoticeRead("staff-user", "staff", {
      ...storeNotice,
      audience: "owner",
      authorId: "hq-user",
    }, [staffMembership]), false);
    assert.equal(canRecordNoticeRead("staff-user", "staff", { ...storeNotice, authorId: "owner-user" }, [
      { ...staffMembership, status: "pending" },
    ]), false);
  });

  test("OWNER can read normal owner audiences and only their own current-store staff notice", () => {
    const ownerMembership = membership();
    const storeNotice = scope({ targetType: "store", targetStoreId: STORE_A, audience: "staff" });
    assert.equal(canRecordNoticeRead("owner-user", "owner", {
      ...scope({ targetType: "store", targetStoreId: STORE_A, audience: "owner" }),
      authorId: "hq-user",
    }, [ownerMembership]), true);
    assert.equal(canRecordNoticeRead("owner-user", "owner", {
      ...scope({ targetType: "store", targetStoreId: STORE_A, audience: "all_members" }),
      authorId: "hq-user",
    }, [ownerMembership]), true);
    assert.equal(canRecordNoticeRead("owner-user", "owner", { ...storeNotice, authorId: "owner-user" }, [ownerMembership]), true);
    assert.equal(canRecordNoticeRead("owner-user", "owner", { ...storeNotice, authorId: "another-owner" }, [ownerMembership]), false);
    assert.equal(canRecordNoticeRead("owner-user", "owner", {
      ...storeNotice,
      targetStoreId: STORE_B,
      authorId: "owner-user",
    }, [ownerMembership]), false);
  });

  test("HQ is not treated as a recipient even when it authored an HQ notice", () => {
    assert.equal(canRecordNoticeRead("hq-user", "hq", {
      ...scope({ audience: "all_members" }),
      authorId: "hq-user",
    }, []), false);
  });
});

describe("notice isRead/viewCount mapping and GET queries", () => {
  test("maps only IDs returned for the current user to read notices", () => {
    const notices = [{ id: "hq-notice" }, { id: "owner-staff-notice" }, { id: "unread-notice" }];
    assert.deepEqual(withNoticeReadStatus(notices, ["hq-notice", "owner-staff-notice"]), [
      { id: "hq-notice", isRead: true },
      { id: "owner-staff-notice", isRead: true },
      { id: "unread-notice", isRead: false },
    ]);
    assert.deepEqual(withNoticeReadStatus(notices, []), notices.map((notice) => ({ ...notice, isRead: false })));
  });

  test("OWNER batches reads for the merged HQ and own STAFF notices, scoped to current user", () => {
    assert.match(bossRoute, /\.eq\("audience", "staff"\)[\s\S]*?\.eq\("author_id", user\.id\)/);
    assert.match(bossRoute, /if \(readableRows\.length > 0\)[\s\S]*?\.from\("notice_reads"\)[\s\S]*?\.select\("notice_id,user_id"\)[\s\S]*?\.in\("notice_id", readableRows\.map\(\(row\) => row\.id\)\)/);
    assert.match(bossRoute, /withNoticeReadStats\(noticeItems, readRecords, user\.id\)/);
    assert.equal((bossRoute.match(/\.from\("notice_reads"\)/g) ?? []).length, 1);
  });

  test("STAFF batches reads after existing access filtering and skips empty lists", () => {
    assert.match(staffRoute, /\.filter\(\(row\) => canReadNotice\("staff"/);
    assert.match(staffRoute, /if \(noticesData\.length > 0\)[\s\S]*?\.from\("notice_reads"\)[\s\S]*?\.select\("notice_id,user_id"\)[\s\S]*?\.in\("notice_id", noticesData\.map\(\(row\) => row\.id\)\)/);
    assert.match(staffRoute, /withNoticeReadStats\(noticeItems, readRecords, userId\)/);
    assert.equal((staffRoute.match(/\.from\("notice_reads"\)/g) ?? []).length, 1);
  });

  test("HQ batches reads for view counts and skips empty lists", () => {
    assert.match(hqRoute, /if \(noticeItems\.length > 0\)[\s\S]*?\.from\("notice_reads"\)[\s\S]*?\.select\("notice_id,user_id"\)[\s\S]*?\.in\("notice_id", noticeItems\.map\(\(notice\) => notice\.id\)\)/);
    assert.match(hqRoute, /withNoticeViewCounts\(noticeItems, readRecords\)/);
    assert.match(readSource("lib/types/notice.ts"), /viewCount: number/);
    assert.equal((hqRoute.match(/\.from\("notice_reads"\)/g) ?? []).length, 1);
  });

  test("all role pages use shared card and detail metadata", async () => {
    assert.match(bossRoute, /isRead: boolean/);
    assert.match(bossRoute, /viewCount: number/);
    assert.match(staffRoute, /isRead: boolean/);
    assert.match(staffRoute, /viewCount: number/);
    for (const role of ["hq", "owner", "staff"] as const) await assertNoticeDetail(role);
    assert.match(ownerNoticesPage, /isRead=\{notice\.isRead\}/);
    assert.match(staffNoticesPage, /!notice\.isRead/);
    assert.match(noticeCard, /<NoticeReadStatus isRead=\{isRead\} \/>/);
    assert.match(noticeMeta, /조회 \{viewCount\}/);
    assert.match(noticeCard, /viewCount=\{viewCount\}/);
    assert.match(hqNoticesPage, /viewCount=\{notice\.viewCount\}/);
    assert.match(hqNoticesPage, /isRead=\{null\}/);
    assert.doesNotMatch(hqNoticesPage, /markNoticeAsRead/);
  });
});

describe("notice source and target filters", () => {
  test("role filter controls compose without resetting the other active filters (component handlers)", () => {
    for (const role of ["hq", "owner", "staff"] as const) {
      const scenario = noticePageScenario(role, true);
      const change = (predicate: (element: ReturnType<typeof componentElements>[number]) => boolean, value: string, event = false) => {
        const control = componentElements(scenario.render()).find(predicate);
        assert.ok(control, `${role}: missing filter control`);
        (control.props.onChange as (value: unknown) => void)(event ? { target: { value } } : value);
      };
      const hasTitles = (titles: string[]) => {
        const markup = renderToStaticMarkup(scenario.render());
        for (const title of ["Kitchen Safety", "Store Schedule", "Franchise Safety"]) {
          assert.equal(markup.includes(title), titles.includes(title), `${role}: ${title}`);
        }
      };
      const search = (value: string) => change((element) => typeof element.props.onChange === "function" && typeof element.props.placeholder === "string", value, true);
      if (role === "hq") {
        change((element) => element.props.ariaLabel === "공지 대상 범위", "store");
        change((element) => element.props["aria-label"] === "공지 대상 지점 필터", "Store A", true);
        search("  Kitchen  ");
        hasTitles(["Kitchen Safety"]);
        search("");
        hasTitles(["Kitchen Safety"]);
      } else if (role === "owner") {
        change((element) => element.props.ariaLabel === "공지 출처", "hq");
        change((element) => element.type === "select", "기타", true);
        search("Kitchen");
        hasTitles([]);
        change((element) => element.props.ariaLabel === "공지 출처", "mine");
        hasTitles(["Store Schedule"]);
        search("missing");
        hasTitles([]);
        search("");
        hasTitles(["Store Schedule"]);
      } else {
        change((element) => element.props["aria-label"] === "공지 대상 필터", "store", true);
        const source = componentElements(scenario.render()).find((element) => element.type === "button" && element.props.children === "매장 공지");
        assert.ok(source);
        (source.props.onClick as () => void)();
        search("  KITCHEN  ");
        hasTitles(["Store Schedule"]);
        change((element) => element.props["aria-label"] === "공지 대상 필터", "franchise", true);
        hasTitles([]);
        change((element) => element.props["aria-label"] === "공지 대상 필터", "store", true);
        hasTitles(["Store Schedule"]);
        search("missing");
        hasTitles([]);
        search("");
        hasTitles(["Store Schedule"]);
      }
    }
  });

  test("shared filter buttons expose pressed state and keyboard focus", () => {
    assert.match(noticeFilter, /aria-pressed=\{isSelected\}/);
    assert.match(noticeFilter, /focus-visible:ring-2/);
    for (const label of ["전체", "전체 지점", "특정 지점"]) {
      assert.match(hqNoticesPage, new RegExp(`label: "${label}"`));
    }
  });

  test("HQ preserves target fields and filters all/franchise/store in the client", () => {
    assert.match(hqNoticesPage, /targetType: notice\.targetType/);
    assert.match(hqNoticesPage, /targetStoreId: notice\.targetStoreId/);
    assert.match(hqNoticesPage, /useState<HqNoticeFilter>\("all"\)/);
    assert.match(hqNoticesPage, /notice\.targetType === "all" \|\| notice\.targetType === "franchise"/);
    assert.match(hqNoticesPage, /notice\.targetType === "store"/);
    assert.match(hqNoticesPage, /setTargetFilter\(ALL_TARGETS\)/);
  });

  test("OWNER filters the already-merged authorized list by isMine", () => {
    assert.match(ownerNoticesPage, /useState<OwnerNoticeFilter>\("all"\)/);
    assert.match(ownerNoticesPage, /sourceFilter === "hq" && notice\.isMine/);
    assert.match(ownerNoticesPage, /sourceFilter === "mine" && !notice\.isMine/);
    assert.match(ownerNoticesPage, /label: "본사 공지"/);
    assert.match(ownerNoticesPage, /label: "내 공지"/);
    assert.match(bossRoute, /\.\.\.\(ownStaffNoticeRows \?\? \[\]\)/);
    assert.match(bossRoute, /isMine: row\.author_id === user\.id/);
  });

  test("STAFF maps sourceLabel to sourceType and keeps target filters independent", () => {
    assert.deepEqual(toStaffNotice({ id: "owner", sourceLabel: "점주 공지" }), { id: "owner", sourceLabel: "점주 공지", sourceType: "owner" });
    assert.deepEqual(toStaffNotice({ id: "hq", sourceLabel: "본사 공지" }), { id: "hq", sourceLabel: "본사 공지", sourceType: "hq" });
    assert.match(staffNoticesPage, /filterStaffNotices\(allNotices, \{ source: sourceFilter, target: targetFilter, query \}\)/);
    assert.match(staffNoticesPage, /onClick={\(\) => setSourceFilter\(value\)}/);
    assert.match(staffNoticesPage, /onChange={\(event\) => setTargetFilter\(event\.target\.value as NoticeTargetFilter\)}/);
    assert.match(staffNoticesPage, /requestKey = storeId \? `\$\{storeId\}:\$\{reloadToken\}` : null/);
    assert.match(staffNoticesPage, /fetch\(`\/api\/staff\/notices\?storeId=\$\{encodeURIComponent\(storeId!\)\}`/);
    assert.match(staffRoute, /sourceLabel: row\.audience === "staff" \? "점주 공지" : "본사 공지"/);
    assert.match(staffNoticesPage, /label: "본사 공지"/);
    assert.match(staffNoticesPage, /label: "매장 공지"/);
  });

  test("role filters are local state and compose with existing search", () => {
    assert.match(hqNoticesPage, /\.filter\(\(notice\) => !query \|\| notice\.title\.toLowerCase\(\)\.includes\(query\)\)/);
    assert.match(ownerNoticesPage, /const query = searchQuery\.toLowerCase\(\)\.trim\(\)/);
    const notices = [
      { id: "hq-all", sourceType: "hq", targetType: "all", title: "Recipe", content: "Alpha" },
      { id: "hq-franchise", sourceType: "hq", targetType: "franchise", title: "Safety", content: "Recipe" },
      { id: "hq-store", sourceType: "hq", targetType: "store", title: "Recipe", content: "Beta" },
      { id: "owner-store", sourceType: "owner", targetType: "store", title: "Closing", content: "Recipe" },
    ] as const;
    for (const source of ["all", "hq", "owner"] satisfies NoticeSourceFilter[]) {
      for (const target of ["all", "franchise", "store"] satisfies NoticeTargetFilter[]) {
        for (const query of ["", "  RECIPE  ", "closing", "missing"]) {
          const expected = notices.filter((notice) =>
            (source === "all" || notice.sourceType === source)
            && (target === "all" || (target === "franchise" ? notice.targetType !== "store" : notice.targetType === "store"))
            && `${notice.title} ${notice.content}`.toLowerCase().includes(query.trim().toLowerCase()),
          ).map((notice) => notice.id);
          assert.deepEqual(filterStaffNotices(notices, { source, target, query }).map((notice) => notice.id), expected, JSON.stringify({ source, target, query }));
        }
      }
    }
    assert.match(hqNoticesPage, /void loadNotices\(\);\s*\}, \[isReady\]\)/);
    assert.match(ownerNoticesPage, /fetchNotices\(\);\s*\}, \[selectedStoreId\]\)/);
    assert.match(staffNoticesPage, /\}, \[storeId, requestKey, router\]\)/);
  });
});

describe("notice view count mapping", () => {
  test("counts unique readers by notice, isolates other notices, and handles no notices", () => {
    const notices = [{ id: "notice-a" }, { id: "notice-b" }];
    const records = [
      { notice_id: "notice-a", user_id: "user-1" },
      { notice_id: "notice-a", user_id: "user-2" },
      { notice_id: "notice-a", user_id: "user-3" },
      { notice_id: "notice-a", user_id: "user-1" },
      { notice_id: "notice-b", user_id: "user-4" },
    ];

    assert.deepEqual(withNoticeReadStats(notices, records, "user-2"), [
      { id: "notice-a", isRead: true, viewCount: 3 },
      { id: "notice-b", isRead: false, viewCount: 1 },
    ]);
    assert.deepEqual(withNoticeReadStats([{ id: "notice-a" }], [
      { notice_id: "notice-a", user_id: "user-1" },
      { notice_id: "notice-a", user_id: "user-1" },
      { notice_id: "notice-a", user_id: "user-2" },
    ], "unread-user"), [
      { id: "notice-a", isRead: false, viewCount: 2 },
    ]);
    assert.deepEqual(withNoticeReadStats([], records, "user-2"), []);
  });

  test("adds unique-reader counts without assigning an HQ read state", () => {
    assert.deepEqual(withNoticeViewCounts([{ id: "notice-a" }, { id: "notice-b" }], [
      { notice_id: "notice-a", user_id: "user-1" },
      { notice_id: "notice-a", user_id: "user-1" },
      { notice_id: "notice-b", user_id: "user-2" },
    ]), [
      { id: "notice-a", viewCount: 1 },
      { id: "notice-b", viewCount: 1 },
    ]);
  });
});

describe("notice read status mapping", () => {
  test("maps only the current user's batched read IDs to true", () => {
    const notices = [{ id: "read-notice" }, { id: "unread-notice" }];
    assert.deepEqual(withNoticeReadStatus(notices, ["read-notice"]), [
      { id: "read-notice", isRead: true },
      { id: "unread-notice", isRead: false },
    ]);
    assert.deepEqual(withNoticeReadStatus(notices, []), [
      { id: "read-notice", isRead: false },
      { id: "unread-notice", isRead: false },
    ]);
  });
});

describe("OWNER and STAFF GET read status queries", () => {
  test("OWNER batches one read lookup across HQ and own STAFF notices for the session user", () => {
    assert.match(bossRoute, /\.in\("audience", \["owner", "all_members"\]\)/);
    assert.match(bossRoute, /\.eq\("author_id", user\.id\)/);
    assert.match(bossRoute, /if \(readableRows\.length > 0\)[\s\S]*?\.from\("notice_reads"\)[\s\S]*?\.select\("notice_id,user_id"\)[\s\S]*?\.in\("notice_id", readableRows\.map\(\(row\) => row\.id\)\)/);
    assert.match(bossRoute, /withNoticeReadStats\(noticeItems, readRecords, user\.id\)/);
  });

  test("STAFF batches one read lookup after the existing access filter and skips empty lists", () => {
    assert.match(staffRoute, /\.filter\(\(row\) => canReadNotice\("staff"/);
    assert.match(staffRoute, /if \(noticesData\.length > 0\)[\s\S]*?\.from\("notice_reads"\)[\s\S]*?\.select\("notice_id,user_id"\)[\s\S]*?\.in\("notice_id", noticesData\.map\(\(row\) => row\.id\)\)/);
    assert.match(staffRoute, /withNoticeReadStats\(noticeItems, readRecords, userId\)/);
  });
});

describe("POST /api/notices/[id]/read route contract", () => {
  test("uses the authenticated session user and does not parse a client user_id", () => {
    assert.match(noticeReadRoute, /sessionClient\.auth\.getUser\(\)/);
    assert.match(noticeReadRoute, /user_id: user\.id/);
    assert.equal(/request\.json\(\)|body\.user_id/.test(noticeReadRoute), false);
  });

  test("returns 404 for missing notices and rejects HQ/non-recipient roles", () => {
    assert.match(noticeReadRoute, /if \(!notice\)[\s\S]*?status: 404/);
    assert.match(noticeReadRoute, /profile\?\.role !== "owner" && profile\?\.role !== "staff"/);
    assert.match(noticeReadRoute, /status: 403/);
  });

  test("validates approved role memberships and actual store/franchise before authorization", () => {
    assert.match(noticeReadRoute, /\.eq\("user_id", user\.id\)[\s\S]*?\.eq\("role", role\)[\s\S]*?\.eq\("status", "approved"\)/);
    assert.match(noticeReadRoute, /membership\.franchise_id !== store\.franchise_id/);
    assert.match(noticeReadRoute, /targetStore\.franchise_id !== notice\.franchise_id/);
    assert.match(noticeReadRoute, /canRecordNoticeRead\(user\.id, role/);
  });

  test("uses an idempotent notice/user upsert without setting read_at", () => {
    assert.match(noticeReadRoute, /\.from\("notice_reads"\)[\s\S]*?\.upsert\(/);
    assert.match(noticeReadRoute, /onConflict: "notice_id,user_id", ignoreDuplicates: true/);
    assert.match(noticeReadRoute, /alreadyRead: !inserted/);
    assert.equal(/read_at\s*:/.test(noticeReadRoute), false);
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
    assert.match(bossRoute, /ownerMembership\.franchise_id !== store\.franchise_id/);
    assert.match(bossRoute, /validateOwnerNoticeCreateRequest\(body\)/);
    assert.match(bossRoute, /\{ status: 400 \}/);
    assert.match(bossRoute, /target_type: "store"/);
    assert.match(bossRoute, /target_store_id: store\.id/);
    assert.match(bossRoute, /franchise_id: store\.franchise_id/);
    assert.match(bossRoute, /author_id: user\.id/);
    assert.match(staffRoute, /export async function GET\(/);
    assert.equal(/export async function (POST|PATCH|DELETE)\(/.test(staffRoute), false);
  });

  test("STAFF reads only approved staff memberships and server-filtered audiences", () => {
    assert.match(staffRoute, /requireServerRole\("staff"\)/);
    assert.match(staffRoute, /searchParams\.get\("storeId"\)/);
    assert.match(staffRoute, /code: "STORE_REQUIRED" \}, \{ status: 400 \}/);
    assert.match(
      staffRoute,
      /\.eq\("user_id", userId\)[\s\S]*?\.eq\("store_id", storeId\)[\s\S]*?\.eq\("role", "staff"\)[\s\S]*?\.eq\("status", "approved"\)/,
    );
    assert.match(staffRoute, /code: "STORE_FORBIDDEN" \}, \{ status: 403 \}/);
    assert.match(staffRoute, /membership\.franchise_id !== store\.franchise_id/);
    assert.equal(/select\("role, franchise_id"\)/.test(staffRoute), false);
    assert.match(staffRoute, /fetchNoticesForStore\(adminClient, storeId\)/);
    assert.match(staffRoute, /\.eq\("franchise_id", store\.franchise_id\)[\s\S]*?\.in\("audience", \["all_members", "staff"\]\)/);
    assert.match(staffRoute, /canReadNotice\("staff"/);
  });
});

describe("OWNER notice create request contract", () => {
  test("accepts only storeId, title, and content", () => {
    assert.deepEqual(validateOwnerNoticeCreateRequest({ storeId: STORE_A, title: "Title", content: "Body" }), {
      success: true,
      data: { storeId: STORE_A, title: "Title", content: "Body" },
    });
  });

  for (const [forbiddenField, forbiddenValue] of [
    ["audience", "owner"],
    ["audience", "all_members"],
    ["targetType", "all"],
    ["targetType", "franchise"],
    ["targetStoreId", STORE_B],
    ["franchiseId", FRANCHISE_B],
  ]) {
    test(`rejects ${forbiddenField}=${forbiddenValue}`, () => {
      const result = validateOwnerNoticeCreateRequest({
        storeId: STORE_A,
        title: "Title",
        content: "Body",
        [forbiddenField]: forbiddenValue,
      });
      assert.deepEqual(result, { success: false, reason: "unsupported_field" });
    });
  }

  test("OWNER notices page exposes the create route and keeps current-store loading", () => {
    assert.match(ownerNoticesPage, /\/boss\/notices\/new/);
    assert.match(ownerNoticesPage, /resolveOwnerCurrentStore\(\)/);
  });

  test("OWNER create UI sends only the current store and notice content", () => {
    assert.match(ownerNoticeCreatePage, /resolveOwnerCurrentStore\(\)/);
    assert.match(
      ownerNoticeCreatePage,
      /body: JSON\.stringify\(\{\s*storeId: currentStore\.storeId,\s*title: trimmedTitle,\s*content: trimmedContent,\s*\}\)/,
    );
    assert.equal(/\b(audience|targetType|targetStoreId|franchiseId)\s*:/.test(ownerNoticeCreatePage), false);
  });
});

describe("notice mutation request allowlists", () => {
  test("content update accepts only id, title, and content", () => {
    assert.deepEqual(validateNoticeContentUpdateRequest({ id: "notice-1", title: "Title", content: "Content" }), {
      success: true,
      data: { id: "notice-1", title: "Title", content: "Content" },
    });
  });

  for (const forbiddenField of ["author_id", "franchise_id", "target_type", "target_store_id", "audience"]) {
    test(`content update rejects ${forbiddenField}`, () => {
      assert.deepEqual(validateNoticeContentUpdateRequest({
        id: "notice-1",
        title: "Title",
        content: "Content",
        [forbiddenField]: "forbidden",
      }), { success: false });
    });
  }

  test("delete accepts only notice id", () => {
    assert.deepEqual(validateNoticeDeleteRequest({ id: "notice-1" }), {
      success: true,
      data: { id: "notice-1" },
    });
    assert.deepEqual(validateNoticeDeleteRequest({ id: "notice-1", author_id: "other-user" }), { success: false });
  });
});

describe("notice mutation UI ownership controls", () => {
  test("HQ edit/delete actions are shown only for notices marked as mine", () => {
    assert.match(hqRoute, /isMine: row\.author_id === hqUser\.userId/);
    assert.match(hqNoticesPage, /selectedNotice\.isMine \?/);
    assert.match(hqNoticesPage, /<NoticeEditDialog/);
    assert.match(hqNoticesPage, /<ConfirmDialog/);
  });

  test("HQ notice title opens an in-page dialog with title, content, and date", async () => {
    await assertNoticeDetail("hq");
  });

  test("OWNER edit/delete actions are shown only for notices marked as mine", () => {
    assert.match(bossRoute, /isMine: row\.author_id === user\.id/);
    assert.match(ownerNoticesPage, /selectedNotice\.isMine \?/);
    assert.match(ownerNoticesPage, /<NoticeEditDialog/);
    assert.match(ownerNoticesPage, /<ConfirmDialog/);
  });
});

describe("STAFF notice detail interaction", () => {
  test("opens a dialog from the list without navigating to a missing id route", async () => {
    assert.equal(/href=\{`\/staff\/notices\/\$\{notice\.id\}`\}/.test(staffNoticesPage), false);
    await assertNoticeDetail("staff");
  });
});

describe("notice read API UI wiring", () => {
  test("only a successful first read increments the view count", () => {
    assert.equal(getNoticeViewCountIncrement({ succeeded: true, alreadyRead: false }), 1);
    assert.equal(getNoticeViewCountIncrement({ succeeded: true, alreadyRead: true }), 0);
    assert.equal(getNoticeViewCountIncrement({ succeeded: false, alreadyRead: false }), 0);
  });

  test("OWNER and STAFF apply the increment only after a successful read request", () => {
    assert.match(ownerNoticesPage, /markNoticeAsRead\(notice\.id\)\.then\(\(result\) => \{[\s\S]*?if \(!result\.succeeded\) return;[\s\S]*?getNoticeViewCountIncrement\(result\)[\s\S]*?viewCount: currentNotice\.viewCount \+ viewCountIncrement/);
    assert.match(staffNoticesPage, /markNoticeAsRead\(notice\.id\)\.then\(\(result\) => \{[\s\S]*?if \(!result\.succeeded\) return;[\s\S]*?getNoticeViewCountIncrement\(result\)[\s\S]*?viewCount: currentNotice\.viewCount \+ viewCountIncrement/);
    assert.doesNotMatch(hqNoticesPage, /markNoticeAsRead/);
    assert.match(hqNoticesPage, /viewCount=\{notice\.viewCount\}/);
  });

  test("read helper POSTs the notice route without a user_id body and tolerates failures", () => {
    assert.match(markNoticeReadHelper, /`\/api\/notices\/\$\{encodeURIComponent\(noticeId\)\}\/read`/);
    assert.match(markNoticeReadHelper, /method: "POST"/);
    assert.equal(/body\s*:/.test(markNoticeReadHelper), false);
    assert.match(markNoticeReadHelper, /Promise<MarkNoticeAsReadResult>/);
    assert.match(markNoticeReadHelper, /if \(!response\.ok\)[\s\S]*?succeeded: false/);
    assert.match(markNoticeReadHelper, /response\.json\(\)/);
    assert.match(markNoticeReadHelper, /alreadyRead: payload\.alreadyRead/);
    assert.match(markNoticeReadHelper, /catch \(error\)[\s\S]*?console\.warn/);
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
