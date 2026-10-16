import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const localModules = new Map();
const fixtureEnvironment = {};
const source = readFileSync(new URL("../../app/staff/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(`${source}\nexport { MessageBubble, normalizeSource, toChatMessages, buildNewChatMessages };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const pageModule = { exports: {} };
new Script(compiled).runInNewContext({ module: pageModule, exports: pageModule.exports,
  require: (name) => name === "@/lib/rag/recipe-fact-verification" ? loadLocalTs("lib/rag/recipe-fact-verification.ts")
    : ["react", "react/jsx-runtime", "lucide-react"].includes(name) ? require(name) : {},
});
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
export const renderEvidenceMessage = (overrides = {}) => renderToStaticMarkup(createElement(pageModule.exports.MessageBubble, {
  message: { from: "ai", text: "테스트 답변", time: "", source: { title: "테스트 인용 근거", category: "운영" },
    similarity: 0.559292845030823, status: "cautious", ...overrides },
}));

test("explicit clarification uses a question-confirmation badge without reclassifying old responses", async () => {
  for (const status of ["insufficient", "cautious", "answered"]) {
    const html = renderEvidenceMessage({ responseKind: "clarification", status });
    assert.ok(html.includes("질문 확인"));
    assert.equal(html.includes("관리자 확인 필요"), false);
    assert.equal(html.includes("확인 권장"), false);
    assert.equal(html.includes("매뉴얼 기반 답변"), false);
  }
  assert.ok(renderEvidenceMessage({ status: "insufficient", text: "어떤 질문인가요?" }).includes("관리자 확인 필요"));
  assert.ok(renderEvidenceMessage({ status: "cautious" }).includes("확인 권장"));
  const submitted = await submitWithFakeResponse({ answer: "확인 질문", status: "insufficient", responseKind: "clarification",
    conversationId: "conversation-fixture", historyAvailable: true });
  assert.equal(submitted.messages.at(-1).responseKind, "clarification");
});

test("support badges are never inferred from status, source, score or answer wording without validated metadata", () => {
  for (const status of ["answered", "cautious", "insufficient"]) {
    for (const similarity of [0.1, 0.55, 0.99]) {
      const html = renderEvidenceMessage({ status, similarity, text: "검증된 답변처럼 보이는 문장" });
      assert.equal(html.includes("매뉴얼 근거 확인"), false);
      assert.equal(html.includes("추가 확인 필요"), false);
      assert.equal(html.includes("정답 확률이나 답변의 완전성을 뜻하지 않습니다"), false);
      if (status === "cautious") assert.ok(html.includes("확인 권장"));
    }
  }
});

async function submitWithFakeResponse(payload, conversationId = "conversation-fixture", options = {}) {
  const parsed = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let submit;
  const lifecycle = [];
  function findSubmit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "submitQuestion") submit = node;
    if (ts.isFunctionDeclaration(node) && ["resetConversation", "startNewConversation"].includes(node.name?.text)) lifecycle.push(node.getText(parsed));
    ts.forEachChild(node, findSubmit);
  }
  findSubmit(parsed);
  assert.ok(submit);
  const code = ts.transpileModule(`${lifecycle.join("\n")}\n${submit.getText(parsed)}\n${options.exercise ?? `submitQuestion(${JSON.stringify(options.question ?? "fixture-question")});`}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let messages = [];
  let input = "";
  let loading = false;
  const storedIds = [];
  const warnings = [];
  const context = {
    isBusy: false, readOnlyStoreName: null, selectedStore: { id: "store-fixture" }, stores: [], conversationId,
    requestInFlightRef: { current: false },
    previousStoreIdRef: { current: "store-fixture" },
    fetch: options.fetchImpl ?? (async () => ({ ok: true, json: async () => payload })),
    setInput: value => { input = typeof value === "function" ? value(input) : value; },
    setIsLoading: value => { loading = value; }, setConversationId: value => { context.conversationId = value; },
    writeStaffConversationId: value => { storedIds.push(value); },
    setReadOnlyStoreName: value => { context.readOnlyStoreName = value; }, setDateLabel: () => {},
    buildNewChatMessages: pageModule.exports.buildNewChatMessages,
    setErrorMessage: value => { if (value) warnings.push(value); },
    setMessages: update => { messages = typeof update === "function" ? update(messages) : update; }, formatMessageTime: () => "",
    isRecord: value => value !== null && typeof value === "object",
    isRagStatus: value => ["answered", "cautious", "insufficient"].includes(value), normalizeSource: pageModule.exports.normalizeSource,
    parseRecipeEvidenceSupport: loadLocalTs("lib/rag/recipe-fact-verification.ts").parseRecipeEvidenceSupport,
  };
  await new Script(code).runInNewContext(context);
  return { messages, warnings, input, loading, storedIds, conversationId: context.conversationId, locked: context.requestInFlightRef.current };
}

test("staff submit blocks same-tick duplicates, unlocks after failure, continues and starts a separate new conversation", async () => {
  const requests = [];
  const result = await submitWithFakeResponse({}, null, {
    exercise: `(async () => {
      const first = submitQuestion('failed-first');
      await Promise.all([first, submitQuestion('same-tick-duplicate')]);
      await submitQuestion('next-question');
      await submitQuestion('connected-follow-up');
      startNewConversation();
      await submitQuestion('separate-new-question');
    })();`,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (requests.length === 1) return { ok: false, status: 503, json: async () => ({ code: "PROVIDER_QUOTA_EXCEEDED" }) };
      return { ok: true, status: 200, json: async () => ({ answer: "synthetic answer", status: "answered", historyAvailable: true,
        conversationId: requests.length === 4 ? "separate-fixture" : "first-fixture" }) };
    },
  });
  assert.deepEqual(requests.map(request => [request.question, request.conversationId]), [
    ["failed-first", null], ["next-question", null], ["connected-follow-up", "first-fixture"], ["separate-new-question", null],
  ]);
  assert.equal(result.loading, false);
  assert.equal(result.locked, false);
  assert.equal(result.conversationId, "separate-fixture");
  assert.ok(result.storedIds.includes(null));
  assert.ok(result.warnings[0].includes("크레딧"));
});

test("staff failure retains the draft and separates user sessions from provider auth and internal validation", async () => {
  for (const [status, code, expected] of [[503, "PROVIDER_QUOTA_EXCEEDED", "크레딧"],
    [502, "PROVIDER_AUTH_FAILED", "인증 설정"], [502, "PROVIDER_PERMISSION_DENIED", "접근 권한"],
    [503, "PROVIDER_RATE_LIMITED", "요청 한도"], [503, "PROVIDER_UNAVAILABLE", "자동 재요청하지"],
    [500, "GENERATION_UNPARSABLE", "매뉴얼 근거를 안전하게 검증하지 못해"], [401, undefined, "로그인 세션"]]) {
    let calls = 0;
    const result = await submitWithFakeResponse({}, null, { question: "preserved-question", fetchImpl: async () => {
      calls++;
      return { ok: false, status, json: async () => ({ code }) };
    } });
    assert.equal(calls, 1);
    assert.equal(result.input, "preserved-question");
    assert.equal(result.messages.at(-1).text, "preserved-question");
    assert.equal(result.loading, false);
    assert.equal(result.locked, false);
    assert.ok(result.warnings.at(-1).includes(expected));
  }
});

function loadLocalTs(relative) {
  const filename = path.resolve(root, relative);
  if (localModules.has(filename)) return localModules.get(filename).exports;
  const loaded = { exports: {} };
  localModules.set(filename, loaded);
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Script(code, { filename }).runInNewContext({ module: loaded, exports: loaded.exports,
    require: name => {
      if (name.startsWith("@/")) return loadLocalTs(`${name.slice(2)}.ts`);
      if (name.startsWith(".")) return loadLocalTs(path.relative(root, path.resolve(path.dirname(filename), name.endsWith(".ts") ? name : `${name}.ts`)));
      return require(name);
    }, console, AbortSignal, Response, URLSearchParams, process: { env: fixtureEnvironment },
  });
  return loaded.exports;
}

function createStaffFixtureHandler(options = {}) {
  const fixture = JSON.parse(readFileSync(new URL("../rag/synthetic-support-cases.json", import.meta.url), "utf8")).dairySupport;
  if (options.clarification) fixture.question = "그럼 개봉한 건?";
  if (options.outOfScope) fixture.question = "오늘 날씨 어때?";
  if (options.shortage) fixture.question = "우유의 개봉 후 보관 기간이 궁금해";
  if (options.escalationFlow) {
    fixture.question = "검증표식 Z의 확인 문자열 알려줘";
    fixture.requestedTarget = "검증표식 Z";
    fixture.coverage = "direct";
    fixture.sources = [];
  }
  if (options.statePermission) {
    fixture.question = "유통기한 지난 우유 써도 돼?";
    fixture.sources = [{ id: "expiry-fixture", quote: "유통기한이 지난 식재료는 사용하지 않는다.", raw: .25968326912132, boost: .2,
      target: "식재료", role: "permission", relation: "covers_requested" }];
    fixture.requestedTarget = "우유";
  }
  if (options.recipeSourceRendering) {
    fixture.question = "HOT 테스트음료의 스팀 온도는 몇 ℃인가요?";
    fixture.requestedTarget = "HOT 테스트음료";
    fixture.coverage = "direct";
    fixture.sources = [{ id: "recipe-rendered-ui", quote: "● HOT 테스트음료\n기본 기준: 16oz / 우유 220ml / 스팀 온도 60~65℃",
      raw: .41, boost: .2, target: "HOT 테스트음료", role: "conditions", relation: "same" }];
  }
  const state = { logs: [], conversations: [], messages: [], notifications: [], order: [], ragCalls: 0, searchCalls: [], interpretations: 0, generations: 0, updates: 0, responseStatus: null, messageInsertAttempts: 0 };
  const tables = {
    question_logs: state.logs, notifications: state.notifications,
    store_memberships: [
      { user_id: "owner-fixture", store_id: "store-fixture", role: "owner", status: "approved" },
      { user_id: "other-owner", store_id: "other-store", role: "owner", status: "approved" },
      { user_id: "pending-owner", store_id: "store-fixture", role: "owner", status: "pending" },
    ],
  };
  const escalationClient = { from(table) {
    assert.ok(Object.hasOwn(tables, table));
    const filters = [];
    const query = {
      select: () => query, eq: (key, value) => { filters.push(row => row[key] === value); return query; },
      in: (key, values) => { filters.push(row => values.includes(row[key])); return query; },
      maybeSingle: async () => ({ data: tables[table].find(row => filters.every(filter => filter(row))) ?? null, error: null }),
      then: resolve => Promise.resolve({ data: tables[table].filter(row => filters.every(filter => filter(row))), error: null }).then(resolve),
      insert: async row => {
        state.order.push("notification");
        if (options.notificationFailure) return { error: { code: "FIXTURE_FAILED" } };
        tables[table].push(row); return { error: null };
      },
    };
    return query;
  } };
  const { resolveRagAnswer } = loadLocalTs("lib/rag/resolve-rag-answer.ts");
  const { finalizeRagQueryResponse } = loadLocalTs("lib/rag/finalize-rag-query-response.ts");
  const { escalateQuestionLogToStoreOwners } = loadLocalTs("lib/notifications/escalate-question-log.ts");
  const ragPost = async request => {
    state.ragCalls++;
    const body = await request.json();
    if (options.forbiddenStore || body.storeId !== "store-fixture") return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    assert.equal(body.question, fixture.question);
    const matches = fixture.sources.map((item, index) => ({ chunk_id: item.id, manual_id: item.manualId ?? `manual-${item.id}`,
      title: options.escalationFlow ? "Synthetic verification marker" : options.statePermission ? "재고 관리" : index === 0 ? "재고 및 비품 보관 위치" : "테스트 확인 정책", category: "재고·발주", content: item.quote,
      raw_similarity_score: item.raw, keyword_boost: item.boost, similarity_score: item.raw + item.boost }));
    const outcome = await resolveRagAnswer({ question: body.question, thresholds: { answered: .6, cautious: .4 },
      noManualAnswer: "관리자에게 확인해 주세요.", cautionNotice: "", requireCoverage: true, requireSupportAssessment: true, requireEvidenceScope: true,
    }, {
      interpret: options.shortage ? async () => { state.interpretations++; assert.fail("explicit first question must not invoke interpretation"); } : undefined,
      search: async query => { state.searchCalls.push(query); return matches; },
      generate: async () => {
        state.generations++;
        if (options.recipeSourceRendering) return JSON.stringify({ answerable: true, answer: "HOT 테스트음료 스팀 온도 약 60~65℃입니다. 이 AI 설명은 수치와 함께 보존하지 마세요.",
          coverage: "direct", usedChunkIds: [fixture.sources[0].id], supportAssessment: { requestedTarget: fixture.requestedTarget, requirements: [
            { kind: "conditions", support: "direct", evidence: [{ chunkId: fixture.sources[0].id, quote: fixture.sources[0].quote, role: "conditions", target: fixture.requestedTarget, targetRelation: "same" }] },
          ] } });
        if (options.statePermission) return JSON.stringify({ answerable: true, answer: "7일 사용 가능", coverage: "partial", usedChunkIds: [fixture.sources[0].id],
          supportAssessment: { requestedTarget: "우유", requirements: [
            { kind: "permission", support: "direct", evidence: [{ chunkId: fixture.sources[0].id, quote: fixture.sources[0].quote, role: "permission", target: "식재료", targetRelation: "covers_requested" }] },
            { kind: "conditions", support: "missing", evidence: [] },
          ] } });
        return options.shortage ? JSON.stringify({ answerable: false, answer: options.shortageBody ?? "7일 보관 가능", coverage: "policy_only", usedChunkIds: [], supportAssessment: null })
        : JSON.stringify({ answerable: true, answer: fixture.sources.map(item => item.quote).join("\n"), coverage: fixture.coverage,
        usedChunkIds: fixture.sources.map(item => item.id), supportAssessment: { requestedTarget: fixture.requestedTarget,
          requirements: [{ kind: options.escalationFlow ? "facts" : "method", support: "direct", evidence: fixture.sources.map(item => ({ chunkId: item.id,
            quote: item.quote, target: item.target, role: item.role, targetRelation: item.relation })) }] } });
      },
    });
    assert.equal(outcome.kind, "resolved");
    const response = await finalizeRagQueryResponse({ httpStatus: 200, question: body.question, storeId: body.storeId, response: outcome.response,
      afterQuestionLogSaved: async saved => {
        if (saved.saved && outcome.escalate) await escalateQuestionLogToStoreOwners(escalationClient, { questionLogId: saved.questionLogId, storeId: body.storeId });
      },
    }, async input => {
      state.order.push("question-log");
      if (options.logFailure) return { saved: false, code: "QUESTION_LOG_SAVE_FAILED" };
      const logId = options.escalationFlow ? `flow-log-${state.logs.length}` : "log-fixture";
      state.logs.push({ id: logId, store_id: input.storeId, question: input.question, answer: input.answer, status: input.status,
        source_manual_id: input.sourceManualId, resolution_status: "open", created_at: "2026-10-11T00:00:00Z" });
      return { saved: true, questionLogId: logId };
    });
    return new Response(JSON.stringify({ ...response, ...(options.evidenceSupport ? { evidenceSupport: options.evidenceSupport } : {}) }), { headers: { "Content-Type": "application/json", "X-RAG-Trace-ID": "11111111-1111-4111-8111-111111111111" } });
  };
  const admin = { from(table) {
    let payload;
    const filters = {};
    const query = {
      select: () => query, eq: (key, value) => { filters[key] = value; return query; },
      insert: row => { payload = row; return query; }, update: () => { state.updates++; return query; },
      maybeSingle: async () => {
        assert.equal(filters.user_id, "user-fixture");
        return { data: options.deniedConversation ? null : { id: filters.id, store_id: "store-fixture" }, error: null };
      },
      single: async () => {
        assert.equal(table, "conversations");
        if (options.conversationFailure) return { data: null, error: { code: "FIXTURE_FAILED" } };
        state.conversations.push({ id: "conversation-fixture", ...payload });
        return { data: { id: "conversation-fixture" }, error: null };
      },
      then: resolve => {
        if (table === "conversation_messages" && payload) {
          state.messageInsertAttempts++;
          if (options.missingResponseKind && payload.some(row => Object.hasOwn(row, "response_kind"))) {
            return Promise.resolve({ error: { code: "PGRST204", message: "response_kind missing from schema cache" } }).then(resolve);
          }
          if (options.messageTransportFailure) throw new TypeError("fixture network failure");
          if (options.messageError) return Promise.resolve({ error: options.messageError }).then(resolve);
          if (options.messageFailure) return Promise.resolve({ error: { code: "FIXTURE_FAILED" } }).then(resolve);
          state.messages.push(...payload);
        }
        if (table === "conversations" && options.updateFailure) return Promise.resolve({ error: { code: "FIXTURE_UPDATE_FAILED" } }).then(resolve);
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    return query;
  } };
  const route = { exports: {} };
  const dependencies = {
    "next/server": require("next/server.js"), "@/app/api/rag/query/route": { POST: ragPost },
    "@/lib/staff/conversations": { ...loadLocalTs("lib/staff/conversations.ts"), buildConversationTitle: () => "테스트 질문", isMissingConversationTable: () => false },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: options.unauthenticated ? null : { id: "user-fixture" } }, error: null }) } }) },
    "@/lib/rag/trace-identifiers": loadLocalTs("lib/rag/trace-identifiers.ts"),
    "@/lib/rag/recipe-fact-verification": loadLocalTs("lib/rag/recipe-fact-verification.ts"),
  };
  const routeSource = readFileSync(new URL("../../app/api/staff/chat/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Script(code).runInNewContext({ module: route, exports: route.exports, require: name => { assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name]; },
    Request, URL, process: { env: { NODE_ENV: "development", ...fixtureEnvironment } }, console: { info: () => {}, error: () => {} },
  });
  return { fixture, state, post: route.exports.POST };
}

test("private execution headers and body markers cannot enter ordinary staff generation", async () => {
  for (const mode of ["body", "header", "retest"]) {
    const handler = createStaffFixtureHandler({ recipeSourceRendering: true });
    const response = await handler.post(new Request("http://localhost/api/staff/chat", { method: "POST", headers: { "Content-Type": "application/json",
      ...(mode === "header" ? { "X-RAG-E2E": "synthetic-private" } : {}), ...(mode === "retest" ? { "X-RAG-Retest": "synthetic-private" } : {}) },
      body: JSON.stringify({ question: handler.fixture.question, storeId: "store-fixture", ...(mode === "body" ? { e2eExecution: { label: "synthetic-private" } } : {}) }) }));
    assert.equal(response.status, 409);
    assert.equal(handler.state.ragCalls, 0);
    assert.equal(handler.state.generations, 0);
    assert.equal(handler.state.logs.length, 0);
    assert.equal(handler.state.messages.length, 0);
  }
});

test("source-rendered recipe facts preserve exact text and source through response, log, storage and reloaded UI with metadata off", async () => {
  const handler = createStaffFixtureHandler({ recipeSourceRendering: true });
  const response = await handler.post(new Request("http://localhost/api/staff/chat", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: handler.fixture.question, storeId: "store-fixture" }) }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "answered");
  assert.ok(body.answer.includes("HOT 테스트음료 (16oz)"));
  assert.ok(body.answer.includes("스팀 온도 60~65℃"));
  for (const unwanted of ["약 60~65℃", "AI 설명", "우유 220ml"]) assert.equal(body.answer.includes(unwanted), false);
  assert.equal((body.answer.match(/60~65℃/gu) ?? []).length, 1);
  assert.equal(body.evidenceSupport, undefined);
  assert.equal(handler.state.logs[0].answer, body.answer);
  assert.equal(handler.state.messages[1].content, body.answer);
  assert.equal(handler.state.logs[0].evidence_support, undefined);
  assert.equal(handler.state.messages[1].evidence_support, undefined);
  assert.equal(handler.state.logs[0].source_manual_id, body.source.manualId);
  assert.equal(handler.state.messages[1].source_title, body.source.title);
  const rows = handler.state.messages.map((row, index) => ({ ...row, id: `source-message-${index}` }));
  const fixture = conversationReadFixture(rows);
  const { getStaffConversationDetail } = loadLocalTs("lib/staff/conversations.ts");
  const detail = await getStaffConversationDetail(fixture.client, "user-fixture", "owned-conversation");
  assert.equal(detail.ok, true);
  const restored = pageModule.exports.toChatMessages(detail.messages)[1];
  const immediate = (await submitWithFakeResponse(body)).messages.at(-1);
  assert.equal(restored.text, immediate.text);
  assert.deepEqual(restored.source, immediate.source);
  assert.equal(restored.status, immediate.status);
  assert.equal(restored.similarity, immediate.similarity);
  for (const message of [immediate, restored]) {
    const html = renderToStaticMarkup(createElement(pageModule.exports.MessageBubble, { message }));
    assert.ok(html.includes("스팀 온도 60~65℃"));
    assert.ok(html.includes("매뉴얼 기반 답변"));
    assert.equal(html.includes("정답 확률이나 답변의 완전성을 뜻하지 않습니다"), false);
    assert.equal(html.includes("매뉴얼 근거 확인"), false);
  }
});

test("synthetic dairy fixture travels through staff API to the live UI and reloaded history without a common error", async () => {
  const handler = createStaffFixtureHandler();
  const rendered = await submitWithFakeResponse({}, null, { question: handler.fixture.question, fetchImpl: async (url, init) => {
    assert.equal(url, "/api/staff/chat");
    const response = await handler.post(new Request(`http://localhost:3000${url}`, init));
    handler.state.responseStatus = response.status;
    assert.match(response.headers.get("X-RAG-Trace-ID"), /^[0-9a-f-]{36}$/);
    return response;
  } });
  assert.equal(handler.state.responseStatus, 200);
  assert.equal(rendered.warnings.length, 0);
  const answer = rendered.messages.at(-1);
  assert.equal(answer.status, "insufficient");
  assert.ok(answer.text.includes("요청 범위 전체를 확인하지 못했습니다"));
  assert.ok(answer.text.includes("질문의 대상 범위 전체에 적용할 수 없습니다"));
  assert.equal(answer.similarity, handler.fixture.expectedEvidenceScore);
  const markup = renderToStaticMarkup(createElement(pageModule.exports.MessageBubble, { message: answer }));
  for (const text of ["재고 및 비품 보관 위치", "관리자 확인 필요"]) assert.ok(markup.includes(text));
  assert.equal(markup.includes("인용 근거 관련도"), false);
  assert.equal(markup.includes("63%"), false);
  assert.equal(handler.state.conversations.length, 1);
  assert.equal(handler.state.conversations[0].store_id, "store-fixture");
  assert.equal(handler.state.messages.length, 2);
  assert.equal(handler.state.logs[0].status, "insufficient");
  assert.equal(handler.state.logs[0].question, handler.fixture.question);
  assert.equal(handler.state.notifications.length, 1);
  assert.equal(handler.state.notifications[0].recipient_user_id, "owner-fixture");
  assert.deepEqual(handler.state.order, ["question-log", "notification"]);
  const restored = pageModule.exports.toChatMessages(handler.state.messages.map(row => ({ role: row.role, content: row.content, createdAt: row.created_at,
    status: row.status, sourceTitle: row.source_title, sourceCategory: row.source_category, similarity: row.similarity })));
  assert.equal(restored.at(-1).text, answer.text);
  assert.equal(restored.at(-1).status, answer.status);
  assert.equal(restored.at(-1).source.title, answer.source.title);
  assert.equal(restored.at(-1).similarity, answer.similarity);
});

