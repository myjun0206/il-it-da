/** 본사 공지사항(GET /api/hq/notices) 응답 항목 */
export interface HqNoticeItem {
  id: string;
  targetType: "all" | "store";
  targetStoreId: string | null;
  targetStoreName: string | null;
  title: string;
  content: string;
  createdAt: string;
}
