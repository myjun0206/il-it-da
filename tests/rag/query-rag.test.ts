import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import {
  POST,
  createAnswer,
  handleRagQuery,
  resolveStatus,
  toRagSource,
} from "../../app/api/rag/query/route.ts";
import type {
  ManualChunkMatch,
  RagQueryErrorResponse,
  RagQuerySuccessResponse,
} from "../../lib/rag/types.ts";

function createMockRequest(body: unknown, rawBody?: string): Request {
  const payload = rawBody !== undefined ? rawBody : JSON.stringify(body);
  return new Request("http://localhost:3000/api/rag/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: payload,
  });
}

function createSampleChunkMatch(overrides: Partial<ManualChunkMatch> = {}): ManualChunkMatch {
  return {
    chunk_id: "test-chunk-uuid-1",
    manual_id: "test-manual-uuid-1",
    title: "음료 제조 매뉴얼",
    category: "레시피",
    content: "아이스 아메리카노는 샷 2잔에 정수물 200ml와 얼음을 가득 채웁니다.",
    similarity_score: 0.85,
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

describe("RAG Query API & Route Tests (/api/rag/query)", () => {
  beforeEach(() => {
    // 기본적으로 가짜 OpenAI 성공 응답 설정 (외부 네트워크 호출 방지)
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "매뉴얼에 따른 가이드 답변입니다." } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // 1. 잘못된 JSON 요청은 HTTP 400 반환
  test("1. returns HTTP 400 for invalid JSON request body", async () => {
    const request = createMockRequest(null, "{ invalid json structure");
    const response = await POST(request);
    const json = (await response.json()) as RagQueryErrorResponse;

    assert.equal(response.status, 400);
    assert.equal(json.error, "Invalid JSON body.");
  });

  // 2. question이 없으면 HTTP 400 반환
  test("2. returns HTTP 400 when question field is missing", async () => {
    const request = createMockRequest({});
    const response = await POST(request);
    const json = (await response.json()) as RagQueryErrorResponse;

    assert.equal(response.status, 400);
    assert.equal(json.error, "question is required.");
  });

  // 3. question이 공백 문자열이면 HTTP 400 반환
  test("3. returns HTTP 400 when question is whitespace only", async () => {
    const request = createMockRequest({ question: "   \n\t  " });
    const response = await POST(request);
    const json = (await response.json()) as RagQueryErrorResponse;

    assert.equal(response.status, 400);
    assert.equal(json.error, "question is required.");
  });

  // 4. 비문자열 question 테스트 (null, 123, true, [], {})
  test("4. returns HTTP 400 for all non-string question types", async () => {
    const invalidValues = [null, 123, true, false, [], {}, ["질문"]];

    for (const invalidValue of invalidValues) {
      const request = createMockRequest({ question: invalidValue });
      const response = await POST(request);
      const json = (await response.json()) as RagQueryErrorResponse;

      assert.equal(response.status, 400, `Expected 400 for input: ${JSON.stringify(invalidValue)}`);
      assert.equal(json.error, "question is required.");
    }
  });

  // 5. 질문 길이 2,000자 경계 테스트 (정확히 2,000자는 허용, 2,001자는 413)
  test("5. accepts exactly 2,000 characters and rejects 2,001 characters with HTTP 413", async () => {
    // 2,000자 -> 허용 (정상 처리)
    const validQuestion = "가".repeat(2_000);
    const validRequest = createMockRequest({ question: validQuestion });
    const validResponse = await handleRagQuery(validRequest, {
      apiKey: "test-api-key",
      searchChunks: async () => [createSampleChunkMatch({ similarity_score: 0.85 })],
    });
    assert.equal(validResponse.status, 200);

    // 2,001자 -> 413 오류
    const longQuestion = "가".repeat(2_001);
    const longRequest = createMockRequest({ question: longQuestion });
    const longResponse = await POST(longRequest);
    const longJson = (await longResponse.json()) as RagQueryErrorResponse;

    assert.equal(longResponse.status, 413);
    assert.equal(longJson.error, "question must be 2,000 characters or fewer.");
  });

  // 6. 검색 결과가 없으면 insufficient 반환
  test("6. returns status: insufficient, similarity: null, source: null when no chunks match", async () => {
    const request = createMockRequest({ question: "없는 매뉴얼에 대한 질문입니다." });
    const response = await handleRagQuery(request, {
      searchChunks: async () => [],
    });
    const json = (await response.json()) as RagQuerySuccessResponse;

    assert.equal(response.status, 200);
    assert.equal(json.status, "insufficient");
    assert.equal(json.similarity, null);
    assert.equal(json.source, null);
    assert.match(json.answer, /매장 관리자에게 문의해 주세요/);
  });

  // 7. 유사도 0.65 미만이면 insufficient 반환
  test("7. returns status: insufficient when similarity is below 0.65 threshold", async () => {
    const request = createMockRequest({ question: "포스기 초기화 방법은?" });
    const response = await handleRagQuery(request, {
      searchChunks: async () => [createSampleChunkMatch({ similarity_score: 0.649 })],
    });
    const json = (await response.json()) as RagQuerySuccessResponse;

    assert.equal(response.status, 200);
    assert.equal(json.status, "insufficient");
    assert.equal(json.similarity, 0.649);
    assert.equal(json.source, null);
    assert.match(json.answer, /매장 관리자에게 문의해 주세요/);
  });

  // 8. 정확히 0.65 및 0.65 이상 0.78 미만 cautious API 흐름 테스트
  test("8. returns status: cautious when similarity is exactly 0.65 and between 0.65 and 0.78", async () => {
    // 정확히 0.65 경계값 테스트
    const requestExact = createMockRequest({ question: "매장 오픈 준비 순서는?" });
    const responseExact = await handleRagQuery(requestExact, {
      apiKey: "test-api-key",
      searchChunks: async () => [createSampleChunkMatch({ similarity_score: 0.65 })],
    });
    const jsonExact = (await responseExact.json()) as RagQuerySuccessResponse;

    assert.equal(responseExact.status, 200);
    assert.equal(jsonExact.status, "cautious");
    assert.equal(jsonExact.similarity, 0.65);
    assert.ok(jsonExact.source);
    assert.match(jsonExact.answer, /매장 관리자에게 다시 문의해 주세요/);

    // 0.70 중간값 테스트
    const requestMid = createMockRequest({ question: "중간 유사도 질문" });
    const responseMid = await handleRagQuery(requestMid, {
      apiKey: "test-api-key",
      searchChunks: async () => [createSampleChunkMatch({ similarity_score: 0.70 })],
    });
    const jsonMid = (await responseMid.json()) as RagQuerySuccessResponse;

    assert.equal(jsonMid.status, "cautious");
    assert.equal(jsonMid.similarity, 0.70);
  });

  // 9. 정확히 0.78 및 0.78 이상 answered API 흐름 테스트
  test("9. returns status: answered when similarity is exactly 0.78 and above", async () => {
    // 정확히 0.78 경계값 테스트
    const requestExact = createMockRequest({ question: "아이스 아메리카노 제조법은?" });
    const responseExact = await handleRagQuery(requestExact, {
      apiKey: "test-api-key",
      searchChunks: async () => [createSampleChunkMatch({ similarity_score: 0.78 })],
    });
    const jsonExact = (await responseExact.json()) as RagQuerySuccessResponse;

    assert.equal(responseExact.status, 200);
    assert.equal(jsonExact.status, "answered");
    assert.equal(jsonExact.similarity, 0.78);
    assert.ok(jsonExact.source);

    // 0.90 상위값 테스트
    const requestHigh = createMockRequest({ question: "높은 유사도 질문" });
    const responseHigh = await handleRagQuery(requestHigh, {
      apiKey: "test-api-key",
      searchChunks: async () => [createSampleChunkMatch({ similarity_score: 0.90 })],
    });
    const jsonHigh = (await responseHigh.json()) as RagQuerySuccessResponse;

    assert.equal(jsonHigh.status, "answered");
    assert.equal(jsonHigh.similarity, 0.90);
  });

  // 10. insufficient 상태에서는 OpenAI를 호출하지 않음
  test("10. does not invoke OpenAI completion when status is insufficient", async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("Should not be called");
    };

    // 유사도 0.60 (낮음)
    const requestLow = createMockRequest({ question: "관련 없는 질문입니다." });
    const responseLow = await handleRagQuery(requestLow, {
      apiKey: "test-api-key",
      searchChunks: async () => [createSampleChunkMatch({ similarity_score: 0.60 })],
    });
    assert.equal(responseLow.status, 200);
    assert.equal(fetchCalled, false);

    // 검색 결과 없음
    const requestEmpty = createMockRequest({ question: "없는 매뉴얼 질문입니다." });
    const responseEmpty = await handleRagQuery(requestEmpty, {
      apiKey: "test-api-key",
      searchChunks: async () => [],
    });
    assert.equal(responseEmpty.status, 200);
    assert.equal(fetchCalled, false);
  });

  // 11. answered와 cautious 응답에 source와 similarity가 올바르게 포함됨
  test("11. answered and cautious responses include correctly mapped camelCase source and similarity", async () => {
    const match = createSampleChunkMatch({
      manual_id: "manual-uuid-11",
      title: "마감 청소 매뉴얼",
      category: "위생",
      similarity_score: 0.88,
    });
    const request = createMockRequest({ question: "마감 청소는 어떻게 하나요?" });
    const response = await handleRagQuery(request, {
      apiKey: "test-api-key",
      searchChunks: async () => [match],
    });
    const json = (await response.json()) as RagQuerySuccessResponse;

    assert.equal(response.status, 200);
    assert.deepEqual(json.source, {
      manualId: "manual-uuid-11",
      title: "마감 청소 매뉴얼",
      category: "위생",
    });
    assert.equal(json.similarity, 0.88);
  });

  // 12. cautious 답변에 관리자 재확인 안내가 포함됨
  test("12. cautious answer appends manager reconfirmation notice", async () => {
    const request = createMockRequest({ question: "특수 쿠폰 사용법은?" });
    const response = await handleRagQuery(request, {
      apiKey: "test-api-key",
      searchChunks: async () => [createSampleChunkMatch({ similarity_score: 0.70 })],
    });
    const json = (await response.json()) as RagQuerySuccessResponse;

    assert.equal(json.status, "cautious");
    assert.match(json.answer, /매장 관리자에게 다시 문의해 주세요/);
  });

  // 13. 가짜 fetch를 이용한 OpenAI HTTP 실패 시 HTTP 500 반환 및 민감정보 미노출 (500, 429 등)
  test("13. returns HTTP 500 when OpenAI returns HTTP error (500, 429), without leaking sensitive error body or API key", async () => {
    const secretApiKey = "sk-proj-super-secret-key-12345";
    const sensitiveErrorMsg = "OpenAI internal engine crashed: connection to auth server failed";

    // 13-1. HTTP 500
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ error: { message: sensitiveErrorMsg } }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    };

    const request500 = createMockRequest({ question: "질문입니다." });
    const response500 = await handleRagQuery(request500, {
      apiKey: secretApiKey,
      searchChunks: async () => [createSampleChunkMatch({ similarity_score: 0.90 })],
    });
    const responseText500 = await response500.text();

    assert.equal(response500.status, 500);
    assert.equal(responseText500, JSON.stringify({ error: "Unable to answer the question." }));
    assert.ok(!responseText500.includes(secretApiKey));
    assert.ok(!responseText500.includes(sensitiveErrorMsg));

    // 13-2. HTTP 429 Rate Limit
    const sensitiveRateLimitMsg = "Rate limit reached: quota exceeded for model gpt-4o";
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ error: { message: sensitiveRateLimitMsg } }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    };

    const request429 = createMockRequest({ question: "질문 429입니다." });
    const response429 = await handleRagQuery(request429, {
      apiKey: secretApiKey,
      searchChunks: async () => [createSampleChunkMatch({ similarity_score: 0.90 })],
    });
    const responseText429 = await response429.text();

    assert.equal(response429.status, 500);
    assert.equal(responseText429, JSON.stringify({ error: "Unable to answer the question." }));
    assert.ok(!responseText429.includes(secretApiKey));
    assert.ok(!responseText429.includes(sensitiveRateLimitMsg));
  });

  // 14. 가짜 fetch를 이용한 OpenAI 빈 응답(empty choices/content, null content) 시 HTTP 500 반환
  test("14. returns HTTP 500 when OpenAI returns empty choices, blank content, or null content", async () => {
    // A. choices 배열이 비어있는 경우
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const requestA = createMockRequest({ question: "질문 A" });
    const responseA = await handleRagQuery(requestA, {
      apiKey: "test-api-key",
      searchChunks: async () => [createSampleChunkMatch({ similarity_score: 0.90 })],
    });
    assert.equal(responseA.status, 500);
    assert.equal(await responseA.text(), JSON.stringify({ error: "Unable to answer the question." }));

    // B. message content가 공백인 경우
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "   \n\t " } }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    const requestB = createMockRequest({ question: "질문 B" });
    const responseB = await handleRagQuery(requestB, {
      apiKey: "test-api-key",
      searchChunks: async () => [createSampleChunkMatch({ similarity_score: 0.90 })],
    });
    assert.equal(responseB.status, 500);
    assert.equal(await responseB.text(), JSON.stringify({ error: "Unable to answer the question." }));

    // C. message content가 null인 경우
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: null } }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    const requestC = createMockRequest({ question: "질문 C" });
    const responseC = await handleRagQuery(requestC, {
      apiKey: "test-api-key",
      searchChunks: async () => [createSampleChunkMatch({ similarity_score: 0.90 })],
    });
    assert.equal(responseC.status, 500);
    assert.equal(await responseC.text(), JSON.stringify({ error: "Unable to answer the question." }));
  });

  // 15. 실제 createAnswer의 AbortController 타임아웃 경로 테스트
  test("15. executes actual AbortController timeout branch in createAnswer and returns HTTP 500", async () => {
    // fetch가 지연되면서 signal.abort()가 트리거되는 상황 재현
    globalThis.fetch = async (_url, init) => {
      const signal = init?.signal as AbortSignal | undefined;

      return new Promise<Response>((resolve, reject) => {
        if (signal?.aborted) {
          const abortError = new Error("The operation was aborted");
          abortError.name = "AbortError";
          return reject(abortError);
        }

        signal?.addEventListener("abort", () => {
          const abortError = new Error("The operation was aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });
    };

    // 15-1. createAnswer 단위 함수에서 타임아웃 오류 메시지 확인
    await assert.rejects(
      async () => {
        await createAnswer("질문", "컨텍스트", {
          apiKey: "test-key",
          timeoutMs: 10, // 10ms 짧은 타임아웃 설정
        });
      },
      (err: Error) => {
        assert.equal(err.message, "OpenAI chat request timed out.");
        return true;
      },
    );

    // 15-2. POST API 경로에서 타임아웃 시 HTTP 500 안전 응답 확인
    const request = createMockRequest({ question: "타임아웃 질문" });
    const response = await handleRagQuery(request, {
      apiKey: "test-key",
      timeoutMs: 10,
      searchChunks: async () => [createSampleChunkMatch({ similarity_score: 0.90 })],
    });

    assert.equal(response.status, 500);
    assert.equal(await response.text(), JSON.stringify({ error: "Unable to answer the question." }));
  });

  // 16. Supabase 검색 실패 테스트 (searchManualChunks throws)
  test("16. returns HTTP 500 when searchManualChunks throws, without exposing database error or secret keys", async () => {
    const sensitiveDbError = "PostgreSQL Error: password authentication failed for role service_role secret_12345";
    const sensitiveManualSnippet = "매뉴얼 1급 대외비 본문";

    const request = createMockRequest({ question: "질문입니다." });
    const response = await handleRagQuery(request, {
      apiKey: "test-api-key",
      searchChunks: async () => {
        throw new Error(`${sensitiveDbError} - ${sensitiveManualSnippet}`);
      },
    });
    const responseText = await response.text();

    assert.equal(response.status, 500);
    assert.equal(responseText, JSON.stringify({ error: "Unable to answer the question." }));
    assert.ok(!responseText.includes("service_role"));
    assert.ok(!responseText.includes("secret_12345"));
    assert.ok(!responseText.includes(sensitiveManualSnippet));
  });

  // 17. 헬퍼 순수 함수 단위 테스트 (resolveStatus, toRagSource)
  test("17. verifies helper pure functions resolveStatus and toRagSource", () => {
    assert.equal(resolveStatus(0.95), "answered");
    assert.equal(resolveStatus(0.78), "answered");
    assert.equal(resolveStatus(0.779), "cautious");
    assert.equal(resolveStatus(0.65), "cautious");
    assert.equal(resolveStatus(0.649), "insufficient");
    assert.equal(resolveStatus(0.0), "insufficient");

    const match = createSampleChunkMatch({
      manual_id: "m-123",
      title: "매뉴얼 A",
      category: "분류 B",
    });
    const source = toRagSource(match);
    assert.deepEqual(source, {
      manualId: "m-123",
      title: "매뉴얼 A",
      category: "분류 B",
    });
  });

  // 18. Next.js Route Handler의 기본 POST 진입점 검증
  test("18. delegates to handleRagQuery when POST is called directly", async () => {
    const request = createMockRequest(null, "{ invalid json");
    const response = await POST(request);
    const json = (await response.json()) as RagQueryErrorResponse;

    assert.equal(response.status, 400);
    assert.equal(json.error, "Invalid JSON body.");
  });

  // 19. GPT에 검색된 매뉴얼 컨텍스트와 직원 질문이 올바르게 전달되는지 검증
  test("19. passes searched manual context and employee question properly to OpenAI Chat Completions API", async () => {
    let capturedBody: {
      model?: string;
      messages?: Array<{ role?: string; content?: string }>;
    } | null = null;

    const testQuestion = "마감 시 에스프레소 머신 세척 방법은?";
    const testManualContent = "마감 시 세척제를 포터필터에 넣고 백플러싱을 5회 반복합니다.";
    const match = createSampleChunkMatch({
      manual_id: "manual-clean-01",
      title: "머신 마감 매뉴얼",
      category: "위생/마감",
      content: testManualContent,
      similarity_score: 0.89,
    });

    globalThis.fetch = async (_url, init) => {
      if (typeof init?.body === "string") {
        capturedBody = JSON.parse(init.body);
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "에스프레소 머신은 백플러싱 5회로 세척합니다." } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const request = createMockRequest({ question: testQuestion });
    const response = await handleRagQuery(request, {
      apiKey: "test-openai-key",
      searchChunks: async () => [match],
    });
    const json = (await response.json()) as RagQuerySuccessResponse;

    // 7. API 응답 정상 반환 확인
    assert.equal(response.status, 200);
    assert.equal(json.status, "answered");
    assert.equal(json.answer, "에스프레소 머신은 백플러싱 5회로 세척합니다.");

    // 1. model이 gpt-4o인지
    assert.ok(capturedBody, "capturedBody should not be null");
    const payload = capturedBody as {
      model?: string;
      messages?: Array<{ role?: string; content?: string }>;
    };
    assert.equal(payload.model, "gpt-4o");

    // 6. system prompt와 user message가 분리되어 있는지
    const messages = payload.messages ?? [];
    assert.equal(messages.length, 2);

    // 2. messages[0].role이 system인지
    assert.equal(messages[0]?.role, "system");
    assert.ok(typeof messages[0]?.content === "string");
    assert.match(messages[0].content, /프랜차이즈 매장 현장 직원을 돕는 AI 도우미/);

    // 3. messages[1].role이 user인지
    assert.equal(messages[1]?.role, "user");

    // 4. messages[1].content에 검색된 매뉴얼의 실제 content가 포함되어 있는지
    assert.ok(typeof messages[1]?.content === "string");
    assert.ok(messages[1].content.includes(testManualContent));

    // 5. messages[1].content에 직원의 실제 질문이 포함되어 있는지
    assert.ok(messages[1].content.includes(testQuestion));
  });
});
