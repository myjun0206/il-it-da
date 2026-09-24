import type { SupabaseClient } from "@supabase/supabase-js";

import { chunkManualText } from "@/lib/rag/chunk-manual";
import { indexManualById } from "@/lib/rag/index-manual";
import { reembedApprovedManuals } from "@/lib/rag/manual-indexing/reembed-approved-manuals";
import type { HqAuthResult } from "@/lib/supabase/hq-auth";
import type { ManualRecord } from "@/lib/types/manual";

// 세부 항목은 기존처럼 문자열(본문만)이거나, 소제목이 있는 경우 { title, content } 객체로 받는다.
// 소제목이 없으면 기존 규칙대로 자식 행의 title에 대주제명을 그대로 쓴다.
export type ManualItemInput = string | { title?: string; content: string };

export type ManualGroupInput = {
  topic: string;
  items: ManualItemInput[];
};

function normalizeItem(item: ManualItemInput, topic: string): { title: string; content: string } {
  if (typeof item === "string") {
    return { title: topic, content: item || "내용 없음" };
  }
  const title = item.title?.trim();
  return { title: title || topic, content: item.content?.trim() || "내용 없음" };
}

const MANUAL_SELECT_COLUMNS =
  "id, brand_name, franchise_id, store_id, parent_manual_id, title, category, content, status, created_at, updated_at";

// 고정 오류 코드와 안전한 error name만 남기고, message/details/hint/payload/content/UUID는 출력하지 않는다.
function logSafeManualError(code: string, error: unknown): void {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(`[MANUALS] ${code}`, { name });
}

async function syncChunksForManuals(
  supabase: SupabaseClient,
  manuals: ManualRecord[],
  indexManual: (manualId: string) => Promise<unknown> = indexManualById,
): Promise<void> {
  if (manuals.length === 0) {
    return;
  }

  try {
    const chunkRows = manuals.flatMap((manual) =>
      chunkManualText(`${manual.title}\n\n${manual.content}`).map((content, index) => ({
        manual_id: manual.id,
        chunk_index: index,
        content,
        embedding: null,
      })),
    );

    if (chunkRows.length > 0) {
      const { error: chunkError } = await supabase.from("manual_chunks").insert(chunkRows);

      if (chunkError) {
        logSafeManualError("MANUAL_CHUNKS_INSERT_FAILED", chunkError);
      }
    }
  } catch (chunkParseError) {
    logSafeManualError("MANUAL_CHUNKING_FAILED", chunkParseError);
  }

  // 위 insert는 embedding=null placeholder만 남기므로, RAG 검색에 잡힐 수 있도록
  // 실제 embedding을 즉시 재생성한다([id]/route.ts, batch-update/route.ts와 동일한 재사용 패턴).
  await reembedApprovedManuals(manuals, indexManual, logSafeManualError);
}

/**
 * 주제 1개 = 부모 카드 1개, 세부 내용 N개 = parent_manual_id로 연결된 자식 행 N개.
 * category는 부모/자식 모두 대주제명으로 맞춘다. 자식 title은 소제목이 있으면 소제목, 없으면 대주제명을 쓰고,
 * 지침 문장(번호 포함)은 오직 content에만 담는다.
 * 여러 그룹을 한 번에 저장할 수 있어 파일 업로드(대주제별로 여러 그룹)와
 * 단건 작성(그룹 1개)을 같은 함수로 처리한다. 청크 동기화 실패는 저장 자체를 막지 않는다.
 */
export async function saveManualGroupsWithChunks(
  supabase: SupabaseClient,
  hqUser: HqAuthResult,
  groups: ManualGroupInput[],
  storeId?: string,
  indexManual: (manualId: string) => Promise<unknown> = indexManualById,
): Promise<ManualRecord[]> {
  const scopeType = storeId ? "store" : "hq";
  const allManuals: ManualRecord[] = [];

  for (const group of groups) {
    const items = group.items.length > 0 ? group.items : ["내용 없음"];
    const topic = group.topic || "제목 없음";

    const { data: parentData, error: parentError } = await supabase
      .from("manuals")
      .insert({
        brand_name: hqUser.brandName,
        franchise_id: hqUser.franchiseId,
        store_id: storeId ?? null,
        scope_type: scopeType,
        parent_manual_id: null,
        title: topic,
        category: topic,
        content: `${items.length}개 항목`,
        status: "approved",
      })
      .select(MANUAL_SELECT_COLUMNS)
      .single();

    if (parentError || !parentData) {
      logSafeManualError("PARENT_MANUAL_INSERT_FAILED", parentError);
      throw new Error("매뉴얼 주제 저장 중 오류가 발생했습니다.");
    }

    const parent = parentData as ManualRecord;
    allManuals.push(parent);

    const { data: childrenData, error: childrenError } = await supabase
      .from("manuals")
      .insert(
        items.map((item) => {
          const { title, content } = normalizeItem(item, topic);
          return {
            brand_name: hqUser.brandName,
            franchise_id: hqUser.franchiseId,
            store_id: storeId ?? null,
            scope_type: scopeType,
            parent_manual_id: parent.id,
            title,
            category: topic,
            content,
            status: "approved",
          };
        }),
      )
      .select(MANUAL_SELECT_COLUMNS);

    if (childrenError) {
      logSafeManualError("CHILD_MANUALS_INSERT_FAILED", childrenError);
      throw new Error("매뉴얼 세부 내용 저장 중 오류가 발생했습니다.");
    }

    const children = (childrenData ?? []) as ManualRecord[];
    allManuals.push(...children);

    await syncChunksForManuals(supabase, children, indexManual);
  }

  return allManuals;
}

/**
 * 이미 존재하는 주제(부모) 카드에 세부 내용 항목을 추가한다 ("+ 내용 항목 추가").
 * 생성되는 자식의 title/category도 부모와 동일한 대주제명을 그대로 사용하고, 지침 문장은 content에만 담는다.
 */
export async function addItemsToManualGroup(
  supabase: SupabaseClient,
  parent: ManualRecord,
  items: string[],
  indexManual: (manualId: string) => Promise<unknown> = indexManualById,
): Promise<ManualRecord[]> {
  if (items.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("manuals")
    .insert(
      items.map((content) => ({
        brand_name: parent.brand_name,
        franchise_id: parent.franchise_id,
        store_id: parent.store_id,
        scope_type: parent.store_id ? "store" : "hq",
        parent_manual_id: parent.id,
        title: parent.title,
        category: parent.category,
        content: content || "내용 없음",
        status: "approved",
      })),
    )
    .select(MANUAL_SELECT_COLUMNS);

  if (error) {
    logSafeManualError("ADD_ITEMS_TO_GROUP_FAILED", error);
    throw new Error("세부 내용 추가 중 오류가 발생했습니다.");
  }

  const children = (data ?? []) as ManualRecord[];

  await syncChunksForManuals(supabase, children, indexManual);

  return children;
}
