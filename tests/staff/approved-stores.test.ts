import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { componentElements, createHookHarness, loadComponentModule } from "../support/component-harness.ts";
import type { useStaffShell } from "../../components/staff/StaffShellContext.tsx";

import {
  failedStaffStoresResult,
  filterApprovedStaffMemberships,
  successfulStaffStoresResult,
  toStaffStores,
  unauthorizedStaffStoresResult,
} from "../../lib/staff/approved-stores.ts";

const CURRENT_USER_ID = "current-user";

function membership(overrides: Record<string, unknown> = {}) {
  return {
    user_id: CURRENT_USER_ID,
    store_id: "store-a",
    role: "staff",
    status: "approved",
    ...overrides,
  };
}

describe("filterApprovedStaffMemberships", () => {
  test("keeps only the current user's approved staff memberships", () => {
    const storeIds = filterApprovedStaffMemberships([
      membership(),
      membership({ status: "pending", store_id: "pending-store" }),
      membership({ status: "rejected", store_id: "rejected-store" }),
      membership({ role: "owner", store_id: "owner-store" }),
      membership({ user_id: "other-user", store_id: "other-user-store" }),
    ], CURRENT_USER_ID);

    assert.deepEqual(storeIds, ["store-a"]);
  });

  test("deduplicates repeated approved memberships for the same store", () => {
    const storeIds = filterApprovedStaffMemberships([
      membership(),
      membership(),
    ], CURRENT_USER_ID);

    assert.deepEqual(storeIds, ["store-a"]);
  });

  test("returns an empty list when no membership is eligible", () => {
    const storeIds = filterApprovedStaffMemberships([
      membership({ status: "pending" }),
      membership({ role: "owner" }),
    ], CURRENT_USER_ID);

    assert.deepEqual(storeIds, []);
  });
});

describe("toStaffStores", () => {
  test("returns only id and name for stores referenced by approved memberships", () => {
    const stores = toStaffStores(
      ["store-a", "store-b"],
      [
        { id: "store-a", store_name: "Store A", boss_id: "internal" },
        { id: "store-b", store_name: "Store B", user_id: "internal" },
        { id: "unapproved-store", store_name: "Do Not Return" },
      ],
    );

    assert.deepEqual(stores, [
      { id: "store-a", name: "Store A" },
      { id: "store-b", name: "Store B" },
    ]);
    const serialized = JSON.stringify(stores);
    assert.equal(serialized.includes("boss_id"), false);
    assert.equal(serialized.includes("user_id"), false);
    assert.equal(serialized.includes("membership"), false);
  });

  test("omits missing or invalid store rows", () => {
    const stores = toStaffStores(
      ["store-a", "missing-store"],
      [{ id: "store-a", store_name: "Store A" }, { id: "missing-store", store_name: "" }],
    );

    assert.deepEqual(stores, [{ id: "store-a", name: "Store A" }]);
  });
});

describe("staff stores API results", () => {
  test("uses a fixed 401 response for unauthenticated users", () => {
    assert.deepEqual(unauthorizedStaffStoresResult(), {
      status: 401,
      body: { error: "Unauthorized." },
    });
  });

  test("returns a 200 empty stores array for users without approved staff membership", () => {
    assert.deepEqual(successfulStaffStoresResult([]), {
      status: 200,
      body: { stores: [] },
    });
  });

  test("uses a fixed 500 response without raw database details", () => {
    assert.deepEqual(failedStaffStoresResult(), {
      status: 500,
      body: { error: "Unable to load approved stores." },
    });
  });
});

