/** 본사 공지사항(GET /api/hq/notices) 응답 항목 */
export interface HqNoticeItem {
  id: string;
  targetType: "all" | "franchise" | "store";
  targetStoreId: string | null;
  targetStoreName: string | null;
  audience: "owner" | "all_members" | "staff";
  isMine: boolean;
  viewCount: number;
  title: string;
  content: string;
  createdAt: string;
}
