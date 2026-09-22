"use client";

import React, { useState, useLayoutEffect, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/common/Button";
import StoreSearchDropdown from "@/components/signup/StoreSearchDropdown";
import StoreMap from "@/components/signup/StoreMap";
import SelectedStoreDisplay from "@/components/signup/SelectedStoreDisplay";
import type { UserRole } from "@/lib/types/user";
import type { Store } from "@/lib/types/store";
import { mockStores } from "@/lib/data/mockStores";

export interface SelectedStore {
  storeId: string;
  franchiseName: string;
  storeName: string;
  address: string;
}

export default function SignupStoresPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStores, setSelectedStores] = useState<Store[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAddMode, setIsAddMode] = useState(false);

  useLayoutEffect(() => {
    const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
    if (!savedRole) {
      console.log("[SIGNUP_STEP4] Redirecting: signupRole is missing");
      router.push("/signup/role");
      return;
    }
    if (savedRole === "hq") {
      // HQ는 organization으로
      console.log("[SIGNUP_STEP4] Redirecting: HQ role should use organization flow");
      router.push("/signup/organization");
      return;
    }
  }, [router]);

  useEffect(() => {
    const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
    if (!savedRole) return;

    const profileData = sessionStorage.getItem("signupProfile");
    console.log("[SIGNUP_STEP4] Loaded profile:", profileData);

    if (!profileData) {
      console.log("[SIGNUP_STEP4] Redirecting: signupProfile is missing");
      router.replace("/signup/profile");
      return;
    }

    try {
      const parsedProfile = JSON.parse(profileData) as { email?: unknown; name?: unknown; phone?: unknown };
      if (
        typeof parsedProfile.email !== "string" ||
        typeof parsedProfile.name !== "string" ||
        typeof parsedProfile.phone !== "string"
      ) {
        console.log("[SIGNUP_STEP4] Redirecting: signupProfile is invalid", parsedProfile);
        router.replace("/signup/profile");
        return;
      }
    } catch (error) {
      console.log("[SIGNUP_STEP4] Redirecting: failed to parse signupProfile", error);
      router.replace("/signup/profile");
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRole(savedRole);

    // query parameter 확인 (add mode인지 여부)
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    if (mode === "add") {
      setIsAddMode(true);
    }

    // 이전에 선택한 매장들 복원 (우선순위: signupSelectedStores > signupStores)
    // signupSelectedStores: Store[] 형식 (API 결과 또는 돌아올 때)
    // signupStores: SelectedStore[] 형식 (서버 저장 형식)
    let restoredStores: Store[] = [];
    
    const savedSelectedStores = sessionStorage.getItem("signupSelectedStores");
    if (savedSelectedStores) {
      try {
        const parsed = JSON.parse(savedSelectedStores) as Store[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          restoredStores = parsed;
        }
      } catch (e) {
        console.error("Failed to parse signupSelectedStores:", e);
      }
    }

    // signupSelectedStores가 없으면, signupStores에서 복원 시도 (mockStores 매칭)
    if (restoredStores.length === 0) {
      const savedStores = sessionStorage.getItem("signupStores");
      if (savedStores) {
        try {
          const parsed = JSON.parse(savedStores) as SelectedStore[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            restoredStores = parsed
              .map((item) => {
                const foundStore = mockStores.find((s) => s.id === item.storeId);
                return foundStore;
              })
              .filter((s): s is Store => Boolean(s));
          }
        } catch (e) {
          console.error("Failed to parse signupStores:", e);
        }
      }
    }

    if (restoredStores.length > 0) {
      setSelectedStores(restoredStores);
    }
  }, [router]);

  if (!role) {
    return null;
  }

  // 매장 선택 핸들러 (중복 방지)
  const handleStoreSelect = (store: Store) => {
    // 이미 선택된 매장인지 확인
    if (selectedStores.some((s) => s.id === store.id)) {
      return; // 이미 선택되어 있으면 추가하지 않음
    }

    // 새로운 매장 추가
    setSelectedStores((prev) => [...prev, store]);
    // 검색창 비우기
    setSearchQuery("");
  };

  // 매장 삭제
  const handleRemoveStore = (storeId: string) => {
    setSelectedStores((prev) => prev.filter((s) => s.id !== storeId));
  };

  // 다음 단계로 진행
  const handleContinue = async () => {
    if (selectedStores.length === 0) return;

    setIsLoading(true);
    setTimeout(() => {
      // 배열 형태로 저장 (복수 매장 대응)
      const storeDataArray: SelectedStore[] = selectedStores.map((store) => ({
        storeId: store.id,
        franchiseName: store.brandName,
        storeName: store.name,
        address: store.address,
      }));
      sessionStorage.setItem("signupStores", JSON.stringify(storeDataArray));
      setIsLoading(false);
      // 선택한 Store 객체들도 sessionStorage에 저장 (approval 페이지에서 사용)
      sessionStorage.setItem("signupSelectedStores", JSON.stringify(selectedStores));
      router.push("/signup/approval");
    }, 800);
  };

  const handlePrevious = () => {
    // add mode에서는 approval 페이지로 직접 돌아가기
    if (isAddMode) {
      router.push("/signup/approval");
    } else {
      router.push("/signup/profile");
    }
  };

  // 진행 단계 (점주/직원: 4 / 5)
  const currentStep = 4;
  const totalSteps = 5;

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <div className="flex flex-col min-h-screen">
        {/* Header */}
        <header className="relative border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
          <div className="flex items-center justify-between px-5 sm:px-8 lg:px-12 xl:px-16 h-16 lg:h-[68px]">
            <button
              onClick={handlePrevious}
              className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors flex-shrink-0 bg-none border-none cursor-pointer"
            >
              <ChevronLeft size={24} className="flex-shrink-0" />
              <span className="text-base sm:text-lg lg:text-[17px] font-semibold hidden sm:inline">
                이전
              </span>
              <span className="text-base font-semibold sm:hidden">이전</span>
            </button>

            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex-shrink-0">
              <img
                src="/logo/ilitda-wordmark.png"
                alt="일잇다"
                className="h-8 sm:h-9 w-auto object-contain"
              />
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <span className="text-base sm:text-lg lg:text-[17px] font-semibold text-[var(--color-text-secondary)]">
                {currentStep} / {totalSteps}
              </span>
              <div className="w-20 sm:w-28 h-2 bg-[var(--color-border-light)] rounded-full overflow-hidden flex-shrink-0">
                <div
                  className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-300"
                  style={{ width: `${(currentStep / totalSteps) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex-1 flex flex-col px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="w-full max-w-6xl mx-auto">
            {/* Title Section */}
            <div className="mb-6 sm:mb-8">
              <h1 className="text-3xl sm:text-4xl font-bold text-[var(--color-text-primary)] mb-2">
                매장을 선택해주세요
              </h1>
              <p className="text-base sm:text-lg text-[var(--color-text-secondary)]">
                {role === "owner"
                  ? "운영 중인 매장을 검색해 선택해주세요."
                  : "근무 중인 매장을 검색해 선택해주세요."}
              </p>
            </div>

            {/* Search Bar with Dropdown */}
            <div className="mb-8">
              <StoreSearchDropdown
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onStoreSelect={handleStoreSelect}
                selectedStoreIds={selectedStores.map((s) => s.id)}
              />
            </div>

            {/* Map + Selected Store 2-Column Layout */}
            <div className="mb-8 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-stretch">
              {/* Left Panel: Selected Stores Display */}
              <SelectedStoreDisplay
                selectedStores={selectedStores}
                onRemoveStore={handleRemoveStore}
              />

              {/* Right Panel: Map */}
              <div className="h-[400px] rounded-lg overflow-hidden border border-[var(--color-border)]">
                <StoreMap
                  stores={selectedStores}
                  selectedStoreIds={selectedStores.map((s) => s.id)}
                  onStoreSelect={handleStoreSelect}
                  centerStore={selectedStores[0] || undefined}
                />
              </div>
            </div>

            {/* Button Group */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={handlePrevious}
                className="w-full sm:w-48"
              >
                <ChevronLeft size={18} />
                이전
              </Button>
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={handleContinue}
                disabled={selectedStores.length === 0 || isLoading}
                className="w-full sm:w-48"
              >
                {isLoading ? "처리 중..." : "다음"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