function storeSelectorScenario(stores = [{ id: "store-a", name: "Store A" }, { id: "store-b", name: "Store B" }], isStoresLoading = false) {
  const harness = createHookHarness([]);
  const selections: string[] = [];
  let finishSave: (() => void) | undefined;
  const props = {
    stores,
    defaultStoreId: "store-a",
    isStoresLoading,
    onSetDefaultStore: async (storeId: string) => {
      selections.push(storeId);
      await new Promise<void>((resolve) => { finishSave = resolve; });
      props.defaultStoreId = storeId;
    },
  };
  const { default: Selector } = loadComponentModule<{ default: (selectorProps: typeof props) => ReactNode }>(
    "components/staff/StoreSelector.tsx",
    { react: { ...harness.react, useRef: () => ({ current: null }) } },
  );
  const render = () => harness.render(() => Selector(props));
  const buttons = () => componentElements(render()).filter((element) => element.type === "button");
  const click = (button: ReturnType<typeof buttons>[number]) => {
    if (!button.props.disabled) (button.props.onClick as () => void)();
  };
  return { props, selections, render, buttons, click, finishSave: async () => { finishSave?.(); await Promise.resolve(); await Promise.resolve(); } };
}

function lifecycleHarness() {
  const harness = createHookHarness([]);
  const refs: { current: unknown }[] = [];
  const effects: { dependencies: unknown[]; cleanup?: () => void }[] = [];
  let refCursor = 0;
  let effectCursor = 0;
  let pending: (() => void)[] = [];
  const react = {
    ...harness.react,
    useRef(initial: unknown) {
      const index = refCursor++;
      return refs[index] ??= { current: initial };
    },
    useCallback: (callback: unknown) => callback,
    useEffectEvent: (callback: unknown) => callback,
    useEffect(callback: () => (() => void) | void, dependencies: unknown[] = []) {
      const index = effectCursor++;
      const previous = effects[index];
      if (previous && dependencies.every((value, position) => Object.is(value, previous.dependencies[position]))) return;
      pending.push(() => {
        previous?.cleanup?.();
        effects[index] = { dependencies, cleanup: callback() || undefined };
      });
    },
  };
  return {
    react,
    render(component: () => ReactNode) {
      refCursor = 0;
      effectCursor = 0;
      const tree = harness.render(component);
      const callbacks = pending;
      pending = [];
      callbacks.forEach((callback) => callback());
      return tree;
    },
  };
}