test("dairy staff and UI preserve the partial answer on log, notification or conversation persistence failures", async () => {
  for (const option of ["logFailure", "notificationFailure", "conversationFailure", "messageFailure"]) {
    const handler = createStaffFixtureHandler({ [option]: true });
    const rendered = await submitWithFakeResponse({}, null, { question: handler.fixture.question, fetchImpl: async (url, init) => {
      const response = await handler.post(new Request(`http://localhost:3000${url}`, init));
      assert.equal(response.status, 200);
      return response;
    } });
    assert.equal(rendered.messages.at(-1).status, "insufficient");
    assert.ok(rendered.messages.at(-1).text.includes("요청 범위"));
    assert.equal(rendered.warnings.some(text => text.includes("답변을 불러오지 못했어요")), false);
    if (option === "logFailure") {
      assert.equal(handler.state.logs.length, 0); assert.equal(handler.state.notifications.length, 0);
      assert.ok(rendered.warnings.some(text => text.includes("질문 기록을 저장하지 못했습니다")));
    } else if (option === "notificationFailure") {
      assert.equal(handler.state.logs.length, 1); assert.equal(handler.state.notifications.length, 0);
      assert.equal(rendered.warnings.length, 0);
    } else assert.ok(rendered.warnings.some(text => text.includes("대화 기록 저장에 실패했습니다")));
  }
});

