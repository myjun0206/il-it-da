import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveFranchiseIdForStoreName } from "@/lib/supabase/resolve-store-franchise";

export const runtime = "nodejs";

interface CreateMembershipRequest {
  storeId?: string;
  storeName?: string;
  role: "owner" | "staff";
  franchiseId?: string;
}

interface CreateMembershipResponse {
  success: boolean;
  membershipId?: string;
  error?: string;
  details?: string;
}

interface MembershipWithStore {
  membershipId: string;
  storeId: string;
  storeName: string;
  role: "owner" | "staff";
  status: "pending" | "approved" | "rejected";
  requestedAt?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // 현재 인증된 사용자 확보
    const serverClient = await createClient();
    const { data: { user }, error: userError } = await serverClient.auth.getUser();

    if (userError || !user) {
      console.log("[GET /api/signup/store-membership] Unauthorized - userError:", userError?.message);
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = user.id;
    console.log("[GET /api/signup/store-membership] Authenticated user:", {
      email: user.email,
      userId: userId,
    });

    const adminClient = createAdminClient();

    // 사용자의 모든 membership을 조회한다. 승인 상태 화면과 역할별 화면이 필요한 상태만 필터링한다.
    const { data: memberships, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("*")
      .eq("user_id", userId);

    if (membershipError) {
      console.error("[GET /api/signup/store-membership] Failed to fetch memberships:", membershipError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch memberships" },
        { status: 500 }
      );
    }

    console.log("[GET /api/signup/store-membership] Memberships found:", memberships?.length || 0);
    if (memberships && memberships.length > 0) {
      memberships.forEach((m, idx) => {
        console.log(`  [${idx}] membershipId=${m.id}, user_id=${m.user_id}, store_id=${m.store_id}, status=${m.status}, role=${m.role}`);
      });
    }

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    // membership의 store_id 목록으로 stores 정보 조회
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeIds = [...new Set((memberships as any[]).map((m: any) => m.store_id).filter(Boolean))];

    if (storeIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    const { data: stores, error: storeError } = await adminClient
      .from("stores")
      .select("id, store_name")
      .in("id", storeIds);

    if (storeError) {
      console.error("Failed to fetch stores:", storeError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch stores" },
        { status: 500 }
      );
    }

    // store_id → store_name 맵 생성
    const storeMap = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stores?.map((s: any) => [s.id, s.store_name]) || []
    );

    // membership과 store 정보 결합
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: MembershipWithStore[] = (memberships as any[]).map((m: any) => ({
      membershipId: m.id,
      storeId: m.store_id,
      storeName: storeMap.get(m.store_id) || "Unknown Store",
      role: m.role,
      status: m.status,
      requestedAt: m.requested_at,
    }));

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("GET /api/signup/store-membership error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<CreateMembershipResponse>> {
  try {
    // 요청 본문 파싱
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { storeId, storeName, role, franchiseId } = body as CreateMembershipRequest;

    if (!role || (role !== "owner" && role !== "staff")) {
      return NextResponse.json(
        { success: false, error: "role must be 'owner' or 'staff'" },
        { status: 400 }
      );
    }

    // 서버에서 현재 인증된 사용자를 직접 가져옴 (클라이언트 userId 신뢰 안 함)
    const serverClient = await createClient();
    const { data: { user }, error: userError } = await serverClient.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: No authenticated user" },
        { status: 401 }
      );
    }

    const userId = user.id;

    const adminClient = createAdminClient();
    const { data: authorizedProfile, error: authorizedProfileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle<{ role: string }>();

    if (authorizedProfileError) {
      return NextResponse.json(
        { success: false, error: "Unable to verify authenticated profile" },
        { status: 500 }
      );
    }

    const hasSocialIdentity = user.identities?.some(
      (identity) => identity.provider === "google" || identity.provider === "kakao",
    );
    const isEmailSignup = user.app_metadata?.provider === "email" && !hasSocialIdentity;
    const canCreateInitialEmailProfile =
      !authorizedProfile && isEmailSignup && user.user_metadata?.role === role;

    if (authorizedProfile?.role !== role && !canCreateInitialEmailProfile) {
      return NextResponse.json(
        { success: false, error: "Forbidden: role does not match authenticated profile" },
        { status: 403 }
      );
    }

    // 1. profiles row 생성 또는 업데이트 (full_name이 없으면 채우기)
    try {
      // 선택한 role이 'owner' 또는 'staff'인지 다시 확인
      const profileRole = role === "owner" ? "owner" : "staff";

      // auth user metadata에서 name 가져오기 (fallback: email)
      const userName = user.user_metadata?.name || user.email || "Unknown User";

      const { error: profileError } = await adminClient
        .from("profiles")
        .insert({
          id: userId,
          role: profileRole,
          full_name: userName,
        });

      // 중복 PK 에러: 기존 profile이 있음
      if (profileError && profileError.code === "23505") {
        // 기존 profile 조회
        const { data: existingProfile, error: fetchError } = await adminClient
          .from("profiles")
          .select("full_name")
          .eq("id", userId)
          .single();

        if (!fetchError && existingProfile && !existingProfile.full_name) {
          // full_name이 NULL이면 업데이트
          const { error: updateError } = await adminClient
            .from("profiles")
            .update({ full_name: userName })
            .eq("id", userId);

          if (updateError) {
            console.error("Profile update error:", updateError);
            return NextResponse.json(
              {
                success: false,
                error: "Failed to update profile",
                details: updateError.message,
              },
              { status: 500 }
            );
          }
        }
        // full_name이 이미 있으면 그냥 스킵 (기존 값 유지)
      } else if (profileError) {
        // 다른 에러
        console.error("Profile creation error:", profileError);
        return NextResponse.json(
          {
            success: false,
            error: "Failed to create profile",
            details: profileError.message,
          },
          { status: 500 }
        );
      }
    } catch (e) {
      console.error("Profile creation exception:", e);
      return NextResponse.json(
        { success: false, error: "Failed to create profile", details: String(e) },
        { status: 500 }
      );
    }

    // 2. stores row 생성/조회
    let finalStoreId: string | null = null;
    // 매장이 속한 브랜드(franchise_id). 기존 매장이면 DB에 저장된 값을 그대로 쓰고,
    // 신규 매장이면 매장명으로 franchises를 자동 매칭한다 (클라이언트가 보낸 브랜드명은 신뢰하지 않는다).
    let finalFranchiseId: string | null = null;

    if (storeId || storeName) {
      // Diagnostic: 요청 파라미터 로그
      console.log("[POST /api/signup/store-membership] Store lookup requested:", {
        storeId,
        storeName,
        role,
        userId,
      });

      // 기존 stores에서 조회 (storeName으로 찾기)
      const { data: existingStore, error: storeError } = await adminClient
        .from("stores")
        .select("id, franchise_id")
        .eq("store_name", storeName)
        .single();

      if (storeError && storeError.code !== "PGRST116") {
        console.error("[POST /api/signup/store-membership] Store lookup error:", storeError);
        return NextResponse.json(
          {
            success: false,
            error: "Failed to lookup store",
            details: storeError.message,
          },
          { status: 500 }
        );
      }

      if (existingStore) {
        // 기존 store 찾음 - 소속 브랜드는 DB에 저장된 franchise_id를 우선 사용하되,
        // 마이그레이션 이전에 생성된 매장 등 franchise_id가 비어있으면 매장명으로 다시 자동 매칭해 채워 넣는다.
        // (채워두지 않으면 이 매장의 승인 요청이 어느 HQ 승인 큐에도 걸리지 않게 된다.)
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

        console.log("[POST /api/signup/store-membership] Found existing store:", {
          storeName,
          storeId: finalStoreId,
          franchiseId: finalFranchiseId,
        });
      } else {
        // 기존 store 없음
        console.log("[POST /api/signup/store-membership] Store not found:", {
          storeName,
          role,
        });

        if (role === "owner") {
          // Owner: 새로운 store 생성
          console.log("[POST /api/signup/store-membership] Creating new store for owner");

          // 매장명으로 소속 브랜드를 자동 인식한다 (예: "버거킹 종로구청점" -> 버거킹).
          const autoDetectedFranchiseId = await resolveFranchiseIdForStoreName(adminClient, storeName!);

          // UPSERT를 사용하거나 먼저 다시 조회 (race condition 방지)
          // 방법: 먼저 다시 확인
          const { data: doubleCheckStore, error: doubleCheckError } = await adminClient
            .from("stores")
            .select("id, franchise_id")
            .eq("store_name", storeName)
            .single();

          if (doubleCheckError && doubleCheckError.code === "PGRST116") {
            // 정말 없음 - INSERT
            const { data: newStore, error: insertError } = await adminClient
              .from("stores")
              .insert({
                store_name: storeName,
                franchise_id: autoDetectedFranchiseId,
                // id, created_at은 defaults로 자동 생성
                // boss_id는 선택사항 (NULL 허용)
              })
              .select("id, franchise_id")
              .single();

            if (insertError) {
              // 상세 오류 로그 (개발환경용)
              console.error("[POST /api/signup/store-membership] Store INSERT failed:", {
                code: insertError.code,
                message: insertError.message,
                details: insertError.details,
                hint: insertError.hint,
                storeName,
              });

              // 동시성으로 다른 요청이 생성했을 수 있음
              // 한 번 더 조회
              const { data: retryStore, error: retryError } = await adminClient
                .from("stores")
                .select("id, franchise_id")
                .eq("store_name", storeName)
                .single();

              if (retryError && retryError.code === "PGRST116") {
                // 정말 생성 실패
                console.error(
                  "[POST /api/signup/store-membership] Store creation failed (retry also failed):",
                  insertError
                );
                return NextResponse.json(
                  {
                    success: false,
                    error: "매장 정보를 등록하는 중 오류가 발생했습니다.",
                    details: insertError.message,
                  },
                  { status: 500 }
                );
              }

              if (retryStore) {
                // 다시 조회하니 있음 (다른 요청이 생성함)
                finalStoreId = retryStore.id;
                finalFranchiseId = retryStore.franchise_id;
                console.log(
                  "[POST /api/signup/store-membership] Store created by concurrent request:",
                  { storeName, storeId: finalStoreId, franchiseId: finalFranchiseId }
                );
              }
            } else {
              // 성공
              finalStoreId = newStore.id;
              finalFranchiseId = newStore.franchise_id;
              console.log("[POST /api/signup/store-membership] New store created:", {
                storeName,
                storeId: finalStoreId,
                franchiseId: finalFranchiseId,
              });
            }
          } else if (!doubleCheckError && doubleCheckStore) {
            // 다시 확인하니 있음 (다른 요청이 생성함)
            finalStoreId = doubleCheckStore.id;
            finalFranchiseId = doubleCheckStore.franchise_id;
            console.log(
              "[POST /api/signup/store-membership] Store already exists (created by concurrent request):",
              { storeName, storeId: finalStoreId, franchiseId: finalFranchiseId }
            );
          }
        } else {
          // Staff: 새로운 store 생성 금지
          console.log(
            "[POST /api/signup/store-membership] Staff cannot request new store"
          );
          return NextResponse.json(
            {
              success: false,
              error: "선택한 매장을 찾을 수 없습니다.",
              details: `Store with name "${storeName}" not found. Staff must select an existing store.`,
            },
            { status: 404 }
          );
        }
      }
    } else {
      return NextResponse.json(
        {
          success: false,
          error: "storeName is required",
          details: "매장 정보가 필요합니다.",
        },
        { status: 400 }
      );
    }

    if (!finalStoreId) {
      console.error("[POST /api/signup/store-membership] Failed to determine finalStoreId");
      return NextResponse.json(
        { success: false, error: "Unable to determine store ID" },
        { status: 500 }
      );
    }

    // 승인 화면 브랜드 드롭다운에서 사용자가 직접 고른 franchiseId가 있으면, 실존하는 프랜차이즈인지
    // 검증한 뒤 이 요청의 franchise_id로 우선 사용한다(자동 인식이 틀렸을 때의 수동 보정 용도).
    let finalMembershipFranchiseId = finalFranchiseId;
    if (franchiseId) {
      const { data: chosenFranchise } = await adminClient
        .from("franchises")
        .select("id")
        .eq("id", franchiseId)
        .maybeSingle();

      if (chosenFranchise) {
        finalMembershipFranchiseId = chosenFranchise.id;
      }
    }

    // 3. store_memberships row 생성 (중복 확인)
    try {
      // 기존 membership 확인
      const { data: existingMembership, error: lookupError } = await adminClient
        .from("store_memberships")
        .select("id, status")
        .eq("user_id", userId)
        .eq("store_id", finalStoreId)
        .single();

      if (lookupError && lookupError.code !== "PGRST116") {
        console.error("Membership lookup error:", lookupError);
        return NextResponse.json(
          {
            success: false,
            error: "Failed to lookup existing membership",
            details: lookupError.message,
          },
          { status: 500 }
        );
      }

      if (existingMembership) {
        // 이미 존재하면 기존 membership ID 반환
        return NextResponse.json({
          success: true,
          membershipId: existingMembership.id,
        });
      }

      // 새로운 membership 생성 (franchise_id는 매장 조회/생성 시 자동 인식된 값 또는 사용자가 선택한 값)
      const { data: newMembership, error: createError } = await adminClient
        .from("store_memberships")
        .insert({
          user_id: userId,
          store_id: finalStoreId,
          franchise_id: finalMembershipFranchiseId,
          role: role,
          status: "pending",
          requested_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (createError) {
        console.error("Membership creation error:", createError);
        return NextResponse.json(
          {
            success: false,
            error: "Failed to create store membership",
            details: createError.message,
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        membershipId: newMembership.id,
      });
    } catch (e) {
      console.error("Membership creation exception:", e);
      return NextResponse.json(
        { success: false, error: "Failed to create membership", details: String(e) },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Unexpected error in POST /api/signup/store-membership:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected error", details: String(error) },
      { status: 500 }
    );
  }
}