async function settleComponent() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function staffScenario(restoreConversation = false) {
  type Shell = ReturnType<typeof useStaffShell>;
  const shellHarness = lifecycleHarness();
  const pageHarness = lifecycleHarness();
  let selectedId: string | null = null;
  let conversationId: string | null = restoreConversation ? "conversation-a" : null;
  let stores = [{ id: "store-a", name: "Store A" }, { id: "store-b", name: "Store B" }];
  let storesFailed = false;
  let releaseStores: (() => void) | undefined;
  let holdStores = false;
  let forbidden = false;
  let chatFailed = false;
  let holdChat = false;
  let releaseChat: (() => void) | undefined;
  let releaseRestore: (() => void) | undefined;
  let storeRequests = 0;
  const questions: { question: string; storeId: string; conversationId: string | null }[] = [];
  const storage = {
    readSelectedStaffStoreId: () => selectedId,
    writeSelectedStaffStoreId: (id: string | null) => { selectedId = id; },
    readStaffConversationId: () => conversationId,
    writeStaffConversationId: (id: string | null) => { conversationId = id; },
  };
  const supabase = { createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: CURRENT_USER_ID } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "staff", approval_status: "approved", full_name: "Tester" } }) }) }) }),
  }) };
  const router = { push: () => { throw new Error("Unexpected navigation"); } };
  const navigation = { useRouter: () => router, usePathname: () => "/staff" };
  const fetchMock = async (url: string, options?: { body?: string; method?: string }) => {
    if (url === "/api/staff/stores") {
      storeRequests++;
      if (holdStores) await new Promise<void>((resolve) => { releaseStores = resolve; });
      return { ok: !storesFailed, status: storesFailed ? 500 : 200, json: async () => storesFailed ? { error: "Failure" } : { stores } };
    }
    if (url === "/api/signup/store-membership") return { ok: true, json: async () => ({ success: true, data: [] }) };
    if (url === "/api/staff/store-preferences") return { ok: true, json: async () => ({ preferences: options?.body ? JSON.parse(options.body) : { defaultStoreId: "store-a", order: [] } }) };
    if (url === "/api/staff/chat") {
      questions.push(JSON.parse(options?.body ?? "{}"));
      if (holdChat) await new Promise<void>((resolve) => { releaseChat = resolve; });
      return { ok: !forbidden && !chatFailed, json: async () => forbidden ? { code: "STORE_FORBIDDEN" } : chatFailed ? { error: "Chat failed" } : { answer: "Test answer", conversationId: "conversation-a" } };
    }
    if (url === "/api/staff/conversations/conversation-a") {
      await new Promise<void>((resolve) => { releaseRestore = resolve; });
      return { ok: true, json: async () => ({
        conversation: { id: "conversation-a", storeId: "store-a", canContinue: true },
        messages: [{ role: "assistant", content: "Previous store restored answer", createdAt: "2026-10-04T00:00:00Z" }],
      }) };
    }
    throw new Error(`Unexpected network request: ${url}`);
  };
  const overrides = { "next/navigation": navigation, "@/lib/supabase/client": supabase, "@/lib/staff/selected-store": storage };
  const { StaffShellProvider } = loadComponentModule<{ StaffShellProvider: (props: { children: ReactNode }) => ReactNode }>(
    "components/staff/StaffShellContext.tsx", { ...overrides, react: shellHarness.react }, { fetch: fetchMock },
  );
  let shell: Shell;
  const refreshShell = () => {
    const provider = shellHarness.render(() => StaffShellProvider({ children: null }));
    shell = componentElements(provider)[0].props.value as Shell;
    return shell;
  };
  refreshShell();
  const { default: Page } = loadComponentModule<{ default: () => ReactNode }>("app/staff/page.tsx", {
    ...overrides,
    react: pageHarness.react,
    "@/components/staff/StaffShellContext": { useStaffShell: () => shell },
    "@/components/staff/ConversationHistoryDrawer": { default: () => null, __esModule: true },
  }, { fetch: fetchMock });
  const render = () => pageHarness.render(Page);
  const elements = () => componentElements(render());
  const input = () => elements().find((element) => element.type === "input")!;
  const type = (value: string) => (input().props.onChange as (event: unknown) => void)({ target: { value } });
  const ask = async (question: string) => {
    type(question);
    const form = elements().find((element) => element.type === "form")!;
    (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    await settleComponent();
  };
  return {
    refreshShell, render, elements, input, type, ask, questions,
    conversationId: () => conversationId,
    storeRequests: () => storeRequests,
    setStores: (next: typeof stores) => { stores = next; },
    failStores: () => { storesFailed = true; },
    failChat: () => { chatFailed = true; },
    holdChat: () => { holdChat = true; },
    releaseChat: async () => { holdChat = false; releaseChat?.(); await settleComponent(); },
    releaseRestore: async () => { releaseRestore?.(); await settleComponent(); },
    forbidStore: () => { forbidden = true; holdStores = true; },
    releaseStores: async () => { holdStores = false; releaseStores?.(); await settleComponent(); },
    ready: async () => { await settleComponent(); refreshShell(); render(); },
  };
}