test("synthetic first-question shortage scope survives staff persistence fallbacks, DTO restore and source-free UI", async () => {
  for (const shortageBody of ["", "해당 안내가 없습니다.", "7일 보관 가능"]) {
  for (const option of [null, "logFailure", "notificationFailure", "conversationFailure", "messageFailure", "missingResponseKind", "updateFailure"]) {
    const handler = createStaffFixtureHandler({ shortage: true, shortageBody, ...(option ? { [option]: true } : {}) });
    const rendered = await submitWithFakeResponse({}, option === "updateFailure" ? "owned-conversation" : null, {
      question: handler.fixture.question, fetchImpl: async (url, init) => {
        const response = await handler.post(new Request(`http://localhost:3000${url}`, init));
        assert.equal(response.status, 200);
        return response;
      },
    });
    const answer = rendered.messages.at(-1);
    assert.equal(handler.state.interpretations, 0);
    assert.equal(handler.state.generations, 1);
    assert.equal(handler.state.ragCalls, 1);
    assert.ok(answer.text.includes(handler.fixture.question));
    assert.ok(answer.text.includes("요청한 조건"));
    assert.ok(answer.text.includes("요청한 기간"));
    assert.equal(answer.text.includes("7일"), false);
    assert.equal(answer.status, "insufficient");
    assert.equal(answer.source, undefined);
    const html = renderToStaticMarkup(createElement(pageModule.exports.MessageBubble, { message: answer }));
    for (const scope of ["우유", "개봉 후", "보관 기간"]) assert.ok(html.includes(scope));
    assert.ok(html.includes("관리자 확인 필요"));
    assert.equal(html.includes("인용 근거 관련도"), false);
    if (handler.state.logs.length) assert.equal(handler.state.logs[0].answer, answer.text);
    if (handler.state.messages.length === 2) {
      const { getStaffConversationDetail } = loadLocalTs("lib/staff/conversations.ts");
      const rows = handler.state.messages.map((row, index) => ({ ...row, id: `scope-message-${index}` }));
      const fixture = conversationReadFixture(rows, { legacy: option === "missingResponseKind" });
      const detail = await getStaffConversationDetail(fixture.client, "user-fixture", "owned-conversation");
      assert.equal(detail.ok, true);
      const restored = pageModule.exports.toChatMessages(detail.messages).at(-1);
      assert.equal(restored.text, answer.text);
      assert.equal(restored.source, undefined);
      assert.equal(restored.status, "insufficient");
      const restoredHtml = renderToStaticMarkup(createElement(pageModule.exports.MessageBubble, { message: restored }));
      for (const scope of ["우유", "개봉 후", "보관 기간"]) assert.ok(restoredHtml.includes(scope));
    }
    assert.equal(rendered.warnings.some(text => text.includes("답변을 불러오지 못했어요")), false);
  }
  }
});

