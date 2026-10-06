import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications";
import { logSafeAuthError } from "@/lib/auth/safe-auth-log";
import { createDiagnosticRequestId, logDiagnosticError } from "@/lib/auth/diagnostic-error-log";
import { normalizeStoreFranchiseName, resolveFranchiseIdForStoreName } from "@/lib/supabase/resolve-store-franchise";

const DATABASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTH_USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MembershipAuthNotReadyError extends Error {
  constructor() {
    super("이메일 인증 또는 계정 생성이 완료되지 않은 사용자입니다.");
    this.name = "MembershipAuthNotReadyError";
  }
}

export async function requireConfirmedMembershipAuthUser(adminClient: SupabaseClient, userId: string) {
  if (!AUTH_USER_ID_PATTERN.test(userId)) {
    console.warn("[AUTH] STORE_MEMBERSHIP_USER_ID_INVALID", { reason: userId ? "not_uuid" : "missing" });
    throw new MembershipAuthNotReadyError();
  }
  const { data, error } = await adminClient.auth.admin.getUserById(userId);
  if (error || !data.user || data.user.id !== userId) {
    if (error && error.status !== 404) {
      throw error;
    }
    console.warn("[AUTH] STORE_MEMBERSHIP_AUTH_USER_MISSING");
    throw new MembershipAuthNotReadyError();
  }
  if (!data.user.email_confirmed_at && !data.user.phone_confirmed_at && !data.user.confirmed_at) {
    throw new MembershipAuthNotReadyError();
  }
  return data.user;
}

function logBrandProfileWriteError(
  stage: string,
  error: { code?: string; message?: string; details?: string; hint?: string; stack?: string },
  profileIdSource?: "generated_brand_profile" | "existing_brand_profile",
): void {
  const redact = (text: string | undefined) => text
    ?.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[redacted-uuid]")
    .slice(0, 500);
  console.error(`[AUTH] ${stage}`, {
    code: error.code,
    profileIdSource,
    authUserReference: "store_memberships.user_id -> auth.users.id -> profiles.user_id",
    ...(error.code === "23503" && error.message?.includes("profiles_id_fkey")
      ? { schemaIssue: "legacy profiles.id FK; apply 028_repair_brand_profile_auth_user_fk.sql" }
      : {}),
    message: redact(error.message),
    details: redact(error.details),
    hint: redact(error.hint),
    stack: redact(error.stack),
  });
}

export interface SignupProfileInput {
  userId: string;
  email: string | null;
  role: "owner" | "staff";
  name: string;
  phone: string | null;
  diagnosticRequestId?: string;
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
  if (!AUTH_USER_ID_PATTERN.test(userId)) {
    console.warn("[AUTH] STORE_MEMBERSHIP_USER_ID_INVALID", { reason: userId ? "not_uuid" : "missing" });
    throw new MembershipAuthNotReadyError();
  }
  const { data: membership, error: membershipError } = await adminClient
    .from("store_memberships")
    .select("role, status, franchise_id, approved_at, approved_by")
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

  const authUser = await requireConfirmedMembershipAuthUser(adminClient, userId);

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

  const { data: existingMasterProfile, error: profileError } = await adminClient
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

