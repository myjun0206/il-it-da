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

export async function GET(): Promise<NextResponse<StaffStoresResponse>> {
  const sessionClient = await createClient();
  const { data: userData, error: userError } = await sessionClient.auth.getUser();

  if (userError || !userData.user) {
    const result = unauthorizedStaffStoresResult();
    return NextResponse.json(result.body, { status: result.status });
  }

  try {
    const adminClient = createAdminClient();
    const { data: memberships, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("id, user_id, store_id, role, status")
      .eq("user_id", userData.user.id)
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

    if (storeIds.length === 0) {
      const result = successfulStaffStoresResult([]);
      return NextResponse.json(result.body, { status: result.status });
    }

    const { data: stores, error: storeError } = await adminClient
      .from("stores")
      .select("id, store_name")
      .in("id", storeIds);

    if (storeError) {
      throw storeError;
    }

    const staffStores = toStaffStores(storeIds, stores ?? []).map((store) => ({
      ...store,
      membershipId: membershipByStoreId.get(store.id) ?? "",
    }));

    return NextResponse.json({ stores: staffStores }, { status: 200 });
  } catch {
    const result = failedStaffStoresResult();
    return NextResponse.json(result.body, { status: result.status });
  }
}
