import { NextResponse } from "next/server";

import {
  failedStaffStoresResult,
  filterApprovedStaffMemberships,
  successfulStaffStoresResult,
  toStaffStores,
  unauthorizedStaffStoresResult,
} from "@/lib/staff/approved-stores";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type StaffStoresResponse = {
  stores?: Array<{ id: string; name: string }>;
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
      .select("user_id, store_id, role, status")
      .eq("user_id", userData.user.id)
      .eq("role", "staff")
      .eq("status", "approved");

    if (membershipError) {
      throw membershipError;
    }

    const storeIds = filterApprovedStaffMemberships(memberships ?? [], userData.user.id);
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

    const result = successfulStaffStoresResult(toStaffStores(storeIds, stores ?? []));
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    const result = failedStaffStoresResult();
    return NextResponse.json(result.body, { status: result.status });
  }
}