test("synthetic expired-state permission retains a direct sourced answer through staff, storage, DTO and UI without gap escalation", async () => {
  const handler = createStaffFixtureHandler({ statePermission: true });
  const rendered = await submitWithFakeResponse({}, null, { question: handler.fixture.question, fetchImpl: async (url, init) => {
    const response = await handler.post(new Request(`http://localhost:3000${url}`, init));
    assert.equal(response.status, 200);
    return response;
  } });
  const answer = rendered.messages.at(-1);
  assert.equal(answer.status, "answered");
  assert.ok(answer.text.includes("우유"));
  assert.ok(answer.text.includes("사용하면 안 돼요"));
  assert.equal(answer.text.includes("7일"), false);
  assert.equal(answer.text.includes("요청 범위 전체를 확인하지 못했습니다"), false);
  assert.equal(handler.state.logs[0].status, "answered");
  assert.equal(handler.state.notifications.length, 0);
  const { getStaffConversationDetail } = loadLocalTs("lib/staff/conversations.ts");
  const rows = handler.state.messages.map((row, index) => ({ ...row, id: `permission-message-${index}` }));
  const detail = await getStaffConversationDetail(conversationReadFixture(rows).client, "user-fixture", "owned-conversation");
  assert.equal(detail.ok, true);
  const restored = pageModule.exports.toChatMessages(detail.messages).at(-1);
  assert.equal(restored.text, answer.text);
  const html = renderToStaticMarkup(createElement(pageModule.exports.MessageBubble, { message: restored }));
  assert.ok(html.includes("사용하면 안 돼요"));
  assert.ok(html.includes("재고 관리"));
  assert.equal(html.includes("관리자 확인 필요"), false);
});