describe("app/staff/page.tsx 근무 매장 선택 배선", () => {

  test("Header가 승인 매장과 로딩 상태를 선택기에 전달하고 선택한 ID를 저장한다", async () => {
    const scenario = storeSelectorScenario();
    const harness = createHookHarness([]);
    const saved: unknown[] = [];
    const Selector = () => null;
    const { default: Header } = loadComponentModule<{ default: () => ReactNode }>("components/staff/StaffHeader.tsx", {
      react: harness.react,
      "@/components/staff/StoreSelector": { default: Selector, __esModule: true },
      "@/components/common/ProfileMenu": { default: () => null, __esModule: true },
      "@/components/common/NotificationCenter": { default: () => null, __esModule: true },
      "@/lib/supabase/client": { createClient: () => { throw new Error("Unexpected auth request"); } },
      "@/components/staff/StaffShellContext": { useStaffShell: () => ({ ...scenario.props, saveStorePreferences: async (value: unknown) => { saved.push(value); } }) },
    });
    const selector = componentElements(harness.render(Header)).find((element) => element.type === Selector);
    assert.ok(selector);
    assert.equal(selector.props.stores, scenario.props.stores);
    assert.equal(selector.props.defaultStoreId, "store-a");
    assert.equal(selector.props.isStoresLoading, false);
    await (selector.props.onSetDefaultStore as (id: string) => Promise<void>)("store-b");
    assert.equal(JSON.stringify(saved), JSON.stringify([{ defaultStoreId: "store-b", order: ["store-a", "store-b"] }]));
  });

  test("승인 매장을 표시하고 선택한 ID를 저장하며 저장 중 중복 선택을 차단한다", async () => {
    const scenario = storeSelectorScenario();
    assert.ok(renderToStaticMarkup(scenario.render()).includes("Store A"));
    scenario.click(scenario.buttons()[0]);
    const options = scenario.buttons().slice(1);
    assert.equal(options.length, 2);
    assert.ok(renderToStaticMarkup(options[0]).includes("Store A"));
    assert.ok(renderToStaticMarkup(options[1]).includes("Store B"));
    scenario.click(options[1]);
    assert.deepEqual(scenario.selections, ["store-b"]);
    assert.ok(scenario.buttons().every((button) => button.props.disabled));
    scenario.click(scenario.buttons()[1]);
    assert.deepEqual(scenario.selections, ["store-b"]);
    await scenario.finishSave();
    assert.equal(scenario.buttons().length, 1);
    assert.ok(renderToStaticMarkup(scenario.render()).includes("Store B"));
    assert.equal(scenario.buttons()[0].props.disabled, false);
  });

  test("선택한 승인 매장 ID로 질문을 전송한다", async () => {
    const scenario = staffScenario();
    await scenario.ready();
    await scenario.refreshShell().saveStorePreferences({ defaultStoreId: "store-b", order: ["store-a", "store-b"] });
    scenario.refreshShell();
    scenario.render();
    scenario.render();
    await scenario.ask("Question for B");
    assert.equal(JSON.stringify(scenario.questions), JSON.stringify([{ question: "Question for B", storeId: "store-b", conversationId: null }]));
  });

  test("다른 매장 선택 시 이전 대화와 입력을 초기화한다", async () => {
    const scenario = staffScenario();
    await scenario.ready();
    await scenario.ask("Previous question");
    scenario.type("Unsent input");
    assert.equal(scenario.conversationId(), "conversation-a");
    assert.ok(renderToStaticMarkup(scenario.render()).includes("Previous question"));
    scenario.failChat();
    await scenario.ask("Failed question");
    scenario.type("Unsent input");
    assert.ok(renderToStaticMarkup(scenario.render()).includes("답변을 불러오지 못했어요"));
    await scenario.refreshShell().saveStorePreferences({ defaultStoreId: "store-b", order: [] });
    scenario.refreshShell();
    scenario.render();
    assert.equal(scenario.input().props.value, "");
    assert.equal(scenario.conversationId(), null);
    const markup = renderToStaticMarkup(scenario.render());
    assert.equal(markup.includes("Previous question"), false);
    assert.equal(markup.includes("Test answer"), false);
    assert.equal(markup.includes("답변을 불러오지 못했어요"), false);
  });

  test("매장 변경 전에 보낸 질문의 늦은 응답을 새 대화에 추가하지 않는다", async () => {
    const scenario = staffScenario();
    await scenario.ready();
    scenario.holdChat();
    await scenario.ask("Previous pending question");
    await scenario.refreshShell().saveStorePreferences({ defaultStoreId: "store-b", order: [] });
    scenario.refreshShell();
    scenario.render();
    await scenario.releaseChat();
    const markup = renderToStaticMarkup(scenario.render());
    assert.equal(markup.includes("Previous pending question"), false);
    assert.equal(markup.includes("Test answer"), false);
    assert.equal(scenario.conversationId(), null);
  });

  test("매장 변경으로 취소된 이전 대화 복원 응답을 무시한다", async () => {
    const scenario = staffScenario(true);
    await scenario.ready();
    await scenario.refreshShell().saveStorePreferences({ defaultStoreId: "store-b", order: [] });
    scenario.refreshShell();
    scenario.render();
    await scenario.releaseRestore();
    assert.equal(renderToStaticMarkup(scenario.render()).includes("Previous store restored answer"), false);
    assert.equal(scenario.conversationId(), null);
  });

  test("같은 매장 재선택 시 대화와 입력을 보존한다", async () => {
    const scenario = staffScenario();
    await scenario.ready();
    await scenario.ask("Previous question");
    scenario.type("Unsent input");
    await scenario.refreshShell().saveStorePreferences({ defaultStoreId: "store-a", order: [] });
    scenario.refreshShell();
    assert.equal(scenario.input().props.value, "Unsent input");
    assert.equal(scenario.conversationId(), "conversation-a");
    assert.ok(renderToStaticMarkup(scenario.render()).includes("Previous question"));
    await scenario.ask("Follow-up");
    assert.equal(scenario.questions[1].conversationId, "conversation-a");
  });

  test("첫 매장 조회 중 로딩 안내를 표시하고 선택을 차단한다", () => {
    const scenario = storeSelectorScenario([], true);
    assert.ok(renderToStaticMarkup(scenario.render()).includes("매장 불러오는 중..."));
    assert.equal(scenario.buttons()[0].props.disabled, true);
    scenario.click(scenario.buttons()[0]);
    assert.deepEqual(scenario.selections, []);
    assert.equal(scenario.buttons().length, 1);
  });

  test("메뉴가 열린 상태로 재조회하면 매장 선택을 차단한다", () => {
    const scenario = storeSelectorScenario();
    scenario.click(scenario.buttons()[0]);
    scenario.props.isStoresLoading = true;
    assert.ok(renderToStaticMarkup(scenario.render()).includes("매장 불러오는 중..."));
    assert.ok(scenario.buttons().every((button) => button.props.disabled));
    scenario.buttons().forEach(scenario.click);
    assert.deepEqual(scenario.selections, []);
  });

  test("매장 조회 중 입력·전송·예시 질문을 차단한다", async () => {
    const scenario = staffScenario();
    assert.equal(scenario.input().props.disabled, true);
    const submit = scenario.elements().find((element) => element.props.type === "submit");
    assert.equal(submit?.props.disabled, true);
    const quickQuestions = scenario.elements().find((element) => Array.isArray(element.props.questions));
    assert.equal(quickQuestions?.props.canAsk, false);
    await (quickQuestions?.props.onSelectQuestion as (question: string) => Promise<void>)("Blocked question");
    assert.deepEqual(scenario.questions, []);
    await scenario.ready();
    assert.equal(scenario.input().props.disabled, false);
  });

  test("목록 조회 실패와 승인 매장 없음을 구분하고 질문을 차단한다", async () => {
    const failed = staffScenario();
    failed.failStores();
    await failed.ready();
    const failedMarkup = renderToStaticMarkup(failed.render());
    assert.ok(failedMarkup.includes("승인된 근무 매장을 불러오지 못했습니다"));
    assert.equal(failedMarkup.includes("승인된 근무 매장이 없습니다"), false);
    assert.equal(failed.input().props.disabled, true);
    const empty = staffScenario();
    empty.setStores([]);
    await empty.ready();
    const emptyMarkup = renderToStaticMarkup(empty.render());
    assert.ok(emptyMarkup.includes("승인된 근무 매장이 없습니다"));
    assert.equal(emptyMarkup.includes("불러오지 못했습니다"), false);
    assert.equal(empty.input().props.disabled, true);
  });

  test("STORE_FORBIDDEN 이후 대화를 비우고 재조회 동안 질문을 차단하며 승인 매장으로 갱신한다", async () => {
    const scenario = staffScenario();
    await scenario.ready();
    await scenario.ask("Previous question");
    scenario.forbidStore();
    scenario.setStores([{ id: "store-b", name: "Store B" }]);
    await scenario.ask("Forbidden question");
    assert.equal(scenario.conversationId(), null);
    const shell = scenario.refreshShell();
    assert.equal(shell.isStoresLoading, true);
    assert.equal(scenario.storeRequests(), 2);
    assert.equal(scenario.input().props.disabled, true);
    assert.equal(renderToStaticMarkup(scenario.render()).includes("Previous question"), false);
    await scenario.ask("Blocked during reload");
    assert.equal(scenario.questions.length, 2);
    await scenario.releaseStores();
    const refreshed = scenario.refreshShell();
    assert.equal(refreshed.selectedStore?.id, "store-b");
    assert.deepEqual(refreshed.stores.map((store) => store.id), ["store-b"]);
    scenario.render();
    assert.equal(scenario.input().props.disabled, false);
  });
});

