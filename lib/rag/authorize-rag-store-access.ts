import "server-only";

import {
  authorizeRagStoreAccess,
  isApprovedStaffMembership,
  resolveStoreFranchiseScope,
  type RagStoreAuthorization,
  type ResolveStoreFranchiseScopeResult,
} from "@/lib/rag/rag-store-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type StoreManualAccessDiagnostic = (
  event: string,
  details: Record<string, unknown>,
) => void;

export async function authorizeRagStoreAccessForRequest(
  storeId: string,
  onDiagnostic?: StoreManualAccessDiagnostic,
): Promise<RagStoreAuthorization> {
  return authorizeRagStoreAccess(storeId, {
    async getCurrentUserId() {
      const sessionClient = await createClient();
      const { data, error } = await sessionClient.auth.getUser();
      onDiagnostic?.("session", {
        user_id: data.user?.id ?? null,
        authenticated: !error && Boolean(data.user),
        error_code: error?.code ?? null,
      });
      return error || !data.user ? null : data.user.id;
    },
    async hasApprovedStaffMembership(userId, requestedStoreId) {
      const adminClient = createAdminClient();
      const { data, error } = await adminClient
        .from("store_memberships")
        .select("user_id, store_id, franchise_id, role, status")
        .eq("user_id", userId)
        .eq("store_id", requestedStoreId)
        .eq("role", "staff")
        .eq("status", "approved")
        .maybeSingle();

      onDiagnostic?.("membership", {
        requested_store_id: requestedStoreId,
        membership: data,
        error_code: error?.code ?? null,
        error_message: error?.message ?? null,
      });

      if (error) {
        throw error;
      }

      return isApprovedStaffMembership(data, userId, requestedStoreId);
    },
  });
}

/**
 * Resolves the franchise scope for an already-authorized storeId, using only
 * the stores.franchise_id column (from 011_store_franchise_mapping.sql) via
 * the service-role client — never a request-body value.
 */
export async function resolveRagStoreFranchiseForRequest(
  storeId: string,
  onDiagnostic?: StoreManualAccessDiagnostic,
): Promise<ResolveStoreFranchiseScopeResult> {
  return resolveStoreFranchiseScope(storeId, {
    async getStoreFranchiseId(requestedStoreId) {
      const adminClient = createAdminClient();
      const { data, error } = await adminClient
        .from("stores")
        .select("id, store_name, franchise_id")
        .eq("id", requestedStoreId)
        .maybeSingle<{ id: string; store_name: string; franchise_id: string | null }>();

      onDiagnostic?.("store_mapping", {
        requested_store_id: requestedStoreId,
        store: data,
        error_code: error?.code ?? null,
        error_message: error?.message ?? null,
      });

      if (error) {
        throw error;
      }

      return data?.franchise_id ?? null;
    },
  });
}
