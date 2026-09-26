import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications";
import { resolveFranchiseIdForStoreName } from "@/lib/supabase/resolve-store-franchise";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";

export interface SignupProfileInput {
  userId: string;
  email: string | null;
  role: "owner" | "staff";
  name: string;
  phone: string | null;
}

export interface SignupProfileResult {
  success: boolean;
  error?: string;
  details?: string;
}

/**
 * profiles row 생성 또는 부족한 필드 보완 (POST /api/signup/store-membership와
 * 인증 콜백의 자동 일괄 승인 신청 양쪽에서 공유하는 로직).
 */
export async function upsertSignupProfile(
  adminClient: SupabaseClient,
  input: SignupProfileInput
): Promise<SignupProfileResult> {
  const { userId, role, name, phone } = input;
  const email = input.email?.trim().toLowerCase() || null;

  try {
    const { error: profileError } = await adminClient.from("profiles").insert({
      id: userId,
      email,
      role,
      full_name: name,
      phone,
      approval_status: "pending",
    });

    // 중복 PK 에러: 기존 profile이 있음
    if (profileError && profileError.code === "23505") {
      const { data: existingProfile, error: fetchError } = await adminClient
        .from("profiles")
        .select("email, full_name, phone, approval_status, brand_id")
        .eq("id", userId)
        .single();

      if (!fetchError && existingProfile) {
        const profileUpdates: Record<string, unknown> = {};
        if (email && existingProfile.email !== email) profileUpdates.email = email;
        if (!existingProfile.full_name) profileUpdates.full_name = name;
        if (phone && !existingProfile.phone) profileUpdates.phone = phone;
        if (!existingProfile.approval_status) profileUpdates.approval_status = "pending";

        if (Object.keys(profileUpdates).length > 0) {
          const { error: updateError } = await adminClient
            .from("profiles")
            .update(profileUpdates)
            .eq("id", userId);

          if (updateError) {
            logSafeAuthError("STORE_MEMBERSHIP_PROFILE_UPDATE_FAILED", updateError);
            return {
              success: false,
              error: "Failed to update profile",
              details: updateError.message,
            };
          }
        }
      }
      return { success: true };
    }

    if (profileError) {
      logSafeAuthError("STORE_MEMBERSHIP_PROFILE_CREATE_FAILED", profileError);
      return {
        success: false,
        error: "Failed to create profile",
        details: profileError.message,
      };
    }

    return { success: true };
  } catch (e) {
    logSafeAuthError("STORE_MEMBERSHIP_PROFILE_CREATE_EXCEPTION", e);
    return { success: false, error: "Failed to create profile", details: String(e) };
  }
}

export interface StoreMembershipRequestInput {
  userId: string;
  userName: string;
  role: "owner" | "staff";
  storeId?: string;
  storeName?: string;
  franchiseId?: string;
  /** 요청자 프로필의 기존 approval_status - 이미 "approved"면 승격 상태를 유지한다. */
  currentApprovalStatus?: string | null;
}

export interface StoreMembershipRequestResult {
  success: boolean;
  membershipId?: string;
  error?: string;
  details?: string;
  status: number;
}

/**
 * 매장 조회/생성 + store_memberships row 생성(중복이면 기존 것 반환) + 알림 발송.
 * POST /api/signup/store-membership와 인증 콜백의 자동 일괄 승인 신청 양쪽에서 공유한다.
 */
