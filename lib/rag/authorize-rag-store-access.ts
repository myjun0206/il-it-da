import "server-only";

import {
  authorizeRagStoreAccess,
  isApprovedStaffMembership,
  type RagStoreAuthorization,
} from "@/lib/rag/rag-store-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function authorizeRagStoreAccessForRequest(
  storeId: string,
): Promise<RagStoreAuthorization> {
  return authorizeRagStoreAccess(storeId, {
    async getCurrentUserId() {
      const sessionClient = await createClient();
      const { data, error } = await sessionClient.auth.getUser();
      return error || !data.user ? null : data.user.id;
    },
    async hasApprovedStaffMembership(userId, requestedStoreId) {
      const adminClient = createAdminClient();
      const { data, error } = await adminClient
        .from("store_memberships")
        .select("user_id, store_id, role, status")
        .eq("user_id", userId)
        .eq("store_id", requestedStoreId)
        .eq("role", "staff")
        .eq("status", "approved")
        .maybeSingle();

      if (error) {
        throw error;
      }

      return isApprovedStaffMembership(data, userId, requestedStoreId);
    },
  });
}