  let masterProfile = existingMasterProfile;
  if (!masterProfile && (membership.role === "owner" || membership.role === "staff")) {
    const metadata = authUser.user_metadata;
    const newMasterProfile = {
      id: authUser.id,
      user_id: authUser.id,
      brand_id: null,
      role: membership.role,
      email: authUser.email?.trim().toLowerCase() || null,
      full_name: typeof metadata?.name === "string" ? metadata.name : authUser.email || null,
      phone: typeof metadata?.phone === "string" ? metadata.phone : null,
      company_email: null,
      approval_status: "approved",
      approved_at: membership.approved_at ?? new Date().toISOString(),
      approved_by: membership.approved_by,
    };
    if (process.env.DEBUG_PROFILE_INSERT === "true") {
      console.info("[AUTH] Inserting master profile for user_id:", authUser.id, { profileId: newMasterProfile.id });
    }
    const { error: insertError } = await adminClient.from("profiles").insert(newMasterProfile);
    if (insertError?.code === "23505") {
      const { data: concurrentProfile, error: concurrentError } = await adminClient
        .from("profiles")
        .select("email, full_name, role, phone, company_email, approval_status, approved_at, approved_by, user_id")
        .eq("id", userId)
        .is("brand_id", null)
        .maybeSingle();
      if (concurrentError || !concurrentProfile) {
        console.error("[AUTH] STORE_MEMBERSHIP_MASTER_PROFILE_INSERT_FAILED", {
          code: concurrentError?.code || insertError.code,
        });
        return false;
      }
      masterProfile = concurrentProfile;
    } else if (insertError) {
      console.error("[AUTH] STORE_MEMBERSHIP_MASTER_PROFILE_INSERT_FAILED", { code: insertError.code });
      return false;
    } else {
      masterProfile = newMasterProfile;
    }
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
    user_id: authUser.id,
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

  // Step 1: 기존 brand profile 조회
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

  // Step 2: 기존 profile이 있으면 UPDATE, 없으면 INSERT
  let writeResult;
  const isExistingProfile = !!existingBrandProfile;

  if (isExistingProfile) {
    // 기존 profile 업데이트
    try {
      writeResult = await adminClient
        .from("profiles")
        .update(brandProfileFields)
        .eq("id", existingBrandProfile.id);
    } catch (error) {
      logBrandProfileWriteError(
        "STORE_MEMBERSHIP_BRAND_PROFILE_UPDATE_FAILED",
        error instanceof Error ? error : { message: "Unexpected update exception" },
        "existing_brand_profile",
      );
      return false;
    }

    if (writeResult.error) {
      logBrandProfileWriteError(
        "STORE_MEMBERSHIP_BRAND_PROFILE_UPDATE_FAILED",
        writeResult.error,
        "existing_brand_profile",
      );
      return false;
    }
  } else {
    // 신규 profile 생성
    const brandProfileValues = {
      id: crypto.randomUUID(),
      ...brandProfileFields,
    };

    if (process.env.DEBUG_PROFILE_INSERT === "true") {
      console.info("[AUTH] Inserting brand profile for user_id:", authUser.id, { profileId: brandProfileValues.id });
    }

    try {
      writeResult = await adminClient
        .from("profiles")
        .insert(brandProfileValues);
    } catch (error) {
      logBrandProfileWriteError(
        "STORE_MEMBERSHIP_BRAND_PROFILE_INSERT_FAILED",
        error instanceof Error ? error : { message: "Unexpected insert exception" },
        "generated_brand_profile",
      );
      return false;
    }

    // Step 3: INSERT 실패 시 23505 duplicate check
    if (writeResult.error?.code === "23505") {
      console.info("[AUTH] STORE_MEMBERSHIP_BRAND_PROFILE_DUPLICATE_DETECTED", {
        userId,
        brandId,
        message: "INSERT failed with 23505, attempting recovery",
      });

      // Step 3a: 재조회로 실제 존재 여부 확인
      const { data: concurrentProfile, error: concurrentLookupError } = await adminClient
        .from("profiles")
        .select("id")
        .eq("user_id", userId)
        .eq("brand_id", brandId)
        .maybeSingle();

      if (concurrentLookupError) {
        logBrandProfileWriteError(
          "STORE_MEMBERSHIP_BRAND_PROFILE_DUPLICATE_RECOVERY_LOOKUP_FAILED",
          concurrentLookupError,
        );
        return false;
      }

      // Step 3b: 재조회에서 profile을 찾지 못한 경우
      if (!concurrentProfile) {
        logBrandProfileWriteError(
          "STORE_MEMBERSHIP_BRAND_PROFILE_DUPLICATE_RECOVERY_NOT_FOUND",
          writeResult.error,
        );
        return false;
      }

      // Step 3c: 재조회에서 찾은 profile을 UPDATE
      const concurrentUpdateResult = await adminClient
        .from("profiles")
        .update(brandProfileFields)
        .eq("id", concurrentProfile.id);

      if (concurrentUpdateResult.error) {
        logBrandProfileWriteError(
          "STORE_MEMBERSHIP_BRAND_PROFILE_DUPLICATE_RECOVERY_UPDATE_FAILED",
          concurrentUpdateResult.error,
        );
        return false;
      }

      // Recovery 성공
      if (process.env.DEBUG_PROFILE_INSERT === "true") {
        console.info("[AUTH] STORE_MEMBERSHIP_BRAND_PROFILE_DUPLICATE_RECOVERED", {
          userId,
          brandId,
          profileId: concurrentProfile.id,
        });
      }
    } else if (writeResult.error) {
      // INSERT 실패 (23505 아닌 다른 오류)
      logBrandProfileWriteError(
        "STORE_MEMBERSHIP_BRAND_PROFILE_INSERT_FAILED",
        writeResult.error,
        "generated_brand_profile",
      );
      return false;
    }
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
  const requestId = input.diagnosticRequestId ?? createDiagnosticRequestId();
  const logProfileFailure = (stage: string, error: unknown) => logDiagnosticError("STORE_MEMBERSHIP_PROFILE", stage, error, {
    requestId,
    userId,
    role,
    userName: name,
    table: "profiles",
    sessionPresent: true,
    ...(stage === "profile.insert" ? { writeFields: "id,user_id,brand_id,email,role,full_name,phone,approval_status" } : {}),
  });

  try {
    // 기존 profile이 있으면 insert를 시도하지 않는다. (이미 가입한 직원의 추가 근무 매장 신청 등)
    // 예전에는 insert의 중복 키 에러(23505)로 기존 profile을 감지했는데, 실제 DB의 profiles에
    // NOT NULL 컬럼이 추가되면서 insert가 23505보다 먼저 not-null 에러(23502)로 실패해 기존 사용자도 막혔다.
    // user_id까지 읽어 023의 복수 브랜드 프로필 계약(auth 사용자 역참조)을 아래에서 보완한다.
    const { data: existingProfile, error: fetchError } = await adminClient
      .from("profiles")
      .select("email, full_name, phone, approval_status, brand_id, user_id")
      .eq("id", userId)
      .maybeSingle();

    if (fetchError) {
      logProfileFailure("profile.lookup", fetchError);
      return { success: false, error: "Failed to load profile", details: fetchError.message };
    }

    const { error: profileError } = existingProfile
      ? { error: null }
      : await adminClient.from("profiles").insert({
          id: userId,
          // 023: 마스터 프로필도 user_id로 같은 auth 사용자를 가리킨다(브랜드 프로필과 동일 규칙).
          user_id: userId,
          brand_id: null,
          email,
          role,
          full_name: name,
          phone,
          approval_status: "pending",
        });

    // 기존 profile이 있음 (또는 동시 요청으로 방금 생성됨)
    if (existingProfile || profileError?.code === "23505") {
      if (existingProfile) {
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
            logProfileFailure("profile.update", updateError);
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
      logProfileFailure("profile.insert", profileError);
      return {
        success: false,
        error: "Failed to create profile",
        details: profileError.message,
      };
    }

    return { success: true };
  } catch (e) {
    logProfileFailure("profile.unexpected_exception", typeof e === "string" ? new Error(e) : e);
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
  diagnosticRequestId?: string;
}

export interface StoreMembershipRequestResult {
  success: boolean;
  membershipId?: string;
  /** true면 이번 요청으로 새 pending membership이 생성됨, false면 기존 membership을 그대로 반환함 */
  created?: boolean;
  /** 반환된 membership의 현재 상태 (pending | approved | rejected) */
  membershipStatus?: string;
  /** 클라이언트가 안내 문구를 고를 수 있는 안전한 코드 (내부 에러 내용은 담지 않는다) */
  code?: "STORE_NOT_FOUND" | "STORE_BRAND_UNKNOWN" | "STORE_NO_OWNER" | "STORE_AMBIGUOUS";
  error?: string;
  details?: string;
  status: number;
}

/** 브랜드가 연결되지 않은 기존 매장은 클라이언트 값으로 채우지 않고 고정 안내로 막는다. */
export const STORE_BRAND_UNRESOLVED_MESSAGE =
  "이 매장의 브랜드 정보가 연결되어 있지 않아 신청할 수 없습니다. 본사에 문의해 주세요.";

/**
 * 매장 조회/생성 + store_memberships row 생성(중복이면 기존 것 반환) + 알림 발송.
 * POST /api/signup/store-membership와 인증 콜백의 자동 일괄 승인 신청 양쪽에서 공유한다.
 */
export async function submitStoreMembershipRequest(
  adminClient: SupabaseClient,
  input: StoreMembershipRequestInput
): Promise<StoreMembershipRequestResult> {
  const { userId, userName, role, storeId, storeName, franchiseId } = input;
  const requestId = input.diagnosticRequestId ?? createDiagnosticRequestId();
  const logMapping = (
    reason: string,
    candidates: { id: string; franchise_id: string | null }[] = [],
    resolvedFranchiseId: string | null = null,
  ) => console.warn("[STORE_MEMBERSHIP] stores.franchise_mapping", {
    timestamp: new Date().toISOString(),
    requestId,
    role,
    reason,
    requestedStoreId: storeId && DATABASE_UUID_PATTERN.test(storeId) ? storeId : null,
    requestedFranchiseId: franchiseId && DATABASE_UUID_PATTERN.test(franchiseId) ? franchiseId : null,
    resolvedFranchiseId,
    candidateCount: candidates.length,
    candidates: candidates.map((store) => ({ storeId: store.id, franchiseId: store.franchise_id })),
  });
  let diagnosticFranchiseId = franchiseId ?? null;
  const logFailure = (stage: string, error: unknown, resolvedStoreId?: string | null) => {
    logDiagnosticError("STORE_MEMBERSHIP", stage, typeof error === "string" ? new Error(error) : error, {
      requestId,
      userId,
      role,
      storeId: resolvedStoreId ?? storeId ?? null,
      franchiseId: diagnosticFranchiseId,
      storeName: storeName ?? null,
      userName,
      sessionPresent: true,
      table: stage.startsWith("stores.") ? "stores" : stage.startsWith("franchises.") ? "franchises" : "store_memberships",
      ...(stage === "stores.insert" ? { writeFields: "store_name,franchise_id", hasStoreName: Boolean(storeName?.trim()), hasFranchiseId: Boolean(diagnosticFranchiseId) } : {}),
      ...(stage === "membership.insert" ? { writeFields: "user_id,store_id,franchise_id,role,status,requested_at", membershipStatus: "pending", hasUserId: Boolean(userId), hasStoreId: Boolean(resolvedStoreId), hasFranchiseId: Boolean(diagnosticFranchiseId) } : {}),
    });
  };

  if (!AUTH_USER_ID_PATTERN.test(userId) || (role !== "owner" && role !== "staff")) {
    return { success: false, error: "신청자 정보가 올바르지 않습니다.", status: 400 };
  }
  if (franchiseId && !DATABASE_UUID_PATTERN.test(franchiseId)) {
    return { success: false, error: "브랜드 정보가 올바르지 않습니다.", status: 400 };
  }

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
  const requestedStoreId = storeId?.trim() || null;

  // storeId를 명시했으면 그 매장으로만 처리한다. 없는 매장이면 이름 resolver나 새 매장 생성으로 넘기지 않는다.
  if (requestedStoreId) {
    if (!DATABASE_UUID_PATTERN.test(requestedStoreId)) {
      return {
        success: false,
        error: "선택한 매장 정보가 올바르지 않습니다.",
        details: "매장을 다시 선택해주세요.",
        status: 400,
      };
    }

    const { data, error } = await adminClient
      .from("stores")
      .select("id, store_name, franchise_id")
      .eq("id", requestedStoreId)
      .maybeSingle<{ id: string; store_name: string; franchise_id: string | null }>();

    if (error) {
      logFailure("stores.selected_lookup", error, requestedStoreId);
      return { success: false, error: "Failed to lookup store", details: error.message, status: 500 };
    }
    if (!data) {
      logMapping("selected_store_not_found");
      return {
        success: false,
        error: "선택한 매장을 찾을 수 없습니다.",
        code: "STORE_NOT_FOUND",
        status: 404,
      };
    }

    storeFromId = data;
    resolvedStoreName = data.store_name;
  }

  let requestedFranchiseId: string | null = null;
  // body의 franchiseId는 "실재하는 프랜차이즈인가"만 확인한다. 기존 매장의 브랜드는 이 값으로 정하지 않는다.
  let clientFranchiseId: string | null = null;

  if (franchiseId && !storeFromId) {
    const { data: chosenFranchise, error: chosenFranchiseError } = await adminClient
      .from("franchises")
      .select("id")
      .eq("id", franchiseId)
      .maybeSingle<{ id: string }>();

    if (chosenFranchiseError || !chosenFranchise) {
      if (chosenFranchiseError) logFailure("franchises.selected_lookup", chosenFranchiseError);
      logMapping("selected_franchise_not_found");
      return { success: false, error: "선택한 브랜드를 확인할 수 없습니다.", status: chosenFranchiseError ? 500 : 400 };
    }
    clientFranchiseId = chosenFranchise.id;
  }

  if (storeFromId) {
    // 기존 매장은 서버가 조회한 stores.franchise_id만 기준으로 삼는다.
    if (!storeFromId.franchise_id) {
      logMapping("selected_store_brand_missing", [storeFromId]);
      return {
        success: false,
        error: STORE_BRAND_UNRESOLVED_MESSAGE,
        code: "STORE_BRAND_UNKNOWN",
        status: 400,
      };
    }
    if (franchiseId && franchiseId !== storeFromId.franchise_id) {
      logMapping("client_brand_corrected_from_selected_store", [storeFromId], storeFromId.franchise_id);
    }
    requestedFranchiseId = storeFromId.franchise_id;
  } else if (resolvedStoreName) {
    // 같은 이름의 매장이 이미 있으면 그 행의 브랜드가 기준이다(이름 resolver나 body보다 우선한다).
    const { data: namedStores, error: namedStoresError } = await adminClient
      .from("stores")
      .select("id, store_name, franchise_id")
      .eq("store_name", resolvedStoreName);

    if (namedStoresError) {
      logFailure("stores.name_lookup", namedStoresError);
      return { success: false, error: "Failed to lookup store", details: namedStoresError.message, status: 500 };
    }

    let matchingStores = (namedStores ?? []) as { id: string; store_name: string; franchise_id: string | null }[];
    const normalizedName = normalizeStoreFranchiseName(resolvedStoreName);
    if (!matchingStores.length && normalizedName) {
      const namePattern = `%${Array.from(normalizedName).map((character) => character.replace(/[\\%_]/g, "\\$&")).join("%")}%`;
      const { data: candidates, error: normalizedLookupError } = await adminClient
        .from("stores")
        .select("id, store_name, franchise_id")
        .ilike("store_name", namePattern);

      if (normalizedLookupError) {
        logFailure("stores.normalized_name_lookup", normalizedLookupError);
        return { success: false, error: "매장 정보를 확인하지 못했습니다.", status: 500 };
      }
      matchingStores = ((candidates ?? []) as typeof matchingStores)
        .filter((store) => normalizeStoreFranchiseName(store.store_name) === normalizedName);
    }

    const existingBrands = [
      ...new Set(
        matchingStores
          .map((store) => store.franchise_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];

    if (matchingStores.length > 0) {
      if (existingBrands.length === 0 && !clientFranchiseId) {
        logMapping("named_store_brand_missing", matchingStores);
        return {
          success: false,
          error: STORE_BRAND_UNRESOLVED_MESSAGE,
          code: "STORE_BRAND_UNKNOWN",
          status: 400,
        };
      }
      if (clientFranchiseId) {
        requestedFranchiseId = clientFranchiseId;
      } else if (existingBrands.length === 1) {
        requestedFranchiseId = existingBrands[0];
      } else {
        const inferredFranchiseId = await resolveFranchiseIdForStoreName(adminClient, resolvedStoreName, { requestId, userId });
        if (!inferredFranchiseId || !existingBrands.includes(inferredFranchiseId)) {
          logMapping("named_store_brand_ambiguous", matchingStores, inferredFranchiseId);
          return {
            success: false,
            error: "같은 이름의 매장이 여러 브랜드에 있습니다. 브랜드 또는 매장을 다시 선택해 주세요.",
            code: "STORE_AMBIGUOUS",
            status: 409,
          };
        }
        requestedFranchiseId = inferredFranchiseId;
      }
    } else {
      // 같은 이름의 매장이 아직 없을 때만 기존 경로(클라이언트 선택 또는 매장명 resolver)를 쓴다.
      requestedFranchiseId = clientFranchiseId ?? (await resolveFranchiseIdForStoreName(adminClient, resolvedStoreName, { requestId, userId }));
      if (!requestedFranchiseId) {
        logMapping("franchise_unresolved");
        return {
          success: false,
          error: "프랜차이즈를 자동으로 확인할 수 없습니다.",
          details: "매장명을 확인하거나 프랜차이즈를 직접 선택해주세요.",
          status: 400,
        };
      }
    }

    const scopedStores = matchingStores.filter((store) => store.franchise_id === requestedFranchiseId);
    if (scopedStores.length > 1) {
      logMapping("named_store_identity_ambiguous", scopedStores, requestedFranchiseId);
      return {
        success: false,
        error: "같은 브랜드에 이름이 같은 매장이 여러 개 있습니다. 정확한 매장을 다시 선택해 주세요.",
        code: "STORE_AMBIGUOUS",
        status: 409,
      };
    }
    if (scopedStores[0]) {
      storeFromId = scopedStores[0];
      resolvedStoreName = storeFromId.store_name;
    } else if (role === "staff") {
      logMapping("store_not_found_in_selected_franchise", matchingStores, requestedFranchiseId);
      return {
        success: false,
        error: "선택한 브랜드에 등록된 매장을 찾을 수 없습니다. 매장 또는 브랜드를 다시 확인해 주세요.",
        code: "STORE_NOT_FOUND",
        status: 404,
      };
    } else if (matchingStores.length) {
      logMapping("owner_new_store_in_selected_franchise", matchingStores, requestedFranchiseId);
    }
  } else {
    return {
      success: false,
      error: "storeName is required",
      details: "매장명을 입력해주세요.",
      status: 400,
    };
  }

  // stores row 생성/조회
  diagnosticFranchiseId = requestedFranchiseId;
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
    logFailure("stores.identity_lookup", storeError);
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

    if (doubleCheckError && doubleCheckError.code !== "PGRST116") {
      logFailure("stores.concurrent_recheck", doubleCheckError);
      return { success: false, error: "매장 정보를 확인하지 못했습니다.", status: 500 };
    }

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
        logFailure("stores.insert", insertError);
        if (insertError.code !== "23505") {
          return {
            success: false,
            error: "매장 정보를 등록하는 중 오류가 발생했습니다.",
            details: insertError.message,
            status: 500,
          };
        }

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

        if (retryError) {
          logFailure("stores.insert_race_recheck", retryError);
          return {
            success: false,
            error: "매장 정보를 등록하는 중 오류가 발생했습니다.",
            details: retryError.message,
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
      code: "STORE_NOT_FOUND",
      status: 404,
    };
  }

  if (!finalStoreId) {
    logFailure("stores.resolve_final_id", new Error("Store ID unresolved"));
    return { success: false, error: "Unable to determine store ID", status: 500 };
  }

  const finalMembershipFranchiseId = requestedFranchiseId ?? finalFranchiseId;
  diagnosticFranchiseId = finalMembershipFranchiseId;

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
      .select("id, status, role, franchise_id")
      .eq("user_id", userId)
      .eq("store_id", finalStoreId)
      .single();

    if (lookupError && lookupError.code !== "PGRST116") {
      logFailure("membership.existing_lookup", lookupError, finalStoreId);
      return {
        success: false,
        error: "Failed to lookup existing membership",
        details: lookupError.message,
        status: 500,
      };
    }

    if (existingMembership) {
      if (existingMembership.role !== role) {
        console.error("[AUTH] STORE_MEMBERSHIP_ROLE_MISMATCH", {
          userId,
          storeId: finalStoreId,
          requestedRole: role,
          existingRole: existingMembership.role,
        });
        return {
          success: false,
          error: "이미 다른 역할로 등록된 매장 멤버십이 있습니다.",
          status: 409,
        };
      }

      if (existingMembership.franchise_id !== finalMembershipFranchiseId) {
        const { error: membershipBrandUpdateError } = await adminClient
          .from("store_memberships")
          .update({ franchise_id: finalMembershipFranchiseId })
          .eq("id", existingMembership.id)
          .eq("user_id", userId)
          .eq("store_id", finalStoreId);

        if (membershipBrandUpdateError) {
          logFailure("membership.franchise_sync", membershipBrandUpdateError, finalStoreId);
          return {
            success: false,
            error: "멤버십 브랜드 연결에 실패했습니다.",
            details: membershipBrandUpdateError.message,
            status: 500,
          };
        }
      }

      console.info("[STORE_MEMBERSHIP] existing_request_reused", {
        requestId,
        userRef: `…${userId.slice(-6)}`,
        storeRef: `…${finalStoreId.slice(-6)}`,
        role: existingMembership.role,
        status: existingMembership.status,
        franchiseRef: `…${finalMembershipFranchiseId.slice(-6)}`,
      });
      // 중복 row를 만들지 않고 기존 membership과 상태를 돌려준다.
      // created/membershipStatus는 가입·매장 추가 화면이 "이미 신청함" 안내를 고를 때 쓴다.
      return {
        success: true,
        membershipId: existingMembership.id,
        created: false,
        membershipStatus: existingMembership.status,
        status: 200,
      };
    }

    // 직원 신청은 그 매장의 점주가 승인한다. 승인된 점주가 없는 매장은 신청을 받을 사람이 없으므로
    // 새 신청을 만들지 않는다. (기존 membership은 위에서 그대로 반환되므로 영향 없음)
    if (role === "staff") {
      const { data: approvedOwners, error: ownerLookupError } = await adminClient
        .from("store_memberships")
        .select("id")
        .eq("store_id", finalStoreId)
        .eq("role", "owner")
        .eq("status", "approved")
        .limit(1);

      if (ownerLookupError) {
        logFailure("membership.approved_owner_lookup", ownerLookupError, finalStoreId);
        return {
          success: false,
          error: "Failed to verify store owner",
          details: ownerLookupError.message,
          status: 500,
        };
      }

      if (!approvedOwners || approvedOwners.length === 0) {
        return {
          success: false,
          error: "아직 점주가 등록되지 않은 매장이라 근무 신청을 할 수 없습니다.",
          details: "해당 매장의 점주가 일잇다에 등록된 뒤 다시 신청해 주세요.",
          code: "STORE_NO_OWNER",
          status: 409,
        };
      }
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
      logFailure("membership.insert", createError, finalStoreId);
      if (createError.code === "23505") {
        const { data: concurrentMembership, error: concurrentLookupError } = await adminClient
          .from("store_memberships")
          .select("id, status, role, franchise_id")
          .eq("user_id", userId)
          .eq("store_id", finalStoreId)
          .maybeSingle();

        if (concurrentLookupError) {
          logFailure("membership.duplicate_recovery_lookup", concurrentLookupError, finalStoreId);
          return { success: false, error: "멤버십 상태를 확인하지 못했습니다.", status: 500 };
        }
        if (concurrentMembership) {
          if (concurrentMembership.role !== role) {
            return { success: false, error: "이미 다른 역할로 등록된 매장 멤버십이 있습니다.", status: 409 };
          }
          console.info("[STORE_MEMBERSHIP] concurrent_request_reused", {
            requestId,
            role,
            status: concurrentMembership.status,
            storeRef: `…${finalStoreId.slice(-6)}`,
          });
          return {
            success: true,
            membershipId: concurrentMembership.id,
            created: false,
            membershipStatus: concurrentMembership.status,
            status: 200,
          };
        }
      }

      return {
        success: false,
        error: "Failed to create store membership",
        details: createError.message,
        status: 500,
      };
    }

    console.info("[STORE_MEMBERSHIP] request_created", {
      requestId,
      userRef: `…${userId.slice(-6)}`,
      storeRef: `…${finalStoreId.slice(-6)}`,
      franchiseRef: `…${finalMembershipFranchiseId.slice(-6)}`,
      role,
      status: "pending",
    });

    generateMembershipNotifications(userId, role, finalStoreId, resolvedStoreName || "", userName, requestId);

    return { success: true, membershipId: newMembership.id, created: true, membershipStatus: "pending", status: 200 };
  } catch (e) {
    logFailure("membership.unexpected_exception", e, finalStoreId);
    return { success: false, error: "Failed to create membership", details: String(e), status: 500 };
  }
}

/**
 * 점주 신청 알림 수신자: 신청 매장의 stores.franchise_id(서버 조회)에 속한 HQ auth 사용자만 돌려준다.
 * 브랜드를 확인할 수 없으면 빈 배열이다(전체 HQ에 보내지 않는다).
 */
export async function resolveOwnerRequestHqRecipientIds(
  adminClient: SupabaseClient,
  storeId: string,
): Promise<string[]> {
  const { data: store, error: storeError } = await adminClient
    .from("stores")
    .select("franchise_id")
    .eq("id", storeId)
    .maybeSingle<{ franchise_id: string | null }>();

  if (storeError) {
    logSafeAuthError("OWNER_REQUEST_NOTIFY_STORE_LOOKUP_FAILED", storeError);
    return [];
  }
  if (!store?.franchise_id) {
    logSafeAuthError("OWNER_REQUEST_NOTIFY_BRAND_UNRESOLVED", new Error("store franchise is missing"));
    return [];
  }

  const { data: hqProfiles, error: hqError } = await adminClient
    .from("profiles")
    .select("id, user_id")
    .eq("role", "hq")
    .eq("brand_id", store.franchise_id);

  if (hqError) {
    logSafeAuthError("OWNER_REQUEST_NOTIFY_HQ_LOOKUP_FAILED", hqError);
    return [];
  }

  // 한 HQ 사용자의 프로필 행이 여럿이어도 auth 사용자(user_id, 없으면 마스터 id) 기준으로 한 번만 보낸다.
  return [
    ...new Set(
      ((hqProfiles ?? []) as { id?: unknown; user_id?: unknown }[])
        .map((profile) => profile.user_id ?? profile.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
}

/**
 * Generate notifications for new membership requests
 * - Staff request: notify store owners
 * - Owner request: notify HQ users of the store's franchise only
 */
async function generateMembershipNotifications(
  userId: string,
  role: "owner" | "staff",
  storeId: string,
  storeName: string,
  userName: string,
  requestId: string,
): Promise<void> {
  let stage = "notifications.admin_client";
  try {
    const adminClient = createAdminClient();

    if (role === "staff") {
      stage = "notifications.approved_owner_lookup";
      const { data: ownerMemberships, error: queryError } = await adminClient
        .from("store_memberships")
        .select("user_id")
        .eq("store_id", storeId)
        .eq("role", "owner")
        .eq("status", "approved");

      if (queryError) {
        logDiagnosticError("STORE_MEMBERSHIP", stage, queryError, {
          requestId,
          userId,
          userName,
          role,
          storeId,
          storeName,
          sessionPresent: true,
        });
        return;
      }

      if (ownerMemberships && ownerMemberships.length > 0) {
        for (const membership of ownerMemberships) {
          stage = "notifications.staff_owner_pending_approval";
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
      stage = "notifications.hq_recipient_lookup";
      const hqRecipientIds = await resolveOwnerRequestHqRecipientIds(adminClient, storeId);

      for (const recipientUserId of hqRecipientIds) {
        stage = "notifications.hq_owner_pending_approval";
        await createNotification({
          recipientUserId,
          type: "owner_pending_approval",
          title: "새로운 점주 승인 요청",
          message: `${storeName} 점주 가입 요청이 있습니다. (${userName})`,
          targetUrl: "/hq/approvals",
          relatedId: userId,
        });
      }
    }
  } catch (e) {
    logDiagnosticError("STORE_MEMBERSHIP", stage, e, {
      requestId,
      userId,
      userName,
      role,
      storeId,
      storeName,
      sessionPresent: true,
    });
  }
}
