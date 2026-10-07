export interface NoticeWithId {
  id: string;
}

export interface NoticeReadRecord {
  notice_id: string;
  user_id: string;
}

export type NoticeReadFilter = "all" | "unread";

export function parseNoticeReadFilter(value: string | null): NoticeReadFilter {
  return value === "unread" ? "unread" : "all";
}

export function filterNoticeRowsByRead<T extends { isRead?: boolean | null }>(
  notices: readonly T[],
  readFilter: NoticeReadFilter,
): T[] {
  return readFilter === "unread"
    ? notices.filter((notice) => notice.isRead === false)
    : [...notices];
}

export function withNoticeViewCounts<T extends NoticeWithId>(
  notices: T[],
  readRecords: Iterable<NoticeReadRecord>,
): Array<T & { viewCount: number }> {
  const readUsersByNotice = new Map<string, Set<string>>();

  for (const record of readRecords) {
    let userIds = readUsersByNotice.get(record.notice_id);
    if (!userIds) {
      userIds = new Set<string>();
      readUsersByNotice.set(record.notice_id, userIds);
    }
    userIds.add(record.user_id);
  }

  return notices.map((notice) => ({
    ...notice,
    viewCount: readUsersByNotice.get(notice.id)?.size ?? 0,
  }));
}

export function withNoticeReadStats<T extends NoticeWithId>(
  notices: T[],
  readRecords: Iterable<NoticeReadRecord>,
  currentUserId: string,
): Array<T & { isRead: boolean; viewCount: number }> {
  const records = [...readRecords];
  const currentUserReadIds = new Set(
    records
      .filter((record) => record.user_id === currentUserId)
      .map((record) => record.notice_id),
  );

  return withNoticeViewCounts(notices, records).map((notice) => ({
    ...notice,
    isRead: currentUserReadIds.has(notice.id),
  }));
}

export function withNoticeReadStatus<T extends NoticeWithId>(
  notices: T[],
  readNoticeIds: Iterable<string>,
): Array<T & { isRead: boolean }> {
  const readIds = new Set(readNoticeIds);
  return notices.map((notice) => ({ ...notice, isRead: readIds.has(notice.id) }));
}