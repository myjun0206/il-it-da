export type NoticeSortOrder = "latest" | "oldest" | "views";

interface SortableNotice {
  createdAt: string;
  viewCount: number;
}

export function getNoticeSortOrder(value: string | null): NoticeSortOrder {
  if (value === "oldest" || value === "views") return value;
  return "latest";
}

export function sortNoticeRows<T extends SortableNotice>(
  notices: T[],
  sortOrder: NoticeSortOrder,
): T[] {
  return [...notices].sort((left, right) => {
    const createdAtDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (sortOrder === "oldest") return -createdAtDifference;
    if (sortOrder === "views") return right.viewCount - left.viewCount || createdAtDifference;
    return createdAtDifference;
  });
}