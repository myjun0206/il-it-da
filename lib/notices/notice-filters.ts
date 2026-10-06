import type { NoticeTargetType } from "./notice-authorization";

export type NoticeSourceFilter = "all" | "hq" | "owner";
export type NoticeTargetFilter = "all" | "franchise" | "store";

export function toStaffNotice<Notice extends { sourceLabel: string }>(notice: Notice) {
  return { ...notice, sourceType: notice.sourceLabel === "점주 공지" ? "owner" as const : "hq" as const };
}

export function filterStaffNotices<Notice extends {
  sourceType: "hq" | "owner";
  targetType: NoticeTargetType;
  title: string;
  content: string;
}>(notices: readonly Notice[], filters: { source: NoticeSourceFilter; target: NoticeTargetFilter; query: string }): Notice[] {
  const query = filters.query.trim().toLowerCase();
  return notices.filter((notice) => {
    if (filters.source !== "all" && notice.sourceType !== filters.source) return false;
    if (filters.target === "franchise" && notice.targetType !== "all" && notice.targetType !== "franchise") return false;
    if (filters.target === "store" && notice.targetType !== "store") return false;
    return !query || notice.title.toLowerCase().includes(query) || notice.content.toLowerCase().includes(query);
  });
}