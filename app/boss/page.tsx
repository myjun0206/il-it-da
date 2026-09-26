"use client";

import React, { useLayoutEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Users,
  Sparkles,
  ChevronDown,
  UploadCloud,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import OwnerSidebar from "@/components/owner/OwnerSidebar";
import OwnerHeader from "@/components/owner/OwnerHeader";
import { Button } from "@/components/common/Button";

type UploadState = "idle" | "loading" | "success" | "error";

interface ApprovedStore {
  membershipId: string;
  storeId: string;
  storeName: string;
  role: string;
  status: string;
}

export default function OwnerDashboardPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [userName, setUserName] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [selectedStoreName, setSelectedStoreName] = useState("");
  const [approvedStores, setApprovedStores] = useState<ApprovedStore[]>([]);
  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false);

  // RAG upload states
  const [guideText, setGuideText] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadMessage, setUploadMessage] = useState("");

  // Authorization & Data Loading
  useLayoutEffect(() => {
    const checkAuthAndInit = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getUser();

        if (error || !data.user) {
          router.push("/");
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role, approval_status")
          .eq("id", data.user.id)
          .maybeSingle<{ role: string; approval_status: string | null }>();
        if (profile?.role !== "owner") {
          router.push("/");
          return;
        }
        if (profile.approval_status !== "approved") {
          router.push("/signup/approval-status");
          return;
        }

        // Get user name from session metadata or email
        const name = data.user.user_metadata?.name || data.user.email || "점주";
        setUserName(name);

        // Get selectedStoreId from sessionStorage
        const storedStoreId = sessionStorage.getItem("selectedStoreId");
        const storedStoreName = sessionStorage.getItem("selectedStoreName");

        if (storedStoreId) {
          setSelectedStoreId(storedStoreId);
          setSelectedStoreName(storedStoreName || "");
        }

        // Fetch approved stores for dropdown
        const response = await fetch("/api/signup/store-membership", { credentials: "include" });
        const result = await response.json();

        if (response.ok && result.success && Array.isArray(result.data)) {
          const approved = result.data.filter(
            (m: ApprovedStore) => m.status === "approved" && m.role === "owner"
          );
          setApprovedStores(approved);

          // ✅ 보안: selectedStoreId 검증
          // storedStoreId가 현재 user의 approved store에 속하는지 확인
          if (approved.length > 0) {
            if (storedStoreId) {
              const isValidStore = approved.some((s: ApprovedStore) => s.storeId === storedStoreId);
              if (!isValidStore) {
                // 검증 실패: sessionStorage의 ID가 유효하지 않음
                // 첫 번째 approved store로 reset
                setSelectedStoreId(approved[0].storeId);
                setSelectedStoreName(approved[0].storeName);
                sessionStorage.setItem("selectedStoreId", approved[0].storeId);
                sessionStorage.setItem("selectedStoreName", approved[0].storeName);
              }
              // 검증 성공: storedStoreId 유지
            } else {
              // storedStoreId 없음: 첫 번째 approved store 설정
              setSelectedStoreId(approved[0].storeId);
              setSelectedStoreName(approved[0].storeName);
              sessionStorage.setItem("selectedStoreId", approved[0].storeId);
              sessionStorage.setItem("selectedStoreName", approved[0].storeName);
            }
          }
        }

        setIsReady(true);
      } catch (e) {
        console.error("Auth initialization failed:", e);
        router.push("/");
      }
    };

    checkAuthAndInit();
  }, [router]);

  // RAG Upload Handler
  const handleGuideUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = guideText.trim();
    if (!text) {
      setUploadState("error");
      setUploadMessage("가이드 내용을 입력해주세요.");
      return;
    }

    // ✅ 보안: selectedStoreId 재검증
    // 사용자가 sessionStorage를 임의로 변경한 경우 방어
    if (!selectedStoreId || approvedStores.length === 0) {
      setUploadState("error");
      setUploadMessage("접근 권한이 없는 매장입니다.");
      return;
    }

    const isValidStore = approvedStores.some((s: ApprovedStore) => s.storeId === selectedStoreId);
    if (!isValidStore) {
      setUploadState("error");
      setUploadMessage("접근 권한이 없는 매장입니다.");
      return;
    }

    setUploadState("loading");
    setUploadMessage("");

    try {
      const response = await fetch("/api/rag/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          metadata: {
            store: selectedStoreId,
            storeName: selectedStoreName,
            type: "guide",
          },
        }),
      });

      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || "저장에 실패했습니다.");
      }

      setGuideText("");
      setUploadState("success");
      setUploadMessage("가이드가 저장되었습니다.");
      setTimeout(() => {
        setUploadState("idle");
        setUploadMessage("");
      }, 3000);
    } catch (error) {
      setUploadState("error");
      setUploadMessage(
        error instanceof Error ? error.message : "가이드 저장에 실패했습니다."
      );
    }
  };

  const handleStoreChange = (store: ApprovedStore) => {
    setSelectedStoreId(store.storeId);
    setSelectedStoreName(store.storeName);
    sessionStorage.setItem("selectedStoreId", store.storeId);
    sessionStorage.setItem("selectedStoreName", store.storeName);
    setStoreDropdownOpen(false);
  };

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
    } catch (e) {
      console.error("Logout failed:", e);
      router.push("/");
    }
  };

  if (!isReady) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)] flex">
      {/* Sidebar */}
      <OwnerSidebar activeMenu="home" onLogout={handleLogout} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:ml-[240px]">
        {/* Header */}
        <OwnerHeader userName={userName} storeName={selectedStoreName} />

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-6 lg:p-8 max-w-7xl mx-auto">
            {/* Welcome Section */}
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                안녕하세요, {userName} 점주님
              </h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                {selectedStoreName}의 오늘 운영 현황을 확인해보세요.
              </p>
            </div>

            {/* Current Store Section */}
            <div className="bg-white border border-[var(--color-border)] rounded-lg p-6 mb-8">
              <p className="text-sm font-semibold text-[var(--color-text-secondary)] mb-3">
                현재 매장
              </p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-[var(--color-text-primary)]">
                    {selectedStoreName}
                  </p>
                  <p className="text-sm text-[var(--color-status-success)] mt-1">
                    운영 중 · 승인 완료
                  </p>
                </div>
                {approvedStores.length > 1 && (
                  <div className="relative">
                    <button
                      onClick={() => setStoreDropdownOpen(!storeDropdownOpen)}
                      className="flex items-center gap-2 px-4 py-2 border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-bg-surface)] transition-colors"
                    >
                      매장 변경
                      <ChevronDown size={18} />
                    </button>
                    {storeDropdownOpen && (
                      <div className="absolute right-0 mt-2 w-64 bg-white border border-[var(--color-border)] rounded-lg shadow-lg z-10">
                        {approvedStores.map((store) => (
                          <button
                            key={store.storeId}
                            onClick={() => handleStoreChange(store)}
                            className={`w-full text-left px-4 py-3 hover:bg-[var(--color-bg-surface)] transition-colors ${
                              selectedStoreId === store.storeId
                                ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                                : "text-[var(--color-text-primary)]"
                            }`}
                          >
                            <p className="font-semibold">{store.storeName}</p>
                            <p className="text-xs text-[var(--color-text-secondary)]">
                              {store.status === "approved" && "승인 완료"}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Today's Management Section */}
            <div className="mb-8">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">
                오늘의 매장 관리
              </h2>
              <div className="grid grid-cols-3 gap-4">
                {/* Staff Management */}
                <div className="bg-white border border-[var(--color-border)] rounded-lg p-6 hover:shadow-sm transition-shadow">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-[var(--color-text-primary)]">
                        직원 관리
                      </h3>
                      <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                        직원 승인과 근무 현황을 확인하세요.
                      </p>
                    </div>
                    <Users size={24} className="text-[var(--color-primary)]" />
                  </div>
                  <button
                    onClick={() => {}}
                    className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
                  >
                    관리하기 →
                  </button>
                </div>

                {/* Manual Management */}
                <div className="bg-white border border-[var(--color-border)] rounded-lg p-6 hover:shadow-sm transition-shadow">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-[var(--color-text-primary)]">
                        매뉴얼 관리
                      </h3>
                      <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                        매장의 업무 매뉴얼을 등록하고 관리하세요.
                      </p>
                    </div>
                    <BookOpen size={24} className="text-[var(--color-primary)]" />
                  </div>
                  <button
                    onClick={() => {}}
                    className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
                  >
                    관리하기 →
                  </button>
                </div>

                {/* AI Assistant */}
                <div className="bg-white border border-[var(--color-border)] rounded-lg p-6 hover:shadow-sm transition-shadow">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-[var(--color-text-primary)]">
                        AI 업무 도우미
                      </h3>
                      <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                        매뉴얼을 기반으로 필요한 정보를 빠르게 확인하세요.
                      </p>
                    </div>
                    <Sparkles size={24} className="text-[var(--color-primary)]" />
                  </div>
                  <button
                    onClick={() => {}}
                    className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
                  >
                    질문하기 →
                  </button>
                </div>
              </div>
            </div>

            {/* Two Column Layout: Staff Overview + Pending Tasks */}
            <div className="grid grid-cols-3 gap-6 mb-8">
              {/* Staff Overview - 2/3 width */}
              <div className="col-span-2 bg-white border border-[var(--color-border)] rounded-lg p-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-[var(--color-text-primary)]">
                      오늘의 직원 현황
                    </h3>
                  </div>
                  <button className="text-sm font-semibold text-[var(--color-primary)] hover:underline">
                    전체 보기 →
                  </button>
                </div>
                <div className="space-y-4">
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    등록된 직원이 없습니다. 직원 관리에서 직원을 등록해보세요.
                  </p>
                </div>
              </div>

              {/* Pending Tasks - 1/3 width */}
              <div className="bg-white border border-[var(--color-border)] rounded-lg p-6">
                <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-6">
                  확인이 필요한 업무
                </h3>
                <div className="space-y-4">
                  <div className="pb-4 border-b border-[var(--color-border)]">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                      직원 가입 승인 요청
                    </p>
                    <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-2">
                      0건
                    </p>
                  </div>
                  <div className="pb-4 border-b border-[var(--color-border)]">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                      확인이 필요한 매뉴얼
                    </p>
                    <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-2">
                      0건
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                      미확인 공지
                    </p>
                    <p className="text-2xl font-bold text-[var(--color-text-primary)] mt-2">
                      0건
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Guide Uploader Section */}
            <div>
              <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">
                매뉴얼 등록
              </h2>
              <form
                onSubmit={handleGuideUpload}
                className="bg-white border border-[var(--color-border)] rounded-lg p-6"
              >
                <div className="flex items-start gap-4 mb-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--color-primary-light)]">
                    <UploadCloud size={24} className="text-[var(--color-primary)]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-[var(--color-text-primary)]">
                      새 매장 가이드 등록
                    </h3>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                      알바생 질문에 활용할 업무 절차와 운영 노하우를 입력해주세요.
                    </p>
                  </div>
                </div>

                <textarea
                  value={guideText}
                  onChange={(e) => setGuideText(e.target.value)}
                  placeholder="예: 마감할 때는 먼저 에스프레소 머신을 세척하고..."
                  className="w-full min-h-48 border border-[var(--color-border)] rounded-lg p-4 text-sm focus:border-[var(--color-primary)] focus:outline-none resize-y"
                />

                <div className="mt-4 flex items-center justify-between">
                  {uploadMessage && (
                    <p
                      className={`text-sm font-semibold ${
                        uploadState === "error"
                          ? "text-red-600"
                          : "text-[var(--color-status-success)]"
                      }`}
                    >
                      {uploadMessage}
                    </p>
                  )}
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={uploadState === "loading"}
                    className="ml-auto"
                  >
                    <UploadCloud size={16} className="mr-2" />
                    {uploadState === "loading" ? "저장 중..." : "가이드 저장"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
