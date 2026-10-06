import { NextResponse } from "next/server";

import {
  failedStaffStoresResult,
  successfulStaffStoresResult,
  toStaffStores,
  unauthorizedStaffStoresResult,
} from "@/lib/staff/approved-stores";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type StaffStoresResponse = {
  stores?: Array<{ id: string; membershipId?: string; name: string }>;
  error?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(): Promise<NextResponse<StaffStoresResponse>> {
  const sessionClient = await createClient();
  const { data: userData, error: userError } = await sessionClient.auth.getUser();

  if (userError || !userData.user) {
    console.warn("[STAFF_STORES] Unauthenticated staff store lookup", {
      error: userError?.message,
    });
    const result = unauthorizedStaffStoresResult();
    return NextResponse.json(result.body, { status: result.status });
  }

  const userId = userData.user.id;

  try {
    const adminClient = createAdminClient();
    const { data: memberships, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("id, user_id, store_id, role, status")
      .eq("user_id", userId)
      .eq("role", "staff")
      .eq("status", "approved");

    if (membershipError) {
      throw membershipError;
    }

    // membership ID 매핑 (store_id -> membership ID)
    const membershipByStoreId = new Map<string, string>();
    const storeIds: string[] = [];

    for (const membership of memberships ?? []) {
      if (
        typeof membership.store_id === "string"
        && membership.store_id.trim().length > 0
        && typeof membership.id === "string"
        && membership.id.trim().length > 0
      ) {
        const storeId = membership.store_id.trim();
        if (!membershipByStoreId.has(storeId)) {
          membershipByStoreId.set(storeId, membership.id);
          storeIds.push(storeId);
        }
      }
    }

    console.info("[STAFF_STORES] Membership lookup", {
      userId,
      membershipRows: memberships?.length ?? 0,
      approvedStaffStoreIds: storeIds,
    });

    if (storeIds.length === 0) {
      const { data: diagnosticMemberships } = await adminClient
        .from("store_memberships")
        .select("user_id, store_id, role, status")
        .eq("user_id", userId);

      console.warn("[STAFF_STORES] No approved staff membership found", {
        userId,
        memberships: (diagnosticMemberships ?? []).map((membership) => ({
          storeId: membership.store_id,
          role: membership.role,
          status: membership.status,
        })),
      });
      const result = successfulStaffStoresResult([]);
      return NextResponse.json(result.body, { status: result.status });
    }

    const invalidStoreIds = storeIds.filter((storeId) => !UUID_PATTERN.test(storeId));
    const validStoreIds = storeIds.filter((storeId) => UUID_PATTERN.test(storeId));
    if (invalidStoreIds.length > 0) {
      console.error("[STAFF_STORES] Invalid store UUID in membership", {
        userId,
        invalidStoreIds,
      });
    }
    if (validStoreIds.length === 0) {
      const result = successfulStaffStoresResult([]);
      return NextResponse.json(result.body, { status: result.status });
    }

    const { data: stores, error: storeError } = await adminClient
      .from("stores")
      .select("id, store_name")
      .in("id", validStoreIds);

    if (storeError) {
      throw storeError;
    }

    const resolvedStores = toStaffStores(validStoreIds, stores ?? []).map((store) => ({
      ...store,
      membershipId: membershipByStoreId.get(store.id) ?? "",
    }));

    const resolvedStoreIds = new Set(resolvedStores.map((store) => store.id));
    const missingStoreIds = validStoreIds.filter((storeId) => !resolvedStoreIds.has(storeId));
    if (missingStoreIds.length > 0) {
      console.error("[STAFF_STORES] Membership store rows missing", {
        userId,
        requestedStoreIds: validStoreIds,
        returnedStoreIds: stores?.map((store) => store.id) ?? [],
        missingStoreIds,
      });
    }

    const result = successfulStaffStoresResult(resolvedStores);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[STAFF_STORES] Store lookup failed", {
      userId,
      message: error instanceof Error ? error.message : "Unknown error",
      code: typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined,
    });
    const result = failedStaffStoresResult();
    return NextResponse.json(result.body, { status: result.status });
  }
}
