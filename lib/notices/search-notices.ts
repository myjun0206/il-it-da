import type { SupabaseClient } from "@supabase/supabase-js";

export interface NoticeSearchRow {
  author_id: string | null;
  title: string;
  content: string;
}

export function filterNoticeRowsBySearch<T extends NoticeSearchRow>(
  rows: T[],
  search: string,
  authorNames: ReadonlyMap<string, string>,
): T[] {
  const query = search.trim().toLowerCase();
  if (!query) return rows;

  return rows.filter((row) => {
    const authorName = row.author_id ? authorNames.get(row.author_id)?.toLowerCase() ?? "" : "";
    return row.title.toLowerCase().includes(query)
      || row.content.toLowerCase().includes(query)
      || authorName.includes(query);
  });
}

export async function searchNoticeRows<T extends NoticeSearchRow>(
  adminClient: SupabaseClient,
  rows: T[],
  searchValue: string | null,
): Promise<T[]> {
  const query = searchValue?.trim() ?? "";
  if (!query) return rows;

  const authorIds = [...new Set(rows.map((row) => row.author_id).filter((id): id is string => Boolean(id)))];
  const authorNames = new Map<string, string>();

  if (authorIds.length > 0) {
    const { data, error } = await adminClient
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);

    if (error) throw error;
    for (const profile of data ?? []) {
      if (profile.full_name) authorNames.set(profile.id, profile.full_name);
    }
  }

  return filterNoticeRowsBySearch(rows, query, authorNames);
}