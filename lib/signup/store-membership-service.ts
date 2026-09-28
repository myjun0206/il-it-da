import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";
import { resolveFranchiseIdForStoreName } from "@/lib/supabase/resolve-store-franchise";

const DATABASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export async function ensureBrandProfileForApprovedMembership(
  adminClient: SupabaseClient,
  userId: string,
  storeId: string,
): Promise<boolean> {
  const { data: membership, error: membershipError } = await adminClient
    .from("store_memberships")
    .select("role, status, franchise_id")
    .eq("user_id", userId)
    .eq("store_id", storeId)
    .eq("status", "approved")
    .maybeSingle();

  if (membershipError) {
    console.error("[AUTH] APPROVED_MEMBERSHIP_BRAND_LOOKUP_FAILED", {
      userId,
      storeId,
      message: membershipError.message,
      code: membershipError.code,
      details: membershipError.details,
      hint: membershipError.hint,
    });
    logSafeAuthError("APPROVED_MEMBERSHIP_BRAND_LOOKUP_FAILED", membershipError);
    return false;
  }
  if (!membership) {
    console.error("[AUTH] APPROVED_MEMBERSHIP_NOT_FOUND", { userId, storeId });
    return false;
  }

  const { data: store, error: storeError } = await adminClient
    .from("stores")
    .select("franchise_id")
    .eq("id", storeId)
    .maybeSingle();

  if (storeError) {
    console.error("[AUTH] APPROVED_STORE_BRAND_LOOKUP_FAILED", {
      userId,
      storeId,
      message: storeError.message,
      code: storeError.code,
      details: storeError.details,
      hint: storeError.hint,
    });
    logSafeAuthError("APPROVED_STORE_BRAND_LOOKUP_FAILED", storeError);
    return false;
  }
  if (!store || !store.franchise_id) {
    console.error("[AUTH] APPROVED_STORE_BRAND_NOT_FOUND", { userId, storeId });
    return false;
  }

  if (membership.franchise_id && store.franchise_id !== membership.franchise_id) {
    console.error("[AUTH] APPROVED_STORE_BRAND_MISMATCH", {
      userId,
      storeId,
      membershipFranchiseId: membership.franchise_id,
      storeFranchiseId: store.franchise_id,
    });
    return false;
  }

  const brandId = membership.franchise_id || store.franchise_id;
  if (!membership.franchise_id) {
    const { error: membershipBrandUpdateError } = await adminClient
      .from("store_memberships")
      .update({ franchise_id: brandId })
      .eq("user_id", userId)
      .eq("store_id", storeId)
      .eq("status", "approved");

    if (membershipBrandUpdateError) {
      console.error("[AUTH] APPROVED_MEMBERSHIP_BRAND_BACKFILL_FAILED", {
        userId,
        storeId,
        brandId,
        message: membershipBrandUpdateError.message,
        code: membershipBrandUpdateError.code,
        details: membershipBrandUpdateError.details,
        hint: membershipBrandUpdateError.hint,
      });
      logSafeAuthError("APPROVED_MEMBERSHIP_BRAND_BACKFILL_FAILED", membershipBrandUpdateError);
      return false;
    }
  }

  const { data: masterProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("email, full_name, role, phone, company_email, approval_status, approved_at, approved_by, user_id")
    .eq("id", userId)
    .is("brand_id", null)
    .maybeSingle();

  if (profileError) {
    console.error("[AUTH] STORE_MEMBERSHIP_MASTER_PROFILE_LOOKUP_FAILED", {
      userId,
      brandId,
      message: profileError.message,
      code: profileError.code,
      details: profileError.details,
      hint: profileError.hint,
    });
    logSafeAuthError("STORE_MEMBERSHIP_MASTER_PROFILE_LOOKUP_FAILED", profileError);
    return false;
  }

  if (
    !masterProfile ||
    (masterProfile.role !== "owner" && masterProfile.role !== "staff") ||
    (membership.role !== "owner" && membership.role !== "staff")
  ) {
    console.error("[AUTH] STORE_MEMBERSHIP_MASTER_PROFILE_INVALID", {
      userId,
      brandId,
      hasMasterProfile: Boolean(masterProfile),
      masterRole: masterProfile?.role,
      membershipRole: membership.role,
    });
    return false;
  }

  const brandProfileFields = {
    user_id: userId,
    email: masterProfile.email,
    full_name: masterProfile.full_name,
    role: masterProfile.role,
    phone: masterProfile.phone,
    company_email: masterProfile.company_email,
    brand_id: brandId,
    approval_status: "approved",
    approved_at: masterProfile.approved_at,
    approved_by: masterProfile.approved_by,
  };
  const brandProfileValues = {
    id: crypto.randomUUID(),
    ...brandProfileFields,
  };

  const { data: existingBrandProfile, error: lookupError } = await adminClient
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .eq("brand_id", brandId)
    .maybeSingle();

  if (lookupError) {
    console.error("[AUTH] STORE_MEMBERSHIP_BRAND_PROFILE_LOOKUP_FAILED", {
      userId,
      brandId,
      message: lookupError.message,
      code: lookupError.code,
      details: lookupError.details,
      hint: lookupError.hint,
    });
    logSafeAuthError("STORE_MEMBERSHIP_BRAND_PROFILE_LOOKUP_FAILED", lookupError);
    return false;
  }

  const saveResult = existingBrandProfile
    ? await adminClient.from("profiles").update(brandProfileFields).eq("id", existingBrandProfile.id)
    : await adminClient.from("profiles").insert(brandProfileValues);

  if (saveResult.error?.code === "23505" && !existingBrandProfile) {
    const { data: concurrentBrandProfile, error: concurrentLookupError } = await adminClient
      .from("profiles")
      .select("id")
      .eq("user_id", userId)
      .eq("brand_id", brandId)
      .maybeSingle();

    if (concurrentLookupError || !concurrentBrandProfile) {
      console.error("[AUTH] STORE_MEMBERSHIP_BRAND_PROFILE_DUPLICATE_RECOVERY_FAILED", {
        userId,
        brandId,
        message: concurrentLookupError?.message || saveResult.error.message,
        code: concurrentLookupError?.code || saveResult.error.code,
        details: concurrentLookupError?.details || saveResult.error.details,
        hint: concurrentLookupError?.hint || saveResult.error.hint,
      });
      logSafeAuthError(
        "STORE_MEMBERSHIP_BRAND_PROFILE_DUPLICATE_RECOVERY_FAILED",
        concurrentLookupError || saveResult.error,
      );
      return false;
    }

    const concurrentUpdate = await adminClient
      .from("profiles")
      .update(brandProfileFields)
      .eq("id", concurrentBrandProfile.id);

    if (concurrentUpdate.error) {
      console.error("[AUTH] STORE_MEMBERSHIP_BRAND_PROFILE_DUPLICATE_UPDATE_FAILED", {
        userId,
        brandId,
        profileId: concurrentBrandProfile.id,
        message: concurrentUpdate.error.message,
        code: concurrentUpdate.error.code,
        details: concurrentUpdate.error.details,
        hint: concurrentUpdate.error.hint,
      });
      logSafeAuthError("STORE_MEMBERSHIP_BRAND_PROFILE_DUPLICATE_UPDATE_FAILED", concurrentUpdate.error);
      return false;
    }
  } else if (saveResult.error) {
    console.error("[AUTH] STORE_MEMBERSHIP_BRAND_PROFILE_SYNC_FAILED", {
      userId,
      brandId,
      profileId: existingBrandProfile?.id || brandProfileValues.id,
      message: saveResult.error.message,
      code: saveResult.error.code,
      details: saveResult.error.details,
      hint: saveResult.error.hint,
    });
    logSafeAuthError("STORE_MEMBERSHIP_BRAND_PROFILE_SYNC_FAILED", saveResult.error);
    return false;
  }

  return true;
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
      user_id: userId,
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
        .select("email, full_name, phone, approval_status, brand_id, user_id")
        .eq("id", userId)
        .single();

      if (!fetchError && existingProfile) {
        const profileUpdates: Record<string, unknown> = {};
        if (existingProfile.user_id !== userId) profileUpdates.user_id = userId;
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

  let resolvedStoreName = storeName?.trim() || null;
  let storeFromId: { id: string; store_name: string; franchise_id: string | null } | null = null;
  if (storeId && DATABASE_UUID_PATTERN.test(storeId)) {
    const { data, error } = await adminClient
      .from("stores")
      .select("id, store_name, franchise_id")
      .eq("id", storeId)
      .maybeSingle<{ id: string; store_name: string; franchise_id: string | null }>();

    if (error) {
      return { success: false, error: "Failed to lookup store", details: error.message, status: 500 };
    }
    if (data) {
      storeFromId = data;
      resolvedStoreName = data.store_name;
    }
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
  } else if (storeFromId?.franchise_id) {
    requestedFranchiseId = storeFromId.franchise_id;
  } else if (resolvedStoreName) {
    requestedFranchiseId = await resolveFranchiseIdForStoreName(adminClient, resolvedStoreName);
    if (!requestedFranchiseId) {
      return {
        success: false,
        error: "프랜차이즈를 자동으로 확인할 수 없습니다.",
        details: "매장명을 확인하거나 프랜차이즈를 직접 선택해주세요.",
        status: 400,
      };
    }
  } else {
    return {
      success: false,
      error: "storeName is required",
      details: "매장명을 입력해주세요.",
      status: 400,
    };
  }

  if (storeFromId?.franchise_id && requestedFranchiseId !== storeFromId.franchise_id) {
    return {
      success: false,
      error: "매장과 프랜차이즈 정보가 일치하지 않습니다.",
      details: "선택한 매장의 브랜드를 다시 확인해주세요.",
      status: 400,
    };
  }

  // stores row 생성/조회
  let finalStoreId: string | null = null;
  let finalFranchiseId: string | null = null;

  let existingStoreQuery = adminClient
    .from("stores")
    .select("id, franchise_id");
  existingStoreQuery = storeFromId
    ? existingStoreQuery.eq("id", storeFromId.id)
    : existingStoreQuery.eq("store_name", resolvedStoreName);
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
  } else if (role === "owner") {
    let doubleCheckStoreQuery = adminClient
      .from("stores")
      .select("id, franchise_id");
    doubleCheckStoreQuery = storeFromId
      ? doubleCheckStoreQuery.eq("id", storeFromId.id)
      : doubleCheckStoreQuery.eq("store_name", resolvedStoreName);
    doubleCheckStoreQuery = requestedFranchiseId
      ? doubleCheckStoreQuery.eq("franchise_id", requestedFranchiseId)
      : doubleCheckStoreQuery.is("franchise_id", null);

    const { data: doubleCheckStore, error: doubleCheckError } = await doubleCheckStoreQuery.single();

    if (doubleCheckError && doubleCheckError.code === "PGRST116") {
      const { data: newStore, error: insertError } = await adminClient
        .from("stores")
        .insert({
          store_name: resolvedStoreName,
          franchise_id: requestedFranchiseId,
        })
        .select("id, franchise_id")
        .single();

      if (insertError) {
        logSafeAuthError("STORE_MEMBERSHIP_STORE_INSERT_FAILED", insertError);

        let retryStoreQuery = adminClient
          .from("stores")
          .select("id, franchise_id");
        retryStoreQuery = storeFromId
          ? retryStoreQuery.eq("id", storeFromId.id)
          : retryStoreQuery.eq("store_name", resolvedStoreName);
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

  if (!finalMembershipFranchiseId) {
    return {
      success: false,
      error: "매장의 브랜드를 확인할 수 없습니다.",
      details: "프랜차이즈 정보가 확인되는 매장을 선택해주세요.",
      status: 400,
    };
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

    generateMembershipNotifications(userId, role, finalStoreId, resolvedStoreName || "", userName).catch((e) =>
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
