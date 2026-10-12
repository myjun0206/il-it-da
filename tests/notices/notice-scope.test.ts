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
import {
  filterNoticeRowsByRead,
  parseNoticeReadFilter,
  withNoticeReadStats,
  withNoticeReadStatus,
  withNoticeViewCounts,
} from "../../lib/notices/with-read-status.ts";
import { getNoticeViewCountIncrement } from "../../lib/notices/mark-notice-read.ts";
import { filterStaffNotices, toStaffNotice, type NoticeSourceFilter, type NoticeTargetFilter } from "../../lib/notices/notice-filters.ts";
import {
  validateNoticeContentUpdateRequest,
  validateNoticeDeleteRequest,
} from "../../lib/notices/validate-notice-mutation.ts";
import { filterNoticeRowsBySearch, searchNoticeRows } from "../../lib/notices/search-notices.ts";
import { getNoticeSortOrder, sortNoticeRows } from "../../lib/notices/sort-notices.ts";
import { paginateNoticeRows, parseNoticePagination } from "../../lib/notices/pagination.ts";

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
const noticeSearchHelper = readSource("lib/notices/search-notices.ts");
const noticeSortHelper = readSource("lib/notices/sort-notices.ts");
const noticePaginationHelper = readSource("lib/notices/pagination.ts");
const noticePaginationComponent = readSource("components/notices/NoticePagination.tsx");