describe("직원 공통 매뉴얼 접근 범위", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const manualsRoute = readFileSync(path.join(repoRoot, "app/api/staff/manuals/route.ts"), "utf8").replace(/\r\n/g, "\n");
  const migration = readFileSync(
    path.join(repoRoot, "supabase/migrations/029_staff_hq_manual_read_access.sql"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  test("공통 매뉴얼은 검증된 지점의 franchise_id와 store_id NULL 기준으로 조회하고 승인된 행만 반환한다", () => {
    assert.match(manualsRoute, /\.eq\("franchise_id", franchise\.franchiseId\)\.is\("store_id", null\)/);
    assert.match(manualsRoute, /\.eq\("status", "approved"\)/);
  });

  test("구형 HQ 공통 매뉴얼의 franchise_id를 유일하게 일치하는 브랜드명으로 보정한다", () => {
    assert.match(migration, /m\.franchise_id is null\s+and m\.store_id is null/);
    assert.match(migration, /select count\(\*[\s\S]*?\) = 1/i);
    assert.match(migration, /lower\(btrim\(m\.brand_name\)\)/i);
  });

  test("RLS는 승인된 staff에게 같은 franchise의 승인 HQ 공통 매뉴얼만 허용한다", () => {
    assert.match(migration, /create policy manuals_select_approved_staff_common/);
    assert.match(migration, /membership\.role = 'staff'/);
    assert.match(migration, /membership\.status = 'approved'/);
    assert.match(migration, /status = 'approved'/);
    assert.match(migration, /membership\.franchise_id = manuals\.franchise_id/);
    assert.match(migration, /store_id is null/);
  });

  test("상세 조회 로그는 명시적으로 활성화했을 때만 원본 매뉴얼 행을 기록한다", () => {
    assert.match(manualsRoute, /process\.env\.MANUAL_LOOKUP_DEBUG === "1"/);
    assert.match(manualsRoute, /store_id: storeId/);
    assert.match(manualsRoute, /franchise_id: franchise\.franchiseId/);
    assert.match(manualsRoute, /raw_rows: data/);
    assert.match(manualsRoute, /raw_rows: franchiseRows/);
    assert.match(manualsRoute, /raw_rows: legacyRows/);
    assert.match(manualsRoute, /rls_bypassed_by_service_role: true/);
  });
});