test("escalation amendment publishes a new revision before identical staff question cites fresh evidence without auto resolution", async () => {
  for (const indexingFailure of [false, true]) {
    const handler = createStaffFixtureHandler({ escalationFlow: true });
    const submit = async (conversationId = null) => submitWithFakeResponse({}, conversationId, { question: handler.fixture.question, fetchImpl: async (url, init) => handler.post(new Request(`http://localhost:3000${url}`, init)) });
    const first = await submit();
    assert.equal(first.messages.at(-1).status, "insufficient");
    assert.equal(handler.state.notifications.length, 1);
    const priorAnswer = handler.state.logs[0].answer;
    const manualId = "77777777-7777-4777-8777-777777777777";
    const manual = { id: manualId, brand_name: "Synthetic Brand", franchise_id: "brand-fixture", store_id: "store-fixture", scope_type: "store",
      parent_manual_id: null, title: "Synthetic verification marker", category: "Test", content: "TEST ONLY. Initial placeholder.",
      status: "approved", updated_at: "2026-10-11T00:00:00Z" };
    const tables = { manuals: [manual], manual_chunks: [], question_logs: handler.state.logs,
      store_memberships: [{ id: "owner-membership", user_id: "owner-fixture", store_id: "store-fixture", role: "owner", status: "approved" }],
      stores: [{ id: "store-fixture", franchise_id: "brand-fixture" }], franchises: [{ id: "brand-fixture", name: "Synthetic Brand" }] };
    const rpcCalls = [];
    const client = { from(table) {
      assert.ok(Object.hasOwn(tables, table));
      const filters = [];
      const query = { select: () => query, eq: (key, value) => { filters.push(row => row[key] === value); return query; },
        maybeSingle: async () => ({ data: tables[table].find(row => filters.every(filter => filter(row))) ?? null, error: null }) };
      return query;
    }, rpc: async (name, args) => {
      rpcCalls.push(name);
      if (name === "check_manual_write_contract") return { data: 2, error: null };
      if (name === "edit_store_manual_if_current") {
        assert.equal(args.p_manual_id, manualId);
        assert.equal(args.p_store_id, "store-fixture");
        assert.equal(args.p_expected_updated_at, manual.updated_at);
        Object.assign(manual, args.p_update, { updated_at: "2026-10-11T00:01:00Z" });
        tables.manual_chunks = [];
        return { data: { manual: { ...manual }, hasChildren: false }, error: null };
      }
      assert.equal(name, "replace_manual_chunks_if_current");
      assert.equal(args.p_expected_snapshot.updated_at, manual.updated_at);
      assert.equal(args.p_chunks.length, 1);
      tables.manual_chunks = args.p_chunks;
      handler.fixture.sources = args.p_chunks.map(row => ({ id: "published-chunk", manualId, quote: row.content, raw: .8, boost: 0,
        target: "검증표식 Z", role: "facts", relation: "same" }));
      return { data: 1, error: null };
    } };
    const { fetchOwnerQuestionManualContext, buildQuestionManualEditUrl } = loadLocalTs("lib/owner/question-manual-context.ts");
    const context = await fetchOwnerQuestionManualContext(client, { userId: "owner-fixture", storeId: "store-fixture", questionId: "flow-log-0" });
    assert.equal(context.status, 200);
    assert.equal(context.body.context.answer, priorAnswer);
    assert.equal(context.body.context.sourceState, "none");
    const editURL = new URL(buildQuestionManualEditUrl("store-fixture", "flow-log-0", manualId), "http://localhost");
    assert.equal(editURL.searchParams.get("manualId"), manualId);
    const { saveStoreManualEdit } = loadLocalTs("lib/manuals/save-store-manual-edit.ts");
    const { indexApprovedManual } = loadLocalTs("lib/rag/index-approved-manual.ts");
    const { resolveManualReadinessStatus } = loadLocalTs("lib/manuals/manual-search-readiness.ts");
    let embeddingCalls = 0;
    const newContent = "TEST ONLY. 검증표식 Z의 확인 문자열은 MOCK-REVISION-TWO이다.";
    const edited = await saveStoreManualEdit(client, { userId: "owner-fixture", storeId: "store-fixture", manualId,
      content: newContent, expectedUpdatedAt: manual.updated_at }, async (id, revision, writeContext) => indexApprovedManual(id, client, async inputs => {
      embeddingCalls++;
      assert.ok(inputs[0].includes(newContent));
      if (indexingFailure) throw new Error("synthetic embedding unavailable");
      return inputs.map(() => Array(1536).fill(.1));
    }, revision, writeContext));
    assert.equal(edited.status, 200);
    assert.equal(manual.content, newContent);
    assert.equal(handler.state.logs[0].resolution_status, "open");
    assert.equal(handler.state.logs[0].answer, priorAnswer);
    assert.equal(embeddingCalls, 1);
    if (indexingFailure) {
      assert.equal(edited.body.searchStatus, "failed");
      assert.equal(tables.manual_chunks.length, 0);
      assert.equal(resolveManualReadinessStatus(manual, [], false), "needs_reindex");
      assert.equal(handler.state.ragCalls, 1);
      continue;
    }
    assert.equal(edited.body.searchStatus, "ready");
    assert.equal(tables.manual_chunks[0].content, newContent);
    assert.equal(resolveManualReadinessStatus(manual, [{ manual_id: manualId, has_embedding: true }], false), "ready");
    const second = await submit("conversation-fixture");
    const answer = second.messages.at(-1);
    assert.equal(answer.status, "answered");
    assert.ok(answer.text.includes("MOCK-REVISION-TWO"));
    assert.equal(answer.source.title, "Synthetic verification marker");
    assert.equal(handler.state.logs[1].source_manual_id, manualId);
    assert.deepEqual(handler.state.searchCalls, [handler.fixture.question, handler.fixture.question]);
    assert.equal(handler.state.ragCalls, 2);
    assert.equal(handler.state.conversations.length, 1);
    assert.equal(handler.state.messages.length, 4);
    assert.equal(handler.state.logs[0].answer, priorAnswer);
    assert.equal(handler.state.logs[0].resolution_status, "open");
    assert.equal(handler.state.notifications.length, 1);
    assert.ok(rpcCalls.includes("replace_manual_chunks_if_current"));
    assert.ok(renderToStaticMarkup(createElement(pageModule.exports.MessageBubble, { message: answer })).includes("MOCK-REVISION-TWO"));
  }
});