describe("notice search", () => {
  const notices = [
    { id: "title-hit", author_id: "author-1", title: "신규 직원 교육 안내", content: "일정 확인" },
    { id: "content-hit", author_id: "author-2", title: "운영 공지", content: "교육 일정 변경" },
    { id: "author-hit", author_id: "author-3", title: "담당자 안내", content: "연락처 확인" },
    { id: "miss", author_id: null, title: "정기 안내", content: "매장 운영" },
  ];
  const authorNames = new Map([["author-3", "김교육"]]);

  test("matches title, content, author name, and partial text", () => {
    assert.deepEqual(filterNoticeRowsBySearch(notices, "교육", authorNames).map(({ id }) => id), [
      "title-hit", "content-hit", "author-hit",
    ]);
    assert.deepEqual(filterNoticeRowsBySearch(notices, "신규 직원", authorNames).map(({ id }) => id), ["title-hit"]);
    assert.deepEqual(filterNoticeRowsBySearch(notices, "운영 공", authorNames).map(({ id }) => id), ["content-hit"]);
  });

  test("trims surrounding whitespace, preserves the list for an empty query, and handles no matches", () => {
    assert.deepEqual(filterNoticeRowsBySearch(notices, "  교육  ", authorNames), filterNoticeRowsBySearch(notices, "교육", authorNames));
    assert.strictEqual(filterNoticeRowsBySearch(notices, "   ", authorNames), notices);
    assert.deepEqual(filterNoticeRowsBySearch(notices, "없는 검색어", authorNames), []);
  });

  test("looks up only authors in the scoped rows and skips lookup without a search", async () => {
    const requestedIds: string[][] = [];
    const fakeClient = {
      from: () => ({
        select: () => ({
          in: (_column: string, ids: string[]) => {
            requestedIds.push(ids);
            return Promise.resolve({
              data: [{ id: "author-3", full_name: "김교육" }, { id: "out-of-scope", full_name: "교육 담당" }],
              error: null,
            });
          },
        }),
      }),
    } as never;
    const scopedNotices = [notices[2], notices[3]];

    assert.deepEqual((await searchNoticeRows(fakeClient, scopedNotices, "교육")).map(({ id }) => id), ["author-hit"]);
    assert.deepEqual(requestedIds, [["author-3"]]);
    assert.strictEqual(await searchNoticeRows(fakeClient, scopedNotices, "  "), scopedNotices);
    assert.deepEqual(requestedIds, [["author-3"]]);
  });

  test("each API searches after its existing role and notice scope checks", () => {
    assert.match(hqRoute, /\.eq\("franchise_id", hqUser\.franchiseId\)[\s\S]*?\.in\("audience", \["owner", "all_members"\]\)[\s\S]*?await searchNoticeRows\(/);
    assert.match(bossRoute, /const readableRows = \[[\s\S]*?canReadNotice\("owner"[\s\S]*?const searchedRows = await searchNoticeRows\(/);
    assert.match(staffRoute, /const readableRows = \(\(scopedRows \?\? \[\]\) as NoticeRow\[\]\)[\s\S]*?canReadNotice\("staff"[\s\S]*?await searchNoticeRows\(/);
    assert.match(noticeSearchHelper, /\.from\("profiles"\)[\s\S]*?\.select\("id, full_name"\)[\s\S]*?\.in\("id", authorIds\)/);
  });
});

describe("notice sorting", () => {
  const notices = [
    { id: "old", title: "휴무 안내", content: "일정", author_id: "author-1", createdAt: "2026-01-01T00:00:00.000Z", viewCount: 1 },
    { id: "new-high", title: "휴무 일정", content: "변경", author_id: "author-2", createdAt: "2026-03-01T00:00:00.000Z", viewCount: 8 },
    { id: "middle-high", title: "휴무 공지", content: "확인", author_id: "author-3", createdAt: "2026-02-01T00:00:00.000Z", viewCount: 8 },
    { id: "new-low", title: "근무 공지", content: "안내", author_id: "author-4", createdAt: "2026-04-01T00:00:00.000Z", viewCount: 2 },
  ];

  test("defaults to latest and supports latest, oldest, and views with latest tie-break", () => {
    assert.equal(getNoticeSortOrder(null), "latest");
    assert.equal(getNoticeSortOrder("invalid"), "latest");
    assert.equal(getNoticeSortOrder("oldest"), "oldest");
    assert.equal(getNoticeSortOrder("views"), "views");
    assert.deepEqual(sortNoticeRows(notices, getNoticeSortOrder(null)).map(({ id }) => id), [
      "new-low", "new-high", "middle-high", "old",
    ]);
    assert.deepEqual(sortNoticeRows(notices, "oldest").map(({ id }) => id), [
      "old", "middle-high", "new-high", "new-low",
    ]);
    assert.deepEqual(sortNoticeRows(notices, "views").map(({ id }) => id), [
      "new-high", "middle-high", "new-low", "old",
    ]);
  });

  test("search results are sorted after filtering and all role APIs sort after read counts", () => {
    const matchingNotices = filterNoticeRowsBySearch(notices, "휴무", new Map());
    assert.deepEqual(sortNoticeRows(matchingNotices, "views").map(({ id }) => id), [
      "new-high", "middle-high", "old",
    ]);
    assert.match(hqRoute, /searchNoticeRows\([\s\S]*?sortNoticeRows\([\s\S]*?withNoticeViewCounts\(noticeItems, readRecords\)/);
    for (const [route, userId] of [[bossRoute, "user.id"], [staffRoute, "userId"]]) {
      assert.match(route, /searchNoticeRows\([\s\S]*?withNoticeReadStatus\(noticeItems, readNoticeIds\)/);
      assert.match(route, /withNoticeReadStatus\(noticeItems, readNoticeIds\)[\s\S]*?filterNoticeRowsByRead\(noticesWithReadStatus, readFilter\)[\s\S]*?withNoticeViewCounts\(readFilteredNotices, readRecords\)[\s\S]*?sortNoticeRows\(noticesWithViewCounts, sortOrder\)/);
      assert.match(route, new RegExp(`record.user_id === ${userId}`));
    }
    assert.match(staffRoute, /sortNoticeRows\(noticesWithViewCounts, sortOrder\)[\s\S]*?\.slice\(0, 1000\)/);
    for (const route of [hqRoute, bossRoute, staffRoute]) {
      assert.match(route, /getNoticeSortOrder\([\s\S]*?searchParams\.get\("sort"\)/);
    }
    assert.match(noticeSortHelper, /right\.viewCount - left\.viewCount \|\| createdAtDifference/);
  });
});

describe("notice pagination", () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({ id: index + 1 }));

  test("defaults to page 1 and nine cards, and caps a requested limit at 50", () => {
    assert.deepEqual(parseNoticePagination(new URLSearchParams()), { page: 1, limit: 9 });
    assert.deepEqual(parseNoticePagination(new URLSearchParams("page=abc&limit=0")), { page: 1, limit: 9 });
    assert.deepEqual(parseNoticePagination(new URLSearchParams("page=0&limit=abc")), { page: 1, limit: 9 });
    assert.deepEqual(parseNoticePagination(new URLSearchParams("page=-1&limit=-10")), { page: 1, limit: 9 });
    assert.deepEqual(parseNoticePagination(new URLSearchParams("page=2&limit=10000")), { page: 2, limit: 50 });
  });

  test("returns ten rows per page with total count and page count", () => {
    const first = paginateNoticeRows(rows, 1, 10);
    const second = paginateNoticeRows(rows, 2, 10);
    const third = paginateNoticeRows(rows, 3, 10);

    assert.deepEqual(first.items.map(({ id }) => id), Array.from({ length: 10 }, (_, index) => index + 1));
    assert.deepEqual(second.items.map(({ id }) => id), Array.from({ length: 10 }, (_, index) => index + 11));
    assert.deepEqual(third.items.map(({ id }) => id), [21, 22, 23, 24, 25]);
    assert.deepEqual(third.pagination, { page: 3, limit: 10, totalCount: 25, totalPages: 3 });
  });

  test("returns an empty page after the last page while retaining requested page metadata", () => {
    const result = paginateNoticeRows(rows, 4, 10);
    assert.deepEqual(result.items, []);
    assert.deepEqual(result.pagination, { page: 4, limit: 10, totalCount: 25, totalPages: 3 });
  });

  test("applies search and views sort before counting and selecting page two", () => {
    const allRows = Array.from({ length: 25 }, (_, index) => ({
      id: `notice-${index + 1}`,
      title: index % 5 === 0 ? "정기 안내" : "휴무 일정 안내",
      content: "운영 공지",
      author_id: null,
      createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      viewCount: (index * 7) % 13,
    }));
    const matchingRows = filterNoticeRowsBySearch(allRows, "휴무", new Map());
    const sortedRows = sortNoticeRows(matchingRows, "views");
    const result = paginateNoticeRows(sortedRows, 2, 10);

    assert.equal(result.pagination.totalCount, 20);
    assert.equal(result.pagination.totalPages, 2);
    assert.deepEqual(result.items, sortedRows.slice(10, 20));
  });

  test("all role APIs paginate after authorized filters, search, and sorting", () => {
    assert.match(hqRoute, /\.in\("audience", \["owner", "all_members"\]\)[\s\S]*?searchNoticeRows\([\s\S]*?const filteredRows = rows\.filter[\s\S]*?sortNoticeRows\([\s\S]*?paginateNoticeRows\(sortedNotices, page, limit\)/);
    assert.match(bossRoute, /const readableRows = \[[\s\S]*?const filteredRows = readableRows\.filter[\s\S]*?searchNoticeRows\([\s\S]*?sortNoticeRows\([\s\S]*?paginateNoticeRows\(sortedNotices, page, limit\)/);
    assert.match(staffRoute, /canReadNotice\("staff"[\s\S]*?const filteredRows = readableRows\.filter[\s\S]*?searchNoticeRows\([\s\S]*?sortNoticeRows\([\s\S]*?const cappedNotices = sortedNotices\.slice\(0, 1000\)[\s\S]*?paginateNoticeRows\(cappedNotices, page, limit\)/);
    assert.match(noticePaginationHelper, /totalCount = rows\.length/);
    assert.match(noticePaginationComponent, /disabled=\{page <= 1\}/);
    assert.match(noticePaginationComponent, /disabled=\{page >= totalPages\}/);
    assert.match(noticePaginationComponent, /aria-current=\{pageNumber === page \? "page" : undefined\}/);
  });

  test("role APIs return pagination metadata and pages send fixed page/limit with active filters", () => {
    for (const route of [hqRoute, bossRoute, staffRoute]) {
      assert.match(route, /parseNoticePagination\(/);
      assert.match(route, /paginateNoticeRows\(/);
      assert.match(route, /pagination/);
    }
    assert.match(hqRoute, /return NextResponse\.json\(\{ notices, targetStores, pagination \}\)/);
    assert.match(bossRoute, /summary: \{[\s\S]*?total: pagination\.totalCount[\s\S]*?pagination,/);
    assert.match(staffRoute, /return NextResponse\.json\(\{ notices, pagination \}\)/);
    assert.match(hqNoticesPage, /params\.set\("page", String\(page\)\)/);
    assert.match(hqNoticesPage, /params\.set\("limit", String\(DEFAULT_NOTICE_LIMIT\)\)/);
    assert.match(ownerNoticesPage, /params\.set\("source", sourceFilter\)[\s\S]*?params\.set\("category", categoryFilter\)/);
    assert.match(staffNoticesPage, /params\.set\("source", sourceFilter\)[\s\S]*?params\.set\("target", targetFilter\)/);
    for (const page of [hqNoticesPage, ownerNoticesPage, staffNoticesPage]) {
      assert.match(page, /params\.set\("page", String\(page\)\)/);
      assert.match(page, /params\.set\("limit", String\(DEFAULT_NOTICE_LIMIT\)\)/);
      assert.match(page, /<NoticePagination/);
    }
  });
});

describe("notice read filter", () => {
  test("defaults missing and invalid values to all and accepts unread", () => {
    assert.equal(parseNoticeReadFilter(null), "all");
    assert.equal(parseNoticeReadFilter("all"), "all");
    assert.equal(parseNoticeReadFilter("foo"), "all");
    assert.equal(parseNoticeReadFilter("123"), "all");
    assert.equal(parseNoticeReadFilter("unread"), "unread");
  });

  test("unread includes only an explicit false read state", () => {
    const notices = [
      { id: "read", isRead: true },
      { id: "unread", isRead: false },
      { id: "null", isRead: null },
      { id: "undefined" },
    ];

    assert.deepEqual(filterNoticeRowsByRead(notices, "unread"), [{ id: "unread", isRead: false }]);
    assert.deepEqual(filterNoticeRowsByRead(notices, "all"), notices);
  });

  test("search, unread, views sort, count, and page two compose in order", () => {
    const allRows = Array.from({ length: 32 }, (_, index) => ({
      id: `notice-${index + 1}`,
      author_id: null,
      title: index < 30 ? "휴무 일정 안내" : "근무 일정 안내",
      content: "매장 운영",
      createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    }));
    const matchingRows = filterNoticeRowsBySearch(allRows, "휴무", new Map());
    const readRecords = matchingRows.flatMap((notice, index) => [
      ...Array.from({ length: index % 6 }, (_, readerIndex) => ({
        notice_id: notice.id,
        user_id: `viewer-${readerIndex}`,
      })),
      ...(index < 5 ? [{ notice_id: notice.id, user_id: "current-user" }] : []),
    ]);
    const currentUserReadIds = readRecords
      .filter((record) => record.user_id === "current-user")
      .map((record) => record.notice_id);
    const withReadState = withNoticeReadStatus(matchingRows, currentUserReadIds);
    const unreadRows = filterNoticeRowsByRead(withReadState, parseNoticeReadFilter("unread"));
    const withViewCounts = withNoticeViewCounts(unreadRows, readRecords);
    const sortedRows = sortNoticeRows(withViewCounts, "views");
    const firstPage = paginateNoticeRows(sortedRows, 1, 10);
    const secondPage = paginateNoticeRows(sortedRows, 2, 10);
    const thirdPage = paginateNoticeRows(sortedRows, 3, 10);

    assert.equal(firstPage.pagination.totalCount, 25);
    assert.equal(firstPage.pagination.totalPages, 3);
    assert.equal(firstPage.items.length, 10);
    assert.equal(secondPage.items.length, 10);
    assert.equal(thirdPage.items.length, 5);
    assert.deepEqual(secondPage.items, sortedRows.slice(10, 20));
    assert.ok([...firstPage.items, ...secondPage.items, ...thirdPage.items].every((notice) => notice.isRead === false));
    assert.deepEqual(sortNoticeRows(unreadRows.map((notice, index) => ({ ...notice, viewCount: index })), "views").map(({ id }) => id),
      [...unreadRows].reverse().map(({ id }) => id));
  });

  test("OWNER and STAFF accept read while HQ route, response type, and page stay unchanged", () => {
    assert.match(bossRoute, /parseNoticeReadFilter\(request\.nextUrl\.searchParams\.get\("read"\)\)/);
    assert.match(staffRoute, /parseNoticeReadFilter\(url\.searchParams\.get\("read"\)\)/);
    assert.doesNotMatch(hqRoute, /parseNoticeReadFilter|searchParams\.get\("read"\)/);
    assert.doesNotMatch(hqNoticesPage, /params\.set\("read"/);
    assert.doesNotMatch(readSource("lib/types/notice.ts"), /isRead/);
  });

  test("OWNER and STAFF pages send the filter, reset pages, and retain their other query state", () => {
    assert.match(ownerNoticesPage, /params\.set\("read", readFilter\)/);
    assert.match(staffNoticesPage, /params\.set\("read", readFilter\)/);
    assert.match(ownerNoticesPage, /setReadFilter\(value\);\s*setPage\(DEFAULT_NOTICE_PAGE\)/);
    assert.match(staffNoticesPage, /setReadFilter\(readFilter === "unread" \? "all" : "unread"\);\s*setPage\(DEFAULT_NOTICE_PAGE\)/);
    for (const page of [ownerNoticesPage, staffNoticesPage]) {
      assert.match(page, /value: "all", label: "전체"/);
      assert.match(page, /value: "unread", label: "안 읽음"/);
      assert.match(page, /markNoticeAsRead\(notice\.id\)/);
      assert.match(page, /if \(readFilter === "unread"\) \{[\s\S]*?unreadReadPending\.current = true/);
      assert.match(page, /if \(unreadReadPending\.current\) \{[\s\S]*?setReloadToken/);
    }
  });
});

function noticePageScenario(role: "hq" | "owner" | "staff", multiple = false, currentPage = 1) {
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
    ? [
        "Tester", "Cafe", rows,
        [{ id: "store-a", name: "Store A" }, { id: "store-b", name: "Store B" }],
        { page: currentPage, limit: 9, totalCount: 27, totalPages: 3 }, currentPage,
        false, "", "", "", "latest", "all", "__all__", null, "", null, null, null, false, false,
      ]
    : role === "owner"
      ? [true, "Tester", "Store A", "store-a", {
          notices: rows,
          pagination: { page: 1, limit: 10, totalCount: rows.length, totalPages: 1 },
          summary: { total: rows.length, important: 0 },
        }, false, "", "all", "", "", "latest", "전체", 1, null, null, null, false, "all", 0, false]
      : [{
          key: "store-a:0::latest:all:all:all:1",
          status: "ready",
          notices: rows,
          pagination: { page: 1, limit: 10, totalCount: rows.length, totalPages: 1 },
        }, 0, "", "", "latest", 1, "store-a", "all", "all", null, "all", false];
  const harness = createHookHarness(initialStates);
  const updates: unknown[] = [];
  const navigations: string[] = [];
  const reads: string[] = [];
  const emptyLayout = () => null;
  const overrides = {
    react: {
      ...harness.react,
      useState(initial: unknown) {
        const [value, setValue] = harness.react.useState(initial);
        return [value, (update: unknown) => { updates.push(update); (setValue as (next: unknown) => void)(update); }];
      },
    },
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
  return { notice, reads, navigations, updates, render: () => harness.render(componentModule.default) };
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
    assert.match(hqRoute, /if \(!hqUser\.franchiseId\) \{[\s\S]*?notices: \[\],[\s\S]*?pagination: emptyPage\.pagination/);
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
    assert.match(bossRoute, /if \(!store\?\.franchise_id\) \{[\s\S]*?notices: \[\],[\s\S]*?pagination: emptyPage\.pagination/);
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
    assert.match(bossRoute, /if \(searchedRows\.length > 0\)[\s\S]*?\.from\("notice_reads"\)[\s\S]*?\.select\("notice_id,user_id"\)[\s\S]*?\.in\("notice_id", searchedRows\.map\(\(row\) => row\.id\)\)/);
    assert.match(bossRoute, /withNoticeReadStatus\(noticeItems, readNoticeIds\)[\s\S]*?filterNoticeRowsByRead\(noticesWithReadStatus, readFilter\)[\s\S]*?withNoticeViewCounts\(readFilteredNotices, readRecords\)/);
    assert.equal((bossRoute.match(/\.from\("notice_reads"\)/g) ?? []).length, 1);
  });

  test("STAFF batches reads after existing access filtering and skips empty lists", () => {
    assert.match(staffRoute, /\.filter\(\(row\) => canReadNotice\("staff"/);
    assert.match(staffRoute, /if \(noticesData\.length > 0\)[\s\S]*?\.from\("notice_reads"\)[\s\S]*?\.select\("notice_id,user_id"\)[\s\S]*?\.in\("notice_id", noticesData\.map\(\(row\) => row\.id\)\)/);
    assert.match(staffRoute, /withNoticeReadStatus\(noticeItems, readNoticeIds\)[\s\S]*?filterNoticeRowsByRead\(noticesWithReadStatus, readFilter\)[\s\S]*?withNoticeViewCounts\(readFilteredNotices, readRecords\)/);
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
  test("multi-store selector searches, selects exact IDs and closes its results", () => {
    const harness = createHookHarness([]);
    const selectorModule = loadComponentModule<{ StoreMultiSelector: (props: unknown) => ReactNode }>("components/notices/StoreMultiSelector.tsx", { react: harness.react });
    let selectedStoreIds: string[] = [];
    const render = () => harness.render(() => selectorModule.StoreMultiSelector({
      stores: [{ id: "store-a", name: "Store A" }, { id: "store-b", name: "Store B" }],
      selectedStoreIds, onSelectionChange: (ids: string[]) => { selectedStoreIds = Array.from(ids); },
    }));
    const search = componentElements(render()).find((element) => element.props["aria-label"] === "공지 대상 지점 검색");
    assert.ok(search);
    (search.props.onChange as (event: unknown) => void)({ target: { value: "Store B" } });
    let elements = componentElements(render());
    const checkbox = elements.find((element) => element.props.type === "checkbox");
    assert.ok(checkbox);
    (checkbox.props.onChange as () => void)();
    assert.deepEqual(selectedStoreIds, ["store-b"]);
    elements = componentElements(render());
    const outside = elements.find((element) => element.type === "div" && element.props["aria-hidden"] === "true");
    assert.ok(outside); (outside.props.onClick as () => void)();
    assert.equal(componentElements(render()).some((element) => element.props.type === "checkbox"), false);
    const remove = componentElements(render()).find((element) => element.props["aria-label"] === "Store B 제거");
    assert.ok(remove); (remove.props.onClick as () => void)();
    assert.deepEqual(selectedStoreIds, []);
  });

  test("HQ renders server page two without slicing again and selects stores by ID", () => {
    const scenario = noticePageScenario("hq", true, 2);
    let elements = componentElements(scenario.render());
    assert.ok(elements.some((element) => element.props.title === "Kitchen Safety"));
    const pager = elements.find((element) => element.props.totalPages === 3);
    assert.ok(pager);
    assert.equal(pager.props.page, 2);
    const scope = elements.find((element) => element.type === "button" && renderToStaticMarkup(element).includes("특정 지점"));
    assert.ok(scope);
    (scope.props.onClick as () => void)();
    elements = componentElements(scenario.render());
    const search = elements.find((element) => element.props["aria-label"] === "지점명 검색");
    assert.ok(search);
    (search.props.onChange as (event: unknown) => void)({ target: { value: "Store B" } });
    elements = componentElements(scenario.render());
    const store = elements.find((element) => element.props["aria-label"] === "공지 대상 지점 Store B");
    assert.ok(store);
    assert.equal(store.props.value, "store-b");
    (store.props.onChange as () => void)();
    assert.match(renderToStaticMarkup(scenario.render()), /Store B/);
    assert.match(hqNoticesPage, /setTargetFilter\(target\.id\)/);
    assert.match(hqNoticesPage, /params\.set\("targetStoreId", targetFilter\)/);
  });

  test("role filter controls compose without resetting the other active filters (component handlers)", () => {
    for (const role of ["hq", "owner", "staff"] as const) {
      const scenario = noticePageScenario(role, true);
      const label = role === "hq" ? "특정 지점" : "본사 공지";
      const control = componentElements(scenario.render()).find((element) =>
        element.type === "button" && renderToStaticMarkup(element).includes(label),
      );
      assert.ok(control, `${role}: missing source/scope chip`);
      assert.equal(control.props["aria-pressed"], false);
      (control.props.onClick as () => void)();
      if (role === "hq") assert.deepEqual(scenario.updates, ["store", "__all__", null, "", 1]);
      else assert.deepEqual(scenario.updates, ["hq", 1]);
      assert.match(role === "hq" ? hqNoticesPage : role === "owner" ? ownerNoticesPage : staffNoticesPage,
        role === "hq" ? /params\.set\("scope", scopeFilter\)/ : /params\.set\("source", sourceFilter\)/);
    }
  });

  test("shared filter buttons expose pressed state and keyboard focus", () => {
    assert.match(noticeFilter, /aria-pressed=\{isSelected\}/);
    assert.match(noticeFilter, /focus-visible:ring-2/);
    for (const label of ["전체", "전체 지점", "특정 지점"]) {
      assert.match(hqNoticesPage, new RegExp(`label: "${label}"`));
    }
  });

  test("HQ preserves target fields and sends scope/target filters to the paginated API", () => {
    assert.match(hqNoticesPage, /targetType: notice\.targetType/);
    assert.match(hqNoticesPage, /targetStoreId: notice\.targetStoreId/);
    assert.match(hqNoticesPage, /useState<HqNoticeFilter>\("all"\)/);
    assert.match(hqNoticesPage, /params\.set\("scope", scopeFilter\)/);
    assert.match(hqNoticesPage, /params\.set\("targetStoreId", targetFilter\)/);
    assert.match(hqNoticesPage, /targetStores\?: HqTargetStore\[\]/);
    assert.match(hqRoute, /const filteredRows = rows\.filter\([\s\S]*?scopeFilter === "franchise"[\s\S]*?targetStoreId/);
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
    assert.match(staffNoticesPage, /const visibleNotices = allNotices/);
    assert.match(staffRoute, /sourceFilter[\s\S]*targetFilter/);
    assert.match(staffNoticesPage, /setSourceFilter\(value\);\s*setPage\(DEFAULT_NOTICE_PAGE\)/);
    assert.match(staffNoticesPage, /setTargetFilter\(event\.target\.value as NoticeTargetFilter\);\s*setPage\(DEFAULT_NOTICE_PAGE\)/);
    assert.match(staffNoticesPage, /requestKey = storeId[\s\S]*?\$\{storeId\}:\$\{reloadToken\}:\$\{submittedQuery\}:\$\{sortOrder\}:\$\{sourceFilter\}:\$\{targetFilter\}:\$\{readFilter\}:\$\{page\}/);
    assert.match(staffNoticesPage, /params\.set\("search", submittedQuery\)/);
    assert.match(staffNoticesPage, /params\.set\("sort", sortOrder\)/);
    assert.match(staffNoticesPage, /params\.set\("page", String\(page\)\)/);
    assert.match(staffNoticesPage, /params\.set\("limit", String\(DEFAULT_NOTICE_LIMIT\)\)/);
    assert.match(staffNoticesPage, /params\.set\("source", sourceFilter\)/);
    assert.match(staffNoticesPage, /params\.set\("target", targetFilter\)/);
    assert.match(staffRoute, /sourceLabel: row\.audience === "staff" \? "점주 공지" : "본사 공지"/);
    assert.match(staffNoticesPage, /label: "본사 공지"/);
    assert.match(staffNoticesPage, /label: "매장 공지"/);
  });

  test("role filters stay local and compose with the server search results", () => {
    assert.match(hqNoticesPage, /setSubmittedSearch\(searchQuery\.trim\(\)\)/);
    assert.match(ownerNoticesPage, /params\.set\("search", submittedSearch\)/);
    assert.match(staffNoticesPage, /setSubmittedQuery\(query\.trim\(\)\)/);
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
    assert.match(hqNoticesPage, /void loadNotices\(\);\s*\}, \[isReady, submittedSearch, sortOrder, page, scopeFilter, targetFilter\]\)/);
    assert.match(ownerNoticesPage, /fetchNotices\(\);\s*\}, \[selectedStoreId, submittedSearch, sortOrder, sourceFilter, categoryFilter, readFilter, page, reloadToken\]\)/);
    assert.match(staffNoticesPage, /\}, \[storeId, requestKey, router, submittedQuery, sortOrder, sourceFilter, targetFilter, readFilter, page\]\)/);
    for (const page of [hqNoticesPage, ownerNoticesPage, staffNoticesPage]) {
      assert.match(page, /aria-label="공지사항 검색"/);
      assert.match(page, /setPage\(DEFAULT_NOTICE_PAGE\)/);
      assert.match(page, /useState<NoticeSortOrder>\("latest"\)/);
      assert.match(page, /(?:value="oldest">|value: "oldest"(?: as const)?, label: ")오래된순/);
      assert.match(page, /(?:value="views">|value: "views"(?: as const)?, label: ")조회(?:수)?순/);
      assert.match(page, /params\.set\("sort", sortOrder\)/);
    }
    for (const role of ["hq", "owner"] as const) {
      const scenario = noticePageScenario(role);
      const search = componentElements(scenario.render()).find((element) => element.props["aria-label"] === "공지사항 검색");
      assert.ok(search);
      (search.props.onChange as (event: unknown) => void)({ target: { value: "  Safety  " } });
      assert.deepEqual(scenario.updates, ["  Safety  ", "Safety", 1]);
    }
    assert.match(staffNoticesPage, /onChange=\{\(event\) => handleSearchChange\(event\.target\.value\)\}/);
    assert.match(staffNoticesPage, /setSubmittedQuery\(value\.trim\(\)\);\s*setPage\(DEFAULT_NOTICE_PAGE\)/);
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
    assert.match(bossRoute, /if \(searchedRows\.length > 0\)[\s\S]*?\.from\("notice_reads"\)[\s\S]*?\.select\("notice_id,user_id"\)[\s\S]*?\.in\("notice_id", searchedRows\.map\(\(row\) => row\.id\)\)/);
    assert.match(bossRoute, /withNoticeReadStatus\(noticeItems, readNoticeIds\)[\s\S]*?filterNoticeRowsByRead\(noticesWithReadStatus, readFilter\)[\s\S]*?withNoticeViewCounts\(readFilteredNotices, readRecords\)/);
  });

  test("STAFF batches one read lookup after the existing access filter and skips empty lists", () => {
    assert.match(staffRoute, /\.filter\(\(row\) => canReadNotice\("staff"/);
    assert.match(staffRoute, /if \(noticesData\.length > 0\)[\s\S]*?\.from\("notice_reads"\)[\s\S]*?\.select\("notice_id,user_id"\)[\s\S]*?\.in\("notice_id", noticesData\.map\(\(row\) => row\.id\)\)/);
    assert.match(staffRoute, /withNoticeReadStatus\(noticeItems, readNoticeIds\)[\s\S]*?filterNoticeRowsByRead\(noticesWithReadStatus, readFilter\)[\s\S]*?withNoticeViewCounts\(readFilteredNotices, readRecords\)/);
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
    assert.match(hqCreatePage, /buildHqNoticeTarget\(targetType, "", audience\)/);
    assert.match(hqCreatePage, /for \(const storeId of targetStoreIds\)/);
    assert.match(hqCreatePage, /buildHqNoticeTarget\(targetType, storeId, audience\)/);
    assert.match(hqCreatePage, /targetType === "store" && targetStoreIds\.length === 0/);
  });

  test("API continues to reject staff audience and verify HQ franchise/store scope", () => {
    assert.match(hqRoute, /audience !== "owner" && audience !== "all_members"/);
    assert.match(hqRoute, /canCreateNotice\(/);
    assert.match(hqRoute, /\.eq\("franchise_id", hqUser\.franchiseId\)/);
  });
});