export async function submitStoreMembershipRequest(
  adminClient: SupabaseClient,
  input: StoreMembershipRequestInput
): Promise<StoreMembershipRequestResult> {
  const { userId, userName, role, storeId, storeName, franchiseId, currentApprovalStatus } = input;

  if (!storeId && !storeName) {
    return {
      success: false,
      error: "storeName is required",
      details: "매장 정보가 필요합니다.",
      status: 400,
    };
  }

  let requestedFranchiseId: string | null = null;
  if (franchiseId) {
    const { data: chosenFranchise, error: chosenFranchiseError } = await adminClient
      .from("franchises")
      .select("id")
      .eq("id", franchiseId)
      .maybeSingle<{ id: string }>();

    if (chosenFranchiseError || !chosenFranchise) {
      return { success: false, error: "Invalid franchiseId", status: 400 };
    }
    requestedFranchiseId = chosenFranchise.id;
  } else if (storeName) {
    requestedFranchiseId = await resolveFranchiseIdForStoreName(adminClient, storeName);
  }

  // stores row 생성/조회
  let finalStoreId: string | null = null;
  let finalFranchiseId: string | null = null;

  let existingStoreQuery = adminClient
    .from("stores")
    .select("id, franchise_id")
    .eq("store_name", storeName);
  existingStoreQuery = requestedFranchiseId
    ? existingStoreQuery.eq("franchise_id", requestedFranchiseId)
    : existingStoreQuery.is("franchise_id", null);

  const { data: existingStore, error: storeError } = await existingStoreQuery.single();

  if (storeError && storeError.code !== "PGRST116") {
    logSafeAuthError("STORE_MEMBERSHIP_STORE_LOOKUP_FAILED", storeError);
    return {
      success: false,
      error: "Failed to lookup store",
      details: storeError.message,
      status: 500,
    };
  }

  if (existingStore) {
    finalStoreId = existingStore.id;
    finalFranchiseId = existingStore.franchise_id;

    if (!finalFranchiseId) {
      const backfilledFranchiseId = await resolveFranchiseIdForStoreName(adminClient, storeName!);

      if (backfilledFranchiseId) {
        const { error: backfillError } = await adminClient
          .from("stores")
          .update({ franchise_id: backfilledFranchiseId })
          .eq("id", existingStore.id);

        if (!backfillError) {
          finalFranchiseId = backfilledFranchiseId;
        }
      }
    }
  } else if (role === "owner") {
    let doubleCheckStoreQuery = adminClient
      .from("stores")
      .select("id, franchise_id")
      .eq("store_name", storeName);
    doubleCheckStoreQuery = requestedFranchiseId
      ? doubleCheckStoreQuery.eq("franchise_id", requestedFranchiseId)
      : doubleCheckStoreQuery.is("franchise_id", null);

    const { data: doubleCheckStore, error: doubleCheckError } = await doubleCheckStoreQuery.single();

    if (doubleCheckError && doubleCheckError.code === "PGRST116") {
      const { data: newStore, error: insertError } = await adminClient
        .from("stores")
        .insert({
          store_name: storeName,
          franchise_id: requestedFranchiseId,
        })
        .select("id, franchise_id")
        .single();

      if (insertError) {
        logSafeAuthError("STORE_MEMBERSHIP_STORE_INSERT_FAILED", insertError);

        let retryStoreQuery = adminClient
          .from("stores")
          .select("id, franchise_id")
          .eq("store_name", storeName);
        retryStoreQuery = requestedFranchiseId
          ? retryStoreQuery.eq("franchise_id", requestedFranchiseId)
          : retryStoreQuery.is("franchise_id", null);

        const { data: retryStore, error: retryError } = await retryStoreQuery.single();

        if (retryError && retryError.code === "PGRST116") {
          logSafeAuthError("STORE_MEMBERSHIP_STORE_INSERT_RETRY_FAILED", insertError);
          return {
            success: false,
            error: "매장 정보를 등록하는 중 오류가 발생했습니다.",
            details: insertError.message,
            status: 500,
          };
        }

        if (retryStore) {
          finalStoreId = retryStore.id;
          finalFranchiseId = retryStore.franchise_id;
        }
      } else {
        finalStoreId = newStore.id;
        finalFranchiseId = newStore.franchise_id;
      }
    } else if (!doubleCheckError && doubleCheckStore) {
      finalStoreId = doubleCheckStore.id;
      finalFranchiseId = doubleCheckStore.franchise_id;
    }
  } else {
    return {
      success: false,
      error: "선택한 매장을 찾을 수 없습니다.",
      details: `Store with name "${storeName}" not found. Staff must select an existing store.`,
      status: 404,
    };
  }

  if (!finalStoreId) {
    return { success: false, error: "Unable to determine store ID", status: 500 };
  }

  const finalMembershipFranchiseId = requestedFranchiseId ?? finalFranchiseId;

  if (finalMembershipFranchiseId) {
    await adminClient
      .from("profiles")
      .update({
        brand_id: finalMembershipFranchiseId,
        approval_status: currentApprovalStatus === "approved" ? "approved" : "pending",
      })
      .eq("id", userId);
  }

  // store_memberships row 생성 (중복 확인)
  try {
    const { data: existingMembership, error: lookupError } = await adminClient
      .from("store_memberships")
      .select("id, status")
      .eq("user_id", userId)
      .eq("store_id", finalStoreId)
      .single();

    if (lookupError && lookupError.code !== "PGRST116") {
      logSafeAuthError("STORE_MEMBERSHIP_LOOKUP_FAILED", lookupError);
      return {
        success: false,
        error: "Failed to lookup existing membership",
        details: lookupError.message,
        status: 500,
      };
    }

    if (existingMembership) {
      return { success: true, membershipId: existingMembership.id, status: 200 };
    }

    const { data: newMembership, error: createError } = await adminClient
      .from("store_memberships")
      .insert({
        user_id: userId,
        store_id: finalStoreId,
        franchise_id: finalMembershipFranchiseId,
        role,
        status: "pending",
        requested_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (createError) {
      logSafeAuthError("STORE_MEMBERSHIP_CREATE_FAILED", createError);
      return {
        success: false,
        error: "Failed to create store membership",
        details: createError.message,
        status: 500,
      };
    }

    generateMembershipNotifications(userId, role, finalStoreId, storeName || "", userName).catch((e) =>
      console.error("Failed to generate notifications:", e)
    );

    return { success: true, membershipId: newMembership.id, status: 200 };
  } catch (e) {
    logSafeAuthError("STORE_MEMBERSHIP_CREATE_EXCEPTION", e);
    return { success: false, error: "Failed to create membership", details: String(e), status: 500 };
  }
}

/**
 * Generate notifications for new membership requests
 * - Staff request: notify store owners
 * - Owner request: notify all HQ users
 */
async function generateMembershipNotifications(
  userId: string,
  role: "owner" | "staff",
  storeId: string,
  storeName: string,
  userName: string
): Promise<void> {
  try {
    const adminClient = createAdminClient();

    if (role === "staff") {
      const { data: ownerMemberships, error: queryError } = await adminClient
        .from("store_memberships")
        .select("user_id")
        .eq("store_id", storeId)
        .eq("role", "owner")
        .eq("status", "approved");

      if (queryError) {
        console.error("Failed to find store owners:", queryError);
        return;
      }

      if (ownerMemberships && ownerMemberships.length > 0) {
        for (const membership of ownerMemberships) {
          await createNotification({
            recipientUserId: membership.user_id,
            type: "staff_pending_approval",
            title: "새로운 직원 승인 요청",
            message: `${userName} 님이 ${storeName} 가입을 요청했습니다.`,
            targetUrl: "/boss/employees",
            relatedId: userId,
          });
        }
      }
    } else if (role === "owner") {
      const { data: hqUsers, error: queryError } = await adminClient
        .from("profiles")
        .select("id")
        .eq("role", "hq");

      if (queryError) {
        console.error("Failed to find HQ users:", queryError);
        return;
      }

      if (hqUsers && hqUsers.length > 0) {
        for (const profile of hqUsers) {
          await createNotification({
            recipientUserId: profile.id,
            type: "owner_pending_approval",
            title: "새로운 점주 승인 요청",
            message: `${storeName} 점주 가입 요청이 있습니다. (${userName})`,
            targetUrl: "/hq/approvals",
            relatedId: userId,
          });
        }
      }
    }
  } catch (e) {
    console.error("Error generating membership notifications:", e);
  }
}
