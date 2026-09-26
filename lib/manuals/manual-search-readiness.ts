/**
 * 저장 성공과 "챗봇이 찾을 수 있는 상태"는 다르다. 018 scoped RPC는
 * status='approved' + embedding is not null인 chunk만 검색하므로, chunk가 없거나
 * embedding이 비어 있는 자식 매뉴얼은 저장돼 있어도 검색되지 않는다.
 * 이 모듈은 새 컬럼/마이그레이션 없이 manuals + manual_chunks 행만으로 그 상태를 계산한다.
 */

export type ManualReadinessStatus = "ready" | "needs_reindex" | "not_searchable" | "parent_only";

export const MANUAL_READINESS_LABELS: Record<ManualReadinessStatus, string> = {
  ready: "검색 준비 완료",
  needs_reindex: "검색 준비 필요",
  not_searchable: "검색 대상 아님",
  parent_only: "상위 항목",
};

export interface ReadinessManualInput {
  id: string;
  title: string;
  category: string;
  parent_manual_id: string | null;
  status: string;
}

/** embedding 벡터 자체는 절대 읽어오지 않고, null 여부만 넘긴다. */
export interface ReadinessChunkInput {
  manual_id: string;
  has_embedding: boolean;
}

export interface ManualReadinessDetail {
  /** 재처리 요청에만 쓰는 값. 화면에 표시하지 않는다. */
  manualId: string;
  title: string;
  status: ManualReadinessStatus;
  statusLabel: string;
  canReindex: boolean;
}

export interface ManualReadinessSummary {
  totalDetailManualCount: number;
  readyCount: number;
  needsReindexCount: number;
  notSearchableCount: number;
}

export interface ManualReadinessGroup {
  title: string;
  category: string;
  summary: ManualReadinessSummary;
  manuals: ManualReadinessDetail[];
}

export interface ManualReadinessReport {
  summary: ManualReadinessSummary;
  groups: ManualReadinessGroup[];
}

function emptySummary(): ManualReadinessSummary {
  return { totalDetailManualCount: 0, readyCount: 0, needsReindexCount: 0, notSearchableCount: 0 };
}

function addToSummary(summary: ManualReadinessSummary, status: ManualReadinessStatus): void {
  if (status === "parent_only") {
    return;
  }
  summary.totalDetailManualCount += 1;
  if (status === "ready") summary.readyCount += 1;
  if (status === "needs_reindex") summary.needsReindexCount += 1;
  if (status === "not_searchable") summary.notSearchableCount += 1;
}

export function resolveManualReadinessStatus(
  manual: ReadinessManualInput,
  chunks: readonly ReadinessChunkInput[],
  hasChildren: boolean,
): ManualReadinessStatus {
  // 주제 카드는 자식을 거느린 행만을 뜻한다. parent_manual_id가 null이어도 자식이 없으면
  // 그 자체가 검색되는 단독 매뉴얼이므로 부모로 취급하지 않는다.
  if (hasChildren) {
    return "parent_only";
  }
  if (manual.status !== "approved") {
    return "not_searchable";
  }
  if (chunks.length === 0 || chunks.some((chunk) => !chunk.has_embedding)) {
    return "needs_reindex";
  }
  return "ready";
}

export function buildManualReadinessReport(
  manuals: readonly ReadinessManualInput[],
  chunks: readonly ReadinessChunkInput[],
): ManualReadinessReport {
  const chunksByManual = new Map<string, ReadinessChunkInput[]>();
  for (const chunk of chunks) {
    const list = chunksByManual.get(chunk.manual_id) ?? [];
    list.push(chunk);
    chunksByManual.set(chunk.manual_id, list);
  }

  // 조회 범위 안의 parent_manual_id 관계로 "실제 자식이 있는 id"를 한 번에 계산한다(행별 재조회 없음).
  const childrenByParent = new Map<string, ReadinessManualInput[]>();
  for (const manual of manuals) {
    if (!manual.parent_manual_id) continue;
    const list = childrenByParent.get(manual.parent_manual_id) ?? [];
    list.push(manual);
    childrenByParent.set(manual.parent_manual_id, list);
  }

  const topLevel = manuals.filter((manual) => !manual.parent_manual_id);
  const total = emptySummary();

  const toDetail = (manual: ReadinessManualInput, summary: ManualReadinessSummary): ManualReadinessDetail => {
    const status = resolveManualReadinessStatus(
      manual,
      chunksByManual.get(manual.id) ?? [],
      (childrenByParent.get(manual.id)?.length ?? 0) > 0,
    );
    addToSummary(summary, status);
    addToSummary(total, status);
    return {
      manualId: manual.id,
      title: manual.title,
      status,
      statusLabel: MANUAL_READINESS_LABELS[status],
      canReindex: status === "needs_reindex",
    };
  };

  const groups: ManualReadinessGroup[] = topLevel.map((manual) => {
    const groupSummary = emptySummary();
    const children = childrenByParent.get(manual.id) ?? [];
    // 자식이 없는 단독 매뉴얼은 자기 자신이 검색 대상 항목이다.
    const details = children.length > 0
      ? children.map((child) => toDetail(child, groupSummary))
      : [toDetail(manual, groupSummary)];

    return {
      title: manual.title,
      category: manual.category,
      summary: groupSummary,
      manuals: details,
    };
  });

  return { summary: total, groups };
}
