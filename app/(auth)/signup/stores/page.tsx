"use client";

import React, { useState, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Search, MapPin, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import type { UserRole } from "@/lib/types/user";
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
  const [selectedStores, setSelectedStores] = useState<SelectedStore[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
    if (!savedRole) {
      router.push("/signup/role");
      return;
    }
    if (savedRole === "hq") {
      // HQ는 organization으로
      router.push("/signup/organization");
      return;
    }
    setRole(savedRole);
    setMounted(true);
  }, [router]);

  if (!mounted) {
    return null;
  }

  // 검색 필터링
  const filteredStores = (mockStores as unknown as any[]).filter((store) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      store.brandName?.toLowerCase().includes(query) ||
      store.name?.toLowerCase().includes(query) ||
      store.address?.toLowerCase().includes(query)
    );
  });

  // 매장 추가/제거
  const toggleStore = (store: any) => {
    const storeId = store.id;
    const alreadySelected = selectedStores.find((s) => s.storeId === storeId);

    if (alreadySelected) {
      setSelectedStores(selectedStores.filter((s) => s.storeId !== storeId));
    } else {
      // 새로운 매장 추가
      const newStore: SelectedStore = {
        storeId: store.id,
        franchiseName: store.brandName,
        storeName: store.name,
        address: store.address,
      };
      setSelectedStores([...selectedStores, newStore]);
    }
  };

  const removeStore = (storeId: string) => {
    setSelectedStores(selectedStores.filter((s) => s.storeId !== storeId));
  };

  const handleContinue = async () => {
    if (selectedStores.length === 0) return;

    setIsLoading(true);
    setTimeout(() => {
      sessionStorage.setItem("signupStores", JSON.stringify(selectedStores));
      setIsLoading(false);
      router.push("/signup/verification");
    }, 800);
  };

  const handlePrevious = () => {
    router.push("/signup/profile");
  };

  // 진행 단계 (점주/직원: 4 / 6)
  const currentStep = 4;
  const totalSteps = 6;

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <div className="flex flex-col min-h-screen">
        {/* Header */}
        <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
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
                className="w-[76px] sm:w-[88px] lg:w-[100px] h-auto object-contain"
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
          <div className="w-full max-w-5xl mx-auto">
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

            {/* Search Bar */}
            <div className="mb-8">
              <div className="relative">
                <Search
                  size={20}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
                />
                <input
                  type="text"
                  placeholder="매장명, 지점명 또는 주소를 검색해주세요"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-14 pl-12 pr-5 rounded-lg border-2 border-[var(--color-border)] bg-white text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/30 transition-colors"
                />
              </div>
            </div>

            {/* Map Area (Mock) */}
            <div className="mb-8 bg-white border border-[var(--color-border)] rounded-lg overflow-hidden">
              <div className="w-full h-96 sm:h-[480px] bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center relative">
                {/* Mock Map with Store Markers */}
                <svg className="w-full h-full" viewBox="0 0 800 400">
                  {/* Map background */}
                  <rect width="800" height="400" fill="#f3f4f6" />

                  {/* Grid */}
                  <g stroke="#e5e7eb" strokeWidth="1" opacity="0.5">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <line
                        key={`v-${i}`}
                        x1={i * 100}
                        y1="0"
                        x2={i * 100}
                        y2="400"
                      />
                    ))}
                    {Array.from({ length: 4 }).map((_, i) => (
                      <line
                        key={`h-${i}`}
                        x1="0"
                        y1={i * 100}
                        x2="800"
                        y2={i * 100}
                      />
                    ))}
                  </g>

                  {/* Store Markers */}
                  {filteredStores.slice(0, 8).map((store, idx) => {
                    const isSelected = selectedStores.some(
                      (s) => s.storeId === store.id
                    );
                    const x = 100 + (idx % 4) * 150 + Math.random() * 50;
                    const y = 80 + Math.floor(idx / 4) * 150 + Math.random() * 50;

                    return (
                      <g key={store.id}>
                        {/* Marker Pin */}
                        <circle
                          cx={x}
                          cy={y}
                          r={isSelected ? 12 : 8}
                          fill={
                            isSelected
                              ? "var(--color-primary)"
                              : "var(--color-primary-light)"
                          }
                          stroke="white"
                          strokeWidth="2"
                          style={{cursor: "pointer"}}
                          onClick={() => toggleStore(store)}
                        />
                        {isSelected && (
                          <circle
                            cx={x}
                            cy={y}
                            r="16"
                            fill="none"
                            stroke="var(--color-primary)"
                            strokeWidth="1"
                            opacity="0.3"
                          />
                        )}
                      </g>
                    );
                  })}

                  {/* Map Label */}
                  <text
                    x="400"
                    y="20"
                    textAnchor="middle"
                    fontSize="14"
                    fill="#9ca3af"
                    fontWeight="500"
                  >
                    지도 뷰 (매장 위치 표시)
                  </text>
                </svg>

                {/* Map Overlay Info */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="text-center text-[var(--color-text-secondary)] bg-white/80 backdrop-blur px-4 py-2 rounded-lg">
                    <p className="text-sm font-medium">
                      검색 결과: {filteredStores.length}개 매장
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Store List Section */}
            <div className="mb-8">
              <h2 className="text-lg sm:text-xl font-bold text-[var(--color-text-primary)] mb-4">
                {filteredStores.length > 0
                  ? `검색 결과 (${filteredStores.length}개)`
                  : "검색 결과 없음"}
              </h2>

              {filteredStores.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  {filteredStores.map((store) => {
                    const isSelected = selectedStores.some(
                      (s) => s.storeId === store.id
                    );
                    return (
                      <div
                        key={store.id}
                        onClick={() => toggleStore(store)}
                        className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                          isSelected
                            ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/10 shadow-md"
                            : "border-[var(--color-border)] bg-white hover:border-[var(--color-primary)] hover:shadow-sm"
                        }`}
                      >
                        <div className="flex gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="h-5 w-5 mt-0.5 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                                  [{store.brandName}]
                                </p>
                                <h3 className="font-semibold text-[var(--color-text-primary)] mb-1">
                                  {store.name}
                                </h3>
                                <p className="text-sm text-[var(--color-text-tertiary)] flex items-center gap-1">
                                  <MapPin size={14} />
                                  {store.address}
                                </p>
                              </div>
                              {isSelected && (
                                <div className="flex-shrink-0 text-[var(--color-primary)]">
                                  ✓
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-8 text-center bg-[var(--color-bg-surface)] rounded-lg border border-[var(--color-border)]">
                  <p className="text-[var(--color-text-secondary)]">
                    검색 결과가 없습니다.
                  </p>
                </div>
              )}
            </div>

            {/* Selected Stores Section */}
            {selectedStores.length > 0 && (
              <div className="mb-8">
                <h2 className="text-lg sm:text-xl font-bold text-[var(--color-text-primary)] mb-4">
                  선택한 매장 {selectedStores.length}
                </h2>

                <div className="space-y-3 mb-6">
                  {selectedStores.map((store) => (
                    <div
                      key={store.storeId}
                      className="flex items-center justify-between p-4 bg-white border border-[var(--color-border)] rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                          [{store.franchiseName}]
                        </p>
                        <p className="font-semibold text-[var(--color-text-primary)]">
                          {store.storeName}
                        </p>
                        <p className="text-sm text-[var(--color-text-tertiary)]">
                          {store.address}
                        </p>
                      </div>
                      <button
                        onClick={() => removeStore(store.storeId)}
                        className="ml-4 flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full hover:bg-red-100 transition-colors"
                        title="제거"
                      >
                        <X
                          size={20}
                          className="text-red-600 hover:text-red-700"
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Button Group */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={handlePrevious}
                className="w-full sm:w-auto"
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
                className="w-full sm:w-auto"
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
