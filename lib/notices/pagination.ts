export const DEFAULT_NOTICE_PAGE = 1;
export const DEFAULT_NOTICE_LIMIT = 9;
export const MAX_NOTICE_LIMIT = 50;

export interface NoticePaginationMetadata {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export function parseNoticePagination(searchParams: Pick<URLSearchParams, "get">): Pick<NoticePaginationMetadata, "page" | "limit"> {
  const requestedPage = Number(searchParams.get("page"));
  const requestedLimit = Number(searchParams.get("limit"));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? requestedPage
    : DEFAULT_NOTICE_PAGE;
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_NOTICE_LIMIT)
    : DEFAULT_NOTICE_LIMIT;

  return { page, limit };
}

export function paginateNoticeRows<T>(
  rows: T[],
  page: number,
  limit: number,
): { items: T[]; pagination: NoticePaginationMetadata } {
  const totalCount = rows.length;
  const offset = (page - 1) * limit;

  return {
    items: rows.slice(offset, offset + limit),
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  };
}