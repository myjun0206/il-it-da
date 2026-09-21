/**
 * HQ manual onboarding & dashboard shared types.
 */

export interface ManualSectionDraft {
  id: string;
  category: string;
  title: string;
  content: string;
}

export interface ManualRecord {
  id: string;
  brand_name: string | null;
  franchise_id: string | null;
  store_id: string | null;
  parent_manual_id: string | null;
  title: string;
  category: string;
  content: string;
  status: "draft" | "approved";
  created_at: string;
  updated_at: string;
}
