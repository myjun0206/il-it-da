import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

// 이 라우트/화면들은 next/server, Supabase 클라이언트, cookies()에 의존해 Next 런타임 밖에서
// 실행되지 않으므로(다른 route 테스트와 동일 관행) 소스 계약으로 고정한다. 상태 계산과 권한
// 판정 자체는 tests/manuals/manual-search-readiness.test.ts에서 실제 함수를 실행해 검증한다.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const TECHNICAL_TERMS = ["embedding", "vector", "chunk", "indexing", "임베딩", "벡터", "청크", "색인"];

describe("app/api/manuals/search-readiness/route.ts (HQ 상태 조회)", () => {
  const source = readSource("app/api/manuals/search-readiness/route.ts");

  test("기존 requireHqUser를 재사용하고 다른 인증 함수를 새로 만들지 않는다", () => {
    assert.match(source, /from "@\/lib\/supabase\/hq-auth"/);
    assert.match(source, /const hqUser = await requireHqUser\(\)/);
  });

  test("같은 franchise의 공통 매뉴얼(store_id is null)로만 범위를 좁힌다", () => {
    assert.match(source, /\.eq\("franchise_id", hqUser\.franchiseId\)/);
    assert.match(source, /\.is\("store_id", null\)/);
  });

  test("요청의 franchiseId/brandName/userId를 읽지 않는다", () => {
    const code = stripComments(source);
    for (const forbidden of ["franchiseId\")", "brandName", "body.franchiseId", "searchParams.get(\"userId\")"]) {
      assert.equal(code.includes(forbidden), false, `reads ${forbidden}`);
    }
  });

  test("DB에 쓰지 않는다 (조회 전용)", () => {
    for (const write of [".insert(", ".update(", ".delete(", ".upsert("]) {
      assert.equal(source.includes(write), false, `writes via ${write}`);
    }
  });

  test("embedding 값 자체를 응답에 담지 않고 null 여부만 계산한다", () => {
    assert.match(source, /has_embedding: row\.embedding !== null/);
    assert.equal(/report[^\n]*embedding:/.test(source), false);
  });

  test("본문(content)을 응답에 넣지 않고 placeholder 제거에만 쓴다", () => {
    assert.match(source, /\.filter\(\(manual\) => manual\.content !== HQ_MANUAL_CATEGORY_PLACEHOLDER_CONTENT\)/);
    assert.match(source, /\.map\(\(\{ id, title, category, parent_manual_id, status \}\)/);
  });

  test("원본 DB 오류를 응답하지 않고 error name만 로그에 남긴다", () => {
    assert.match(source, /name: e instanceof Error \? e\.name : "UnknownError"/);
    assert.equal(/error: [^\n]*e\.message/.test(source), false);
  });
});

describe("app/api/store-manuals/search-readiness/route.ts (점주 상태 조회)", () => {
  const source = readSource("app/api/store-manuals/search-readiness/route.ts");

  test("기존 requireStoreOwner를 재사용해 storeId를 서버에서 다시 검증한다", () => {
    assert.match(source, /from "@\/lib\/manuals\/store-manual-auth"/);
    assert.match(source, /requireStoreOwner\(adminClient, userData\.user\.id, requestedStoreId\)/);
  });

  test("검증 실패 시 403으로 fail-closed 한다", () => {
    assert.match(source, /if \(!storeAuth\) \{\s*\n\s*return NextResponse\.json\([^)]*status: 403/);
  });

  test("조회는 클라이언트가 보낸 값이 아니라 검증된 storeAuth.storeId로 스코핑한다", () => {
    assert.match(source, /\.eq\("store_id", storeAuth\.storeId\)/);
    assert.equal(stripComments(source).includes('.eq("store_id", requestedStoreId)'), false);
  });

  test("DB에 쓰지 않는다 (조회 전용)", () => {
    for (const write of [".insert(", ".update(", ".delete(", ".upsert("]) {
      assert.equal(source.includes(write), false, `writes via ${write}`);
    }
  });

  test("원본 DB 오류를 응답하지 않고 error name만 로그에 남긴다", () => {
    assert.match(source, /name: e instanceof Error \? e\.name : "UnknownError"/);
  });
});

describe("재인덱싱 라우트 (HQ / 점주)", () => {
  const hq = readSource("app/api/manuals/search-readiness/reindex/route.ts");
  const store = readSource("app/api/store-manuals/search-readiness/reindex/route.ts");

  test("임베딩 함수를 새로 만들지 않고 기존 indexManualById를 재사용한다", () => {
    for (const source of [hq, store]) {
      assert.match(source, /from "@\/lib\/rag\/index-manual"/);
      assert.match(source, /await indexManualById\(manualId\)/);
      assert.equal(source.includes("createEmbeddings"), false);
    }
  });

  test("매 호출마다 인증을 다시 수행한다", () => {
    assert.match(hq, /const hqUser = await requireHqUser\(\)/);
    assert.match(store, /auth\.getUser\(\)/);
    assert.match(store, /requireStoreOwner\(adminClient, userData\.user\.id, requestedStoreId\)/);
  });

  test("색인 전에 DB에서 읽은 행으로 공유 가드를 다시 통과시킨다", () => {
    for (const source of [hq, store]) {
      assert.match(source, /from "@\/lib\/manuals\/manual-reindex-guard"/);
      assert.match(source, /checkManualReindexAllowed\(\s*\n\s*manual,\s*\n\s*\{ kind: "(hq|store)"/);
      const guardIndex = source.indexOf("checkManualReindexAllowed(");
      const indexIndex = source.indexOf("await indexManualById(");
      assert.ok(guardIndex >= 0 && indexIndex > guardIndex, "guard must run before indexing");
    }
  });

  test("parent_manual_id가 null이라는 이유가 아니라 실제 자식 존재 여부로 부모 카드를 가린다", () => {
    for (const source of [hq, store]) {
      // 조회 범위 밖 단건 재처리라도 N+1 없이 단일 질의로 자식 존재만 확인한다.
      assert.match(source, /\.eq\("parent_manual_id", manualId\)\s*\n\s*\.limit\(1\)/);
      assert.match(source, /Boolean\(firstChild\),/);
      assert.equal(source.includes('.select("id, parent_manual_id, status'), false);
    }
  });

  test("클라이언트가 보낸 franchiseId/scopeType을 신뢰하지 않는다", () => {
    for (const source of [hq, store]) {
      const code = stripComments(source);
      assert.equal(code.includes("body.franchiseId"), false);
      assert.equal(code.includes("body.scopeType"), false);
      assert.equal(code.includes("body.brandName"), false);
    }
    assert.equal(stripComments(hq).includes("body.storeId"), false);
  });

  test("점주 라우트는 body.storeId를 받되 requireStoreOwner로 재검증한 storeAuth.storeId로 판정한다", () => {
    assert.match(store, /\{ kind: "store", storeId: storeAuth\.storeId \},/);
  });

  test("한 번에 한 건만 처리한다 (무제한 일괄 재처리 API 없음)", () => {
    for (const source of [hq, store]) {
      assert.equal(source.includes("manualIds"), false);
      assert.equal(/for \(const [^)]*of [^)]*manuals/.test(source), false);
    }
  });

  test("원본 OpenAI/DB 오류 대신 고정된 사용자용 메시지를 반환한다", () => {
    for (const source of [hq, store]) {
      assert.match(source, /REINDEX_FAILED_MESSAGE/);
      assert.equal(/error: [^\n]*e\.message/.test(source), false);
      assert.match(source, /name: e instanceof Error \? e\.name : "UnknownError"/);
    }
  });
});

describe("청크 중복 방지 계약 (기존 구현 재사용)", () => {
  const source = readSource("lib/rag/index-approved-manual.ts");

  test("indexManualById가 쓰는 색인 경로는 unique(manual_id, chunk_index) upsert + stale 삭제를 유지한다", () => {
    assert.match(source, /\.upsert\(rows, \{ onConflict: "manual_id,chunk_index" \}\)/);
    assert.match(source, /\.delete\(\)\s*\n\s*\.eq\("manual_id", manual\.id\)\s*\n\s*\.gte\("chunk_index", chunks\.length\)/);
  });

  test("상태 조회는 범위 안 id를 한 번에 조회해 N+1 질의를 만들지 않는다", () => {
    for (const relative of [
      "app/api/manuals/search-readiness/route.ts",
      "app/api/store-manuals/search-readiness/route.ts",
    ]) {
      const source = readSource(relative);
      assert.match(source, /\.in\("manual_id", manualIds\)/);
      assert.equal(/for \([^)]*\) \{[^}]*await adminClient/.test(source), false);
    }
  });

  test("부모 주제 카드를 임베딩하는 새 경로를 추가하지 않았다", () => {
    for (const relative of [
      "app/api/manuals/search-readiness/reindex/route.ts",
      "app/api/store-manuals/search-readiness/reindex/route.ts",
    ]) {
      assert.equal(readSource(relative).includes("parent_manual_id: null"), false);
    }
  });
});

describe("components/manuals/ManualSearchReadinessPanel.tsx (관리자 화면 계약)", () => {
  const source = readSource("components/manuals/ManualSearchReadinessPanel.tsx");

  test("기술 용어를 사용자 화면 문구로 쓰지 않는다", () => {
    const visibleText = source.match(/>[^<>{}]*[가-힣][^<>{}]*</g)?.join(" ") ?? "";
    for (const term of TECHNICAL_TERMS) {
      assert.equal(visibleText.toLowerCase().includes(term.toLowerCase()), false, `shows ${term}`);
    }
  });

  test("네 가지 상태 문구를 쉬운 한국어로 쓴다", () => {
    assert.match(source, /검색 준비 완료/);
    assert.match(source, /검색 준비 필요/);
    assert.match(source, /검색 대상 아님/);
    assert.match(source, /manual\.statusLabel/);
  });

  test("색상만으로 상태를 구분하지 않고 아이콘과 글자를 함께 쓴다", () => {
    assert.match(source, /const STATUS_ICONS = \{/);
    assert.match(source, /<Icon size=\{14\} aria-hidden="true" \/>/);
  });

  test("재처리 버튼에 label이 있고 실행 중에는 비활성화된다", () => {
    assert.match(source, /aria-label=\{`\$\{manual\.title\} 검색 준비 다시 하기`\}/);
    assert.match(source, /disabled=\{busyManualId !== null\}/);
    assert.match(source, /검색 준비 다시 하기/);
  });

  test("재처리 성공 후 상태를 다시 조회한다", () => {
    const noticeIndex = source.indexOf("의 검색 준비를 다시 했어요");
    const reloadIndex = source.indexOf("setReloadToken((token) => token + 1)", noticeIndex);
    assert.ok(noticeIndex >= 0 && reloadIndex > noticeIndex);
    assert.match(source, /\}, \[loadReport, reloadToken\]\)/);
  });

  test("결과를 aria-live/role=alert로 알린다", () => {
    assert.match(source, /role="status" aria-live="polite"/);
    assert.match(source, /role="alert"/);
  });

  test("접기/펴기 토글에 aria-expanded가 있다", () => {
    assert.match(source, /aria-expanded=\{isExpanded\}/);
  });

  test("manualId는 요청에만 쓰고 화면에 렌더링하지 않는다", () => {
    assert.equal(/\{manual\.manualId\}<\//.test(source), false);
    assert.equal(source.includes(">{manual.manualId}"), false);
    assert.match(source, /manualId: manual\.manualId/);
  });

  test("재처리 필요 항목에만 버튼을 노출한다", () => {
    assert.match(source, /\{manual\.canReindex && \(/);
  });
});

describe("기존 화면/계약 회귀 없음", () => {
  test("HQ와 점주 매뉴얼 화면이 같은 상태 컴포넌트를 재사용한다", () => {
    const hqPage = readSource("app/hq/manuals/common/page.tsx");
    const storePage = readSource("app/boss/store-manuals/page.tsx");
    assert.match(hqPage, /<ManualSearchReadinessPanel/);
    assert.match(storePage, /<ManualSearchReadinessPanel/);
    assert.match(hqPage, /readinessUrl="\/api\/manuals\/search-readiness"/);
    assert.match(storePage, /readinessUrl=\{`\/api\/store-manuals\/search-readiness\?storeId=\$\{selectedStoreId\}`\}/);
  });

  test("기존 목록 조회/업로드 호출부는 그대로 남아 있다", () => {
    const storePage = readSource("app/boss/store-manuals/page.tsx");
    assert.match(storePage, /\/api\/store-manuals\?storeId=\$\{storeId\}&includeCategoryPlaceholders=1/);
    assert.match(storePage, /openAnalyzeFilePicker/);
  });

  test("저장 완료 문구가 검색 준비 완료를 뜻하지 않도록 안내한다", () => {
    for (const relative of ["app/hq/manuals/onboarding/page.tsx", "app/boss/store-manuals/upload/page.tsx"]) {
      assert.match(readSource(relative), /저장했어요\. 검색 준비 상태를 확인해 주세요\./);
    }
  });

  test("확정 저장 API의 성공 응답 shape({ manuals })는 바뀌지 않았다", () => {
    for (const relative of [
      "app/api/manuals/preview/confirm/route.ts",
      "app/api/store-manuals/preview/confirm/route.ts",
    ]) {
      assert.match(readSource(relative), /NextResponse\.json\(\{ manuals \}, \{ status: 201 \}\)/);
    }
  });

  test("018 검색 RPC와 019 cascade 마이그레이션을 건드리지 않았다", () => {
    assert.match(readSource("supabase/migrations/018_scoped_hybrid_manual_search.sql"), /match_manual_chunks_hybrid_scoped/);
    assert.match(
      readSource("supabase/migrations/019_manuals_parent_cascade_delete.sql"),
      /on delete cascade/,
    );
  });
});