test("staff fixture denies unauthenticated, foreign-store and unowned-conversation requests before writes", async () => {
  for (const [option, status, conversationId] of [["unauthenticated", 401, null], ["forbiddenStore", 403, null], ["deniedConversation", 404, "other-conversation"]]) {
    const handler = createStaffFixtureHandler({ [option]: true });
    const response = await handler.post(new Request("http://localhost:3000/api/staff/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: handler.fixture.question, storeId: "store-fixture", conversationId }) }));
    assert.equal(response.status, status);
    assert.equal(handler.state.logs.length + handler.state.messages.length + handler.state.notifications.length + handler.state.conversations.length, 0);
  }
});

test("existing conversation persistence failure is visible without hiding the answer", async () => {
  const result = await submitWithFakeResponse({ answer: "fixture-answer", status: "cautious", conversationId: "conversation-fixture",
    historyAvailable: false, saveError: "대화 기록 저장에 실패했습니다." });
  assert.equal(result.messages.at(-1).text, "fixture-answer");
  assert.equal(result.messages.at(-1).status, "cautious");
  assert.ok(result.warnings.some(value => value.includes("대화 기록 저장에 실패했습니다")));
});

test("question-log failure is visible and never claims manager notification delivery", async () => {
  const result = await submitWithFakeResponse({ answer: "fixture-answer", status: "insufficient", conversationId: "conversation-fixture",
    historyAvailable: true, questionLogSaveError: "QUESTION_LOG_SAVE_FAILED" });
  assert.equal(result.messages.at(-1).status, "insufficient");
  assert.ok(result.warnings.some(value => value.includes("질문 기록을 저장하지 못했습니다")));
  assert.ok(result.warnings.some(value => value.includes("직접 알려주세요")));
  assert.equal(result.warnings.some(value => value.includes("알림을 전달했습니다")), false);
});

test("simultaneous persistence failures are preserved and successful responses do not fabricate warnings", async () => {
  const failed = await submitWithFakeResponse({ answer: "fixture-answer", conversationId: "conversation-fixture", historyAvailable: false,
    saveError: "대화 기록 저장에 실패했습니다.", questionLogSaveError: "QUESTION_LOG_SAVE_FAILED" });
  assert.equal(failed.warnings.length, 1);
  assert.ok(failed.warnings[0].includes("질문 기록을 저장하지 못했습니다"));
  assert.ok(failed.warnings[0].includes("대화 기록 저장에 실패했습니다"));
  for (const questionLogSaveError of [undefined, "unknown-private-error"]) {
    const success = await submitWithFakeResponse({ answer: "fixture-answer", conversationId: "conversation-fixture", historyAvailable: true, questionLogSaveError });
    assert.equal(success.warnings.length, 0);
  }
});

test("staff live and reloaded history hide scores while preserving source and response state", () => {
  const live = renderEvidenceMessage();
  const saved = renderEvidenceMessage(JSON.parse(JSON.stringify({ similarity: 0.559292845030823, status: "cautious" })));
  assert.equal(live, saved);
  assert.equal(live.includes("인용 근거 관련도"), false);
  assert.equal(live.includes("정답 확률이나 답변의 완전성을 뜻하지 않습니다"), false);
  assert.ok(live.includes("테스트 인용 근거"));
  assert.ok(live.includes("확인 권장"));
  assert.equal(live.includes("56%"), false);
  const boundary = renderEvidenceMessage({ similarity: 0.596382245618982, status: "cautious" });
  assert.equal(boundary.includes("인용 근거 관련도"), false);
  assert.ok(boundary.includes("확인 권장"));
});

test("high relevance cannot override the persisted manager-confirmation status", () => {
  const markup = renderEvidenceMessage({ similarity: 0.634530957650396, status: "insufficient" });
  assert.ok(markup.includes("관리자 확인 필요"));
  assert.equal(markup.includes("인용 근거 관련도"), false);
  assert.equal(markup.includes("매뉴얼 기반 답변"), false);
});

test("missing/nonfinite evidence and missing source never show fabricated relevance", () => {
  for (const similarity of [undefined, NaN, Infinity, -Infinity]) assert.equal(renderEvidenceMessage({ similarity }).includes("인용 근거 관련도"), false);
  assert.equal(renderEvidenceMessage({ source: undefined }).includes("인용 근거 관련도"), false);
  assert.equal(renderEvidenceMessage({ similarity: 2 }).includes("인용 근거 관련도"), false);
  assert.equal(renderEvidenceMessage({ similarity: -1 }).includes("인용 근거 관련도"), false);
});

function conversationReadFixture(rows, options = {}) {
  const messageSelects = [];
  const client = { from(table) {
    let columns = "";
    const filters = {};
    const query = {
      select: value => { columns = value; if (table === "conversation_messages") messageSelects.push(value); return query; },
      eq: (key, value) => { filters[key] = value; return query; }, order: () => query,
      maybeSingle: async () => {
        if (table === "conversations") {
          assert.equal(filters.user_id, "user-fixture");
          return { data: options.denied ? null : { id: "owned-conversation", title: "대화", store_id: "store-fixture", updated_at: "2026-10-11T00:00:00Z" }, error: null };
        }
        if (table === "store_memberships") {
          assert.equal(filters.user_id, "user-fixture");
          assert.equal(filters.store_id, "store-fixture");
          return { data: { id: "membership" }, error: null };
        }
        return { data: { store_name: "매장" }, error: null };
      },
      then: resolve => {
        assert.equal(table, "conversation_messages");
        assert.equal(filters.conversation_id, "owned-conversation");
        if (options.error) return Promise.resolve({ data: null, error: options.error }).then(resolve);
        if (options.legacy && columns.includes("response_kind")) return Promise.resolve({ data: null,
          error: { code: "42703", message: "column response_kind does not exist" } }).then(resolve);
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return query;
  } };
  return { client, messageSelects };
}

test("recipe metadata opt-in preserves response, stored row, DTO and UI while full badge remains off", async () => {
  const support = { version: 1, outcome: "partial", verified: [{ ingredient: "우유", quantity: "220", unit: "ml" }], missing: ["바닐라 시럽"], reason: "RECIPE_REQUIRED_FACT_MISSING" };
  try {
    fixtureEnvironment.RAG_RECIPE_SUPPORT_STORAGE = "1";
    const handler = createStaffFixtureHandler({ evidenceSupport: support });
    const response = await handler.post(new Request("http://localhost/api/staff/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: handler.fixture.question, storeId: "store-fixture" }) }));
    const body = await response.json();
    assert.deepEqual(JSON.parse(JSON.stringify(body.evidenceSupport)), support);
    assert.equal(handler.state.messages[0].evidence_support, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(handler.state.messages[1].evidence_support)), support);
    const rows = handler.state.messages.map((row, index) => ({ ...row, id: `message-${index}` }));
    const fixture = conversationReadFixture(rows);
    const { getStaffConversationDetail } = loadLocalTs("lib/staff/conversations.ts");
    const result = await getStaffConversationDetail(fixture.client, "user-fixture", "owned-conversation");
    assert.equal(result.ok, true);
    assert.ok(fixture.messageSelects[0].includes("evidence_support"));
    const restored = pageModule.exports.toChatMessages(result.messages)[1];
    const immediate = await submitWithFakeResponse(body);
    const render = message => renderToStaticMarkup(createElement(pageModule.exports.MessageBubble, { message }));
    for (const message of [restored, immediate.messages.at(-1)]) {
      const html = render(message);
      assert.ok(html.includes("추가 확인 필요"));
      assert.ok(html.includes("확인된 내용: 우유 220ml"));
      assert.ok(html.includes("부족한 범위: 바닐라 시럽"));
      assert.equal(html.includes("매뉴얼 근거 확인"), false);
    }
    const full = { version: 1, outcome: "full", verified: [{ ingredient: "우유", quantity: "220", unit: "ml" }], missing: [], reason: "RECIPE_BOUNDED_FACTS_VERIFIED" };
    const message = { from: "ai", text: "정확한 답변. 확인 권장 안내 유지.", time: "", status: "cautious", similarity: .55,
      source: { title: "매뉴얼" }, evidenceSupport: full };
    assert.equal(render(message).includes("매뉴얼 근거 확인"), false);
    const opted = renderToStaticMarkup(createElement(pageModule.exports.MessageBubble, { message, allowFullSupportBadge: true }));
    assert.ok(opted.includes("매뉴얼 근거 확인"));
    assert.ok(opted.includes("정답을 보장하지 않습니다"));
    assert.ok(opted.includes("확인 권장"));
    assert.equal(opted.includes("정답 확률이나 답변의 완전성을 뜻하지 않습니다"), false);
    assert.equal(render({ ...message, evidenceSupport: { ...full, missing: ["우유"] } }).includes("매뉴얼 근거 확인"), false);
    assert.equal(render({ ...message, responseKind: "clarification" }).includes("매뉴얼 근거 확인"), false);
  } finally {
    delete fixtureEnvironment.RAG_RECIPE_SUPPORT_STORAGE;
  }
  const handler = createStaffFixtureHandler({ evidenceSupport: support });
  const response = await handler.post(new Request("http://localhost/api/staff/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: handler.fixture.question, storeId: "store-fixture" }) }));
  assert.equal((await response.json()).evidenceSupport, undefined);
  assert.equal(handler.state.messages[1].evidence_support, undefined);
});

test("explicit out-of-scope API and read-only stored history use scope badges while shortage remains unchanged", async () => {
  const handler = createStaffFixtureHandler({ outOfScope: true });
  const response = await handler.post(new Request("http://localhost:3000/api/staff/chat", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: handler.fixture.question, storeId: "store-fixture" }) }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.responseKind, "out_of_scope");
  assert.equal(body.status, "insufficient");
  assert.equal(body.historyAvailable, true);
  assert.equal(handler.state.generations, 0);
  assert.equal(handler.state.searchCalls.length, 0);
  assert.equal(handler.state.notifications.length, 0);
  assert.equal(handler.state.messages[1].response_kind, null);
  const immediate = await submitWithFakeResponse(body);
  assert.equal(immediate.messages.at(-1).responseKind, "out_of_scope");
  assert.ok(renderEvidenceMessage(immediate.messages.at(-1)).includes("업무 범위 안내"));
  assert.equal(renderEvidenceMessage(immediate.messages.at(-1)).includes("관리자 확인 필요"), false);
  const { getStaffConversationDetail } = loadLocalTs("lib/staff/conversations.ts");
  const rows = handler.state.messages.map((row, index) => ({ ...row, id: `scope-${index}` }));
  const before = JSON.stringify(rows);
  for (const legacy of [false, true]) {
    const detail = await getStaffConversationDetail(conversationReadFixture(rows, { legacy }).client, "user-fixture", "owned-conversation");
    assert.equal(detail.ok, true);
    assert.equal(detail.messages[1].responseKind, "out_of_scope");
    assert.equal(detail.messages[1].status, "insufficient");
    const html = renderEvidenceMessage(pageModule.exports.toChatMessages(detail.messages)[1]);
    assert.ok(html.includes("업무 범위 안내"));
    assert.equal(html.includes("관리자 확인 필요"), false);
    assert.equal(html.includes("매뉴얼 기반 답변"), false);
  }
  assert.equal(JSON.stringify(rows), before);
  const shortageRows = rows.map((row, index) => index === 0 ? { ...row, content: "직원 식대 영수증 정산 기한이 언제인가요?" } : row);
  const shortage = await getStaffConversationDetail(conversationReadFixture(shortageRows).client, "user-fixture", "owned-conversation");
  assert.notEqual(shortage.messages[1].responseKind, "out_of_scope");
  assert.ok(renderEvidenceMessage(pageModule.exports.toChatMessages(shortage.messages)[1]).includes("관리자 확인 필요"));
  assert.ok(renderEvidenceMessage({ status: "insufficient", text: body.answer }).includes("관리자 확인 필요"));
});

test("response kind survives actual conversation DTO and UI; NULL and old DB rows keep legacy badges", async () => {
  const { getStaffConversationDetail, isMissingResponseKindColumn } = loadLocalTs("lib/staff/conversations.ts");
  const handler = createStaffFixtureHandler({ clarification: true });
  await handler.post(new Request("http://localhost:3000/api/staff/chat", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: handler.fixture.question, storeId: "store-fixture", conversationId: "owned-conversation" }) }));
  const rows = handler.state.messages.map((row, index) => ({ ...row, id: `message-${index}` }));
  for (const legacy of [false, true]) {
    const supplied = legacy ? rows.map(row => { const copy = { ...row }; delete copy.response_kind; return copy; }) : rows;
    const fixture = conversationReadFixture(supplied, { legacy });
    const result = await getStaffConversationDetail(fixture.client, "user-fixture", "owned-conversation");
    assert.equal(result.ok, true);
    assert.equal(fixture.messageSelects.length, legacy ? 2 : 1);
    const restored = pageModule.exports.toChatMessages(result.messages);
    const html = renderToStaticMarkup(createElement(pageModule.exports.MessageBubble, { message: restored[1] }));
    assert.ok(html.includes(legacy ? "관리자 확인 필요" : "질문 확인"));
    assert.equal(result.messages[0].responseKind, null);
  }
  const nullFixture = conversationReadFixture(rows.map(row => ({ ...row, response_kind: null })));
  const nullResult = await getStaffConversationDetail(nullFixture.client, "user-fixture", "owned-conversation");
  assert.equal(nullResult.messages[1].responseKind, null);
  for (const error of [{ code: "42501", message: "permission denied response_kind" }, { code: "42703", message: "missing source_title" }]) {
    assert.equal(isMissingResponseKindColumn(error), false);
    const fixture = conversationReadFixture(rows, { error });
    const result = await getStaffConversationDetail(fixture.client, "user-fixture", "owned-conversation");
    assert.equal(result.ok, false);
    assert.equal(fixture.messageSelects.length, 1);
  }
});

test("pre-migration message INSERT retries only missing response_kind and never duplicates messages", async () => {
  for (const missingResponseKind of [true, false]) {
    const handler = createStaffFixtureHandler({ clarification: true, missingResponseKind, messageFailure: !missingResponseKind });
    const response = await handler.post(new Request("http://localhost:3000/api/staff/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: handler.fixture.question, storeId: "store-fixture", conversationId: "owned-conversation" }) }));
    const body = await response.json();
    assert.equal(handler.state.messageInsertAttempts, missingResponseKind ? 2 : 1);
    assert.equal(handler.state.messages.length, missingResponseKind ? 2 : 0);
    assert.equal(body.historyAvailable, missingResponseKind);
    assert.equal(body.responseKind, "clarification");
    assert.equal(handler.state.logs.length, 0);
    if (missingResponseKind) assert.equal(Object.hasOwn(handler.state.messages[1], "response_kind"), false);
  }
});

test("prepared response-kind migration is nullable, role constrained and contains no backfill", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/041_conversation_message_response_kind.sql", import.meta.url), "utf8");
  assert.match(migration, /add column if not exists response_kind text/);
  assert.match(migration, /response_kind in \('answer', 'clarification'\)/);
  assert.match(migration, /role <> 'user' or response_kind is null/);
  assert.doesNotMatch(migration, /\b(update|delete|insert|drop)\b/i);
  assert.doesNotMatch(migration, /response_kind text (?:not null|default)/i);
  const statements = migration.split(";").map(value => value.trim()).filter(Boolean);
  assert.equal(statements.length, 5);
  assert.equal(statements[0], "begin");
  assert.equal(statements[4], "commit");
  assert.ok(statements.slice(1, 4).every(value => value.startsWith("alter table public.conversation_messages")));
  assert.equal((migration.match(/add column/gi) ?? []).length, 1);
  assert.equal((migration.match(/add constraint/gi) ?? []).length, 2);
  assert.doesNotMatch(migration, /\b(default|references|trigger|grant|revoke|policy|index)\b/i);
  const preflight = readFileSync(new URL("../../docs/sql/041-conversation-response-kind-preflight.readonly.sql", import.meta.url), "utf8");
  assert.match(preflight, /begin transaction read only/);
  assert.doesNotMatch(preflight, /\b(alter|create|drop|insert|update|delete|grant|revoke)\b/i);
});

test("B clarification is preserved in owned staff conversation and restored UI without analytic logs or notifications", async () => {
  const handler = createStaffFixtureHandler({ clarification: true });
  const response = await handler.post(new Request("http://localhost:3000/api/staff/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: handler.fixture.question, storeId: "ignored-request-store", conversationId: "owned-conversation" }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.storeId, "store-fixture");
  assert.equal(body.responseKind, "clarification");
  assert.equal(body.historyAvailable, true);
  assert.equal(handler.state.conversations.length, 0);
  assert.equal(handler.state.messages.length, 2);
  assert.equal(handler.state.messages[0].content, handler.fixture.question);
  assert.match(handler.state.messages[1].content, /위치.*관리 방법/u);
  assert.equal(handler.state.updates, 1);
  assert.equal(handler.state.logs.length, 0);
  assert.equal(handler.state.notifications.length, 0);
  const restored = pageModule.exports.toChatMessages(handler.state.messages.map(row => ({ role: row.role, content: row.content,
    createdAt: row.created_at, status: row.status, responseKind: row.response_kind, sourceTitle: row.source_title, sourceCategory: row.source_category, similarity: row.similarity })));
  assert.equal(restored[0].text, handler.fixture.question);
  assert.equal(restored[1].text, body.answer);
  assert.equal(restored[1].responseKind, "clarification");
  assert.equal(handler.state.messages[0].response_kind, undefined);
  assert.ok(renderToStaticMarkup(createElement(pageModule.exports.MessageBubble, { message: restored[1] })).includes("질문 확인"));
  for (const options of [{ clarification: true, unauthenticated: true }, { clarification: true, deniedConversation: true }]) {
    const denied = createStaffFixtureHandler(options);
    const result = await denied.post(new Request("http://localhost:3000/api/staff/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: handler.fixture.question, storeId: "other-store", conversationId: "foreign-conversation" }),
    }));
    assert.equal(result.status, options.unauthenticated ? 401 : 404);
    assert.equal(denied.state.messages.length, 0);
    assert.equal(denied.state.logs.length, 0);
  }
});

test("successful INSERT is never retried and permission, transport, constraint or other-column errors stay failures", async () => {
  const cases = [
    { options: { clarification: true }, savedMessages: 2, historyAvailable: true },
    { options: { clarification: true, updateFailure: true }, savedMessages: 2, historyAvailable: false },
    { options: { clarification: true, messageError: { code: "42501", message: "permission denied response_kind" } }, savedMessages: 0, historyAvailable: false },
    { options: { clarification: true, messageError: { code: "23514", message: "response_kind check violation" } }, savedMessages: 0, historyAvailable: false },
    { options: { clarification: true, messageError: { code: "42703", message: "column source_title does not exist" } }, savedMessages: 0, historyAvailable: false },
    { options: { clarification: true, messageTransportFailure: true }, savedMessages: 0, historyAvailable: false },
  ];
  for (const scenario of cases) {
    const handler = createStaffFixtureHandler(scenario.options);
    const response = await handler.post(new Request("http://localhost:3000/api/staff/chat", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: handler.fixture.question, storeId: "store-fixture", conversationId: "owned-conversation" }) }));
    const body = await response.json();
    assert.equal(handler.state.messageInsertAttempts, 1);
    assert.equal(handler.state.messages.length, scenario.savedMessages);
    assert.equal(body.historyAvailable, scenario.historyAvailable);
    assert.equal(Boolean(body.saveError), !scenario.historyAvailable);
    assert.equal(body.responseKind, "clarification");
    assert.equal(handler.state.logs.length, 0);
  }
});