"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ArrowRight, MapPin, Users } from "lucide-react";
import { Button } from "@/components/common/Button";
import { Card } from "@/components/common/Card";
import { Input } from "@/components/common/Input";
import type { UserRole } from "@/lib/types/user";
import { mockStores } from "@/lib/data/mockStores";

export default function SignupStoresPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const savedRole = sessionStorage.getItem("signupRole") as UserRole | null;
    if (!savedRole) {
      router.push("/signup/role");
    } else {
      setRole(savedRole);
    }
  }, [router]);

  const filteredStores = mockStores.filter((store) =>
    store.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    store.address.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleStore = (storeId: string) => {
    const newSelected = new Set(selectedStores);
    if (newSelected.has(storeId)) {
      newSelected.delete(storeId);
    } else {
      newSelected.add(storeId);
    }
    setSelectedStores(newSelected);
  };

  const handleContinue = async () => {
    if (selectedStores.size === 0) return;

    setIsLoading(true);
    setTimeout(() => {
      sessionStorage.setItem(
        "signupStores",
        JSON.stringify(Array.from(selectedStores))
      );
      setIsLoading(false);
      router.push("/signup/verification");
    }, 800);
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      <div className="flex flex-col min-h-screen">
        {/* Header */}
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <Link
              href={role === "hq" ? "/signup/organization" : "/signup/terms"}
              className="flex items-center gap-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <ChevronLeft size={20} />
              <span className="text-sm font-medium">이전</span>
            </Link>
            <div className="text-sm text-[var(--color-text-tertiary)]">
              {role === "hq" ? "5단계" : "4단계"} / 6단계
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
          <div className="w-full max-w-4xl">
            <Card className="mb-8" padding="lg">
              {/* Title */}
              <div className="mb-6">
                <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">
                  매장 선택
                </h1>
                <p className="text-[var(--color-text-secondary)]">
                  일할 매장을 선택해주세요. 여러 매장을 선택할 수 있습니다.
                </p>
              </div>

              {/* Search */}
              <Input
                placeholder="매장명 또는 주소로 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </Card>

            {/* Stores List */}
            <div className="space-y-3 mb-8">
              {filteredStores.length > 0 ? (
                filteredStores.map((store) => (
                  <Card
                    key={store.id}
                    onClick={() => toggleStore(store.id)}
                    padding="md"
                    className={`cursor-pointer transition-all ${
                      selectedStores.has(store.id)
                        ? "ring-2 ring-[var(--color-primary)] shadow-lg"
                        : "hover:shadow-md"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <input
                        type="checkbox"
                        checked={selectedStores.has(store.id)}
                        onChange={() => toggleStore(store.id)}
                        className="h-5 w-5 mt-1 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold text-[var(--color-text-primary)]">
                              {store.name}
                            </h3>
                            <p className="text-sm text-[var(--color-text-secondary)] mt-1 flex items-center gap-1">
                              <MapPin size={14} />
                              {store.address}
                            </p>
                          </div>
                          {selectedStores.has(store.id) && (
                            <div className="flex-shrink-0">
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-primary)]">
                                <span className="text-white text-sm font-bold">
                                  ✓
                                </span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Store Info */}
                        <div className="mt-3 flex gap-4 text-xs text-[var(--color-text-tertiary)]">
                          <span className="flex items-center gap-1">
                            <Users size={12} />
                            직원 {store.memberCount}명
                          </span>
                          <span>매뉴얼 {store.manualCount}개</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))
              ) : (
                <Card padding="lg" border={false} shadow={false}>
                  <p className="text-center text-[var(--color-text-secondary)]">
                    검색 결과가 없습니다.
                  </p>
                </Card>
              )}
            </div>

            {/* Summary */}
            <div className="mb-8 p-4 bg-[var(--color-primary-light)] rounded-lg">
              <p className="text-sm text-[var(--color-text-primary)]">
                <span className="font-semibold">선택된 매장:</span> {selectedStores.size}
                개
              </p>
            </div>

            {/* Button Group */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() =>
                  router.push(
                    role === "hq" ? "/signup/organization" : "/signup/terms"
                  )
                }
                className="w-full sm:w-auto"
              >
                <ChevronLeft size={18} />
                이전
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleContinue}
                disabled={selectedStores.size === 0}
                isLoading={isLoading}
                className="w-full sm:w-auto"
              >
                다음
                <ArrowRight size={18} />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
