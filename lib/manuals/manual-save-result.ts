import type { ManualRecord } from "@/lib/types/manual";

export function manualSaveResult(manuals: readonly ManualRecord[]) {
  const searchResults = manuals.map((manual) => ({ manualId: manual.id, status: manual.search_status ?? "unknown" }));
  const incomplete = searchResults.length === 0 || searchResults.some((item) => item.status === "failed" || item.status === "unknown");
  return {
    saveStatus: "saved" as const,
    searchStatus: incomplete ? "incomplete" as const : "complete" as const,
    searchResults,
    message: incomplete
      ? "본문은 저장되었지만 일부 검색 반영에 실패했거나 결과를 확인하지 못했습니다. 검색 준비 상태에서 해당 항목을 다시 처리해 주세요."
      : "본문 저장 결과를 확인했습니다. 미승인 항목과 상위 항목은 검색 대상이 아닙니다. 검색 준비 상태를 확인해 주세요.",
  };
}

export function manualSaveMessage(body: unknown): string {
  const result = body as { message?: unknown; saveStatus?: unknown; searchStatus?: unknown } | null;
  return typeof result?.message === "string" ? result.message
    : "저장 응답을 받았습니다. 검색 반영 완료는 확인하지 못했습니다. 검색 준비 상태를 다시 확인해 주세요.";
}